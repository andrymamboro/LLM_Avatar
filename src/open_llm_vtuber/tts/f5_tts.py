import os
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"  # Memaksa penggunaan CPU untuk menghindari error CUDA/cuDNN

import torch
torch.cuda.is_available = lambda: False  # Memaksa PyTorch untuk tidak menggunakan CUDA

import soundfile as sf
from loguru import logger
from typing import Optional
from .tts_interface import TTSInterface


def _load_audio_with_soundfile(
    uri: str,
    frame_offset: int = 0,
    num_frames: int = -1,
    normalize: bool = True,
    channels_first: bool = True,
    format: str | None = None,
    buffer_size: int = 4096,
    backend: str | None = None,
) -> tuple[torch.Tensor, int]:
    """Load audio as float32 tensor without relying on torchaudio/torchcodec.

    This keeps F5-TTS functional on CPU-only environments where torchcodec
    wheels may still depend on CUDA runtime libraries.
    """
    del normalize, format, buffer_size, backend

    audio, sample_rate = sf.read(uri, dtype="float32", always_2d=True)

    if frame_offset > 0:
        audio = audio[frame_offset:]
    if num_frames is not None and num_frames > -1:
        audio = audio[:num_frames]

    tensor = torch.from_numpy(audio)
    if channels_first:
        tensor = tensor.transpose(0, 1)

    return tensor, int(sample_rate)

try:
    # Use the stable high-level API from the f5-tts package.
    from f5_tts.api import F5TTS
    F5_PT_AVAILABLE = True
except ImportError:
    F5_PT_AVAILABLE = False
    logger.warning("f5-tts tidak terinstal. Jalankan: pip install f5-tts")


class TTSEngine(TTSInterface):
    def __init__(
        self,
        model_path: str = "models/f5_tts/f5_tts_indo_v2.pt",
        vocab_path: str = "models/f5_tts/vocab.txt",
        ref_audio_path: str = "models/f5_tts/my_voice.wav",
        ref_text: str = "Ini adalah rekaman contoh suara saya dalam bahasa indonesia.",
        device: Optional[str] = "cpu",
    ):
        """Initializes the F5-TTS PyTorch engine for Indonesian Voice Cloning."""
        if not F5_PT_AVAILABLE:
            raise ImportError("Pustaka f5-tts wajib diinstal terlebih dahulu.")

        self.model_path = model_path
        self.vocab_path = vocab_path
        self.ref_audio_path = ref_audio_path
        self.ref_text = ref_text
        
        # MODIFIKASI: Dipaksa menggunakan CPU untuk menghindari error CUDA/cuDNN
        self.device = "cpu"

        # Validasi file lokal aplikasi
        for path in [self.model_path, self.vocab_path, self.ref_audio_path]:
            if not os.path.exists(path):
                raise FileNotFoundError(f"Aset aplikasi tidak ditemukan: {path}")

        logger.info(f"f5_tts: Terpaksa menggunakan device: {self.device}")

        try:
            # `model_path` in app config maps to `ckpt_file` in f5-tts API.
            # Patch internal loader to avoid torchcodec CUDA-linked binaries.
            import f5_tts.infer.utils_infer as f5_utils

            f5_utils.torchaudio.load = _load_audio_with_soundfile

            self.model = F5TTS(
                ckpt_file=self.model_path,
                vocab_file=self.vocab_path,
                device=self.device,
            )
            logger.info("Mesin suara lokal F5-TTS (.pt) siap digunakan pada mode CPU.")
        except Exception as e:
            logger.critical(f"Gagal memuat file .pt ke memori CPU: {e}")
            raise

    def generate_audio(
        self, text: str, file_name_no_ext: str | None = None
    ) -> str | None:
        """Generates voice-cloned speech using the loaded PyTorch checkpoint."""
        file_name = self.generate_cache_file_name(file_name_no_ext)
        if not file_name.endswith(".wav"):
            file_name += ".wav"

        try:
            logger.info(f"Memproses pengucapan teks di CPU: '{text}'")

            wav, sample_rate, _spec = self.model.infer(
                ref_file=self.ref_audio_path,
                ref_text=self.ref_text,
                gen_text=text,
            )

            # Simpan output array murni menjadi file audio fisik aplikasi
            sf.write(file_name, wav, sample_rate)
            logger.info(f"Audio asisten sukses dibuat: {file_name}")
            return file_name

        except Exception as e:
            logger.critical(f"Gagal memproses pembuatan suara di CPU: {e}")
            return None

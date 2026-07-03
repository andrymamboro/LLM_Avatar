#!/usr/bin/env python3
"""CosyVoice Gradio server compatible with Open LLM VTuber.

This exposes the `/generate_audio` endpoint expected by
`src/open_llm_vtuber/tts/cosyvoice_tts.py`.
"""

from __future__ import annotations

import argparse
import importlib
import math
import os
import tempfile
from typing import Any, Iterable

import gradio as gr
import soundfile as sf
import torch


MODE_SFT = "预训练音色"
MODE_ZERO_SHOT = "3s极速复刻"
MODE_CROSS_LINGUAL = "跨语种复刻"
MODE_INSTRUCT = "自然语言控制"
MODES = [MODE_SFT, MODE_ZERO_SHOT, MODE_CROSS_LINGUAL, MODE_INSTRUCT]


class MockCosyVoice:
    """Small local synthesizer used only for connection testing."""

    sample_rate = 22050
    list_avaliable_spks = ["中文女", "中文男", "英文女", "英文男"]

    def _tone(self, tts_text: str, frequency: float = 440.0) -> Iterable[dict[str, torch.Tensor]]:
        duration = max(0.6, min(4.0, 0.08 * len(tts_text)))
        samples = int(self.sample_rate * duration)
        timeline = torch.linspace(0, duration, samples)
        envelope = torch.linspace(0.05, 0.35, samples).minimum(torch.linspace(0.35, 0.05, samples))
        waveform = torch.sin(2 * math.pi * frequency * timeline) * envelope
        yield {"tts_speech": waveform.unsqueeze(0)}

    def inference_sft(self, tts_text: str, spk_id: str, **_: Any) -> Iterable[dict[str, torch.Tensor]]:
        return self._tone(tts_text, 440.0)

    def inference_zero_shot(self, tts_text: str, *_: Any, **__: Any) -> Iterable[dict[str, torch.Tensor]]:
        return self._tone(tts_text, 523.25)

    def inference_cross_lingual(self, tts_text: str, *_: Any, **__: Any) -> Iterable[dict[str, torch.Tensor]]:
        return self._tone(tts_text, 659.25)

    def inference_instruct(self, tts_text: str, *_: Any, **__: Any) -> Iterable[dict[str, torch.Tensor]]:
        return self._tone(tts_text, 392.0)


def import_cosyvoice_class(class_name: str) -> type:
    try:
        module = importlib.import_module("cosyvoice.cli.cosyvoice")
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "CosyVoice package tidak ditemukan. Install CosyVoice lalu jalankan script ini "
            "dengan PYTHONPATH mengarah ke repo CosyVoice, atau pakai --mock untuk tes koneksi."
        ) from exc

    try:
        return getattr(module, class_name)
    except AttributeError as exc:
        raise RuntimeError(f"Class {class_name} tidak ditemukan di cosyvoice.cli.cosyvoice.") from exc


def load_wav(path: str | None, target_sr: int) -> torch.Tensor | None:
    if not path:
        return None

    file_utils = importlib.import_module("cosyvoice.utils.file_utils")
    return file_utils.load_wav(path, target_sr)


def create_engine(args: argparse.Namespace) -> Any:
    if args.mock:
        return MockCosyVoice()

    if not args.model_dir:
        raise RuntimeError("Berikan --model-dir, misalnya models/CosyVoice-300M-SFT.")

    engine_class = import_cosyvoice_class(args.engine)
    kwargs = {
        "load_jit": args.load_jit,
        "load_trt": args.load_trt,
        "fp16": args.fp16,
    }
    return engine_class(args.model_dir, **kwargs)


def first_audio_path(result: Iterable[dict[str, torch.Tensor]], sample_rate: int) -> str:
    chunks = []
    for item in result:
        if "tts_speech" not in item:
            continue
        speech = item["tts_speech"].detach().cpu()
        if speech.ndim == 1:
            speech = speech.unsqueeze(0)
        chunks.append(speech)

    if not chunks:
        raise gr.Error("CosyVoice tidak menghasilkan audio.")

    audio = torch.cat(chunks, dim=-1)
    output_path = tempfile.NamedTemporaryFile(prefix="cosyvoice_", suffix=".wav", delete=False).name
    sf.write(output_path, audio.squeeze(0).numpy(), sample_rate)
    return output_path


def create_generate_audio(engine: Any, prompt_sample_rate: int):
    sample_rate = int(getattr(engine, "sample_rate", 22050))

    def generate_audio(
        tts_text: str,
        mode_checkbox_group: str,
        sft_dropdown: str,
        prompt_text: str,
        prompt_wav_upload: str | None,
        prompt_wav_record: str | None,
        instruct_text: str,
        seed: int,
    ) -> str:
        if not tts_text or not tts_text.strip():
            raise gr.Error("Text TTS kosong.")

        torch.manual_seed(int(seed or 0))
        prompt_wav = prompt_wav_upload or prompt_wav_record

        if mode_checkbox_group == MODE_SFT:
            result = engine.inference_sft(tts_text, sft_dropdown)
        elif mode_checkbox_group == MODE_ZERO_SHOT:
            prompt_speech = load_wav(prompt_wav, prompt_sample_rate) if not isinstance(engine, MockCosyVoice) else None
            result = engine.inference_zero_shot(tts_text, prompt_text, prompt_speech)
        elif mode_checkbox_group == MODE_CROSS_LINGUAL:
            prompt_speech = load_wav(prompt_wav, prompt_sample_rate) if not isinstance(engine, MockCosyVoice) else None
            result = engine.inference_cross_lingual(tts_text, prompt_speech)
        elif mode_checkbox_group == MODE_INSTRUCT:
            result = engine.inference_instruct(tts_text, sft_dropdown, instruct_text)
        else:
            raise gr.Error(f"Mode tidak dikenal: {mode_checkbox_group}")

        return first_audio_path(result, sample_rate)

    return generate_audio


def build_app(engine: Any, prompt_sample_rate: int) -> gr.Blocks:
    speakers = list(getattr(engine, "list_avaliable_spks", []) or ["中文女", "中文男", "英文女", "英文男"])
    default_speaker = "中文女" if "中文女" in speakers else speakers[0]
    generate_audio = create_generate_audio(engine, prompt_sample_rate)

    with gr.Blocks(title="CosyVoice TTS Server") as app:
        gr.Markdown("# CosyVoice TTS Server")
        gr.Markdown("Endpoint untuk Open LLM VTuber: `api_name='/generate_audio'`.")

        with gr.Row():
            tts_text = gr.Textbox(label="tts_text", lines=4, value="你好，我是 CosyVoice。")
            output_audio = gr.Audio(label="output", type="filepath")

        with gr.Row():
            mode = gr.Radio(MODES, label="mode_checkbox_group", value=MODE_SFT)
            speaker = gr.Dropdown(speakers, label="sft_dropdown", value=default_speaker)

        prompt_text = gr.Textbox(label="prompt_text", value="")
        with gr.Row():
            prompt_upload = gr.Audio(label="prompt_wav_upload", type="filepath")
            prompt_record = gr.Audio(label="prompt_wav_record", type="filepath")

        instruct_text = gr.Textbox(label="instruct_text", value="")
        seed = gr.Number(label="seed", value=0, precision=0)
        submit = gr.Button("Generate", variant="primary")

        inputs = [
            tts_text,
            mode,
            speaker,
            prompt_text,
            prompt_upload,
            prompt_record,
            instruct_text,
            seed,
        ]
        submit.click(generate_audio, inputs=inputs, outputs=output_audio, api_name="generate_audio")

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a CosyVoice Gradio server for Open LLM VTuber.")
    parser.add_argument("--host", default=os.getenv("COSYVOICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("COSYVOICE_PORT", "50000")))
    parser.add_argument("--model-dir", default=os.getenv("COSYVOICE_MODEL_DIR", ""))
    parser.add_argument("--engine", choices=["CosyVoice", "CosyVoice2"], default=os.getenv("COSYVOICE_ENGINE", "CosyVoice"))
    parser.add_argument("--prompt-sample-rate", type=int, default=16000)
    parser.add_argument("--load-jit", action="store_true")
    parser.add_argument("--load-trt", action="store_true")
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--share", action="store_true")
    parser.add_argument("--mock", action="store_true", help="Run without CosyVoice model; emits a test tone.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    engine = create_engine(args)
    app = build_app(engine, args.prompt_sample_rate)
    app.queue(default_concurrency_limit=1).launch(
        server_name=args.host,
        server_port=args.port,
        share=args.share,
        show_error=True,
    )


if __name__ == "__main__":
    main()

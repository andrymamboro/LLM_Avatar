####
# change from xTTS.py
####

import atexit
import os
import subprocess
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from loguru import logger
from .tts_interface import TTSInterface


class TTSEngine(TTSInterface):
    _managed_server_process: subprocess.Popen | None = None
    _atexit_registered: bool = False
    _expression_tag_pattern = re.compile(
        r"\[(neutral|anger|disgust|fear|joy|smirk|sadness|surprise)\]",
        re.IGNORECASE,
    )

    def __init__(
        self,
        api_url: str = "http://127.0.0.1:9880/tts",
        text_lang: str = "zh",
        ref_audio_path: str = "",
        prompt_lang: str = "zh",
        prompt_text: str = "",
        text_split_method: str = "cut5",
        batch_size: str = "1",
        media_type: str = "wav",
        streaming_mode: str = "true",
        auto_start_server: bool = False,
        gpt_sovits_root: str = "",
        startup_timeout_sec: int = 60,
    ):
        self.api_url = api_url
        self.text_lang = text_lang
        self.ref_audio_path = ref_audio_path
        self.prompt_lang = prompt_lang
        self.prompt_text = prompt_text
        self.text_split_method = text_split_method
        self.batch_size = batch_size
        self.media_type = media_type
        self.streaming_mode = streaming_mode
        self.auto_start_server = auto_start_server
        self.gpt_sovits_root = gpt_sovits_root
        self.startup_timeout_sec = startup_timeout_sec
        self.healthcheck_url = self._build_healthcheck_url(api_url)
        self._repo_root = Path(__file__).resolve().parents[3]

        if self.auto_start_server:
            self._ensure_server_ready()

    @staticmethod
    def _build_healthcheck_url(api_url: str) -> str:
        parsed = urlparse(api_url)
        return f"{parsed.scheme}://{parsed.netloc}/openapi.json"

    def _is_server_ready(self) -> bool:
        try:
            response = requests.get(self.healthcheck_url, timeout=3)
            return response.status_code == 200
        except requests.RequestException:
            return False

    @staticmethod
    def _cleanup_managed_server() -> None:
        process = TTSEngine._managed_server_process
        if process is None:
            return
        if process.poll() is None:
            logger.info("Stopping managed GPT-SoVITS server process...")
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    def _resolve_gpt_sovits_root(self) -> Path | None:
        if self.gpt_sovits_root:
            candidate = Path(self.gpt_sovits_root).expanduser().resolve()
            if candidate.exists():
                return candidate
            logger.error(f"Configured gpt_sovits_root not found: {candidate}")
            return None

        auto_candidate = (self._repo_root.parent / "GPT-SoVITS").resolve()
        if auto_candidate.exists():
            return auto_candidate
        logger.error(
            "Unable to auto-detect GPT-SoVITS root. Please set gpt_sovits_root in conf.yaml"
        )
        return None

    def _start_managed_server(self) -> bool:
        gpt_root = self._resolve_gpt_sovits_root()
        if gpt_root is None:
            return False

        script_path = gpt_root / "api_v2.py"
        config_path = gpt_root / "GPT_SoVITS" / "configs" / "tts_infer.yaml"
        if not script_path.exists() or not config_path.exists():
            logger.error(
                "GPT-SoVITS files not found. Expected api_v2.py and GPT_SoVITS/configs/tts_infer.yaml"
            )
            return False

        parsed = urlparse(self.api_url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 9880

        venv_python = self._repo_root / ".venv" / "bin" / "python"
        python_executable = str(venv_python) if venv_python.exists() else sys.executable

        env = os.environ.copy()
        pythonpath_parts = [str(gpt_root), str(gpt_root / "GPT_SoVITS")]
        if env.get("PYTHONPATH"):
            pythonpath_parts.append(env["PYTHONPATH"])
        env["PYTHONPATH"] = ":".join(pythonpath_parts)

        command = [
            python_executable,
            str(script_path),
            "-a",
            host,
            "-p",
            str(port),
            "-c",
            str(config_path),
        ]

        logger.info(
            f"Starting managed GPT-SoVITS server: {' '.join(command)} (cwd={gpt_root})"
        )
        TTSEngine._managed_server_process = subprocess.Popen(
            command,
            cwd=str(gpt_root),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        if not TTSEngine._atexit_registered:
            atexit.register(TTSEngine._cleanup_managed_server)
            TTSEngine._atexit_registered = True

        return True

    def _ensure_server_ready(self) -> None:
        if self._is_server_ready():
            return

        if not self._start_managed_server():
            return

        deadline = time.time() + max(self.startup_timeout_sec, 5)
        while time.time() < deadline:
            if self._is_server_ready():
                logger.info("Managed GPT-SoVITS server is ready.")
                return
            time.sleep(1)

        logger.error(
            "Managed GPT-SoVITS server did not become ready before timeout. "
            "Please check GPT-SoVITS logs and configuration."
        )

    def _resolve_ref_audio_path(self) -> str:
        if not self.ref_audio_path:
            return self.ref_audio_path

        audio_path = Path(self.ref_audio_path).expanduser()
        if audio_path.is_absolute():
            return str(audio_path)

        workspace_audio = (self._repo_root / audio_path).resolve()
        if workspace_audio.exists():
            return str(workspace_audio)

        return str(audio_path)

    def generate_audio(self, text, file_name_no_ext=None):
        if self.auto_start_server and not self._is_server_ready():
            self._ensure_server_ready()

        file_name = self.generate_cache_file_name(file_name_no_ext, self.media_type)
        cleaned_text = self._expression_tag_pattern.sub("", text)
        # Prepare the data for the POST request
        data = {
            "text": cleaned_text,
            "text_lang": self.text_lang,
            "ref_audio_path": self._resolve_ref_audio_path(),
            "prompt_lang": self.prompt_lang,
            "prompt_text": self.prompt_text,
            "text_split_method": self.text_split_method,
            "batch_size": self.batch_size,
            "media_type": self.media_type,
            "streaming_mode": self.streaming_mode,
        }

        # Send POST request to the TTS API
        response = requests.get(self.api_url, params=data, timeout=120)

        # Check if the request was successful
        if response.status_code == 200:
            # Save the audio content to a file
            with open(file_name, "wb") as audio_file:
                audio_file.write(response.content)
            return file_name
        else:
            # Handle errors or unsuccessful requests
            logger.critical(
                f"Error: Failed to generate audio. Status code: {response.status_code}"
            )
            try:
                logger.critical(f"GPT-SoVITS response: {response.text}")
            except Exception:
                pass
            return None

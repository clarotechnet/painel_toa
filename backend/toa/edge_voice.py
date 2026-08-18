from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import threading
from collections import OrderedDict
from collections.abc import Callable


DEFAULT_EDGE_VOICE = "pt-BR-FranciscaNeural"
ALLOWED_EDGE_VOICES = (
    "pt-BR-FranciscaNeural",
    "pt-BR-AntonioNeural",
)
MAX_SPEECH_CHARACTERS = 900


class EdgeVoiceError(RuntimeError):
    pass


def _normalize_text(value: object) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        raise ValueError("O texto da voz esta vazio")
    if len(text) > MAX_SPEECH_CHARACTERS:
        raise ValueError(
            f"O texto da voz excede {MAX_SPEECH_CHARACTERS} caracteres"
        )
    return text


def _render_edge_audio(text: str, voice: str, rate: str) -> bytes:
    try:
        import edge_tts
    except ImportError as exc:
        raise EdgeVoiceError("O componente de voz neural nao esta instalado") from exc

    async def collect() -> bytes:
        chunks: list[bytes] = []
        communicator = edge_tts.Communicate(text, voice, rate=rate)
        async for chunk in communicator.stream():
            if chunk.get("type") == "audio" and chunk.get("data"):
                chunks.append(chunk["data"])
        return b"".join(chunks)

    try:
        audio = asyncio.run(collect())
    except Exception as exc:
        raise EdgeVoiceError("A voz neural esta temporariamente indisponivel") from exc
    if not audio:
        raise EdgeVoiceError("A voz neural nao retornou audio")
    return audio


class EdgeVoiceService:
    def __init__(
        self,
        *,
        renderer: Callable[[str, str, str], bytes] | None = None,
        cache_size: int = 128,
    ) -> None:
        self._renderer = renderer or _render_edge_audio
        self._cache_size = max(1, int(cache_size))
        self._cache: OrderedDict[str, bytes] = OrderedDict()
        self._lock = threading.RLock()
        self._slots = threading.BoundedSemaphore(2)

    @property
    def installed(self) -> bool:
        return importlib.util.find_spec("edge_tts") is not None

    def status(self) -> dict:
        return {
            "available": self.installed,
            "provider": "Microsoft Edge Neural",
            "default_voice": DEFAULT_EDGE_VOICE,
            "voices": list(ALLOWED_EDGE_VOICES),
            "fallback": "Voz local do navegador",
        }

    def synthesize(
        self,
        value: object,
        *,
        voice: str = DEFAULT_EDGE_VOICE,
        rate: str = "-5%",
    ) -> bytes:
        text = _normalize_text(value)
        selected_voice = str(voice or DEFAULT_EDGE_VOICE).strip()
        if selected_voice not in ALLOWED_EDGE_VOICES:
            raise ValueError("Voz nao autorizada")
        selected_rate = str(rate or "-5%").strip()
        if selected_rate not in {"-10%", "-5%", "+0%", "+5%"}:
            raise ValueError("Velocidade de voz nao autorizada")
        key = hashlib.sha256(
            f"{selected_voice}\0{selected_rate}\0{text}".encode("utf-8")
        ).hexdigest()
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
                return cached

        if not self._slots.acquire(timeout=15):
            raise EdgeVoiceError("A voz neural esta ocupada")
        try:
            audio = self._renderer(text, selected_voice, selected_rate)
        finally:
            self._slots.release()
        if not isinstance(audio, bytes) or not audio:
            raise EdgeVoiceError("A voz neural nao retornou audio")

        with self._lock:
            self._cache[key] = audio
            self._cache.move_to_end(key)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return audio


EDGE_VOICE = EdgeVoiceService()

import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
CHROME_PATH = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
# Perfil exclusivo do monitor da TV. Assim ele nao depende do navegador do
# DOMINIUM principal e pode recuperar a propria sessao quando ela expirar.
PROFILE_PATH = ROOT / "config" / "toa_chrome_profile"
EXTENSION_PATH = PROJECT_ROOT / "toa-bridge"
TOA_URL = "https://clarobrasil.etadirect.com/toa/"
DEBUG_PORT = 9341


def _targets() -> list[dict[str, object]]:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{DEBUG_PORT}/json/list",
            timeout=2,
        ) as response:
            payload = json.load(response)
        return payload if isinstance(payload, list) else []
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return []


def launch() -> dict[str, object]:
    if not CHROME_PATH.is_file():
        raise FileNotFoundError(f"Chrome não encontrado: {CHROME_PATH}")
    PROFILE_PATH.mkdir(parents=True, exist_ok=True)

    targets = _targets()
    if not targets:
        arguments = [
            str(CHROME_PATH),
            f"--remote-debugging-port={DEBUG_PORT}",
            f"--user-data-dir={PROFILE_PATH}",
            "--profile-directory=Default",
            "--window-size=1600,1000",
            "--lang=pt-BR",
            "--no-first-run",
            "--no-default-browser-check",
            f"--load-extension={EXTENSION_PATH.resolve()}",
            f"--disable-extensions-except={EXTENSION_PATH.resolve()}",
            "--new-window",
            TOA_URL,
        ]
        subprocess.Popen(
            arguments,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            targets = _targets()
            if targets:
                break
            time.sleep(0.25)
    if not targets:
        raise RuntimeError("Chrome de descoberta não abriu a porta de inspeção")

    toa_targets = [
        target for target in targets
        if "clarobrasil.etadirect.com" in str(target.get("url", ""))
    ]
    return {
        "ok": True,
        "debug_port": DEBUG_PORT,
        "extension_targets": 0,
        "toa_targets": len(toa_targets),
        "extension_loaded": False,
        "collector": "cdp-dom",
        "profile": str(PROFILE_PATH),
    }


if __name__ == "__main__":
    print(json.dumps(launch(), ensure_ascii=False))

"""Mantem a API/painel local (porta 8765) disponivel enquanto o TOA estiver ativo."""
from __future__ import annotations

import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
HOST = "127.0.0.1"
PORT = 8765
APP = ROOT / "app.py"


def log(message: str) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {message}\n"
    with (DATA / "dominium-app-watchdog.log").open("a", encoding="utf-8") as fh:
        fh.write(line)
    print(line, end="", flush=True)


def port_open(timeout: float = 0.35) -> bool:
    try:
        with socket.create_connection((HOST, PORT), timeout=timeout):
            return True
    except OSError:
        return False


def creation_flags() -> int:
    if sys.platform == "win32":
        return int(getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return 0


def start_app() -> subprocess.Popen[bytes]:
    DATA.mkdir(parents=True, exist_ok=True)
    stdout = (DATA / "dominium-app.stdout.log").open("ab", buffering=0)
    stderr = (DATA / "dominium-app.stderr.log").open("ab", buffering=0)
    try:
        process = subprocess.Popen(
            [sys.executable, "-B", str(APP), "--no-browser"],
            cwd=str(ROOT),
            stdout=stdout,
            stderr=stderr,
            creationflags=creation_flags(),
        )
    finally:
        # Popen duplicou os handles no processo filho; o watchdog nao precisa
        # mante-los abertos entre reinicios.
        stdout.close()
        stderr.close()
    log(f"API iniciada. PID={process.pid}")
    return process


def main() -> int:
    log("Watchdog da API iniciado.")
    process: subprocess.Popen[bytes] | None = None

    while True:
        if process is not None:
            code = process.poll()
            if code is None:
                time.sleep(1.0)
                continue
            log(f"API encerrou com codigo {code}; reiniciando em 2 segundos.")
            process = None
            time.sleep(2.0)
            continue

        # Se a porta ja estiver ocupada por uma API existente, nao abre outra.
        # Continua observando; se a porta sumir, cria a nossa instancia.
        if port_open():
            time.sleep(1.0)
            continue

        try:
            process = start_app()
        except Exception as exc:  # pragma: no cover - protecao operacional
            log(f"Falha ao iniciar API: {exc!r}. Nova tentativa em 3 segundos.")
            time.sleep(3.0)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)

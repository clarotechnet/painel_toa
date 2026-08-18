"""Reinicia o supervisor de sessao se o processo encerrar inesperadamente."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SUPERVISOR = Path(__file__).with_name("toa_session_supervisor.py")
RESTART_SECONDS = 5


def main() -> None:
    print("[TOA WATCHDOG] Protecao da sessao iniciada.", flush=True)
    while True:
        process = subprocess.Popen(
            [sys.executable, "-B", str(SUPERVISOR)],
            cwd=str(ROOT),
        )
        try:
            code = process.wait()
        except KeyboardInterrupt:
            process.terminate()
            return
        print(
            f"[TOA WATCHDOG] Supervisor encerrou (codigo {code}); "
            f"reiniciando em {RESTART_SECONDS}s.",
            flush=True,
        )
        time.sleep(RESTART_SECONDS)


if __name__ == "__main__":
    main()

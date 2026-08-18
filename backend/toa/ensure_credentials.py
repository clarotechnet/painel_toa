"""Valida a credencial DPAPI do TOA e a recria no usuário Windows atual quando necessário."""
from __future__ import annotations

import sys
from getpass import getpass
from pathlib import Path

from credentials import TOACredentialError, load_credentials, save_credentials

ROOT = Path(__file__).resolve().parent
CREDENTIALS_PATH = ROOT / "config" / "toa_credentials.dat"


def configure() -> None:
    print()
    print("[CREDENCIAL TOA] É necessário registrar o login neste Windows.")
    print("A senha será digitada de forma oculta e salva com a DPAPI do Windows.")
    print("Ela não será exibida nem gravada em texto puro.")
    print()

    username = input("Usuário/login TOA: ").strip()
    password = getpass("Senha TOA: ")
    if not username or not password:
        raise TOACredentialError("Usuário e senha são obrigatórios.")

    save_credentials(CREDENTIALS_PATH, username, password)
    # Confirma imediatamente que o mesmo usuário/processo consegue ler o arquivo.
    load_credentials(CREDENTIALS_PATH)
    print("[OK] Credencial TOA protegida foi gravada para o usuário Windows atual.")


def main() -> int:
    try:
        load_credentials(CREDENTIALS_PATH)
        print("[OK] Credencial TOA protegida válida para este Windows.")
        return 0
    except TOACredentialError as exc:
        print(f"[AVISO] {exc}")

    try:
        configure()
        return 0
    except (TOACredentialError, OSError) as exc:
        print(f"[ERRO] Não foi possível configurar a credencial TOA: {exc}")
        return 1
    except KeyboardInterrupt:
        print("\n[ERRO] Configuração cancelada pelo usuário.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

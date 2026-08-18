"""Mantem uma sessao TOA dedicada ao monitor, com credencial protegida por DPAPI."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from selenium.common.exceptions import WebDriverException

from credentials import TOACredentialError
from toa_browser import (
    AUTHORIZED_HOSTS,
    TOA_URL,
    authenticated,
    create_driver,
    login_error,
    login_visible,
    prefill_credentials,
    submit_login,
)


ROOT = Path(__file__).resolve().parents[2]
HEARTBEAT_URL = "http://127.0.0.1:8765/api/v1/collector/heartbeat"
CHECK_SECONDS = 5
AUTH_RETRY_SECONDS = 20
AUTH_BLOCKED_RETRY_SECONDS = 300
AUTH_CONFIRM_SECONDS = 45
_next_auth_attempt_at = 0.0
_auth_attempts = 0


def heartbeat(state: str, error: str = "", *, window_state: str = "visible") -> None:
    payload = json.dumps({
        "collector": "toa-session", "state": state,
        "source": "dedicated-chrome", "observed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "error": str(error or "")[:500],
        "details": {
            "profile": "dedicated",
            "login_mode": "dpapi",
            "headless": False,
            "window_state": window_state,
        },
    }).encode("utf-8")
    request = urllib.request.Request(
        HEARTBEAT_URL, data=payload, method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=3):
            pass
    except (OSError, urllib.error.URLError):
        pass


def wait_authenticated(driver, seconds: int = AUTH_CONFIRM_SECONDS) -> tuple[bool, str]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if authenticated(driver):
                return True, ""
            explicit_error = login_error(driver)
            if explicit_error:
                return False, explicit_error
        except WebDriverException:
            return False, "Falha de comunicacao com o navegador"
        time.sleep(1)
    return False, ""


def wait_console_or_login(driver, seconds: int = 20) -> str:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if authenticated(driver):
                return "console"
            if login_visible(driver):
                return "login"
        except WebDriverException:
            return "error"
        time.sleep(1)
    return "timeout"


def ensure_session(driver) -> bool:
    global _next_auth_attempt_at, _auth_attempts
    if authenticated(driver):
        _next_auth_attempt_at = 0.0
        _auth_attempts = 0
        return True
    heartbeat("authenticating")
    if not login_visible(driver):
        current = str(driver.current_url or "")
        hostname = (urllib.parse.urlparse(current).hostname or "").casefold()
        if hostname not in AUTHORIZED_HOSTS:
            driver.get(TOA_URL)
        # Oracle pode manter o mesmo documento enquanto remonta a grade e a
        # arvore de recursos. Navegar novamente durante esse intervalo fazia a
        # Console parecer reiniciar. Uma aba que ja esta no dominio autorizado
        # apenas e observada; somente uma tela de login explicita autoriza acao.
        state = wait_console_or_login(driver)
    else:
        state = "login"
    if state == "console" or authenticated(driver):
        return True
    if state != "login" and not login_visible(driver):
        raise RuntimeError("TOA ainda esta montando a Console; nenhuma navegacao foi executada")
    if time.monotonic() < _next_auth_attempt_at:
        heartbeat("authenticating", "Aguardando intervalo seguro para nova tentativa")
        return False
    print("[TOA SESSION] CAP detectado; iniciando autenticacao protegida.", flush=True)
    prefill_credentials(driver)
    submit_login(driver)
    _auth_attempts += 1
    confirmed, explicit_error = wait_authenticated(driver)
    if not confirmed:
        if explicit_error:
            _next_auth_attempt_at = time.monotonic() + AUTH_BLOCKED_RETRY_SECONDS
            raise RuntimeError(f"CAP recusou a autenticacao: {explicit_error}")
        # Falha transitoria (reload, rede ou formulario remontado): repete cedo,
        # com crescimento moderado para nunca pressionar o login da Claro.
        retry = min(120, AUTH_RETRY_SECONDS * max(1, _auth_attempts))
        _next_auth_attempt_at = time.monotonic() + retry
        raise RuntimeError("O CAP nao concluiu o redirecionamento; nova tentativa sera automatica")
    _next_auth_attempt_at = 0.0
    _auth_attempts = 0
    print("[TOA SESSION] Console recuperada automaticamente.", flush=True)
    if "clarobrasil.etadirect.com" not in str(driver.current_url):
        driver.get(TOA_URL)
        time.sleep(3)
    return authenticated(driver)


def main() -> None:
    driver = None
    minimized = False
    print("[TOA SESSION] Supervisor iniciado; credenciais nunca sao exibidas.", flush=True)
    while True:
        try:
            if driver is None:
                heartbeat("starting", window_state="visible")
                # 2.1.5: o primeiro login fica visivel. Isso evita uma espera
                # silenciosa caso o CAP exiba aviso, redirecionamento ou tela
                # intermediaria. Depois de autenticar a janela e minimizada.
                driver = create_driver(headless=False, background=False)
                minimized = False
                try:
                    current = str(driver.current_url or "")
                    hostname = (urllib.parse.urlparse(current).hostname or "").casefold()
                    if hostname not in AUTHORIZED_HOSTS:
                        driver.get(TOA_URL)
                except WebDriverException:
                    pass

            if ensure_session(driver):
                if not minimized:
                    try:
                        driver.minimize_window()
                        minimized = True
                        print("[TOA SESSION] Console autenticada; Chrome dedicado minimizado.", flush=True)
                    except WebDriverException:
                        minimized = False
                heartbeat("online", window_state="minimized" if minimized else "visible")
            else:
                heartbeat(
                    "authenticating",
                    "Recuperacao automatica em andamento",
                    window_state="visible" if not minimized else "minimized",
                )
            time.sleep(CHECK_SECONDS)
        except TOACredentialError as exc:
            heartbeat("error", "Credencial TOA protegida nao configurada", window_state="visible")
            print(f"[TOA SESSION] {exc}", flush=True)
            time.sleep(30)
        except RuntimeError as exc:
            heartbeat("error", str(exc), window_state="visible" if not minimized else "minimized")
            print(f"[TOA SESSION] {exc}", flush=True)
            time.sleep(CHECK_SECONDS)
        except WebDriverException as exc:
            heartbeat("error", str(exc), window_state="unknown")
            print(f"[TOA SESSION] Navegador desconectou: {exc}", flush=True)
            driver = None
            minimized = False
            time.sleep(CHECK_SECONDS)
        except Exception as exc:
            heartbeat("error", f"Falha inesperada: {exc}", window_state="unknown")
            print(f"[TOA SESSION] Falha inesperada; supervisor continuara ativo: {exc}", flush=True)
            driver = None
            minimized = False
            time.sleep(10)
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    main()

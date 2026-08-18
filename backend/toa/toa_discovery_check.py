import json
import urllib.parse

from selenium import webdriver
from selenium.webdriver.chrome.options import Options

from toa_discovery_browser import CHROME_PATH, DEBUG_PORT


def check() -> dict[str, object]:
    options = Options()
    options.binary_location = str(CHROME_PATH)
    options.debugger_address = f"127.0.0.1:{DEBUG_PORT}"
    driver = webdriver.Chrome(options=options)
    pages: list[dict[str, object]] = []
    for handle in driver.window_handles:
        driver.switch_to.window(handle)
        current_url = str(driver.current_url or "")
        parsed = urllib.parse.urlparse(current_url)
        if parsed.hostname != "clarobrasil.etadirect.com":
            continue
        hook_active = bool(driver.execute_script(
            "return Boolean(window.__TOA_DISCOVERY_HOOK_ACTIVE__)"
        ))
        text = str(driver.execute_script(
            "return (document.body && document.body.innerText || '').slice(0, 10000)"
        ) or "").casefold()
        pages.append({
            "path": parsed.path,
            "title": str(driver.title or "")[:120],
            "hook_active": hook_active,
            "authenticated_markers": any(marker in text for marker in (
                "console de aloca",
                "detalhes da atividade",
                "pesquisa em atividades",
                "recursos",
            )),
            "login_visible": "sign in" in text or "entrar" in text,
        })
    return {
        "ok": True,
        "pages": pages,
        "hook_active": any(bool(page["hook_active"]) for page in pages),
        "authenticated": any(bool(page["authenticated_markers"]) for page in pages),
    }


if __name__ == "__main__":
    print(json.dumps(check(), ensure_ascii=False))

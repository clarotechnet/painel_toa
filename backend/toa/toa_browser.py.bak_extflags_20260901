import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException, WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.keys import Keys

from credentials import load_credentials


ROOT = Path(__file__).resolve().parent
TOA_URL = "https://clarobrasil.etadirect.com/toa/"
TOA_DUO_URL = "https://clarobrasil.etadirect.com/"
PROFILE_PATH = ROOT / "config" / "toa_chrome_profile"
CREDENTIALS_PATH = ROOT / "config" / "toa_credentials.dat"
CHROME_PATH = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
DEBUG_PORT = 9341
AUTHORIZED_HOSTS = frozenset({
    "clarobrasil.etadirect.com",
    "cap.claro.com.br",
})


def _hide_windows_for_pid(pid: int) -> None:
    """Esconde somente a janela do Chrome dedicado sem usar modo headless.

    O Oracle/TOA se comporta de forma mais confiavel em um Chrome normal.
    Mantemos esse Chrome fora da tela do usuario, mas com renderizacao real.
    """
    if sys.platform != "win32" or not pid:
        return
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def callback(hwnd, _lparam):
            owner = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
            if owner.value == int(pid):
                user32.ShowWindow(hwnd, 0)  # SW_HIDE
            return True

        user32.EnumWindows(enum_proc(callback), 0)
    except Exception:
        # A posicao fora da tela abaixo continua servindo como fallback.
        pass


def create_driver(
    *,
    headless: bool = False,
    background: bool = False,
    launch_if_missing: bool = True,
) -> webdriver.Chrome:
    PROFILE_PATH.mkdir(parents=True, exist_ok=True)
    launched_pid = 0
    if not _debugger_running():
        if not launch_if_missing:
            raise RuntimeError("O Chrome TOA de automacao nao esta aberto")
        arguments = [
            str(CHROME_PATH),
            f"--remote-debugging-port={DEBUG_PORT}",
            f"--user-data-dir={PROFILE_PATH}",
            "--profile-directory=Default",
            "--window-size=1600,1000",
            "--lang=pt-BR",
            "--no-first-run",
            "--no-default-browser-check",
            # Evita que o Oracle suspenda timers/rede quando a janela dedicada
            # estiver escondida fora da area de trabalho.
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            "--disable-features=CalculateNativeWinOcclusion",
            f"--load-extension={(ROOT.parent.parent / 'toa-bridge').resolve()}",
            f"--disable-extensions-except={(ROOT.parent.parent / 'toa-bridge').resolve()}",
        ]
        if headless:
            arguments.extend((
                "--headless=new",
                "--disable-gpu",
            ))
        else:
            arguments.append("--new-window")
            # Na inicializacao deixamos a janela visivel para que qualquer tela
            # intermediaria do CAP/Oracle possa ser vista. O supervisor minimiza
            # a janela assim que o Console de Alocacao estiver autenticado.
            if background:
                arguments.append("--start-minimized")
        # Abre diretamente no TOA em vez de depender de uma aba restaurada do perfil.
        arguments.append(TOA_URL)
        process = subprocess.Popen(
            arguments,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        launched_pid = int(process.pid or 0)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and not _debugger_running():
            time.sleep(0.25)
        if not _debugger_running():
            raise RuntimeError("O Chrome TOA nao abriu a porta de automacao")

    options = Options()
    options.binary_location = str(CHROME_PATH)
    options.debugger_address = f"127.0.0.1:{DEBUG_PORT}"
    driver = webdriver.Chrome(options=options)
    select_toa_tab(driver)
    return driver


def select_toa_tab(driver: webdriver.Chrome) -> bool:
    """Select the Oracle/CAP page when another Chrome tab has focus."""
    cap_handle = None
    for handle in driver.window_handles:
        try:
            driver.switch_to.window(handle)
            hostname = (urllib.parse.urlparse(str(driver.current_url or "")).hostname or "").casefold()
            if hostname == "clarobrasil.etadirect.com":
                return True
            if hostname == "cap.claro.com.br":
                cap_handle = handle
        except WebDriverException:
            continue
    if cap_handle:
        driver.switch_to.window(cap_handle)
        return True
    return False


def _debugger_running() -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{DEBUG_PORT}/json/version",
            timeout=1,
        ) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def debugger_running() -> bool:
    """Return whether the DOMINIUM-managed Chrome can be reattached."""
    return _debugger_running()


def close_browser(driver: webdriver.Chrome) -> None:
    try:
        driver.execute_cdp_cmd("Browser.close", {})
    except Exception:
        pass


def _first_visible(driver: webdriver.Chrome, selectors):
    for by, selector in selectors:
        try:
            for element in driver.find_elements(by, selector):
                if element.is_displayed() and element.is_enabled():
                    return element
        except (NoSuchElementException, WebDriverException):
            continue
    return None


def _login_fields(driver: webdriver.Chrome):
    username = _first_visible(driver, (
        (By.ID, "username"),
        (By.NAME, "username"),
        (By.CSS_SELECTOR, "input[autocomplete='username']"),
        (By.CSS_SELECTOR, "input[type='email']"),
        (By.CSS_SELECTOR, "input[type='text']"),
    ))
    password = _first_visible(driver, (
        (By.ID, "password"),
        (By.NAME, "password"),
        (By.CSS_SELECTOR, "input[autocomplete='current-password']"),
        (By.CSS_SELECTOR, "input[type='password']"),
    ))
    return username, password


def login_visible(driver: webdriver.Chrome) -> bool:
    current_url = str(driver.current_url or "").strip()
    hostname = (urllib.parse.urlparse(current_url).hostname or "").casefold()
    if hostname not in AUTHORIZED_HOSTS:
        return False
    sign_in = _first_visible(driver, ((By.ID, "sign-in"),))
    if sign_in is not None:
        return True
    username, password = _login_fields(driver)
    return username is not None and password is not None


def authenticated(driver: webdriver.Chrome) -> bool:
    if login_visible(driver):
        return False
    current_url = str(driver.current_url or "").strip()
    hostname = (urllib.parse.urlparse(current_url).hostname or "").casefold()
    if hostname != "clarobrasil.etadirect.com":
        return False
    # A grade do Oracle e remontada periodicamente e, por alguns segundos, o
    # texto do body pode ficar vazio. O titulo da Console permanece estavel e
    # evita que essa renderizacao normal seja confundida com sessao expirada.
    title = str(driver.title or "").casefold()
    if "console de aloca" in title:
        return True
    text = driver.find_element(By.TAG_NAME, "body").text.casefold()
    authenticated_markers = (
        "console de aloca",
        "detalhes da atividade",
        "pesquisa em atividades",
        "atividades",
        "recursos",
    )
    return any(marker in text for marker in authenticated_markers)


def prefill_credentials(driver: webdriver.Chrome) -> None:
    if not login_visible(driver):
        return
    credentials = load_credentials(CREDENTIALS_PATH)
    username, password = _login_fields(driver)
    if username is None or password is None:
        raise RuntimeError("Campos de entrada do TOA/CAP nao foram encontrados")
    def fill(element, value: str) -> None:
        element.clear()
        element.send_keys(value)
        if element.get_attribute("value") == value:
            return
        # Alguns builds do CAP remontam o input logo depois do clear(). O
        # setter nativo + eventos preserva o valor no controlador da pagina.
        driver.execute_script("""
          const el=arguments[0], value=arguments[1];
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
          setter.call(el,value);
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
        """, element, value)
        if element.get_attribute("value") != value:
            raise RuntimeError("O CAP apagou um campo durante o preenchimento")

    fill(username, credentials["username"])
    fill(password, credentials["password"])


def login_error(driver: webdriver.Chrome) -> str:
    """Return a sanitized CAP authentication error, never field contents."""
    try:
        text = driver.find_element(By.TAG_NAME, "body").text.casefold()
    except (NoSuchElementException, WebDriverException):
        return ""
    markers = (
        ("senha expir", "Senha expirada"),
        ("usuário bloque", "Usuario bloqueado"),
        ("usuario bloque", "Usuario bloqueado"),
        ("credenciais invál", "Credenciais invalidas"),
        ("credenciais invalid", "Credenciais invalidas"),
        ("usuário ou senha", "Usuario ou senha invalidos"),
        ("usuario ou senha", "Usuario ou senha invalidos"),
        ("login invál", "Login invalido"),
        ("login invalid", "Login invalido"),
        ("muitas tentativas", "Limite de tentativas atingido"),
    )
    for fragment, message in markers:
        if fragment in text:
            return message
    return ""


def submit_login(driver: webdriver.Chrome) -> None:
    """Submit the visible TOA/CAP login form without ever logging credentials."""
    selectors = (
        (By.ID, "sign-in"),
        (By.CSS_SELECTOR, "button[type='submit']"),
        (By.CSS_SELECTOR, "input[type='submit']"),
        (By.XPATH, "//button[contains(translate(normalize-space(.),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'ENVIAR')]"),
    )
    for by, selector in selectors:
        try:
            element = driver.find_element(by, selector)
            if element.is_displayed() and element.is_enabled():
                element.click()
                return
        except NoSuchElementException:
            continue
    _, password = _login_fields(driver)
    if password is not None:
        password.send_keys(Keys.ENTER)
        return
    raise RuntimeError("Botao de entrada do TOA/CAP nao foi encontrado")


def connect_interactively(timeout: int = 900) -> None:
    driver = create_driver(headless=False)
    try:
        driver.get(TOA_URL)
        time.sleep(2)
        if authenticated(driver):
            print("Sessao TOA ja esta autenticada.")
            return
        prefill_credentials(driver)
        print("Janela DOMINIUM TOA aberta. Clique em Conectar.")
        print("Aguardando o Console de Alocacao...")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if authenticated(driver):
                print("Sessao TOA confirmada e salva com seguranca no perfil local.")
                time.sleep(3)
                return
            time.sleep(1)
        raise TimeoutError("O login TOA nao foi concluido dentro de 15 minutos")
    except WebDriverException as exc:
        raise RuntimeError(f"Falha ao abrir a sessao TOA: {exc.msg}") from exc
    finally:
        close_browser(driver)


if __name__ == "__main__":
    connect_interactively()

import datetime as dt
import json
import logging
import re
import shutil
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from credentials import load_credentials


TOA_URL = "https://clarobrasil.etadirect.com/toa/"
DEFAULT_TIMES = ("09:00", "14:00", "17:20")
ROUTE_PREFIX_TARGETS = {
    "NTL": {"target": "rn", "label": "Natal"},
    "PWM": {"target": "rn", "label": "Parnamirim"},
    "FTZ": {"target": "ftz", "label": "Fortaleza"},
    "JCR": {"target": "jcr", "label": "Recife"},
    "MRO": {"target": "mro", "label": "Mossoro"},
}
DEFAULT_ROUTES = (
    {"route": "NTL-DMV", "target": "rn", "label": "Natal"},
    {"route": "NTL-DMV_ADM", "target": "rn", "label": "Natal"},
    {"route": "NTL-DMV_VT", "target": "rn", "label": "Natal"},
    {"route": "PWM-DMV", "target": "rn", "label": "Parnamirim"},
    {"route": "PWM-DMV_ADM", "target": "rn", "label": "Parnamirim"},
    {"route": "PWM-DMV_VT", "target": "rn", "label": "Parnamirim"},
    {"route": "FTZ-DMV_01", "target": "ftz", "label": "Fortaleza"},
    {"route": "FTZ-DMV_01_VT", "target": "ftz", "label": "Fortaleza"},
    {"route": "FTZ-DMV_ADM", "target": "ftz", "label": "Fortaleza"},
    {"route": "JCR-DMV", "target": "jcr", "label": "Recife"},
    {"route": "JCR-DMV_ADM", "target": "jcr", "label": "Recife"},
    {"route": "JCR-DMV_VT", "target": "jcr", "label": "Recife"},
    {"route": "MRO-DMV", "target": "mro", "label": "Mossoro"},
)


class TOAWebExporter:
    def __init__(
        self,
        credentials_path: Path,
        download_root: Path,
        *,
        headless: bool = True,
    ) -> None:
        self.credentials_path = credentials_path
        self.download_root = download_root.resolve()
        self.headless = headless
        self.driver = None
        self.profile_root: Path | None = None

    def __enter__(self) -> "TOAWebExporter":
        self.open()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def open(self) -> None:
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.support.ui import WebDriverWait
        except ImportError as exc:
            raise RuntimeError(
                "Selenium nao esta instalado; execute py -3 -m pip install selenium"
            ) from exc

        self.download_root.mkdir(parents=True, exist_ok=True)
        options = Options()
        options.binary_location = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
        options.add_argument("--window-size=1600,1000")
        options.add_argument("--lang=pt-BR")
        options.add_argument("--no-first-run")
        options.add_argument("--no-default-browser-check")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--remote-debugging-port=0")
        self.profile_root = Path(tempfile.mkdtemp(prefix="dominium-toa-chrome-"))
        options.add_argument(f"--user-data-dir={self.profile_root}")
        options.add_experimental_option(
            "prefs",
            {
                "download.default_directory": str(self.download_root),
                "download.prompt_for_download": False,
                "download.directory_upgrade": True,
                "safebrowsing.enabled": True,
            },
        )
        if self.headless:
            options.add_argument("--headless=new")

        try:
            self.driver = webdriver.Chrome(options=options)
            credentials = load_credentials(self.credentials_path)
            self.driver.get(TOA_URL)
            wait = WebDriverWait(self.driver, 120)
            username = wait.until(
                EC.visibility_of_element_located((By.NAME, "username"))
            )
            password = self.driver.find_element(By.NAME, "password")
            username.clear()
            username.send_keys(credentials["username"])
            password.clear()
            password.send_keys(credentials["password"])
            self.driver.find_element(
                By.XPATH,
                "//button[normalize-space(.)='ENVIAR']",
            ).click()
            wait.until(
                lambda driver: "console de aloca" in driver.find_element(
                    By.TAG_NAME, "body"
                ).text.casefold()
            )
            wait.until(
                EC.visibility_of_element_located(
                    (
                        By.XPATH,
                        "//button[@role='link' and normalize-space(.)='FTZ-DMV_ADM']",
                    )
                )
            )
            time.sleep(5)
        except Exception:
            self.close()
            raise

    def close(self) -> None:
        if self.driver is not None:
            try:
                self.driver.quit()
            finally:
                self.driver = None
        if self.profile_root is not None:
            shutil.rmtree(self.profile_root, ignore_errors=True)
            self.profile_root = None

    def available_routes(self) -> tuple[dict[str, str], ...]:
        if self.driver is None:
            raise RuntimeError("Sessao TOA nao iniciada")

        from selenium.webdriver.common.by import By

        found: dict[str, dict[str, str]] = {}
        for element in self.driver.find_elements(By.XPATH, "//*[@role='link']"):
            route = " ".join(element.text.split()).upper()
            match = re.match(r"^(NTL|PWM|FTZ|JCR|MRO)-[A-Z0-9_-]+$", route)
            if not match:
                continue
            destination = ROUTE_PREFIX_TARGETS[match.group(1)]
            found[route] = {
                "route": route,
                "target": destination["target"],
                "label": destination["label"],
            }
        if not found:
            raise RuntimeError("Nenhum bucket NTL, PWM, FTZ, JCR ou MRO foi localizado")
        prefix_order = {prefix: index for index, prefix in enumerate(ROUTE_PREFIX_TARGETS)}
        return tuple(
            sorted(
                found.values(),
                key=lambda item: (
                    prefix_order[item["route"].split("-", 1)[0]],
                    item["route"],
                ),
            )
        )

    def reset_console(self) -> None:
        if self.driver is None:
            return
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait

        self.driver.get(TOA_URL)
        wait = WebDriverWait(self.driver, 120)
        wait.until(
            lambda driver: "console de aloca" in driver.find_element(
                By.TAG_NAME, "body"
            ).text.casefold()
        )
        wait.until(
            EC.visibility_of_element_located(
                (By.XPATH, "//button[@role='link' and contains(normalize-space(.), '-DMV')]")
            )
        )
        time.sleep(3)

    def export_route(self, route: str, timeout: float = 300.0) -> Path:
        if self.driver is None:
            raise RuntimeError("Sessao TOA nao iniciada")

        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait

        route_button = WebDriverWait(self.driver, 60).until(
            EC.element_to_be_clickable(
                (By.XPATH, f"//button[@role='link' and normalize-space(.)='{route}']")
            )
        )
        self.driver.execute_script("arguments[0].click()", route_button)
        time.sleep(5)

        before = {path.resolve() for path in self.download_root.iterdir() if path.is_file()}
        actions = WebDriverWait(self.driver, 60).until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    "//button[normalize-space(.)='Acoes' or normalize-space(.)='Ações']",
                )
            )
        )
        self.driver.execute_script("arguments[0].click()", actions)
        export = WebDriverWait(self.driver, 30).until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    "//button[@aria-label='Exportar' or normalize-space(.)='Exportar']",
                )
            )
        )
        self.driver.execute_script("arguments[0].click()", export)

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            current = {
                path.resolve()
                for path in self.download_root.iterdir()
                if path.is_file()
            }
            candidates = [
                path
                for path in current - before
                if path.suffix.casefold() != ".crdownload"
                and not path.with_suffix(path.suffix + ".crdownload").exists()
            ]
            if candidates:
                path = max(candidates, key=lambda item: item.stat().st_mtime)
                if path.suffix.casefold() != ".csv":
                    raise RuntimeError(
                        f"O TOA exportou {path.name}; altere o formato do usuario para CSV"
                    )
                if route.casefold() not in path.name.casefold():
                    raise RuntimeError(
                        f"O TOA exportou {path.name}, mas a rota esperada era {route}"
                    )
                self.reset_console()
                return path
            time.sleep(0.5)
        raise TimeoutError(f"O TOA nao concluiu a exportacao de {route} em 5 minutos")


class TOAAutomation:
    def __init__(
        self,
        root: Path,
        import_callback: Callable[[dict[str, str], Path], dict[str, Any]],
        *,
        logger: logging.Logger | None = None,
        times: tuple[str, ...] = DEFAULT_TIMES,
        routes: tuple[dict[str, str], ...] = DEFAULT_ROUTES,
        exporter_factory: Callable[..., TOAWebExporter] = TOAWebExporter,
    ) -> None:
        self.root = root.resolve()
        self.credentials_path = self.root / "config" / "toa_credentials.dat"
        self.export_root = self.root / "logs" / "toa-exports"
        self.history_path = self.root / "logs" / "toa-automation.jsonl"
        self.state_path = self.root / "config" / "toa_automation_state.json"
        self.import_callback = import_callback
        self.logger = logger or logging.getLogger("dominium.toa")
        self.times = times
        self.routes = routes
        self.exporter_factory = exporter_factory
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.scheduler_thread: threading.Thread | None = None
        self.worker_thread: threading.Thread | None = None
        self.running = False
        self.started_at = ""
        self.source = ""
        self.current_route = ""
        self.active_routes = list(routes)
        self.last_run: dict[str, Any] | None = None
        self.executed_slots = self._load_slots()
        self.history = self._load_history()

    def _load_slots(self) -> set[str]:
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
            values = payload.get("executed_slots", [])
            return {str(value) for value in values}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return set()

    def _persist_slots(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        today = dt.date.today().isoformat()
        self.executed_slots = {
            value for value in self.executed_slots if value.startswith(today)
        }
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(
                {"executed_slots": sorted(self.executed_slots)},
                ensure_ascii=True,
                indent=2,
            ),
            encoding="utf-8",
        )
        temporary.replace(self.state_path)

    def _load_history(self) -> list[dict[str, Any]]:
        try:
            lines = self.history_path.read_text(encoding="utf-8").splitlines()[-50:]
        except OSError:
            return []
        history = []
        for line in lines:
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                history.append(value)
        return history

    def _append_history(self, value: dict[str, Any]) -> None:
        self.history_path.parent.mkdir(parents=True, exist_ok=True)
        with self.history_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(value, ensure_ascii=True, separators=(",", ":")))
            stream.write("\n")
        self.history = (self.history + [value])[-50:]

    def start(self) -> None:
        if self.scheduler_thread and self.scheduler_thread.is_alive():
            return
        self.stop_event.clear()
        self.scheduler_thread = threading.Thread(
            target=self._scheduler_loop,
            name="toa-scheduler",
            daemon=True,
        )
        self.scheduler_thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.scheduler_thread:
            self.scheduler_thread.join(timeout=3)

    def trigger(self, source: str = "manual", slot: str = "") -> bool:
        with self.lock:
            if self.running:
                return False
            if slot:
                self.executed_slots.add(slot)
                self._persist_slots()
            self.running = True
            self.started_at = dt.datetime.now().isoformat(timespec="seconds")
            self.source = source
            self.current_route = ""
            self.worker_thread = threading.Thread(
                target=self._run,
                args=(source,),
                name="toa-import-worker",
                daemon=True,
            )
            self.worker_thread.start()
            return True

    def _scheduler_loop(self) -> None:
        while not self.stop_event.is_set():
            now = dt.datetime.now()
            minute = now.strftime("%H:%M")
            if minute in self.times and self.credentials_path.is_file():
                slot = f"{now.date().isoformat()}T{minute}"
                with self.lock:
                    already_executed = slot in self.executed_slots
                if not already_executed:
                    self.trigger("agendada", slot)
            self.stop_event.wait(5)

    def _run(self, source: str) -> None:
        started = time.monotonic()
        run_at = dt.datetime.now()
        run_dir = self.export_root / run_at.strftime("%Y%m%d") / run_at.strftime("%H%M%S")
        results: list[dict[str, Any]] = []
        fatal_error = ""
        self.logger.info("TOA automatico: iniciando rodada %s", source)
        try:
            with self.exporter_factory(
                self.credentials_path,
                run_dir,
                headless=True,
            ) as exporter:
                discover_routes = getattr(exporter, "available_routes", None)
                routes = tuple(discover_routes()) if callable(discover_routes) else self.routes
                if not routes:
                    raise RuntimeError("Nenhum bucket do TOA foi localizado")
                with self.lock:
                    self.active_routes = list(routes)
                self.logger.info(
                    "TOA automatico: %s buckets localizados: %s",
                    len(routes),
                    ", ".join(route["route"] for route in routes),
                )
                for route in routes:
                    with self.lock:
                        self.current_route = route["route"]
                    item: dict[str, Any] = {
                        "route": route["route"],
                        "target": route["target"],
                        "label": route["label"],
                    }
                    route_started = time.monotonic()
                    try:
                        path = exporter.export_route(route["route"])
                        item.update(self.import_callback(route, path))
                        item.setdefault("status", "concluida")
                        item["filename"] = path.name
                        item["bytes"] = path.stat().st_size
                    except Exception as exc:
                        self.logger.exception(
                            "TOA automatico: falha na rota %s", route["route"]
                        )
                        item.update(
                            status="erro",
                            requires_human=True,
                            error=str(exc),
                        )
                        recover = getattr(exporter, "reset_console", None)
                        if callable(recover):
                            try:
                                recover()
                            except Exception:
                                self.logger.exception(
                                    "TOA automatico: falha ao recuperar o console"
                                )
                    item["seconds"] = round(time.monotonic() - route_started, 1)
                    results.append(item)
        except Exception as exc:
            fatal_error = str(exc)
            self.logger.exception("TOA automatico: falha ao abrir a sessao")

        completed_at = dt.datetime.now().isoformat(timespec="seconds")
        run = {
            "started_at": self.started_at,
            "completed_at": completed_at,
            "source": source,
            "seconds": round(time.monotonic() - started, 1),
            "ok": not fatal_error and all(item.get("status") != "erro" for item in results),
            "error": fatal_error,
            "routes": results,
        }
        with self.lock:
            self.last_run = run
            self.running = False
            self.current_route = ""
            try:
                self._append_history(run)
            except OSError:
                self.logger.exception("TOA automatico: nao foi possivel gravar o historico")
        self.logger.info(
            "TOA automatico: rodada concluida em %.1fs (%s)",
            run["seconds"],
            "ok" if run["ok"] else "com falhas",
        )

    def _next_run(self) -> str:
        now = dt.datetime.now()
        for offset in (0, 1):
            day = now.date() + dt.timedelta(days=offset)
            for value in self.times:
                hour, minute = map(int, value.split(":"))
                candidate = dt.datetime.combine(day, dt.time(hour, minute))
                if candidate > now:
                    return candidate.isoformat(timespec="minutes")
        return ""

    def public_state(self) -> dict[str, Any]:
        with self.lock:
            return {
                "ok": True,
                "enabled": True,
                "credentials_configured": self.credentials_path.is_file(),
                "running": self.running,
                "started_at": self.started_at,
                "source": self.source,
                "current_route": self.current_route,
                "times": list(self.times),
                "next_run": self._next_run(),
                "last_run": self.last_run,
                "history": list(reversed(self.history[-10:])),
                "routes": list(self.active_routes),
            }

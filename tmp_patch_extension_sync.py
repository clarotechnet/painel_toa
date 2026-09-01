from pathlib import Path

files = [
    Path(r'C:\Users\Usuario\Documents\sistematoa\backend\toa\toa_browser.py'),
    Path(r'C:\Users\Usuario\Documents\sistematoa\backend\toa\toa_discovery_browser.py'),
]

for f in files:
    s = f.read_text(encoding='utf-8')
    if 'import shutil\n' not in s:
        s = s.replace('import sys\n', 'import shutil\nimport sys\n', 1)
    f.write_text(s, encoding='utf-8')
print('imports-ok')
browser = files[0]
s = browser.read_text(encoding='utf-8')
if 'PERSISTENT_EXTENSION_PATH' not in s:
    marker = 'DEBUG_PORT = 9341\n'
    insert = (
        'DEBUG_PORT = 9341\n'
        'PROJECT_EXTENSION_PATH = (ROOT.parent.parent / "toa-bridge").resolve()\n'
        'PERSISTENT_EXTENSION_PATH = Path(r"C:\\EXTENSAO_TOA_ATLAS")\n'
    )
    s = s.replace(marker, insert, 1)

if 'def _sync_persistent_extension()' not in s:
    marker = '\n\ndef _hide_windows_for_pid(pid: int) -> None:\n'
    func = '''\n\ndef _sync_persistent_extension() -> None:\n    """Mantem a extensao persistente do perfil dedicada igual ao codigo do projeto."""\n    if not PROJECT_EXTENSION_PATH.exists():\n        raise RuntimeError(f"Extensao TOA nao encontrada: {PROJECT_EXTENSION_PATH}")\n    if PERSISTENT_EXTENSION_PATH.exists():\n        shutil.rmtree(PERSISTENT_EXTENSION_PATH)\n    shutil.copytree(\n        PROJECT_EXTENSION_PATH,\n        PERSISTENT_EXTENSION_PATH,\n        ignore=shutil.ignore_patterns("*.bak*", "__pycache__", "tmp_*"),\n    )\n'''
    s = s.replace(marker, func + marker, 1)

browser.write_text(s, encoding='utf-8')
print('browser-sync-function-ok')
s = browser.read_text(encoding='utf-8')
needle = '    if not _debugger_running():\n        if not launch_if_missing:\n'
if '_sync_persistent_extension()' not in s.split('def create_driver',1)[1]:
    repl = '    if not _debugger_running():\n        _sync_persistent_extension()\n        if not launch_if_missing:\n'
    s = s.replace(needle, repl, 1)
browser.write_text(s, encoding='utf-8')
print('browser-sync-call-ok')

discovery = files[1]
s = discovery.read_text(encoding='utf-8')
if 'PERSISTENT_EXTENSION_PATH' not in s:
    s = s.replace(
        'EXTENSION_PATH = ROOT.parent.parent / "toa-bridge"\n',
        'EXTENSION_PATH = ROOT.parent.parent / "toa-bridge"\nPERSISTENT_EXTENSION_PATH = Path(r"C:\\EXTENSAO_TOA_ATLAS")\n',
        1,
    )
if 'def sync_extension_copy()' not in s:
    marker = '\n\ndef main() -> int:\n'
    func = '''\n\ndef sync_extension_copy() -> None:\n    if PERSISTENT_EXTENSION_PATH.exists():\n        shutil.rmtree(PERSISTENT_EXTENSION_PATH)\n    shutil.copytree(\n        EXTENSION_PATH.resolve(),\n        PERSISTENT_EXTENSION_PATH,\n        ignore=shutil.ignore_patterns("*.bak*", "__pycache__", "tmp_*"),\n    )\n'''
    s = s.replace(marker, func + marker, 1)
if '    sync_extension_copy()\n' not in s:
    s = s.replace('def main() -> int:\n', 'def main() -> int:\n    sync_extension_copy()\n', 1)
discovery.write_text(s, encoding='utf-8')
print('discovery-sync-ok')

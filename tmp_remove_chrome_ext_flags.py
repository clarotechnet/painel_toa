from pathlib import Path

files = [
    Path(r'C:\Users\Usuario\Documents\sistematoa\backend\toa\toa_browser.py'),
    Path(r'C:\Users\Usuario\Documents\sistematoa\backend\toa\toa_discovery_browser.py'),
]

for f in files:
    backup = f.with_name(f.name + '.bak_extflags_20260901')
    if not backup.exists():
        backup.write_bytes(f.read_bytes())
    lines = f.read_text(encoding='utf-8').splitlines()
    filtered = [line for line in lines if '--load-extension=' not in line and '--disable-extensions-except=' not in line]
    f.write_text('\n'.join(filtered) + '\n', encoding='utf-8')
    print(f.name, 'removed', len(lines) - len(filtered), 'flag lines')

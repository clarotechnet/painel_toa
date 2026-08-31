from pathlib import Path

p = Path(r'C:\Users\Usuario\Documents\sistematoa\backend\toa\toa_capture.py')
s = p.read_text(encoding='utf-8')
old = '\n    _print_inventory("Materiais/miscelaneas retirados", order.removed_materials)\n'
new = '\n            _print_inventory("Materiais/miscelaneas retirados", order.removed_materials)\n'
if old not in s:
    raise SystemExit('target-not-found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('indent-fixed')

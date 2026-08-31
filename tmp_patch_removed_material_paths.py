from pathlib import Path

root = Path(r'C:\Users\Usuario\Documents\sistematoa')
main = root / 'toa-bridge' / 'content-main.js'
datalake = root / 'toa_datalake_store.py'

s = main.read_text(encoding='utf-8')
old = """      materials: equipment(ctx?.materials || capture?.materials),
      validation: ctx?.captureValidation || capture?.validation || {},
"""
new = """      materials: equipment(ctx?.materials || capture?.materials),
      removed_materials: equipment(ctx?.removedMaterials || capture?.removed_materials),
      validation: ctx?.captureValidation || capture?.validation || {},
"""
if old not in s:
    raise SystemExit('content-main target missing')
main.write_text(s.replace(old, new, 1), encoding='utf-8')

t = datalake.read_text(encoding='utf-8')
old = '                      "material": raw.get("materials") or raw.get("miscelaneas") or []}'
new = '                      "material": raw.get("materials") or raw.get("miscelaneas") or [],\n                      "removed_material": raw.get("removed_materials") or raw.get("removedMaterials") or []}'
if old not in t:
    raise SystemExit('datalake target missing')
datalake.write_text(t.replace(old, new, 1), encoding='utf-8')
print('removed-material-paths-patched')

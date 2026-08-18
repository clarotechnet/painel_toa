import ctypes
import json
from ctypes import wintypes
from pathlib import Path
from typing import Any

class TOACredentialError(RuntimeError):
    pass

class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

def _blob(data: bytes) -> tuple[_DataBlob, Any]:
    buf = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    return _DataBlob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))), buf

def _configure(crypt32: Any, kernel32: Any) -> None:
    ptr = ctypes.POINTER(_DataBlob)
    crypt32.CryptProtectData.argtypes = [ptr, wintypes.LPCWSTR, ptr, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ptr]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    crypt32.CryptUnprotectData.argtypes = [ptr, ctypes.c_void_p, ptr, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ptr]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p

def _protect(data: bytes) -> bytes:
    if not hasattr(ctypes, 'windll'):
        raise TOACredentialError('DPAPI disponível somente no Windows.')
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    _configure(crypt32, kernel32)
    source, source_buf = _blob(data); output = _DataBlob(); entropy, entropy_buf = _blob(b'DominiumTOA:v1')
    ok = crypt32.CryptProtectData(ctypes.byref(source), 'DOMINIUM TOA', ctypes.byref(entropy), None, None, 0x1, ctypes.byref(output))
    if not ok: raise ctypes.WinError()
    try: return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel32.LocalFree(output.pbData); del source_buf, entropy_buf

def _unprotect(data: bytes) -> bytes:
    if not hasattr(ctypes, 'windll'):
        raise TOACredentialError('DPAPI disponível somente no Windows.')
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    _configure(crypt32, kernel32)
    source, source_buf = _blob(data); output = _DataBlob(); entropy, entropy_buf = _blob(b'DominiumTOA:v1')
    ok = crypt32.CryptUnprotectData(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0x1, ctypes.byref(output))
    if not ok: raise ctypes.WinError()
    try: return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel32.LocalFree(output.pbData); del source_buf, entropy_buf

def save_credentials(path: Path, username: str, password: str) -> None:
    payload = json.dumps({'username': username, 'password': password}, ensure_ascii=True, separators=(',', ':')).encode('utf-8')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_protect(payload))

def load_credentials(path: Path) -> dict[str, str]:
    try:
        raw = path.read_bytes()
    except FileNotFoundError as exc:
        raise TOACredentialError(f'Credencial TOA não encontrada: {path}') from exc

    try:
        payload = json.loads(_unprotect(raw).decode('utf-8'))
    except OSError as exc:
        # A DPAPI do Windows vincula o arquivo ao usuário/estado de segurança
        # que o criou. Arquivos copiados de outro PC/conta podem existir, mas
        # não podem ser descriptografados (ex.: NTE_BAD_KEY_STATE / 0x8009000B).
        raise TOACredentialError(
            'A credencial TOA salva não pode ser descriptografada pelo usuário '
            'Windows atual. Ela precisa ser gravada novamente neste computador.'
        ) from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TOACredentialError(
            'O arquivo de credencial TOA está inválido e precisa ser recriado.'
        ) from exc

    if not payload.get('username') or not payload.get('password'):
        raise TOACredentialError('Credencial TOA incompleta.')
    return payload

from getpass import getpass
from pathlib import Path
from credentials import save_credentials

root = Path(__file__).resolve().parent
path = root / 'config' / 'toa_credentials.dat'
username = input('Usuário/login TOA: ').strip()
password = getpass('Senha TOA: ')
if not username or not password:
    raise SystemExit('Usuário e senha são obrigatórios.')
save_credentials(path, username, password)
print(f'Credencial TOA salva com DPAPI em: {path}')

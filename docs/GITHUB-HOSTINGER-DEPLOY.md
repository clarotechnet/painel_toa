# GitHub + Hostinger: publicação automática do painel

O GitHub armazena o código-fonte. A GitHub Action executa os testes, gera
`dist/` e envia somente o site estático para a Hostinger por SFTP.

## O que não deve ir para o GitHub

- `.env.local` e `.env.docker`;
- senha do PostgreSQL, token de ingestão e chave de criptografia do n8n;
- JSON da conta de serviço Firebase e chaves privadas;
- `data/`, bancos SQLite, logs e o perfil do Chrome.

A configuração web de `public/config.js`, incluindo a Firebase Web API Key, é
pública por definição e precisa chegar ao navegador. A proteção de leitura e
escrita é controlada pelas regras do Realtime Database.

## 1. Criar o repositório

No GitHub, crie um repositório **privado**, vazio, sem README e sem `.gitignore`.
Depois, no PowerShell aberto em `D:\sistemas\toa`, execute:

```powershell
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git add .
git status
git commit -m "prepara painel TOA para Firebase e Hostinger"
git push -u origin main
```

Antes do `git commit`, confirme em `git status` que `.env.local`, `.env.docker`,
`data/` e arquivos de conta de serviço não aparecem.

## 2. Obter os dados SFTP na Hostinger

1. Abra **Sites > Painel de controle** no site de destino.
2. Abra **Avançado > Acesso SSH** ou **Acesso remoto**.
3. Ative SSH/SFTP se estiver desativado.
4. Anote IP/host, porta, usuário e caminho exato do `public_html` desse domínio.
5. Defina uma senha SSH/SFTP exclusiva para a implantação.

Na Hostinger a porta SFTP normalmente é `65002`, mas use o número exibido no
seu próprio painel. O caminho costuma ser semelhante a:

```text
/home/u123456789/domains/seu-dominio.com.br/public_html/
```

## 3. Criar o ambiente e os Secrets no GitHub

No repositório, abra **Settings > Environments > New environment**, crie o
ambiente `production` e, dentro dele, cadastre estes Environment secrets:

| Secret | Valor |
| --- | --- |
| `HOSTINGER_SFTP_HOST` | IP ou host mostrado pela Hostinger |
| `HOSTINGER_SFTP_PORT` | Porta mostrada, normalmente `65002` |
| `HOSTINGER_SFTP_USER` | Usuário SSH/SFTP |
| `HOSTINGER_SFTP_PASSWORD` | Senha SSH/SFTP |
| `HOSTINGER_REMOTE_DIR` | Caminho completo do `public_html` do domínio |

Não use a senha da conta do GitHub ou do hPanel. O workflow usa somente os cinco
Secrets acima; nenhum segredo do n8n ou do coletor é necessário na hospedagem.

## 4. Primeira publicação

O primeiro `push` para `main` já dispara o workflow. Para executar novamente:

1. Abra **Actions** no GitHub.
2. Escolha **Publicar painel na Hostinger**.
3. Clique em **Run workflow** e selecione `main`.
4. Aguarde `Build, teste e deploy` ficar verde.

Se a Hostinger ainda mostrar a página padrão, abra o Gerenciador de Arquivos e
remova somente o arquivo padrão criado por ela, como `default.php`, do diretório
correto. Não apague pastas de outros domínios.

## 5. Atualizações futuras

Depois da configuração inicial, cada atualização segue o mesmo fluxo:

```powershell
git add .
git commit -m "descreva a alteração"
git push
```

O workflow testa, gera e publica o painel automaticamente. O computador local e
o Docker ainda precisam permanecer ligados para coletar o TOA e enviar as
atualizações ao Firebase; a Hostinger hospeda somente a interface pública.

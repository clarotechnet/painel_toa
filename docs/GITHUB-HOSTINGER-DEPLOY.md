# GitHub + Hostinger: publicação automática do painel

O GitHub armazena o código-fonte. A GitHub Action executa os testes, gera
`dist/` e envia somente o site estático para `public_html/central` por FTP.

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

## 2. Obter os dados FTP na Hostinger

1. Abra **Sites > Painel de controle** no site de destino.
2. Abra **Arquivos > Contas FTP**.
3. Anote servidor/IP, usuário e senha do mesmo acesso já usado pelos outros
   sites.

O workflow usa a porta FTP `21`. Como a conta abre em `public_html`, o diretório
remoto deste painel está fixado em `./central/`.

## 3. Criar os Secrets no GitHub

No repositório, abra **Settings > Secrets and variables > Actions** e clique em
**New repository secret** para cadastrar:

| Secret | Valor |
| --- | --- |
| `HOSTINGER_FTP_SERVER` | Servidor/IP FTP mostrado pela Hostinger |
| `HOSTINGER_FTP_USERNAME` | Usuário FTP |
| `HOSTINGER_FTP_PASSWORD` | Senha FTP |

Não use a senha da conta do GitHub ou do hPanel. O workflow usa somente os três
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

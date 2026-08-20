# DOMINIUM TOA / TEC1

Monitor independente e somente leitura do Oracle Field Service para operação em TV. O projeto mantém um banco SQLite local, uma API própria e dois coletores complementares:

- `Time/get`: pulso operacional de técnicos, buckets, rota e status a cada 2 minutos.
- DOM/CSV: contingência e enriquecimento dos dados exibidos na Console de Alocação.

Ele não cria, altera nem baixa atividades no TOA e não contém integração com o Imperium.

## Abrir no Windows

1. Execute `backend\toa\configure_credentials.py` uma vez. A credencial é cifrada com DPAPI e só pode ser aberta pelo mesmo usuário do Windows.
2. Dê dois cliques em `Abrir_Painel_TOA.cmd` ou execute `npm start` na pasta do projeto.
3. O painel abre em `http://127.0.0.1:8765/`. O Chrome dedicado do TOA roda como navegador normal **oculto em segundo plano** (sem janela na tela). Isso preserva o comportamento real do Oracle sem abrir uma janela para o usuario.

`npm start` inicia o sistema completo: API SQLite, sessão dedicada do TOA em segundo plano, recuperação automática de login, coletor `Time/get` e painel. Antes de iniciar, ele encerra uma execução antiga do próprio projeto para evitar watchdog ou Chrome duplicado. `npm stop` encerra API, coletores, supervisor e somente o Chrome dedicado da porta `9341`, sem fechar o Chrome pessoal. `npm run dev` inicia somente a interface Vite em `localhost:5173` e deve ser usado apenas para desenvolvimento com a API já ativa.

O inicializador sobe a API, a sessão dedicada do Chrome dedicado, o supervisor de autenticação, o coletor `Time/get` e o painel. Logs técnicos ficam em `data/` e nunca incluem senha, cookie, token ou CSRF. Se precisar refazer a credencial protegida, execute `backend\toa\configure_credentials.py` novamente.

## API local v1

- `GET /api/v1/health`
- `GET /api/v1/monitor/summary`
- `GET /api/v1/monitor/feed`
- `GET /api/v1/activities?date=2026-08-13&bucket=NTL-DMV&status=field`
- `GET /api/v1/buckets`
- `GET /api/v1/technicians`
- `GET /api/v1/tec1/alerts?minutes=30`
- `GET /api/v1/contracts/{contrato}`
- `GET /api/v1/activities/{activityId}`

A API de leitura é limitada ao próprio computador. Para ingestão remota, configure `DOMINIUM_INGEST_TOKEN` e use os endpoints documentados em `docs/API.md`.

## Consulta opcional pela API do TOA

A extensão opcional `toa-bridge/` mantém uma sessão autenticada do TOA como
coletor silencioso para consultas sob demanda através do Worker/D1. Ela usa
somente chamadas internas de leitura, não abre OS visualmente e envia apenas o
retrato operacional sanitizado. Instalação e configuração:
`docs/TOA-CLOUD-BRIDGE.md`.

## Painel online com Docker

A pilha opcional com n8n, PostgreSQL, FastAPI, frontend e HTTPS para VPS está em
`compose.yaml`. Ela preserva o SQLite local e publica somente o retrato operacional
sanitizado. Veja o passo a passo em `docs/DOCKER-N8N-POSTGRESQL.md`.

Para publicar sem VPS, usando n8n no Docker local, Firebase Realtime Database e
o frontend na Hostinger, siga `docs/FIREBASE-N8N-HOSTINGER.md`. Nesse modo o
Firebase envia as mudanças ao navegador imediatamente e o Render não é usado.

## Banco de dados

O arquivo `data/toa_datalake.sqlite3` armazena atividades, OS, equipamentos, histórico, mudanças de status/técnico/bucket e saúde dos coletores. SQLite foi escolhido porque é gratuito, transacional, pesquisável e não exige servidor. JSON continua apenas como formato da API.

## TEC1

TEC1 só é calculado quando existe a janela oficial da atividade. A agenda de rota (`S + duração`) nunca é tratada como janela do cliente. Alertas são consolidados por contrato para evitar que um contrato com várias OS fale várias vezes.

## Desenvolvimento e validação

```powershell
npm install
npm test
npm run build
python app.py --no-browser
```

Dependências opcionais do navegador:

```powershell
python -m pip install -r backend/toa/requirements.txt
```

## Hospedagem

O modo estático (`dist/`) pode ser publicado em hospedagem compartilhada, mas coleta automática, SQLite e sessão TOA precisam de um computador Windows ligado ou de um servidor com navegador compatível. Docker não é obrigatório para a instalação na TV.


## Credencial protegida no Windows (2.1.4)

Ao executar `npm start`, o sistema valida o arquivo `backend/toa/config/toa_credentials.dat`.
Se ele tiver sido criado por outro usuário/estado DPAPI do Windows (erro `0x8009000B` / “Chave inválida para uso no estado especificado”), o inicializador solicitará usuário e senha uma única vez e recriará o arquivo usando a DPAPI do usuário Windows atual. A senha não é exibida nem salva em texto puro.


## Inicialização 2.1.5
Durante a etapa de autenticação inicial o Chrome dedicado fica visível para que telas intermediárias do CAP possam ser vistas. Depois que o Console de Alocação fica autenticado, a janela é minimizada automaticamente. A etapa 5/7 imprime o estado da sessão a cada poucos segundos.

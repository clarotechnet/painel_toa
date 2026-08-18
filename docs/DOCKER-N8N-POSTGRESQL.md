# DOMINIUM TOA online com Docker, n8n e PostgreSQL

## Arquitetura criada

O funcionamento local continua sendo a fonte oficial:

1. Chrome dedicado acessa o TOA no Windows.
2. Os coletores gravam no SQLite local pela API da porta `8765`.
3. A API local monta um retrato sanitizado e o coloca em uma fila `latest-wins`.
4. A fila envia o retrato por HTTPS e Bearer Token para o webhook do n8n.
5. O n8n encaminha o corpo e o token para a FastAPI interna.
6. A FastAPI valida o token e grava o retrato atual no PostgreSQL.
7. O painel online consulta a FastAPI sem criar uma execução n8n a cada 5 segundos.

Se Docker ou internet falhar, SQLite e painel local continuam funcionando. A fila
mantém somente o retrato mais novo e tenta novamente, evitando acumular dados
obsoletos.

## Portas locais

| Servico | Endereco |
|---|---|
| Painel online de teste | `http://localhost:8088` |
| n8n | `http://localhost:5678` |
| FastAPI/saude | `http://localhost:8780/health` |
| PostgreSQL | somente na rede interna Docker |
| Painel/SQLite local | `http://127.0.0.1:8765` |

## 1. Criar os arquivos secretos

No PowerShell, dentro da pasta do projeto, execute o gerador seguro:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-docker-env.ps1
```

O script cria três segredos aleatórios, não os imprime e já coloca o mesmo token
de ingestão nos dois arquivos. Ele se recusa a sobrescrever uma configuração
existente.

Se preferir configurar manualmente, copie os dois arquivos `.example` e substitua
os três marcadores, respectivamente, em:

- `POSTGRES_PASSWORD`
- `N8N_ENCRYPTION_KEY`
- `DOMINIUM_INGEST_TOKEN`

Copie exatamente o mesmo `DOMINIUM_INGEST_TOKEN` para `.env.local`.

Os arquivos `.env.docker` e `.env.local` estão ignorados pelo Git. Os arquivos
`.example` não possuem segredo e podem ser versionados.

## 2. Subir os containers no Docker Desktop

```powershell
docker compose --env-file .env.docker config
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

Espere todos os servicos exibirem `running` ou `healthy`. Para acompanhar:

```powershell
docker compose --env-file .env.docker logs -f --tail 100
```

Use `Ctrl+C` apenas para sair da visualizacao dos logs; os containers continuam
executando.

## 3. Configurar o n8n

1. Abra `http://localhost:5678` e crie a conta proprietaria local.
2. Importe o workflow fornecido:

```powershell
docker compose --env-file .env.docker exec n8n n8n import:workflow --input=/opt/dominium/workflows/dominium-toa-snapshot.json
```

3. Atualize a pagina do n8n.
4. Abra `DOMINIUM TOA - Publicar snapshot no PostgreSQL`.
5. Confirme que o primeiro node usa o caminho `dominium-toa-snapshot`.
6. No n8n 2.x, clique em `Publish` no canto superior direito e confirme a
   publicacao. O webhook de producao so e registrado depois dessa etapa; nao e
   necessario usar `Execute workflow` para o funcionamento normal.

O endereco de producao local passa a ser:

`http://localhost:5678/webhook/dominium-toa-snapshot`

O token não fica dentro do workflow. Ele chega no header `Authorization`, é
repassado pela rede privada Docker e só é validado pela FastAPI.

## 4. Ligar o coletor ao n8n

Confirme em `.env.local`:

```dotenv
DOMINIUM_N8N_WEBHOOK_URL=http://localhost:5678/webhook/dominium-toa-snapshot
DOMINIUM_INGEST_TOKEN=O_MESMO_TOKEN_DO_DOCKER
```

Feche uma execução antiga com `npm stop` e inicie normalmente:

```powershell
npm start
```

A API local lê `.env.local` automaticamente. Nenhuma mudança é necessária nas
credenciais protegidas do TOA.

## 5. Validar o fluxo completo

Depois que o TOA concluir uma coleta:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/api/v1/health
Invoke-RestMethod http://localhost:8780/health
Invoke-RestMethod http://localhost:8780/api/toa-datalake/feed
```

No primeiro resultado, `cloud_sync.state` deve ficar `online`. O terceiro deve
conter `orders` e `timelineActivities`. O painel Docker fica em
`http://localhost:8088`.

Se `cloud_sync.state` estiver `retrying`, confira se o workflow está ativo e veja
as execuções no n8n. Se estiver `configuration_error`, confira URL, HTTPS e token.

## 6. Publicar em uma VPS Hostinger

É necessário um plano VPS com Docker; hospedagem compartilhada não executa essa
pilha. Na VPS:

1. Aponte dois registros DNS `A` para o IP da VPS, por exemplo
   `painel.seudominio.com.br` e `n8n.seudominio.com.br`.
2. Instale Git e Docker/Compose ou use o template Docker da Hostinger.
3. Envie/clonar o projeto e crie `.env.docker` com segredos novos.
4. Ajuste no `.env.docker`:

```dotenv
PANEL_DOMAIN=painel.seudominio.com.br
N8N_DOMAIN=n8n.seudominio.com.br
N8N_HOST=n8n.seudominio.com.br
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://n8n.seudominio.com.br/
N8N_WEBHOOK_URL=https://n8n.seudominio.com.br/
N8N_SECURE_COOKIE=true
CORS_ORIGINS=https://painel.seudominio.com.br
```

5. Libere no firewall somente SSH, TCP 80 e TCP/UDP 443.
6. Inicie com o gateway HTTPS automatico:

```bash
docker compose --env-file .env.docker --profile production up -d --build
```

7. Crie o proprietario do n8n, importe e ative o workflow como no ambiente local.
8. No Windows coletor, altere apenas `.env.local`:

```dotenv
DOMINIUM_N8N_WEBHOOK_URL=https://n8n.seudominio.com.br/webhook/dominium-toa-snapshot
DOMINIUM_INGEST_TOKEN=O_MESMO_TOKEN_DA_VPS
```

9. Reinicie o painel/coletor com `npm stop` e `npm start`.

O Caddy obtém e renova automaticamente os certificados HTTPS quando o DNS já
aponta para a VPS e as portas 80/443 estão acessíveis.

## Operacao e backup

Parar sem apagar dados:

```powershell
docker compose --env-file .env.docker stop
```

Iniciar novamente:

```powershell
docker compose --env-file .env.docker start
```

Atualizar imagens e recriar containers:

```powershell
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d --build
```

Backup logico do PostgreSQL:

```powershell
docker compose --env-file .env.docker exec -T postgres pg_dump -U dominium -d dominium -Fc > dominium-backup.dump
```

Não use `docker compose down -v`, pois `-v` apaga os volumes persistentes do
PostgreSQL, n8n e Caddy.

Se alguma porta local estiver em uso, altere `DOMINIUM_WEB_PORT`,
`DOMINIUM_API_PORT` ou `N8N_LOCAL_PORT` em `.env.docker` antes de iniciar.

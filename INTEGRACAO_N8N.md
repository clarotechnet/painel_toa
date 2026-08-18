# Atualização automática da TV

Este projeto agora mantém um cache SQLite em `data/toa_datalake.sqlite3` e o
front-end consulta esse cache a cada 60 segundos. O CSV continua disponível como
contingência.

Endpoint de entrada:

`POST /api/toa-datalake/ingest`

Para receber pela rede, use o mesmo `DOMINIUM_INGEST_TOKEN` configurado no n8n:

```powershell
$env:DOMINIUM_INGEST_TOKEN='gere-um-segredo-longo-e-unico'
python app.py --host 0.0.0.0 --no-browser
```

Consultas locais:

- `/api/toa-datalake/status`
- `/api/toa-datalake/feed`
- `GET /api/toa-datalake/detail-queue` (somente no próprio PC)
- `POST /api/toa-datalake/detail-queue` (coletor remoto autenticado)
- `/api/toa-datalake/records/CONTRATO_OU_ATIVIDADE`

O receptor aceita atividades e OS gerais, além de detalhes com observação,
código de baixa, equipamentos instalados/retirados/do cliente e materiais.
Nenhuma credencial do TOA é armazenada neste projeto.

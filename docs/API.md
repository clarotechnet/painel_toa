# API DOMINIUM TOA v1

Base local: `http://127.0.0.1:8765/api/v1`

## Leitura

| Endpoint | Finalidade |
|---|---|
| `GET /health` | Banco, último ciclo e saúde dos coletores |
| `GET /monitor/summary` | KPIs da TV |
| `GET /monitor/feed` | Feed completo compatível com o painel |
| `GET /activities` | Lista paginada e sanitizada |
| `GET /buckets` | Totais por bucket |
| `GET /technicians` | Técnicos, logins, buckets e situação |
| `GET /technician-monitor/summary?date=AAAA-MM-DD` | KM e quantidade de pontos por técnico |
| `GET /technician-monitor/track/{login}?date=AAAA-MM-DD` | Trajeto ponto a ponto de um técnico |
| `GET /tec1/alerts?minutes=30` | Alertas por contrato |
| `GET /contracts/{id}` | Atividades, OS, materiais e histórico de um contrato |
| `GET /activities/{id}` | Registro detalhado de uma atividade |

Filtros de `activities`: `profile`, `date`, `status`, `bucket`, `limit` e `offset`.

## Ingestão

- `POST /api/v1/ingest/snapshot`
- `POST /api/v1/ingest/history`
- `POST /api/v1/collector/heartbeat`
- `POST /api/v1/ingest/technician-locations`
- `POST /api/v1/technician-monitor/close-day`

Chamadas locais são aceitas sem token. Pela rede, envie `Authorization: Bearer <DOMINIUM_INGEST_TOKEN>`.

## Privacidade

A API não publica endereço, telefone, e-mail, CPF nem credenciais de sessão. O coletor só envia dados operacionais necessários ao monitoramento. Cookies, token, CSRF e senha permanecem dentro do navegador/DPAPI.

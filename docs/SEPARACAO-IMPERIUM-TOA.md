# Separação realizada

## TOA / TEC1 (este projeto)
- Monitor operacional e Console de Rotas.
- Timeline de atividades e refeição.
- TEC1, risco de janela e alerta sonoro.
- Leitura de CSV e cadastro de técnicos do TOA.
- TOA browser/live/capture/automation/discovery para uso local.

## Imperium (não incluído neste projeto)
- `imperium_api.py`, `imperium_http_api.py`, `imperium_http_plan.py`.
- DataSnap e protocolos de importação/baixa do Imperium.
- Criar OS Manual.
- Baixar OS e códigos de baixa.
- Estoque, materiais, write-off e transferências.
- Relatório/histórico de baixas.
- WhatsApp que dependia da confirmação no Imperium.
- Central inteligente que cruzava TOA com estoque/baixa do Imperium.
- `toa_import.py` após a etapa de parsing, pois sua segunda metade construía o protocolo de importação no Imperium.

## Decisão importante
A interface não foi redesenhada como um painel novo. O CSS original, o motor `operations-monitor.js`, o Console de Rotas e o Modo TV foram mantidos para preservar a experiência da versão original mostrada pelo usuário.

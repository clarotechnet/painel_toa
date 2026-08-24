# DOMINIUM TOA Cloud Bridge

Ponte privada, assíncrona e somente leitura entre o **Dominium primário** e a
sessão TOA que já alimenta o Central/modo TV.

## O que ela resolve

- O Dominium primário não precisa abrir nem manter uma segunda sessão TOA.
- O computador Central continua sendo o único ponto autenticado no Oracle.
- A consulta acontece em segundo plano, sem clicar na busca global ou abrir OS.
- O D1 guarda somente o retrato operacional necessário por até seis horas.
- Contrato, OS, código de baixa, observação, equipamentos e miscelâneas chegam
  ao Dominium primário.
- Nome/endereço/documento/telefone do cliente, senha, cookie e CSRF nunca entram
  no Worker nem no D1.

## Fluxo

```text
Dominium primário
  -> POST /v1/lookups
Cloudflare Worker + D1
  -> fila privada
Extensão no Central
  -> GET /v1/collector/jobs/next
  -> consulta interna autenticada do TOA por contrato
  -> POST /v1/collector/jobs/{id}/result
Dominium primário
  -> GET /v1/lookups/{id}
```

A ponte não baixa OS, não altera rota, não edita atividade e não possui
credenciais do TOA.

## Segurança

- chaves separadas para o Dominium primário e para o coletor;
- autenticação Bearer comparada por hash;
- lista permitida de campos antes de gravar no D1;
- resposta limitada a 256 KiB;
- lease atômico: um job não é processado por dois coletores simultaneamente;
- seis tentativas, expiração da fila em 30 minutos e resultado em seis horas;
- cabeçalhos `no-store`, `nosniff`, CSP e ausência de CORS público;
- chave primária local protegida pelo DPAPI do usuário Windows.

## Desenvolvimento local

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

## Publicação

1. Autorize uma vez com `npx wrangler login`.
2. Crie o banco e atualize a configuração:

```powershell
npx wrangler d1 create dominium-toa-bridge --location=enam --binding=DB --update-config
```

3. Cadastre duas chaves aleatórias e diferentes:

```powershell
npx wrangler secret put DOMINIUM_PRIMARY_TOKEN
npx wrangler secret put DOMINIUM_COLLECTOR_TOKEN
npm run db:remote
npm run deploy
```

4. No sistema autorizado, configure a URL do Worker e a chave primária apenas
   no backend. Nunca coloque essa chave no JavaScript do painel publicado.
5. No computador Central, carregue a extensão 2.6.6 deste projeto, abra **Detalhes > Opções da
   extensão**, informe a URL `workers.dev` e a chave do coletor.

Nunca coloque as chaves em Git, no `wrangler.jsonc` ou no código-fonte.

## Publicação atual da TechNet

- Worker: `dominium-toa-bridge`
- D1: `dominium-toa-bridge`
- URL: `https://dominium-toa-bridge.dominium-toa-cloud-bridge.workers.dev`
- Região preferencial do D1: ENAM
- Extensão pronta: `TOA-TechNet-Bridge-2.6.6.zip`

Esta publicação é independente dos containers Docker, workflows n8n e demais
APIs existentes na conta Cloudflare.

## Endpoints

- `GET /health`
- `POST /v1/lookups` — chave primária
- `GET /v1/lookups/{id}` — chave primária
- `GET /v1/collector/jobs/next?collector_id=...` — chave do coletor
- `POST /v1/collector/jobs/{id}/result` — chave do coletor

## Testes

```powershell
npm run check
npm test
```

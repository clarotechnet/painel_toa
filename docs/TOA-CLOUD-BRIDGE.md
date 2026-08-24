# Ponte silenciosa TOA via Cloudflare

Esta integração é opcional e complementar ao monitor existente. Ela permite que
um sistema autorizado solicite um contrato pelo Worker/D1 e receba um retrato
operacional obtido na sessão autenticada do TOA.

```text
Sistema autorizado
  -> Cloudflare Worker / D1
  -> TOA TechNet Bridge no Chrome
  -> chamadas internas autenticadas do TOA
  -> Cloudflare Worker / D1
  -> sistema autorizado
```

## Segurança

- A versão incorporada é `2.6.7` e fica em `toa-bridge/`.
- O código não contém a chave do coletor nem credenciais do TOA.
- A chave é gravada somente em `chrome.storage.local` pela tela de opções.
- A integração trabalha em modo somente leitura e com `ROUTE_TREE_ONLY_MODE`.
- Não abre OS, não usa a pesquisa visual e não executa baixa ou alteração.
- O retrato remoto exclui endereço, telefone, documento, e-mail, cookies,
  cabeçalhos de sessão, senha, token do TOA e CSRF.

## Instalação permanente

No PowerShell, na raiz do projeto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-toa-bridge.ps1
```

O destino padrão é:

```text
C:\Dominium\TOA-TechNet-Bridge
```

Em seguida:

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione `C:\Dominium\TOA-TechNet-Bridge`.
5. Abra **Detalhes > Opções da extensão**.
6. Marque **Ativar coleta para o Dominium primário**.
7. Confirme o Worker já preenchido:
   `https://dominium-toa-bridge.dominium-toa-cloud-bridge.workers.dev`.
8. Informe a chave recebida por canal privado.
9. Mantenha a identificação `central-toa` e clique em **Salvar e testar**.

Resultado esperado: `Ponte online. Mantenha o TOA aberto.`

## Worker e banco D1

O código auditável do Worker recebido foi incorporado em `toa_cloud_bridge/`.
Arquivos locais (`.dev.vars`, `.wrangler/` e `node_modules/`) e extensões antigas
do pacote não fazem parte do projeto.

Para validar localmente:

```powershell
cd toa_cloud_bridge
npm install
npm run check
npm test
```

Para publicar ou atualizar o Worker, autentique o Wrangler, aplique a migração
e cadastre as duas chaves diretamente no Cloudflare:

```powershell
npx wrangler login
npm run db:remote
npx wrangler secret put DOMINIUM_PRIMARY_TOKEN
npx wrangler secret put DOMINIUM_COLLECTOR_TOKEN
npm run deploy
```

Essas chaves não pertencem aos Secrets do deploy estático da Hostinger. O
frontend publicado não pode receber `DOMINIUM_PRIMARY_TOKEN`; somente um backend
autorizado deve criar e consultar jobs da ponte.

## Operação

Mantenha uma aba autenticada em `https://clarobrasil.etadirect.com/toa/` na
Console de Alocação. A aba pode ficar minimizada, mas o Chrome não pode ser
encerrado.

Diagnóstico no console da página:

```javascript
window.__TN_TOA_DIRECT_STATUS__()
window.TNTOAAutoExport.treeStatus()
window.TNTOAAutoExport.discoverBuckets()
```

Consulta manual de leitura:

```javascript
await window.__TN_TOA_DIRECT_LOOKUP__('4257449')
```

## Dados enviados

Contrato, atividade, tarefas/OS, status, serviço, data, janela, rota, técnico,
login, códigos de baixa, observação técnica, equipamentos instalados/retirados/
do cliente, materiais, miscelâneas e alertas de validação.

## Testes do pacote

```powershell
npm run test:bridge
npm run test:cloud-bridge
```

Sem uma chave válida não é possível concluir o teste online do Worker. A chave
nunca deve ser enviada ao GitHub nem adicionada aos arquivos `.env` públicos.

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

- A versão incorporada é `2.6.2` e fica em `toa-bridge/`.
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
```

Sem uma chave válida não é possível concluir o teste online do Worker. A chave
nunca deve ser enviada ao GitHub nem adicionada aos arquivos `.env` públicos.

# TOA TechNet Bridge 2.6.2

## Ponte Cloudflare do Dominium

Esta versão mantém o bridge local existente e também pode atender a fila
privada Cloudflare/D1 do Dominium primário. Na página de extensões do navegador,
abra **Detalhes > Opções da extensão**, informe a URL `workers.dev`, a chave do
coletor e ative a integração. A publicação atual usa:

`https://dominium-toa-bridge.dominium-toa-cloud-bridge.workers.dev`

A chave fica apenas no armazenamento local da extensão. A extensão nunca envia
login, senha, cookie ou CSRF do TOA. O retrato remoto contém apenas contrato,
atividade, tarefas/OS, códigos de baixa, técnico, observação, equipamentos,
miscelâneas e validação operacional; dados pessoais do cliente são removidos
novamente pelo Worker antes de chegar ao D1.

Extensao local para capturar dados do TOA na sessao ja autenticada do Chrome.
Ela nao possui credenciais e nao executa baixa de OS.

## Dados capturados

- atividade e contrato por `aid`;
- OS 1 pelos slots `193/194/195`;
- OS 2 pelos slots `196/197/198`;
- codigo visivel de baixa de cada OS;
- equipamento entrando pelo pool `install`;
- equipamento saindo pelo pool `deinstall`;
- equipamento no cliente pelo pool `customer`;
- miscelaneas pelo codigo `192`;
- ponto pelo campo `335`;
- acao pelo campo `419`;
- local pelo campo `307`;
- quantidade utilizada e saldo disponivel em campos separados;
- tecnico atribuido, provedor da rota, donos do inventario e remetentes de
  formularios.

Inventario e formularios sao aceitos somente quando o AID coincide exatamente
com a atividade aberta. Itens de outra atividade sao ignorados e registrados
como alerta.

## Saida normalizada

A ultima captura fica disponivel somente para diagnostico em:

```js
window.__TN_LAST_TOA_CAPTURE__
```

O objeto tambem e enviado ao bridge local em `/toa/sync`, junto com os campos
legados usados pelo DOMINIUM.

Para desconexao, as miscelaneas capturadas ficam apenas em
`captured_materials_for_audit`; o campo operacional `materials` permanece
vazio porque desconexao nao usa miscelaneas.

## Instalar para teste

1. Abra `chrome://extensions`.
2. Ative o modo do desenvolvedor.
3. Clique em **Carregar sem compactacao**.
4. Selecione esta pasta.
5. Recarregue a pagina do TOA.

## Testes locais

```powershell
node test-toa-inventory-core.js
node test-disconnect-inventory.js
```

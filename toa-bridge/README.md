# TOA TechNet Bridge 2.6.11

## Lote de monitoramento técnico 2.6.11

- envia `gps_real`, `planned_route` e `service_stops` como conjuntos separados;
- mantém compatibilidade de leitura com os lotes GPS da versão anterior;
- aceita respostas de busca do TOA encapsuladas em `data`, `result`, `response`, `sections` ou `items`;
- descarta automaticamente um template de busca obsoleto e expõe somente um diagnóstico seguro em `window.__TN_TOA_DIRECT_STATUS__()`.

## Validação por PID, data e atividade 2.6.10

- usa a porta real da API local (`8765`) para publicar GPS e paradas;
- rejeita e repete uma resposta `Map.get` quando o PID devolvido pelo TOA não
  corresponde ao PID solicitado;
- transporta o identificador da atividade (`ta`) junto ao ponto GPS real;
- mantém trilha GPS, fotografia das paradas de OS e eventual rota planejada em
  camadas independentes, sem fabricar coordenadas ou associações.

## Vínculo seguro da rota ao técnico 2.6.9

- cada replay silencioso de `Map.get` transporta o PID solicitado até o parser;
- `queue[aid]` é tratada uma única vez como fotografia oficial das paradas;
- impede que o técnico visualmente selecionado receba a rota de outro técnico;
- elimina marcadores duplicados sem misturar a rota planejada aos pontos reais de GPS.

## Rota corrente sem acúmulo 2.6.8

- cada resposta `Map.get` substitui a fotografia de paradas do técnico naquele dia;
- somente atividades da fila com coordenadas reais viram marcadores A, B, C...;
- Na Base, treinamento, refeição e outros itens sem coordenada não viram ponto `(0,0)`;
- a trilha de GPS continua incremental e separada da rota planejada;
- coordenadas nulas, vazias, `(0,0)` ou fora da área operacional brasileira são descartadas.

## Correção de associação do trajeto 2.6.5

- associa ao técnico selecionado os pontos do mapa que o TOA envia sem repetir o PID;
- só interpreta chaves numéricas como PID quando elas pertencem a um recurso conhecido;
- evita misturar sequência/timestamp numérico com identificador de técnico.

## Coleta GPS 2.6.4

- a consulta oficial de `positionHistory` percorre todos os recursos identificados pelo TOA, mesmo quando o bucket não está aberto no mapa;
- recursos repetidos são consultados uma única vez pelo login externo;
- o bucket conhecido acompanha os pontos enviados para permitir os filtros por cidade no painel.
- `window.__TN_TOA_LOCATION_SYNC_ALL__()` força uma consulta completa imediata para diagnóstico;
- paradas de serviço capturadas no mapa são enviadas separadamente da trilha GPS, com marcador, OS, contrato, serviço, status e janela.

## Correção 2.6.3

- completa a árvore de rotas usando também `delta.Provider` das respostas do TOA;
- antes de recusar uma atividade como externa à DMV, consulta seus detalhes em
  modo somente leitura e valida novamente o vínculo técnico → bucket;
- mantém bloqueadas atividades realmente externas à árvore DMV.

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

## Diagnostico do trace tecnico

Depois que o mapa do TOA fizer ao menos uma consulta normal, o hook guarda somente
o formato efemero do ultimo `Map.get`. Para testar a hipotese encontrada no HAR,
execute no console:

```js
await window.__TN_TOA_TEST_TECH_TRACE__()
```

O teste repete a requisicao da propria sessao alterando apenas
`filter[show_tech_trace]` para `1`. A resposta devolvida ao console e um resumo
sanitizado com contagens, nomes de campos relacionados a trace e ate 12 amostras
de coordenada/horario. Ela nao e enviada ao bridge, n8n ou PostgreSQL.

Estado do diagnostico:

```js
window.__TN_TOA_TECH_TRACE_STATUS__()
```

## Varredura GPS silenciosa 2.6.6

Depois que o mapa fizer uma consulta normal, a extensao preserva somente o
molde efemero do `Map.get` da sessao. A arvore `Time.get` fornece os PIDs dos
tecnicos e seus buckets DMV. A cada cinco minutos, a extensao consulta esses
PIDs sequencialmente, com intervalo minimo de um segundo, sem clicar na arvore
e sem abrir atividades. Cada resposta volta ao mesmo pipeline de normalizacao
e envio GPS usado pelas consultas visiveis.

Assim, o mapa precisa ser aberto uma vez depois de recarregar a extensao ou
renovar o login. Depois disso, a pagina pode permanecer na arvore de rotas.
Se a sessao expirar, a varredura para e aguarda um novo login.

Diagnostico e acionamento manual:

```js
window.__TN_TOA_LOCATION_STATUS__()
await window.__TN_TOA_LOCATION_SYNC_MAP_ALL__()
window.__TN_TOA_CANCEL_TECHNICIAN_SYNC__()
```

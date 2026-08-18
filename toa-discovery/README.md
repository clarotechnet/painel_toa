# TOA Discovery

Extensão Chromium/Opera GX separada para mapear, desde `document_start`, os dados operacionais que a sessão autenticada do usuário já recebe do Oracle Field Service.

## Segurança

- Não contorna autenticação, Duo ou permissões do usuário.
- Não enumera IDs: somente valida candidatos observados no DOM, `jQuery.data()`, modelos ou respostas já carregadas.
- O replay de `Hint/provider` só é habilitado depois que uma chamada real é observada na sessão.
- A árvore/modelo é a fonte principal. `Hint/provider` serve apenas para completar login e detalhes ausentes, com concorrência máxima de seis chamadas.
- Cookies, `Authorization`, `X-OFS-CSRF-SECURE`, tickets, tokens e chaves de sessão nunca são enviados ao service worker, gravados ou exportados.
- Payloads brutos são analisados na memória da página e descartados. O armazenamento contém apenas schema, campos e entidades operacionais normalizadas.
- CPF, CNPJ, telefone, e-mail e endereço completo de cliente são descartados.

## Carregar no Opera GX

1. Abra `opera://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Selecione **Carregar sem compactação**.
4. Escolha esta pasta `toa-discovery`.
5. Abra `https://clarobrasil.etadirect.com/toa/` e recarregue a página para que o hook execute antes do Oracle.

No popup da extensão:

- **Iniciar coleta** limpa a captura acumulada, ativa o modo separado por bucket e recarrega o TOA uma vez.
- **Varredura rápida de todos os buckets** percorre os buckets visíveis da árvore, captura IDs e nomes e salva cada bucket automaticamente. Mantenha o TOA aberto durante a passagem.
- A captura preserva recursos sem rota no dia e recursos cujo login não aparece no modelo. Eles ficam marcados como `aguardando_login`, sem serem descartados.
- **Salvar bucket atual** continua disponível como conferência manual e agora usa somente os IDs observados no bucket atual, sem eliminar duplicados legítimos entre buckets.
- **Mapear árvore** inspeciona as fontes que a tela já carregou. No modo por bucket, a separação usa somente as respostas recebidas após o início da coleta, porque o modelo global do TOA acumula cidades já visitadas.
- Passe o mouse ou abra um técnico uma única vez para observar a chamada real `Hint/provider`.
- **Completar logins** enriquece os IDs encontrados em segundo plano; não é requisito para salvar nomes e IDs da árvore.
- **Exportar Excel final** gera `TOA_Inventario_Completo.xlsx` com um índice e uma aba para cada bucket salvo.
- **Exportar JSON** gera `toa-discovery.json` sanitizado.

## Arquitetura

```text
Oracle page
  -> core.js + page-hook.js (MAIN world, document_start)
  -> window.postMessage (somente conteúdo sanitizado)
  -> content.js (isolated world)
  -> service-worker.js
  -> chrome.storage.local
  -> popup/exporter
```

## Escopo atual

Etapas 1 e 2 implementadas:

- captura antecipada de `fetch`, XHR, WebSocket e EventSource;
- catálogo automático de endpoints, parâmetros, tipos, schema e categorias;
- descoberta de candidatos na árvore virtualizada e modelos carregados;
- captura direta `resourceId/nome` da árvore, incluindo recursos sem rota carregada;
- validação complementar `resourceId -> userId/login/nome` usando uma requisição observada;
- coleta incremental separada por bucket, sem reutilizar IDs fixos de outra cidade;
- exportação sanitizada JSON/XLSX.

Atividades, histórico, rota/mapa e inventário já possuem extração genérica por schema, mas precisam de navegação real nessas telas para confirmar os nomes usados nesta instância do TOA.

export function MonitorWorkspace() {
  return `
  <section class="monitor-workspace" id="monitorWorkspace" aria-label="Monitor de ordens de serviço">
    <header class="workspace-heading monitor-heading">
      <div>
        <p class="section-label">MONITORAMENTO</p>
        <h2>Monitor de O.S.</h2>
        <p>Acompanhamento da operação com os dados do TOA.</p>
        <p class="monitor-freshness" id="monitorFreshness" role="status" aria-live="polite">Carregue um CSV do TOA para iniciar.</p>
      </div>
      <div class="monitor-actions">
        <input class="hidden" id="monitorCsvInput" type="file" accept=".csv,text/csv" multiple>
        <button class="button monitor-tv-button" id="monitorTvOpen" type="button"><i data-lucide="monitor-play"></i><span>Modo TV</span></button>
        <button class="button primary monitor-csv-button" id="monitorCsvOpen" type="button"><i data-lucide="file-up"></i><span>Carregar CSV do TOA</span></button>
        <button class="button secondary monitor-demo-toggle" id="monitorDemo" type="button" aria-pressed="false"><i data-lucide="presentation"></i><span>Cenários de exemplo</span></button>
        <button class="button secondary" id="monitorNotify" type="button" title="Ativar alertas locais"><i data-lucide="bell"></i><span>Alertas</span></button>
        <button class="button secondary" id="monitorVoice" type="button" title="Ativar voz para alertas de TEC1" aria-pressed="false"><i data-lucide="volume-2"></i><span>Voz TEC1</span></button>
        <button class="button secondary" id="monitorExport" type="button"><i data-lucide="download"></i><span>Exportar</span></button>
        <button class="button secondary" id="monitorRefresh" type="button"><i data-lucide="refresh-cw"></i><span>Atualizar</span></button>
      </div>
    </header>

    <div class="monitor-demo-banner hidden" id="monitorDemoBanner" role="status"><div><strong>Modo demonstração</strong><span>OS fictícias e isoladas da operação real.</span></div><small>Não notifica nem exporta dados reais.</small></div>

    <section class="monitor-source-card hidden" id="monitorCsvSource" aria-label="Fonte CSV ativa">
      <div class="monitor-source-icon"><i data-lucide="file-check-2"></i></div>
      <div class="monitor-source-copy"><strong>Fotografia do TOA carregada</strong><span id="monitorCsvSourceTitle">Arquivo CSV</span><small id="monitorCsvSourceDetail">Dados operacionais em modo somente leitura.</small></div>
      <button class="button secondary" id="monitorCsvReplace" type="button"><i data-lucide="refresh-cw"></i><span>Trocar CSV</span></button>
      <button class="button ghost danger" id="monitorCsvClear" type="button"><i data-lucide="trash-2"></i><span>Limpar CSV</span></button>
    </section>

    <section class="monitor-attention-stage" id="monitorAttentionStage" aria-label="Central visual de alertas" aria-live="polite"></section>

    <section class="monitor-kpis" aria-label="Indicadores do monitor">
      <article><span>Total de OS</span><strong id="monitorTotal">0</strong><small>Lista consultada</small></article>
      <article class="warning"><span>Em campo</span><strong id="monitorField">0</strong><small>Em execução</small></article>
      <article class="completed"><span>Concluídas</span><strong id="monitorCompleted">0</strong><small>Na lista atual</small></article>
      <article><span>Pendentes</span><strong id="monitorPending">0</strong><small>Aguardando ação</small></article>
      <article class="warning"><span>Revisitas</span><strong id="monitorRevisits">0</strong><small>Quando informado na fonte</small></article>
      <article><span>Com código de baixa</span><strong id="monitorClosedWithCode">0</strong><small>Desfecho identificado</small></article>
      <article class="danger"><span>Alertas de rota</span><strong id="monitorRouteAlerts">0</strong><small>Janela em risco ou perdida</small></article>
    </section>

    <nav class="monitor-tabs" id="monitorTabs" aria-label="Visões do monitor"></nav>

    <section class="monitor-panel">
      <header class="monitor-panel-head">
        <div><h3 id="monitorViewTitle">Monitor de O.S.</h3><p id="monitorViewSubtitle"></p></div>
        <div class="monitor-toolbar">
          <label class="monitor-search"><i data-lucide="search"></i><input id="monitorSearch" type="search" placeholder="OS, contrato, técnico, serviço ou bucket" autocomplete="off"></label>
          <select class="monitor-bucket-filter" id="monitorBucket" aria-label="Filtrar bucket"><option value="all">Todos os buckets</option></select>
          <select id="monitorStatus" aria-label="Filtrar situação">
            <option value="all">Todos os status</option><option value="field">Iniciadas / em rota</option><option value="pending">Pendentes</option><option value="completed">Concluídas</option><option value="suspended">Suspensas / realocadas</option><option value="canceled">Canceladas</option>
          </select>
        </div>
      </header>
      <div class="monitor-notice hidden" id="monitorNotice"></div>
      <div class="route-console hidden" id="monitorRouteConsole"></div>
      <div class="monitor-table-wrap" id="monitorTableWrap"><table class="monitor-table"><thead id="monitorTableHead"></thead><tbody id="monitorTableBody"></tbody></table></div>
    </section>
  </section>`;
}

export function DashboardWorkspace() {
  return `
  <section class="dashboard-workspace" aria-label="Visão geral TOA">
    <header class="workspace-heading dashboard-heading"><div><p class="section-label">PAINEL OPERACIONAL TOA</p><h2>Visão geral</h2></div><span class="dashboard-updated" id="dashboardUpdated">Sem CSV carregado</span></header>
    <section class="dashboard-metrics" aria-label="Indicadores da operação">
      <article class="dashboard-metric"><div><span>OS no TOA</span><i data-lucide="clipboard-list"></i></div><strong id="dashboardOpenCount">0</strong><small>Fotografia CSV atual</small></article>
      <article class="dashboard-metric warning"><div><span>Em campo</span><i data-lucide="truck"></i></div><strong id="dashboardFieldCount">0</strong><small>Em execução</small></article>
      <article class="dashboard-metric success"><div><span>Concluídas</span><i data-lucide="circle-check-big"></i></div><strong id="dashboardCompletedCount">0</strong><small>Lista atual do TOA</small></article>
      <article class="dashboard-metric danger"><div><span>Alertas de rota</span><i data-lucide="triangle-alert"></i></div><strong id="dashboardFailureCount">0</strong><small>TEC1 / janela</small></article>
    </section>
    <div class="dashboard-grid">
      <section class="dashboard-panel status-panel"><header><h3>Distribuição da operação</h3><span id="dashboardTotalLabel">0 OS</span></header><div class="status-distribution" id="dashboardDistribution"></div></section>
      <section class="dashboard-panel city-panel"><header><h3>Volume por cidade</h3><span>CSV atual</span></header><div class="city-bars" id="dashboardCityBars"></div></section>
      <section class="dashboard-panel attention-panel"><header><h3>Atenção operacional</h3><span class="danger-text" id="dashboardAttentionCount">0 alertas</span></header><div class="attention-list" id="dashboardAttentionList"></div></section>
    </div>
    <section class="dashboard-panel recent-panel"><header><h3>Ordens recentes</h3><button class="text-button" id="dashboardOpenOrders" type="button">Ver todas</button></header><div class="table-scroll dashboard-table-scroll"><table><thead><tr><th>OS</th><th>Contrato</th><th>Serviço</th><th>Cidade</th><th>Técnico</th><th>Status</th></tr></thead><tbody id="dashboardRecentBody"></tbody></table></div></section>
  </section>`;
}

export function OrdersWorkspace() {
  return `
  <section class="toa-simple-workspace">
    <header class="workspace-heading orders-heading"><div><p class="section-label">CONSULTA TOA</p><h2>Ordens de serviço</h2><p>Lista somente leitura baseada nos CSVs carregados.</p></div></header>
    <section class="toolbar"><label class="field search-field"><span>Pesquisar</span><input id="ordersSearch" type="search" placeholder="OS, contrato, técnico ou serviço"></label><label class="field service-field"><span>Status</span><select id="ordersStatus"><option value="all">Todos</option><option value="field">Em campo</option><option value="pending">Pendentes</option><option value="completed">Concluídas</option><option value="canceled">Canceladas</option></select></label></section>
    <section class="table-section"><div class="table-scroll"><table><thead><tr><th>OS</th><th>Contrato</th><th>Serviço</th><th>Cidade</th><th>Bucket</th><th>Técnico</th><th>Status</th><th>Janela</th></tr></thead><tbody id="ordersBody"></tbody></table></div><div class="empty-state hidden" id="ordersEmpty">Nenhuma OS encontrada.</div></section>
  </section>`;
}

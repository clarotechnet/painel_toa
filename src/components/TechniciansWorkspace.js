export function TechniciansWorkspace() {
  return `
  <section class="toa-simple-workspace">
    <header class="workspace-heading"><div><p class="section-label">RECURSOS TOA</p><h2>Técnicos</h2><p>Cadastro usado para converter o login do TOA no nome do técnico.</p></div></header>
    <section class="monitor-kpis toa-tech-kpis"><article><span>Técnicos no cadastro</span><strong id="techDirectoryCount">0</strong><small>Base local TOA</small></article><article><span>Na fotografia atual</span><strong id="techActiveCount">0</strong><small>Com atividade no CSV</small></article><article><span>Sem nome mapeado</span><strong id="techUnknownCount">0</strong><small>Login exibido como fallback</small></article></section>
    <section class="toolbar"><label class="field search-field"><span>Pesquisar</span><input id="techSearch" type="search" placeholder="Nome, login, equipe ou bucket"></label></section>
    <section class="table-section"><div class="table-scroll"><table><thead><tr><th>Nome</th><th>Login</th><th>Equipes</th><th>Bucket atual</th><th>OS no CSV</th></tr></thead><tbody id="techBody"></tbody></table></div><div class="empty-state hidden" id="techEmpty">Nenhum técnico encontrado.</div></section>
  </section>`;
}

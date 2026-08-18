export function ImportWorkspace() {
  return `
  <section class="toa-simple-workspace">
    <header class="workspace-heading"><div><p class="section-label">FONTE DE DADOS</p><h2>Carregar CSV do TOA</h2><p>Os arquivos ficam no navegador e são processados localmente.</p></div></header>
    <section class="toa-upload-card">
      <div class="monitor-source-icon"><i data-lucide="file-up"></i></div>
      <div><strong>Fotografia das atividades</strong><p>Selecione um ou vários arquivos Atividades-*.csv exportados pelo TOA.</p></div>
      <button class="button primary" id="importsOpen" type="button"><i data-lucide="upload"></i><span>Selecionar CSV</span></button>
    </section>
    <section class="dashboard-panel"><header><h3>Arquivos carregados</h3><span id="importsCount">0 arquivos</span></header><div id="importsList" class="toa-file-list"></div></section>
    <section class="dashboard-panel hidden" id="importsErrorsPanel"><header><h3>Arquivos com problema</h3><span class="danger-text">Revisar</span></header><div id="importsErrors" class="toa-file-list"></div></section>
  </section>`;
}

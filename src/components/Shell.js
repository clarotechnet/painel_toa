export function Shell() {
  return `
  <header class="app-header">
    <div class="brand-block">
      <div class="brand-mark" aria-hidden="true"><img class="brand-asset brand-primary-logo" src="/assets/brands/logo-novo-compact.svg" alt=""></div>
      <div class="brand-copy">
        <p class="product">TECHNET - DOMINIUM TOA</p>
        <p class="product-tagline">Monitoramento independente do TOA e TEC1.</p>
        <h1>Operação TOA / TEC1</h1>
      </div>
      <img class="header-partner-logo brand-asset" src="/assets/brands/claro-orb.png" alt="Claro">
      <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-controls="primarySidebar" aria-expanded="true" aria-label="Recolher menu lateral" title="Recolher menu lateral">
        <i data-lucide="panel-left-close" aria-hidden="true"></i>
      </button>
    </div>
    <nav class="profile-tabs" id="profileTabs" aria-label="Bases do TOA"></nav>
    <div class="header-actions">
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="Alternar tema" title="Alternar tema">
        <i data-lucide="sun-moon" aria-hidden="true"></i><span id="themeLabel">Modo claro</span>
      </button>
      <div class="connection connected" id="connectionStatus"><span class="status-dot" aria-hidden="true"></span><span>Monitor local</span></div>
      <div class="operator" aria-label="Sistema atual"><span>TOA</span><small>Monitor TEC1</small></div>
      <div class="operator-avatar" aria-hidden="true">T1</div>
    </div>
  </header>

  <div class="app-shell">
    <aside class="side-nav" id="primarySidebar" aria-label="Módulos TOA">
      <p class="side-nav-label">Operação</p>
      <button class="side-nav-item" data-module="dashboard" type="button"><i data-lucide="layout-dashboard"></i><span><strong>Visão geral</strong><small>TOA</small></span></button>
      <button class="side-nav-item active" data-module="monitor" type="button"><i data-lucide="monitor-dot"></i><span><strong>Monitor de O.S.</strong><small>Tempo real</small></span></button>
      <button class="side-nav-item" data-module="orders" type="button"><i data-lucide="clipboard-check"></i><span><strong>Ordens de serviço</strong><small>CSV do TOA</small></span></button>
      <p class="side-nav-label side-nav-section">TOA</p>
      <button class="side-nav-item" data-module="imports" type="button"><i data-lucide="upload"></i><span><strong>Carregar CSV</strong><small>Fonte TOA</small></span></button>
      <button class="side-nav-item" data-module="technicians" type="button"><i data-lucide="users-round"></i><span><strong>Técnicos</strong><small>Cadastro TOA</small></span></button>
      <div class="side-nav-footer">
        <div class="side-brand-lockup" aria-label="TechNet, agente autorizado Claro">
          <img class="side-brand-technet brand-asset" src="/assets/brands/technet-agent.png" alt="TechNet agente autorizado"><span aria-hidden="true"></span><img class="side-brand-claro brand-asset" src="/assets/brands/claro-wordmark.png" alt="Claro">
        </div>
        <div class="side-nav-assurance"><i data-lucide="shield-check"></i><span>Monitor TOA independente</span></div>
      </div>
    </aside>
    <main id="workspaceRoot"></main>
  </div>
  <section class="monitor-tv hidden" id="monitorTv" aria-label="TOA em modo TV"></section>
  <div class="toast-stack" id="toastStack" aria-live="polite"></div>
  `;
}

// content-main.js - Roda no world: MAIN
// Acesso total ao DOM e Knockout.js, mas sem chrome.runtime
// Comunica com content-isolated.js via postMessage

(function () {
  "use strict";

  if (window.__TN_INJECTED__) return;
  window.__TN_INJECTED__ = true;
  window.__TN_DISCONNECT_BUILD__ = 'toa-route-tree-no-os-warmup-20260814';

  const BOT_BRIDGE_HOST = '127.0.0.1';
  const BOT_BRIDGE_PORT = 8787;

  // Estado
  const state = {
    currentAid: null,
    currentContract: null,
    byAid: new Map(),
    byContract: new Map(),
    minimized: false,
    pos: { x: null, y: null },
    template: null,
    searchTemplate: null,
    detailsTemplate: null,
    syncTemplate: null,
    directLookupBusy: false,
    lastDirectResult: null,
    lastDirectSearchRows: [],
    lastExport: null,
    exportStatus: "Aguardando dados...",
    exporting: false,
    lastTemplateAt: null,
    seenAids: new Set(),
    lastSyncAt: null,
    autoLookupBusy: false,
    bridgeAvailable: false,
    lastScreenSyncSig: '',
    lastScreenSyncAt: 0,
    cattaCache: new Map(),
    providersByPid: new Map(),
    providersByExternalId: new Map(),
  };

  // Contador de requests para correlacionar respostas
  let requestId = 0;
  const pendingRequests = new Map();

  // Inicializa comunicação com content-isolated
  function initBridgeProxy() {
    return new Promise((resolve) => {
      // Escuta respostas do content-isolated
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const { type, id, success, result, error } = event.data || {};
        
        if (type === 'TOA_BRIDGE_RESPONSE' && pendingRequests.has(id)) {
          const { resolve, reject } = pendingRequests.get(id);
          pendingRequests.delete(id);
          
          if (success) {
            resolve(result);
          } else {
            reject(new Error(error || 'Bridge proxy error'));
          }
        }
      });

      // Testa conexão
      bridgeFetchProxy('/toa/health')
        .then(() => {
          state.bridgeAvailable = true;
          console.log('[TOA-MAIN] Bridge proxy conectado!');
          resolve(true);
        })
        .catch((err) => {
          console.warn('[TOA-MAIN] Bridge proxy indisponível:', err.message);
          state.bridgeAvailable = false;
          resolve(false);
        });
    });
  }

  // Proxy para bridge via content-isolated.js
  function bridgeFetchProxy(path, options = {}) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pendingRequests.set(id, { resolve, reject });
      
      // Envia para content-isolated.js
      window.postMessage({
        type: 'TOA_BRIDGE_REQUEST',
        id,
        path,
        options
      }, '*');

      // Timeout de 10 segundos
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('Bridge proxy timeout'));
        }
      }, 10000);
    });
  }

  // Alias para compatibilidade
  const bridgeFetch = bridgeFetchProxy;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function normalizeText(txt) {
    return String(txt || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function firstText() {
    for (const value of arguments) {
      const text = String(value || '').trim();
      if (text) return text;
    }
    return '';
  }

  function getValueByLabel(labelText) {
    const target = normalizeText(labelText);
    const labels = Array.from(document.querySelectorAll('label'));
    const label = labels.find(l => normalizeText(l.innerText || l.textContent) === target);
    if (!label) return '';

    const forId = label.getAttribute('for');
    if (!forId) return '';

    const escapedId = window.CSS && CSS.escape ? CSS.escape(forId) : String(forId).replace(/"/g, '\\"');
    const valueEl = document.getElementById(forId) || document.querySelector('#' + escapedId);
    if (!valueEl) return '';
    return (valueEl.innerText || valueEl.value || '').trim();
  }

  function getTipoAtividade() {
    return getValueByLabel('Tipo de Atividade');
  }

  function getStatusAtividade() {
    return getValueByLabel('Status da Atividade');
  }

  function formatPhone(raw) {
    if (!raw) return null;
    let d = String(raw).replace(/\D+/g, '');
    if (d.length < 10) return null;
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
    return d;
  }

  function onlyDigits(raw) {
    return String(raw || '').replace(/\D+/g, '');
  }

  function isValidCPF(raw) {
    const cpf = onlyDigits(raw);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
    let check = 11 - (sum % 11);
    if (check >= 10) check = 0;
    if (check !== Number(cpf[9])) return false;

    sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
    check = 11 - (sum % 11);
    if (check >= 10) check = 0;
    return check === Number(cpf[10]);
  }

  function formatCPF(raw) {
    const cpf = onlyDigits(raw);
    if (!isValidCPF(cpf)) return '';
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  function isValidCNPJ(raw) {
    const cnpj = onlyDigits(raw);
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    const calculate = (length) => {
      const weights = length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0);
      const mod = sum % 11;
      return mod < 2 ? 0 : 11 - mod;
    };
    return calculate(12) === Number(cnpj[12]) && calculate(13) === Number(cnpj[13]);
  }

  function formatCNPJ(raw) {
    const cnpj = onlyDigits(raw);
    if (!isValidCNPJ(cnpj)) return '';
    return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }

  function parseCustomerDocument(raw) {
    const digits = onlyDigits(raw);
    if (digits.length === 11 && isValidCPF(digits)) {
      const value = formatCPF(digits);
      return { documento: value, documento_raw: digits, tipo_documento: 'CPF', cpfCliente: value, cnpjCliente: '' };
    }
    if (digits.length === 14 && isValidCNPJ(digits)) {
      const value = formatCNPJ(digits);
      return { documento: value, documento_raw: digits, tipo_documento: 'CNPJ', cpfCliente: '', cnpjCliente: value };
    }
    return {
      documento: digits || String(raw || '').trim(),
      documento_raw: digits,
      tipo_documento: digits ? 'OUTRO' : '',
      cpfCliente: '',
      cnpjCliente: '',
    };
  }

  function formatPhoneDisplay(raw) {
    const d = onlyDigits(raw);
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    return d || String(raw || '').trim();
  }

  async function lookupCattaForCtx(ctx) {
    if (!ctx || !ctx.cpfCliente) return;
    const cpfDigits = onlyDigits(ctx.cpfCliente);
    if (!isValidCPF(cpfDigits)) return;

    const cached = state.cattaCache.get(cpfDigits);
    if (cached) {
      ctx.catta = cached;
      return;
    }
    if (ctx.cattaLoading) return;

    ctx.cattaLoading = true;
    ctx.cattaError = '';
    render();

    try {
      const contrato = onlyDigits(ctx.contrato || state.currentContract || '');
      const result = await bridgeFetch(`/catta/by-cpf?cpf=${encodeURIComponent(cpfDigits)}&state=BR&contrato=${encodeURIComponent(contrato)}`);
      const dataObj = result?.data || result || {};
      
      if (result?.ok !== true || dataObj?.ok !== true) {
        let errMsg = dataObj?.error || dataObj?.message || 'Falha Catta';
        if (errMsg === 'not_logged_in') {
          errMsg = 'Catta sem sessão (faça login com !catta login)';
        }
        ctx.cattaLoading = false;
        ctx.cattaError = errMsg;
        render();
        return;
      }

      const payload = {
        ok: true,
        nome: dataObj?.nome || '',
        cpfCnpj: dataObj?.cpfCnpj || ctx.cpfCliente,
        phones: Array.isArray(dataObj?.phones) ? dataObj.phones : [],
        addresses: Array.isArray(dataObj?.addresses) ? dataObj.addresses : [],
        loadedAt: Date.now(),
      };
      state.cattaCache.set(cpfDigits, payload);
      ctx.catta = payload;
      ctx.cattaLoading = false;
      render();
    } catch (err) {
      ctx.cattaLoading = false;
      ctx.cattaError = err?.message || 'Falha Catta';
      render();
    }
  }

  // Sync com bot
  const _syncPending = new Map();

  function syncCtxComBot(ctx) {
    if (!ctx || !ctx.contrato) return;
    const contrato = String(ctx.contrato).replace(/\D/g, '');
    if (!contrato || contrato.length < 5 || contrato.length > 18) return;

    if (_syncPending.has(contrato)) clearTimeout(_syncPending.get(contrato));
    _syncPending.set(contrato, setTimeout(async () => {
      _syncPending.delete(contrato);
      const telefones = Array.from(ctx.contatos || []).filter(t => t && t.length >= 10);

      const payload = {
        source: ctx.syncSource || 'toa-extension',
        entries: [{
          contrato,
          telefones,
          aid: String(ctx.aid || ''),
          pid: String(ctx.pid || ''),
          date: String(ctx.date || ''),
          externalId: String(ctx.externalId || ctx.searchRow?.external_id || ''),
          tecnico: ctx.tecnico || '',
          nome: ctx.nome || '',
          cpfCliente: ctx.cpfCliente || '',
          cnpjCliente: ctx.cnpjCliente || '',
          documento: ctx.documento || '',
          documento_raw: ctx.documento_raw || '',
          tipo_documento: ctx.tipo_documento || '',
          janela: ctx.janela || ctx.horario || '',
          horario: ctx.horario || '',
          status: ctx.status || '',
          endereco: ctx.endereco || '',
          bairro: ctx.bairro || '',
          cidade: ctx.cidade || '',
          complemento: ctx.complemento || '',
          tipoOS: ctx.tipoOS || '',
          tipoServico: ctx.tipoServico || ctx.tipoOS || '',
          tipo: ctx.tipo || '',
          aworktype: ctx.aworktype || ctx.tipoServico || ctx.tipoOS || '',
          worktype: ctx.worktype || '',
          activityType: ctx.activityType || '',
          observacao: ctx.observacao || '',
          equipamentos: Array.isArray(ctx.equipamentos) ? ctx.equipamentos : [],
          equipamentosRaw: Array.isArray(ctx.equipamentosRaw) ? ctx.equipamentosRaw : [],
          seriais: Array.isArray(ctx.seriais) ? ctx.seriais : [],
          equipamentosDesinstalados: Array.isArray(ctx.equipamentosDesinstalados)
            ? ctx.equipamentosDesinstalados
            : [],
          tasks: Array.isArray(ctx.tasks) ? ctx.tasks : [],
          closeCodes: Array.isArray(ctx.closeCodes) ? ctx.closeCodes : [],
          inventory: Array.isArray(ctx.inventory) ? ctx.inventory : [],
          installedEquipment: Array.isArray(ctx.installedEquipment) ? ctx.installedEquipment : [],
          removedEquipment: Array.isArray(ctx.removedEquipment) ? ctx.removedEquipment : [],
          customerEquipment: Array.isArray(ctx.customerEquipment) ? ctx.customerEquipment : [],
          unknownEquipment: Array.isArray(ctx.unknownEquipment) ? ctx.unknownEquipment : [],
          materials: Array.isArray(ctx.materials) ? ctx.materials : [],
          materialsRaw: Array.isArray(ctx.materialsRaw) ? ctx.materialsRaw : [],
          forms: Array.isArray(ctx.forms) ? ctx.forms : [],
          responsibility: ctx.responsibility || {},
          captureValidation: ctx.captureValidation || {},
          captureSchemaVersion: Number(ctx.captureSchemaVersion || 0),
          normalizedCapture: ctx.normalizedCapture || null,
        }]
      };

      console.log('[TOA-SYNC] →', contrato, telefones, ctx.tipoOS || ctx.tipoServico || '');
      try {
        const data = await bridgeFetch('/toa/sync', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const inserted = data?.data?.inserted || data?.inserted || 0;
        console.log('[TOA-SYNC] ✅ bridge aceitou:', inserted, 'entrada(s)');
      } catch (err) {
        console.warn('[TOA-SYNC] ⚠ bridge indisponível:', err.message);
      }
    }, 1500));
  }

  async function syncTodosComBot() {
    const entries = [];
    for (const [, ctx] of state.byContract) {
      if (!ctx.contrato) continue;
      entries.push({
        contrato: String(ctx.contrato).replace(/\D/g, ''),
        telefones: Array.from(ctx.contatos || []).filter(t => t && t.length >= 10),
        aid: String(ctx.aid || ''),
        tecnico: ctx.tecnico || '',
        nome: ctx.nome || '',
        cpfCliente: ctx.cpfCliente || '',
        janela: ctx.horario || '',
        status: ctx.status || '',
        endereco: ctx.endereco || '',
        bairro: ctx.bairro || '',
        cidade: ctx.cidade || '',
        complemento: ctx.complemento || '',
        tipoOS: ctx.tipoOS || '',
        tipoServico: ctx.tipoServico || ctx.tipoOS || '',
        tipo: ctx.tipo || '',
        aworktype: ctx.aworktype || '',
        worktype: ctx.worktype || '',
        activityType: ctx.activityType || '',
        observacao: ctx.observacao || '',
      });
    }
    if (!entries.length) {
      state.exportStatus = '⚠ Nenhum contrato no cache';
      render();
      return;
    }
    try {
      const data = await bridgeFetch('/toa/sync', {
        method: 'POST',
        body: JSON.stringify({ source: 'toa-extension-batch', entries }),
      });
      const inserted = data?.data?.inserted || data?.inserted || 0;
      state.exportStatus = `✅ ${inserted} contratos sincronizados`;
      render();
    } catch (err) {
      state.exportStatus = `⚠ Erro sync: ${err.message}`;
      render();
    }
  }

  // DOM helpers
  function getElementByText(text) {
    const all = document.querySelectorAll('div, span, label, td, p');
    for (let el of all) {
      if (el.innerText && el.innerText.trim() === text && el.nextElementSibling)
        return el.nextElementSibling.innerText.trim();
    }
    return '';
  }

  function getFromIndex(indexId) {
    const el = document.querySelector(`#id_index_${indexId}`);
    if (el) return (el.innerText || el.textContent || '').trim();
    const label = document.querySelector(`label#index_${indexId}`);
    if (label && label.nextElementSibling)
      return (label.nextElementSibling.innerText || '').trim();
    return '';
  }

  function sanitizeTechnicianName(value) {
    return String(value || '')
      .split(/\r?\n/)[0]
      .replace(/\s+(?:Equipamento|Histórico|Historico|Mensagens).*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getTechName() {
    let el = document.querySelector(
      '.of-activity-details-header-subtitle, .v-activity-header-subtitle, .activity-details-subtitle, ' +
      '[class*="header-subtitle"], [class*="activity-header"], [class*="details-header"], ' +
      '.activity-header, .details-header-subtitle'
    );
    if (!el) {
      el = Array.from(document.querySelectorAll('div, span, p, label, h1, h2, h3, strong'))
        .find(e => {
          const t = (e.innerText || '').trim();
          return t.includes('/') && t.match(/\d{2}\/\d{2}\/\d{2,4}/) && t.length < 150;
        });
    }
    if (el) {
      let text = (el.innerText || '')
        .replace(/Detalhes da atividade/gi, '')
        .replace(/,?\s*\d{2}\/\d{2}\/\d{2,4}.*/gi, '')
        .replace(/\s*,\s*/g, ' ')
        .trim();
      const parts = text.split(/[,|–|-]/);
      const nome = sanitizeTechnicianName(parts[0] || '');
      if (nome.length > 5 && !nome.match(/^\d/)) return nome;
    }
    return 'Técnico não identificado';
  }

  function getContratoFromIndex() {
    const val = getFromIndex(12);
    return val ? val.replace(/\D/g, '') : null;
  }

  function getNomeFromIndex() { return getFromIndex(13) || ''; }

  function getComplemento() { return getElementByText('Complemento Endereço') || ''; }

  function getContractFromScreen() {
    const fromIdx = getContratoFromIndex();
    if (fromIdx && fromIdx.length >= 6) return fromIdx;
    const c = getElementByText('Contrato');
    return c ? c.replace(/\D/g, '') : null;
  }

  function getActiveAidFromUrl() {
    const m = window.location.href.match(/aid=(\d+)/) || window.location.href.match(/activity\/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function getFieldValueFromScreen(labels) {
    for (const label of labels) {
      const byFormLabel = getValueByLabel(label);
      if (byFormLabel) return byFormLabel;

      const byText = getElementByText(label);
      if (byText) return byText;
    }
    return '';
  }

  function isRegionalPhone(raw) {
    const phone = formatPhone(raw);
    if (!phone) return null;
    return /^(81|84|85)\d{8,9}$/.test(phone) ? phone : null;
  }

  function collectPhonesFromText(text) {
    const out = new Set();
    const src = String(text || '');
    const re = /(?:\+?55[\s().-]*)?\(?\s*(?:81|84|85)\s*\)?[\s().-]*9?\d{4}[\s.-]*\d{4}/g;
    const matches = src.match(re) || [];
    matches.forEach(value => {
      const phone = isRegionalPhone(value);
      if (phone) out.add(phone);
    });
    return Array.from(out);
  }

  function collectPhonesFromScreen() {
    const texts = [];
    [
      'Telefone',
      'Telefone 1',
      'Telefone 2',
      'Telefone 3',
      'Telefone Celular',
      'Celular',
      'Telefone Residencial',
      'Telefone Comercial',
      'Contato',
      'Phone',
      'Cell',
    ].forEach(label => {
      const value = getFieldValueFromScreen([label]);
      if (value) texts.push(value);
    });

    const details = document.querySelector('#context-layout') || document.body;
    if (details) texts.push(details.innerText || details.textContent || '');

    return Array.from(new Set(texts.flatMap(collectPhonesFromText)));
  }

  function normalizeSerialRaw(value) {
    return String(value || '').trim().replace(/\s+/g, '');
  }

  function stripSerialStars(value) {
    return normalizeSerialRaw(value).replace(/^\*+|\*+$/g, '');
  }

  function serialKindFromRaw(value) {
    const raw = normalizeSerialRaw(value);
    const clean = stripSerialStars(raw);
    if (raw.startsWith('*') || raw.endsWith('*')) return 'SMART';
    if (/^\d{18,}$/.test(clean)) return 'CHIP';
    return 'DECODER';
  }

  function looksLikeSerial(value) {
    const clean = stripSerialStars(value).toUpperCase();
    if (!clean || clean === '---') return false;
    if (!/^[A-Z0-9]{6,32}$/.test(clean)) return false;
    if (!/\d/.test(clean)) return false;
    return true;
  }

  function extractEquipmentSerialsFromDom() {
    const entries = [];
    const seen = new Set();

    const tables = Array.from(document.querySelectorAll('table'));
    for (const table of tables) {
      const headers = Array.from(
        table.querySelectorAll('th, [data-ofsc-entity-property="invsn"], .table-header-column-title')
      );
      const hasSerialCol = headers.some(h => normalizeText(h.innerText || h.textContent || '').includes('serial'));
      if (!hasSerialCol && !table.querySelector('[data-ofsc-entity-property="invsn"]')) continue;

      const rows = Array.from(table.querySelectorAll('tr')).slice(1);
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (!cells.length) continue;

        const byProp = (prop) => {
          const el = row.querySelector(`[data-ofsc-entity-property="${prop}"]`);
          return el ? (el.innerText || el.textContent || '').trim() : '';
        };
        const byPos = (idx) => cells[idx] ? (cells[idx].innerText || cells[idx].textContent || '').trim() : '';

        const candidates = [
          byProp('invsn'),
          byProp('invsn2'),
          byProp('invsnSubst'),
          byProp('invsn_subst'),
          byPos(3),
          byPos(5),
        ].filter(Boolean);

        for (const raw of candidates) {
          if (!looksLikeSerial(raw)) continue;
          const serial = stripSerialStars(raw);
          const tipo = serialKindFromRaw(raw);
          const key = `${serial}|${tipo}`;
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({ serial, tipo });
        }
      }
    }

    return entries;
  }

  function buildSerialReportText() {
    const entries = extractEquipmentSerialsFromDom();
    if (!entries.length) return 'Nenhum serial encontrado';
    return entries.map(({ serial, tipo }) => `${serial} (${tipo})`).join(', ');
  }

  function syncCurrentScreenWithBot(force = false) {
    const contrato = getContractFromScreen();
    if (!contrato || contrato.length < 6) return false;

    const aid = getActiveAidFromUrl();
    const ctx = state.byContract.get(contrato) || (aid ? state.byAid.get(aid) : null) || {
      contrato,
      contatos: new Set(),
    };

    ctx.contrato = contrato;
    if (aid) ctx.aid = aid;
    if (!ctx.contatos) ctx.contatos = new Set();

    const nomeTela = getFieldValueFromScreen(['Nome', 'Nome do Cliente', 'Cliente']) || getNomeFromIndex();
    const enderecoTela = getFieldValueFromScreen(['Endereço', 'Endereco', 'Endereço Completo', 'Endereco Completo', 'Logradouro']);
    const complementoTela = getComplemento();
    const tipoTela = getTipoAtividade();
    const statusTela = getStatusAtividade();
    const tecnicoTela = sanitizeTechnicianName(getTechName());
    const telefonesTela = collectPhonesFromScreen();
    const sig = [contrato, aid || '', nomeTela || '', enderecoTela || '', complementoTela || '', tipoTela || '', statusTela || '', tecnicoTela || '', telefonesTela.join('/')].join('|');

    if (!force && state.lastScreenSyncSig === sig && Date.now() - state.lastScreenSyncAt < 15000) {
      return false;
    }

    if (nomeTela) ctx.nome = nomeTela;
    if (enderecoTela) ctx.endereco = enderecoTela;
    if (complementoTela) ctx.complemento = complementoTela;
    telefonesTela.forEach(phone => ctx.contatos.add(phone));
    if (tipoTela) {
      ctx.tipoOS = tipoTela;
      ctx.tipoServico = tipoTela;
      const aw = String(ctx.aworktype || '').trim();
      if (!aw || /^\d+$/.test(aw)) ctx.aworktype = tipoTela;
    }
    if (statusTela) ctx.status = statusTela;
    if (tecnicoTela && tecnicoTela !== 'Técnico não identificado') ctx.tecnico = tecnicoTela;
    ctx.syncSource = 'toa-extension-screen';

    state.byContract.set(contrato, ctx);
    if (aid) state.byAid.set(aid, ctx);

    if (nomeTela || enderecoTela || complementoTela || tipoTela || statusTela || telefonesTela.length) {
      state.lastScreenSyncSig = sig;
      state.lastScreenSyncAt = Date.now();
      syncCtxComBot(ctx);
      return true;
    }
    return false;
  }

  // Parser OFSC
  function deepScanOFSC(obj) {
    if (!obj) return;

    if (obj.delta && obj.delta.Activity) {
      state.lastSyncAt = Date.now();
      rememberProviders(obj);

      const activityEntries = Object.entries(obj.delta.Activity);
      const providerEntries = Object.entries(obj.delta.Provider || {});
      const namedProviders = providerEntries
        .map(([pid, provider]) => ({
          pid: String(provider?.pid ?? pid),
          name: sanitizeTechnicianName(firstText(provider?.pname, provider?.name, provider?._identifier)),
        }))
        .filter((provider) => provider.name);
      const currentAid = getActiveAidFromUrl();
      const currentContract = getContractFromScreen();

      for (const [aid, rawData] of activityEntries) {
        const data = rawData || {};
        const idNum = parseInt(aid, 10);
        if (!Number.isFinite(idNum)) continue;
        state.seenAids.add(String(idNum));

        const contrato = data.customer_number ? String(data.customer_number) : null;
        const isCurrentScreen = (currentAid && currentAid === idNum) ||
          (currentContract && contrato === currentContract);
        const candidatePids = [
          data.pid, data.apid, data.provider_id, data.resource_id,
        ].map((value) => String(value ?? '').trim()).filter(Boolean);
        let providerName = '';
        for (const pid of candidatePids) {
          providerName = firstText(
            obj.delta.Provider?.[pid]?.pname,
            state.providersByPid.get(pid)?.name
          );
          if (providerName) break;
        }
        if (!providerName && activityEntries.length === 1 && namedProviders.length === 1) {
          providerName = namedProviders[0].name;
        }
        const screenName = isCurrentScreen ? sanitizeTechnicianName(getTechName()) : '';
        const routedPid = String(data.auto_routed_to_provider_id ?? '').trim();
        const routedName = routedPid && state.providersByPid.has(routedPid)
          ? firstText(state.providersByPid.get(routedPid)?.name, data.auto_routed_to_provider_name)
          : '';

        const ctx = {
          aid: idNum,
          pid: firstText(data.pid, data.apid, data.provider_id, data.resource_id),
          date: firstText(data.date, data.activity_date, data.auto_routed_to_date),
          contrato,
          nome: data.cname || 'Cliente',
          cpfCliente: formatCPF(firstText(
            data[174],
            data.cpf,
            data.customer_cpf,
            data.customer_document,
            data.document_number,
            data.document
          )),
          bairro: data.caddress2 || data.neighborhood || '',
          cidade: data.city || data.ccity || '',
          complemento: '',
          endereco: data.caddress || 'Endereço não informado',
          horario: (data.service_window_start && data.service_window_end)
            ? `${data.service_window_start} - ${data.service_window_end}` : '',
          tecnico: firstText(screenName, providerName, routedName),
          syncSource: 'toa-extension-passive',
          contatos: new Set(),
          observacao: '',
          status: firstText(data.astatus, data.status, data.activity_status),
          tipoOS: firstText(data.aworktype, data[544], data.atype, data.worktype, data.activityType),
          tipoServico: firstText(data.aworktype, data[544], data.atype),
          tipo: firstText(data.atype, data.type),
          aworktype: firstText(data.aworktype),
          worktype: firstText(data.worktype),
          activityType: firstText(data.activityType),
        };

        [data.cphone, data.ccell, data.phone].forEach(p => {
          const num = formatPhone(p);
          if (num) ctx.contatos.add(num);
        });

        [236, 237, 238, 155, 187, 369, 699].forEach(k => {
          if (data[k]) {
            const txt = String(data[k]).replace(/\r\n|\n/g, ' ').trim();
            if (txt) ctx.observacao += (ctx.observacao ? ' | ' : '') + txt;
          }
        });

        if (isCurrentScreen) {
          const tipoTela = getTipoAtividade();
          const statusTela = getStatusAtividade();
          const complementoTela = getComplemento();
          if (tipoTela) {
            ctx.tipoOS = tipoTela;
            if (!ctx.tipoServico) ctx.tipoServico = tipoTela;
          }
          if (statusTela) ctx.status = statusTela;
          if (complementoTela) ctx.complemento = complementoTela;
        }

        try {
          const capture = normalizedCaptureFromResponse(
            obj,
            idNum,
            {
              aid: isCurrentScreen && currentAid ? currentAid : idNum,
              pid: ctx.pid,
              date: ctx.date,
            },
            'toa-extension-passive'
          );
          applyNormalizedCapture(ctx, capture);
        } catch (error) {
          ctx.captureValidation = {
            valid: false,
            errors: [String(error?.message || 'toa_capture_normalization_failed')],
            warnings: [],
          };
        }

        state.byAid.set(idNum, ctx);
        if (ctx.contrato) state.byContract.set(ctx.contrato, ctx);
        if (ctx.contrato) syncCtxComBot(ctx);
      }

      render();
      return;
    }

    if (typeof obj === 'object') {
      Object.keys(obj).forEach(k => {
        if (obj[k] && typeof obj[k] === 'object') deepScanOFSC(obj[k]);
      });
    }
  }

  // Botões de cópia
  window.copyVisitReport = function (e) {
    const btn = e ? e.target : null;
    const dataAtiv = getElementByText('Data');
    const contrato = getElementByText('Contrato') || state.currentContract || '';
    const nomeCli = getNomeFromIndex() || getElementByText('Nome');
    const tecnico = getTechName();
    const seriaisTexto = buildSerialReportText();

    const report = `Data: ${dataAtiv}\nContrato: ${contrato}\nNome do cliente: ${nomeCli}\nNumero serial: ${seriaisTexto}\nNome do Técnico: ${tecnico}`;

    navigator.clipboard.writeText(report).then(() => {
      if (btn) {
        const ot = btn.innerText; btn.innerText = '✓ COPIADO!'; btn.style.background = '#28a745';
        setTimeout(() => { btn.innerText = ot; btn.style.background = '#0056b3'; }, 2000);
      }
    }).catch(err => console.error(err));
  };

  window.copyFormattedInfo = function (e) {
    const btn = e ? e.target : null;
    const ctx = state.byContract.get(state.currentContract) || state.byAid.get(state.currentAid);
    if (!ctx) { console.warn('Sem ctx…'); return; }

    const telefonesCatta = Array.isArray(ctx.catta?.phones)
      ? ctx.catta.phones.map(item => item.digits).filter(Boolean)
      : [];
    const telefones = Array.from(new Set([...Array.from(ctx.contatos), ...telefonesCatta]));
    const telefonesTexto = telefones.length > 0 ? telefones.join(' / ') : '';

    const texto = `DX 22 *FTZ*\n‼ *RETIDO* ‼\n*Contrato*: ${ctx.contrato || ''}\n*agenda*: ${ctx.horario || ''}\n*Nome*: ${ctx.nome || ''}\n*Endereço*: ${ctx.endereco || ''}\n*Telefone*: ${telefonesTexto}\n*END RET*: \n*TECNICO*: ${ctx.tecnico || ''}`;

    navigator.clipboard.writeText(texto).then(() => {
      if (btn) {
        const ot = btn.innerText; btn.innerText = '✓ Copiado!'; btn.style.background = '#28a745';
        setTimeout(() => { btn.innerText = ot; btn.style.background = '#d81b60'; }, 1800);
      }
    }).catch(err => console.error('Erro ao copiar:', err));
  };

  window.copyFullReport = function (e, contractKey) {
    const ctx = state.byContract.get(contractKey) || state.byAid.get(state.currentAid);
    if (!ctx) return;
    const comp = getComplemento();
    const end = ctx.endereco + (comp ? ' ' + comp : '');
    const telefonesCatta = Array.isArray(ctx.catta?.phones)
      ? ctx.catta.phones.map(item => item.digits).filter(Boolean)
      : [];
    const listaTels = Array.from(new Set([...Array.from(ctx.contatos), ...telefonesCatta])).map(n => 'TEL: ' + n).join('\n');
    const textoFinal = `⭕ FORA ROTA ⭕\n\nCONTRATO: ${ctx.contrato || ''}\nNOME: ${ctx.nome || ''}\nCPF: ${ctx.cpfCliente || ''}\nEND: ${end}\nAGENDA: ${ctx.horario || 'Não informado'}\n${listaTels}`;

    navigator.clipboard.writeText(textoFinal).then(() => {
      if (e && e.target) { e.target.innerText = 'Copiado!'; setTimeout(() => { e.target.innerText = 'Copiar Tudo'; }, 2000); }
    });
  };

  // Template capture
  function extractFormData(fd) {
    const out = [];
    try { for (const [k, v] of fd.entries()) out.push([k, v]); } catch {}
    return out;
  }

  function looksLikeHasPhones(delta) {
    if (!delta?.Activity) return false;
    for (const aid of Object.keys(delta.Activity)) {
      const a = delta.Activity[aid] || {};
      if (a.cphone || a.ccell || a.phone) return true;
    }
    return false;
  }

  function resolveToaUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) throw makeToaError('toa_url_invalida');
    const absolute = new URL(value.startsWith('?') ? '/' + value : value, location.href);
    if (absolute.origin !== location.origin) throw makeToaError('toa_url_invalida');
    return absolute;
  }

  function isSearchRequestUrl(rawUrl) {
    try {
      const url = resolveToaUrl(rawUrl);
      return /\/index\.php$/i.test(url.pathname) &&
        url.searchParams.get('m') === 'search' &&
        url.searchParams.get('a') === 'search';
    } catch { return false; }
  }

  function isDetailsRequestUrl(rawUrl) {
    try {
      const url = resolveToaUrl(rawUrl);
      return url.searchParams.get('m') === 'sync' &&
        url.searchParams.get('a') === 'write' &&
        url.searchParams.get('ajax') === '1';
    } catch { return false; }
  }

  function extractUrlEncodedEntries(body) {
    try {
      if (body instanceof URLSearchParams) return Array.from(body.entries());
      if (typeof body === 'string') return Array.from(new URLSearchParams(body).entries());
    } catch {}
    return [];
  }

  function allowedReplayHeaders(headers) {
    const out = {};
    for (const [name, value] of Object.entries(headers || {})) {
      const key = String(name || '').toLowerCase();
      if (['accept', 'x-requested-with', 'x-oa', 'x-platform'].includes(key)) out[key] = String(value);
    }
    return out;
  }

  function rememberProviders(json) {
    const providers = json?.delta?.Provider || json?.Provider;
    if (!providers || typeof providers !== 'object') return;

    for (const [fallbackPid, raw] of Object.entries(providers)) {
      if (!raw || typeof raw !== 'object') continue;
      const pid = String(raw.pid ?? fallbackPid ?? '').trim();
      const externalId = firstText(raw.external_id, raw.externalId, raw.login).toUpperCase();
      const name = sanitizeTechnicianName(firstText(raw.pname, raw.name, raw.resource_name, raw._identifier));
      if (!name || name === 'Técnico não identificado') continue;

      const provider = { pid, externalId, name };
      if (pid) state.providersByPid.set(pid, provider);
      if (externalId) state.providersByExternalId.set(externalId, provider);
    }
  }

  function resolveTechnicianForRow(json, row, activity) {
    rememberProviders(json);

    const pid = String(row?.pid ?? '').trim();
    const externalId = String(row?.external_id || '').trim().toUpperCase();
    const directProviders = json?.delta?.Provider || {};
    const direct = directProviders[pid] || Object.values(directProviders).find((item) => {
      return externalId && String(item?.external_id || '').trim().toUpperCase() === externalId;
    });
    const cached = state.providersByPid.get(pid) || state.providersByExternalId.get(externalId);
    const providerName = sanitizeTechnicianName(firstText(direct?.pname, cached?.name));
    if (providerName) return providerName;

    // Este campo pode conservar o técnico de um roteamento anterior. Só é seguro
    // quando o PID informado pela atividade coincide com o PID da linha pesquisada.
    const routedPid = String(activity?.auto_routed_to_provider_id ?? '').trim();
    if (routedPid && routedPid === pid) {
      return sanitizeTechnicianName(firstText(activity?.auto_routed_to_provider_name));
    }

    return '';
  }

  function todayIsoSaoPaulo() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function chooseSearchRow(rows) {
    const today = todayIsoSaoPaulo();
    return rows.find((row) => String(row?.date || '') === today) || rows[0] || null;
  }

  function captureSyncTemplate(method, url, body, json, headers) {
    if (!isDetailsRequestUrl(url) || !(body instanceof FormData)) return;
    const entries = extractFormData(body);
    if (!entries.length) return;

    const requiredSessionKeys = new Set(['__protocol', 'dv', 'u', 'f', 'trust']);
    const available = new Set(entries.map(([key]) => key));
    if (![...requiredSessionKeys].every((key) => available.has(key))) return;

    state.syncTemplate = {
      method: method || 'POST',
      url: resolveToaUrl(url).href,
      encoding: 'formdata',
      entries,
      headers: allowedReplayHeaders(headers),
      capturedAt: Date.now(),
      sampleDeltaKeys: Object.keys(json?.delta || {}),
    };
    console.log('[TOA-DIRECT] template base de sessao capturado sem abrir OS');
    render();
  }

  function buildSearchParamsFromSync(contractNorm) {
    const tpl = state.syncTemplate;
    if (!tpl?.entries?.length) throw makeToaError('toa_template_sessao_indisponivel');

    const keepKeys = new Set([
      '__protocol', 'dv', 'pid', 'u', 'f', 'pids', 'aids', 'restriction',
      'qid', 'fakeIds', 'trust', 'fakeIdsClean', 'limitActivitiesByPool[notscheduled]'
    ]);
    const params = new URLSearchParams();
    for (const [key, value] of tpl.entries) {
      if (keepKeys.has(key)) params.append(key, String(value ?? ''));
    }

    params.set('from', '');
    params.set('size', '60');
    params.set('searchFields[customer_number]', 'true');
    params.set('searchValue', contractNorm);
    params.set('searchDate', 'at_all');
    params.set('skip_delta', '0');
    params.set('pids', '[]');
    params.set('aids', '[]');
    params.set('qid', 'undefined');
    return params;
  }

  function captureSearchTemplate(method, url, body, json, headers) {
    if (!isSearchRequestUrl(url) || !Array.isArray(json)) return;
    const entries = extractUrlEncodedEntries(body);
    if (!entries.length || !entries.some(([key]) => key === 'searchValue')) return;
    state.searchTemplate = {
      method: method || 'POST',
      url: resolveToaUrl(url).href,
      encoding: 'urlencoded',
      entries,
      headers: allowedReplayHeaders(headers),
      capturedAt: Date.now(),
    };
    console.log('[TOA-DIRECT] template de busca capturado');
    render();
  }

  function captureDetailsTemplate(method, url, body, json, headers) {
    if (!isDetailsRequestUrl(url) || !json?.delta || !looksLikeHasPhones(json.delta) || !(body instanceof FormData)) return;
    state.detailsTemplate = {
      method: method || 'POST',
      url: resolveToaUrl(url).href,
      encoding: 'formdata',
      entries: extractFormData(body),
      headers: allowedReplayHeaders(headers),
      capturedAt: Date.now(),
      sampleDeltaKeys: Object.keys(json.delta || {}),
    };
    state.template = state.detailsTemplate;
    state.lastTemplateAt = new Date().toISOString();
    state.exportStatus = '✅ Template capturado (agora dá pra exportar em lote)';
    console.log('[TOA-DIRECT] template de detalhes capturado');
    render();
  }

  function captureTemplatesFromRequest(method, url, body, json, headers) {
    try { captureSyncTemplate(method, url, body, json, headers); } catch {}
    try { captureSearchTemplate(method, url, body, json, headers); } catch {}
    try { captureDetailsTemplate(method, url, body, json, headers); } catch {}
  }

  function makeToaError(code, status = 0) {
    const error = new Error(code);
    error.code = code;
    error.status = Number(status || 0);
    return error;
  }

  function isLoginLikeResponse(response, text) {
    const finalUrl = String(response?.url || '');
    if (response?.redirected && finalUrl) {
      try { if (new URL(finalUrl).origin !== location.origin) return true; } catch {}
    }
    const sample = String(text || '').slice(0, 5000);
    return /<html|<!doctype/i.test(sample) && /login|sign[ -]?in|autentica|oracle field service/i.test(sample);
  }

  const TOA_REPLAY_HEADER_NAMES = new Set(['accept', 'x-requested-with', 'x-oa', 'x-platform']);

  function replayHeaders(template, extra = {}) {
    const headers = {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
      'x-oa': '2',
      'x-platform': '1',
    };
    for (const [name, value] of Object.entries(template?.headers || {})) {
      const key = String(name || '').toLowerCase();
      if (TOA_REPLAY_HEADER_NAMES.has(key) && value != null) headers[key] = String(value);
    }
    return { ...headers, ...extra };
  }

  function xhrRequestWithTimeout(url, options, timeoutMs) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.__toaDirectReplay = true;
      xhr.open(options.method || 'POST', url, true);
      xhr.withCredentials = true;
      xhr.timeout = timeoutMs;
      for (const [name, value] of Object.entries(options.headers || {})) {
        xhr.setRequestHeader(name, value);
      }
      xhr.onload = () => resolve({
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        text: xhr.responseText || '',
        url: xhr.responseURL || url,
        redirected: Boolean(xhr.responseURL && xhr.responseURL !== url),
      });
      xhr.onerror = () => reject(makeToaError('toa_falha_rede'));
      xhr.ontimeout = () => reject(makeToaError('toa_timeout'));
      xhr.onabort = () => reject(makeToaError('toa_falha_rede'));
      // Chamada intencional ao send atual: deve atravessar o wrapper do package.js,
      // responsável por injetar X-OFS-CSRF-SECURE na sessão corrente.
      xhr.send(options.body);
    });
  }

  async function xhrToaJson(url, options, timeoutMs, invalidCode) {
    const response = await xhrRequestWithTimeout(url, options, timeoutMs);
    if (response.status === 401) throw makeToaError('toa_http_401', 401);
    if (response.status === 403) throw makeToaError('toa_http_403', 403);
    if (!response.ok) throw makeToaError(`toa_http_${response.status}`, response.status);
    if (isLoginLikeResponse(response, response.text)) throw makeToaError('toa_sem_sessao');
    try { return JSON.parse(response.text); }
    catch { throw makeToaError(invalidCode); }
  }

  function normalizeContractDirect(value) {
    const contract = String(value || '').replace(/\D+/g, '');
    if (contract.length < 5 || contract.length > 18) throw makeToaError('toa_contrato_invalido');
    return contract;
  }

  async function searchContractDirect(contract) {
    const contractNorm = normalizeContractDirect(contract);
    const capturedSearch = state.searchTemplate?.entries?.length ? state.searchTemplate : null;
    const syntheticSearch = !capturedSearch && state.syncTemplate?.entries?.length
      ? state.syncTemplate
      : null;
    const tpl = capturedSearch || syntheticSearch;
    if (!tpl) throw makeToaError('toa_template_busca_indisponivel');

    const url = capturedSearch
      ? resolveToaUrl(capturedSearch.url)
      : new URL('/index.php?m=search&a=search', location.origin);
    if (!isSearchRequestUrl(url.href)) throw makeToaError('toa_template_busca_indisponivel');

    const params = capturedSearch
      ? new URLSearchParams()
      : buildSearchParamsFromSync(contractNorm);

    if (capturedSearch) {
      for (const [key, value] of capturedSearch.entries) params.append(key, String(value ?? ''));
      params.set('searchValue', contractNorm);
      params.set('searchDate', 'at_all');
      params.set('searchFields[customer_number]', 'true');
      params.set('size', '60');
      params.set('skip_delta', '0');
    }

    const json = await xhrToaJson(url.href, {
      method: 'POST',
      headers: replayHeaders(tpl, {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      }),
      body: params.toString(),
    }, 10000, 'toa_resposta_busca_invalida');
    if (!Array.isArray(json)) throw makeToaError('toa_resposta_busca_invalida');
    const section = json.find(item => item?.key === 'customer_number');
    if (!section || !Array.isArray(section?.value?.rows)) throw makeToaError('toa_resposta_busca_invalida');
    return section.value.rows;
  }

  async function fetchActivityDirect(row) {
    const tpl = state.detailsTemplate || state.syncTemplate || state.template;
    if (!tpl?.entries?.length) throw makeToaError('toa_template_detalhes_indisponivel');
    const aid = Number(row?.aid);
    const pid = Number(row?.pid);
    const date = String(row?.date || '').trim();
    if (!Number.isFinite(aid) || !Number.isFinite(pid) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw makeToaError('toa_resposta_busca_invalida');
    }
    const url = resolveToaUrl(tpl.url);
    if (!isDetailsRequestUrl(url.href)) throw makeToaError('toa_template_detalhes_indisponivel');
    const overrides = new Map([
      ['requestedAid', String(aid)], ['pid', String(pid)], ['requestedDate', date],
      ['date', date], ['dq', date], ['dispatcher', '1'], ['skip_delta', '0'],
      ['aids', '[]'], ['pids', '[]'], ['qid', 'undefined'],
    ]);
    const fd = new FormData();
    const seen = new Set();
    for (const [key, value] of tpl.entries) {
      fd.append(key, overrides.has(key) ? overrides.get(key) : value);
      seen.add(key);
    }
    for (const [key, value] of overrides) if (!seen.has(key)) fd.append(key, value);
    return xhrToaJson(url.href, {
      method: 'POST', headers: replayHeaders(tpl), body: fd,
    }, 15000, 'toa_resposta_detalhes_invalida');
  }

  function extractWorkTypeFromIdentifier(identifier) {
    const parts = String(identifier || '').split(/\s+-\s+/).map(item => item.trim()).filter(Boolean);
    if (parts.length >= 3 && /^\d{2}:\d{2}$/.test(parts[0]) && /^\d{2}:\d{2}$/.test(parts[1])) return parts[2];
    return '';
  }

  function normalizedCaptureFromResponse(json, aid, row = {}, source = 'toa-extension-direct') {
    const normalizer = window.TNToaInventoryCore?.normalizeActivityResponse;
    if (typeof normalizer !== 'function') {
      throw makeToaError('toa_inventory_core_unavailable');
    }
    return normalizer(json, String(aid || ''), {
      route: {
        aid: String(row?.aid || aid || ''),
        pid: String(row?.pid || ''),
        external_id: String(row?.external_id || ''),
        date: String(row?.date || ''),
      },
      captureSource: source,
    });
  }

  function legacyEquipmentFromCapture(item) {
    return {
      invid: String(item?.invid || ''),
      serial: String(item?.serial || '').toUpperCase(),
      tipo: String(item?.type || ''),
      modelo: String(item?.description || ''),
      pool: String(item?.pool || ''),
      desinstalado: String(item?.pool || '') === 'deinstall',
      point: String(item?.point || ''),
      action: String(item?.action || ''),
      action_code: String(item?.action_code || ''),
      provider_id: String(item?.provider_id || ''),
    };
  }

  function legacyMaterialFromCapture(item) {
    return {
      inventory_id: String(item?.invid || ''),
      invid: String(item?.invid || ''),
      activity_id: String(item?.activity_id || ''),
      provider_id: String(item?.provider_id || ''),
      code: String(item?.material_code || ''),
      material_code: String(item?.material_code || ''),
      name: String(item?.description || ''),
      description: String(item?.description || ''),
      quantity: String(item?.used_quantity || ''),
      used_quantity: String(item?.used_quantity || ''),
      available_stock: String(item?.available_stock || ''),
      pool: String(item?.pool || ''),
      point: String(item?.point || ''),
      action: String(item?.action || ''),
      action_code: String(item?.action_code || ''),
      identity_complete: Boolean(item?.material_code && item?.description),
      validation_errors: Array.isArray(item?.validation_errors) ? item.validation_errors : [],
      validation_warnings: Array.isArray(item?.validation_warnings) ? item.validation_warnings : [],
    };
  }

  function dedupeLegacyEquipment(items) {
    const bySerial = new Map();
    const poolPriority = pool => pool === 'deinstall' ? 0 : (pool === 'customer' ? 1 : 2);
    for (const item of items) {
      if (!item.serial) continue;
      const current = bySerial.get(item.serial);
      if (!current) {
        bySerial.set(item.serial, {
          ...item,
          pools: [item.pool].filter(Boolean),
          invids: [item.invid].filter(Boolean),
        });
        continue;
      }
      const preferred = poolPriority(item.pool) < poolPriority(current.pool) ? item : current;
      const secondary = preferred === item ? current : item;
      bySerial.set(item.serial, {
        ...preferred,
        tipo: preferred.tipo || secondary.tipo || '',
        modelo: preferred.modelo || secondary.modelo || '',
        pools: Array.from(new Set([...(current.pools || []), item.pool].filter(Boolean))),
        invids: Array.from(new Set([...(current.invids || []), item.invid].filter(Boolean))),
      });
    }
    return Array.from(bySerial.values());
  }

  function applyNormalizedCapture(ctx, capture) {
    if (!ctx || !capture) return ctx;
    const equipmentRaw = (capture.inventory || [])
      .filter(item => item.kind === 'equipment')
      .map(legacyEquipmentFromCapture);
    const materialsRaw = (capture.materials || []).map(legacyMaterialFromCapture);
    const captureErrors = Array.isArray(capture?.validation?.errors)
      ? capture.validation.errors
      : [];

    ctx.captureSchemaVersion = capture.schema_version;
    ctx.normalizedCapture = capture;
    ctx.tasks = capture.tasks || [];
    ctx.closeCodes = Array.from(new Set(
      (capture.tasks || []).map(task => String(task.close_code || '')).filter(Boolean)
    ));
    ctx.inventory = capture.inventory || [];
    ctx.installedEquipment = capture.installed_equipment || [];
    ctx.removedEquipment = capture.removed_equipment || [];
    ctx.customerEquipment = capture.customer_equipment || [];
    ctx.unknownEquipment = capture.unknown_equipment || [];
    ctx.materials = capture.materials || [];
    ctx.forms = capture.forms || [];
    ctx.responsibility = capture.responsibility || {};
    ctx.captureValidation = capture.validation || { valid: false, errors: [], warnings: [] };
    ctx.equipamentosRaw = equipmentRaw;
    ctx.equipamentos = dedupeLegacyEquipment(equipmentRaw);
    ctx.seriais = ctx.equipamentos.map(item => item.serial);
    ctx.equipamentosDesinstalados = equipmentRaw.filter(item => item.desinstalado);
    ctx.materialsRaw = materialsRaw;
    ctx.inventoryUnclassified = [
      ...(capture.unknown_inventory || []),
      ...(capture.unknown_equipment || []),
    ];
    ctx.materialsComplete = !captureErrors.some(error => (
      error.startsWith('material_') || error.startsWith('inventory_')
    ));

    window.__TN_LAST_TOA_CAPTURE__ = capture;
    window.dispatchEvent(new CustomEvent('tn-toa-capture', { detail: capture }));
    return ctx;
  }

  function parseDirectActivityResponse(json, row) {
    const aid = Number(row?.aid);
    const pid = Number(row?.pid);
    const delta = json?.delta;
    const activity = delta?.Activity?.[String(aid)];
    if (!delta || !activity) throw makeToaError('toa_resposta_detalhes_invalida');
    const tecnico = resolveTechnicianForRow(json, row, activity);
    if (!tecnico) throw makeToaError('toa_provider_nao_encontrado');
    const normalizedCapture = normalizedCaptureFromResponse(
      json,
      aid,
      row,
      'toa-extension-direct'
    );
    const contatos = new Set();
    [activity.cphone, activity.ccell, activity.phone].forEach(value => {
      const phone = formatPhone(value);
      if (phone) contatos.add(phone);
    });
    const observacao = [236, 237, 238, 155, 187, 369, 699]
      .map(key => String(activity[key] || '').replace(/\r\n|\n/g, ' ').trim())
      .filter(Boolean).join(' | ');
    const tipoOS = firstText(
      activity?._identifier_structure?.aworktype?.text,
      extractWorkTypeFromIdentifier(activity._identifier),
      activity[544], activity.aworktype, activity.atype
    );
    const documentoInfo = parseCustomerDocument(firstText(
      activity[174], activity[698], activity.cpf, activity.customer_cpf,
      activity.customer_document, activity.document_number, activity.document
    ));
    const result = {
      ok: true,
      aid,
      pid,
      date: String(row?.date || ''),
      externalId: String(row?.external_id || ''),
      searchRow: row,
      syncSource: 'toa-extension-direct',
      contrato: String(activity.customer_number || ''),
      nome: activity.cname || 'Cliente',
      ...documentoInfo,
      endereco: activity.caddress || '',
      bairro: activity.caddress2 || activity.neighborhood || '',
      cidade: activity.ccity || activity.city || '',
      uf: activity.cstate || '',
      cep: activity.czip || '',
      complemento: activity.complement || activity.caddress3 || '',
      horario: activity.service_window_start && activity.service_window_end
        ? `${activity.service_window_start} - ${activity.service_window_end}`
        : (activity.service_window || ''),
      janela: activity.delivery_window || '',
      tecnico,
      status: firstText(activity.astatus, activity.status, activity.activity_status),
      tipoOS,
      tipoServico: tipoOS,
      tipo: firstText(activity.atype, activity.type),
      aworktype: firstText(activity.aworktype),
      worktype: firstText(activity.worktype),
      activityType: firstText(activity.activityType, activity.atype),
      contatos,
      telefones: Array.from(contatos),
      telefone: Array.from(contatos)[0] || '',
      observacao,
    };
    return applyNormalizedCapture(result, normalizedCapture);
  }

  function routeForSearchRow(row) {
    try {
      const route = window.TNTOAAutoExport?.routeForProvider?.(row?.pid);
      return route?.name ? String(route.name) : '';
    } catch {
      return '';
    }
  }

  async function lookupContractDirect(contract, options = {}) {
    if (state.directLookupBusy) throw makeToaError('toa_consulta_em_andamento');
    state.directLookupBusy = true;
    try {
      const contractNorm = normalizeContractDirect(contract);
      console.log('[TOA-DIRECT] pesquisando contrato', contractNorm);
      const rawRows = await searchContractDirect(contractNorm);
      const rowsWithRoute = rawRows.map((candidate) => ({
        ...candidate,
        route_name: routeForSearchRow(candidate),
      }));
      const routeRows = rowsWithRoute.filter((candidate) => candidate.route_name);
      const treeInfo = window.TNTOAAutoExport?.treeStatus?.() || {};
      const treeReady = Number(treeInfo.nodes || 0) > 0 && Number(treeInfo.buckets || 0) > 0;
      const rows = treeReady ? routeRows : rowsWithRoute;
      state.lastDirectSearchRows = rows;
      console.log('[TOA-DIRECT] pesquisa retornou', rawRows.length, 'OS; dentro da arvore DMV:', routeRows.length, 'treeReady=', treeReady);
      if (!rows.length && rawRows.length && treeReady) {
        return {
          ok: false,
          error: 'toa_fora_arvore_dmv',
          contrato_pesquisado: contractNorm,
          activity_count: rawRows.length,
        };
      }
      if (!rows.length) return { ok: false, error: 'toa_sem_resultados', contrato_pesquisado: contractNorm };
      let row;
      if (options.requireSingleActivity === true) {
        const today = todayIsoSaoPaulo();
        const rowsToday = rows.filter(
          candidate => String(candidate?.date || '') === today
        );
        const exactRows = rowsToday.length ? rowsToday : rows;
        if (exactRows.length !== 1) {
          return {
            ok: false,
            error: 'multiple_toa_activities',
            contrato_pesquisado: contractNorm,
            activity_count: rows.length,
            activity_count_today: rowsToday.length,
          };
        }
        row = exactRows[0];
      } else {
        row = chooseSearchRow(rows);
      }
      if (!row) return { ok: false, error: 'toa_sem_resultados', contrato_pesquisado: contractNorm };
      if (row !== rows[0]) {
        console.log('[TOA-DIRECT] priorizando OS de hoje', { aid: row.aid, pid: row.pid, date: row.date });
      }
      console.log('[TOA-DIRECT] carregando atividade', { aid: row.aid, pid: row.pid, date: row.date });
      const json = await fetchActivityDirect(row);
      const ctx = parseDirectActivityResponse(json, row);
      ctx.contrato_pesquisado = contractNorm;
      ctx.rota = String(row?.route_name || routeForSearchRow(row) || '');
      if (String(ctx.contrato || '').replace(/\D+/g, '') !== contractNorm) {
        throw makeToaError('toa_resultado_contrato_divergente');
      }
      state.lastDirectResult = ctx;
      state.seenAids.add(String(ctx.aid));
      state.byAid.set(Number(ctx.aid), ctx);
      state.byContract.set(contractNorm, ctx);
      syncCtxComBot(ctx);
      render();
      console.log('[TOA-DIRECT] consulta concluída', { contrato: contractNorm, aid: ctx.aid });
      return { ok: true, ...ctx, resultado: ctx, rows };
    } finally {
      state.directLookupBusy = false;
    }
  }

  // Coleta AIDs
  function collectAidsFromDOM() {
    const aids = new Set();
    
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/aid=(\d+)/) || href.match(/activity\/(\d+)/);
      if (m && m[1]) aids.add(m[1]);
    });

    document.querySelectorAll('[data-aid],[data-activity-id],[data-activity],[data-id]').forEach(el => {
      const cand = el.getAttribute('data-aid') || el.getAttribute('data-activity-id')
                || el.getAttribute('data-activity') || el.getAttribute('data-id');
      if (cand && /^\d+$/.test(cand)) aids.add(cand);
    });

    document.querySelectorAll('td,span,div').forEach(el => {
      const t = (el.textContent || '').trim();
      if (/^\d{8,12}$/.test(t)) aids.add(t);
    });

    return Array.from(aids)
      .map(x => String(x))
      .filter(x => /^\d{8,12}$/.test(x))
      .sort((a, b) => Number(a) - Number(b));
  }

  function collectAidsSmart() {
    const fromDom = collectAidsFromDOM();
    if (fromDom.length) return fromDom;
    return Array.from(state.seenAids)
      .map(x => String(x))
      .filter(x => /^\d{8,12}$/.test(x))
      .sort((a, b) => Number(a) - Number(b));
  }

  // Exportação em lote
  async function postWithTemplateForAid(aid) {
    const tpl = state.template;
    if (!tpl?.entries?.length) throw new Error('Sem template');

    const absUrl = tpl.url.startsWith('http')
      ? tpl.url
      : (location.origin + (tpl.url.startsWith('?') ? '/' + tpl.url : tpl.url));

    const fd = new FormData();
    for (const [k, v] of tpl.entries) {
      let nv = v;
      if (k === 'requestedAid') nv = String(aid);
      if (k === 'aids') nv = JSON.stringify([String(aid)]);
      if (k === 'queue[0][aId]') nv = String(aid);
      if (k.toLowerCase().includes('aid') && /^\d{8,12}$/.test(String(v))) nv = String(aid);
      if (k.toLowerCase().includes('activity') && /^\d{8,12}$/.test(String(v))) nv = String(aid);
      fd.append(k, nv);
    }

    const r = await xhrRequestWithTimeout(absUrl, {
      method: tpl.method || 'POST',
      body: fd,
      headers: replayHeaders(tpl),
    }, 15000);

    const text = r.text;
    let j = null;
    try { j = JSON.parse(text); } catch {}

    if (!j?.delta) {
      return { aid, ok: false, status: r.status, error: 'Sem delta', rawLen: text.length };
    }

    deepScanOFSC(j);
    const ctx = state.byAid.get(parseInt(aid, 10));
    const telefones = ctx ? Array.from(ctx.contatos) : [];
    return {
      aid,
      ok: telefones.length > 0,
      status: r.status,
      contrato: ctx?.contrato || '',
      telefones
    };
  }

  window.tnExportContatosLote = async function () {
    if (state.exporting) return;
    if (!state.template) {
      state.exportStatus = '⚠ Sem template. Abra 1 OS pra capturar o request com telefones (uma vez).';
      render(); return;
    }

    const aids = collectAidsSmart();
    if (!aids.length) {
      state.exportStatus = '⚠ Não achei AIDs. Deixe o sync carregar ou abra 1 OS.';
      render(); return;
    }

    state.exporting = true;
    state.exportStatus = `⏳ Exportando ${aids.length} AIDs…`;
    render();

    const results = [];
    for (let i = 0; i < aids.length; i++) {
      state.exportStatus = `⏳ ${i + 1}/${aids.length}… aid=${aids[i]}`;
      render();
      try { results.push(await postWithTemplateForAid(aids[i])); }
      catch (e) { results.push({ aid: aids[i], ok: false, status: 0, error: String(e?.message || e) }); }
      await sleep(250);
    }

    const final = results
      .filter(r => r.ok && r.contrato && r.telefones?.length)
      .map(r => ({ contrato: r.contrato, telefones: r.telefones.join(' / ') }));

    state.lastExport = final;
    window.__TN_EXPORT_CONTATOS__ = final;

    try { await navigator.clipboard.writeText(final.map(x => `${x.contrato}: ${x.telefones}`).join('\n')); } catch {}

    if (final.length > 0) {
      const entriesBot = final.map(x => ({
        contrato: String(x.contrato).replace(/\D/g, ''),
        telefones: String(x.telefones).split('/').map(t => t.trim()).filter(t => t.length >= 10),
      }));
      try {
        const data = await bridgeFetch('/toa/sync', {
          method: 'POST',
          body: JSON.stringify({ source: 'toa-extension-export', entries: entriesBot }),
        });
        const inserted = data?.data?.inserted || data?.inserted || 0;
        state.exportStatus = `✅ Export: ${final.length} contratos. Bridge: ${inserted} sincronizados.`;
      } catch (err) {
        state.exportStatus = `✅ Export: ${final.length} contratos (bridge: ${err.message})`;
      }
    } else {
      state.exportStatus = `✅ Export: ${final.length} contratos com telefone.`;
    }

    state.exporting = false;
    render();
  };

  // ========================= AUTO-LOOKUP CORRIGIDO =========================
  
  const TYPING_DELAY = () => 65 + Math.random() * 55;
  const CLICK_PAUSE = () => 320 + Math.random() * 260;
  const LOOKUP_MAX_TRIES = 6;
  const LOOKUP_RETRY_COOLDOWN_MS = 2500;
  const ROUTE_TREE_ONLY_MODE = true;
  const _lookupAttempts = new Map(); // contrato -> { count, lastAt }

  function bumpLookupAttempt(contrato) {
    const key = String(contrato || '').replace(/\D/g, '');
    if (!key) return { key: '', count: 0, lastAt: 0 };
    const now = Date.now();
    const prev = _lookupAttempts.get(key) || { count: 0, lastAt: 0 };
    const next = { count: (prev.count || 0) + 1, lastAt: now };
    _lookupAttempts.set(key, next);
    return { key, ...next };
  }

  function getLookupAttempt(contrato) {
    const key = String(contrato || '').replace(/\D/g, '');
    if (!key) return null;
    const val = _lookupAttempts.get(key);
    return val ? { key, ...val } : { key, count: 0, lastAt: 0 };
  }

  function clearLookupAttempt(contrato) {
    const key = String(contrato || '').replace(/\D/g, '');
    if (!key) return;
    _lookupAttempts.delete(key);
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (!rect) return false;
      if (rect.width < 2 || rect.height < 2) return false;
      return true;
    } catch {
      return false;
    }
  }

  function findGlobalSearchInput({ onlyVisible = false } = {}) {
    const selectors = [
      'div#search-bar-container input.search-bar-input[type="search"][data-bind*="searchValue"]',
      'div#search-bar-container input.search-bar-input[type="search"][aria-label*="Pesquisa"]',
      'div#search-bar-container input.search-bar-input[type="search"]',
      'input.search-bar-input[type="search"][data-bind*="searchValue"]',
      'input.search-bar-input[type="search"][aria-label*="Pesquisa"]',
      'input.search-bar-input[type="search"]',
      'input.search-bar-input:not(.icon):not(.global-search-bar-input-button)[data-bind*="searchValue"]',
      'input.search-bar-input:not(.icon):not(.global-search-bar-input-button)',
    ];

    for (const sel of selectors) {
      const elements = Array.from(document.querySelectorAll(sel));
      for (const el of elements) {
        if (!el) continue;
        if (onlyVisible && !isVisible(el)) continue;
        return el;
      }
    }
    return null;
  }

  function findSearchToggleButton() {
    const selectors = [
      '.action-global-search-icon',
      'global-services\\:global-search\\:global-search-button',
      'input.search-bar-input.icon.global-search-bar-input-button',
      'input.search-bar-input.icon',
      '.global-search-bar-input-button',
      '.search-bar-input[tabindex="0"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  async function clickLikeHuman(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus?.(); } catch {}

    if (el.matches?.('input, textarea')) {
      return true;
    }

    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];
    for (const type of events) {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch {}
      await sleep(30 + Math.random() * 60);
    }

    try { el.click?.(); } catch {}
    return true;
  }
  async function abrirCampoBuscaSeNecessario() {
    let inputEl = findGlobalSearchInput({ onlyVisible: true });

    if (!inputEl) {
      console.log('[AUTO-LOOKUP] Campo fechado, tentando abrir...');
      const toggleBtn = findSearchToggleButton();

      if (toggleBtn) {
        console.log('[AUTO-LOOKUP] Clicando no botao toggle:', toggleBtn.className);
        await clickLikeHuman(toggleBtn);
        await sleep(700 + Math.random() * 500);
      }

      for (let i = 0; i < 18; i++) {
        inputEl = findGlobalSearchInput({ onlyVisible: true });
        if (inputEl) break;
        await sleep(140 + Math.random() * 70);
      }
    }

    if (!inputEl) {
      const inputs = document.querySelectorAll('input[type="search"], input[type="text"]');
      for (const inp of inputs) {
        const ariaLabel = inp.getAttribute('aria-label') || '';
        const id = inp.id || '';
        const name = inp.name || '';
        const placeholder = inp.placeholder || '';
        if (/search/i.test(id) || /search/i.test(name) ||
            ariaLabel.includes('Pesquisa') || placeholder.includes('Pesquisa') ||
            ariaLabel.includes('atividades') || placeholder.includes('atividades')) {
          if (!isVisible(inp)) continue;
          if (inp.classList?.contains('icon') && inp.classList?.contains('global-search-bar-input-button')) continue;
          if (inp.id === 'search-input') continue;
          inputEl = inp;
          break;
        }
      }
    }

    if (inputEl) {
      try { inputEl.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      try { inputEl.focus(); } catch {}
    }

    return inputEl;
  }
  async function humanTypeInField(inputEl, text) {
    const alvo = String(text || '').replace(/\D/g, '');

    inputEl.focus();
    await sleep(220 + Math.random() * 180);

    try {
      inputEl.select?.();
      inputEl.setSelectionRange?.(0, String(inputEl.value || '').length);
    } catch {}

    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    inputEl.dispatchEvent(new Event('propertychange', { bubbles: true }));

    try {
      if (window.ko && window.ko.dataFor) {
        const vm = window.ko.dataFor(inputEl);
        if (vm?.searchValue && typeof vm.searchValue === 'function') {
          vm.searchValue('');
        }
      }
    } catch {}

    await sleep(140 + Math.random() * 140);

    for (const char of alvo) {
      try {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      } catch {}

      inputEl.value += char;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new Event('propertychange', { bubbles: true }));

      try {
        if (window.ko && window.ko.dataFor) {
          const vm = window.ko.dataFor(inputEl);
          if (vm?.searchValue && typeof vm.searchValue === 'function') {
            vm.searchValue(inputEl.value);
          }
        }
      } catch {}

      try {
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      } catch {}

      await sleep(TYPING_DELAY());
    }

    const digitsNoCampo = String(inputEl.value || '').replace(/\D/g, '');
    if (digitsNoCampo !== alvo) {
      console.warn('[AUTO-LOOKUP] Campo saiu torto, corrigindo valor final:', digitsNoCampo, '->', alvo);
      inputEl.value = alvo;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new Event('propertychange', { bubbles: true }));
      try {
        if (window.ko && window.ko.dataFor) {
          const vm = window.ko.dataFor(inputEl);
          if (vm?.searchValue && typeof vm.searchValue === 'function') {
            vm.searchValue(alvo);
          }
        }
      } catch {}
    }

    await sleep(260 + Math.random() * 180);

    console.log('[AUTO-LOOKUP] Disparando ENTER humano...');
    try {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }));
    } catch {}

    await sleep(80 + Math.random() * 120);

    try {
      inputEl.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }));
    } catch {}

    try {
      if (window.ko && window.ko.dataFor) {
        const vm = window.ko.dataFor(inputEl);
        if (vm && typeof vm.onKeyPressSearch === 'function') {
          vm.onKeyPressSearch({ keyCode: 13, which: 13 });
        }
        if (vm && typeof vm.performImmediateSearch === 'function') {
          vm.performImmediateSearch();
        }
      }
    } catch {}

    console.log('[AUTO-LOOKUP] Digitado humano:', alvo, '| Valor:', inputEl.value);
  }
  async function clicarPrimeiraOS(contrato) {
    for (let i = 0; i < 40; i++) {
      const items = Array.from(document.querySelectorAll(
        'div.found-item-activity, ' +
        '.activity-title, ' +
        '.activity-icon[aid], ' +
        '[data-id^="a_"], ' +
        'div.global-search-found-item, ' +
        '[class*="search-found"], ' +
        '[class*="result-item"], ' +
        '.search-result-item, ' +
        'div.oj-flex.global-search-recent-requests-item, ' +
        'div.oj-flex-item.global-search-recent-query, ' +
        'a[href*="aid="], ' +
        'a[href*="/activity/"], ' +
        'a[href*="activity/"]'
      )).filter(isVisible);
      
      if (items.length > 0) {
        await sleep(CLICK_PAUSE());
        const alvo =
          items[0].querySelector?.('.activity-title') ||
          items[0].querySelector?.('.activity-icon[aid]') ||
          items[0].closest?.('.found-item-activity')?.querySelector?.('.activity-title') ||
          items[0].closest?.('.found-item-activity')?.querySelector?.('.activity-icon[aid]') ||
          items[0];
        console.log('[AUTO-LOOKUP] Clicando no primeiro resultado:', alvo.textContent?.trim().slice(0, 80) || alvo.getAttribute?.('aria-label') || alvo.className);
        await clickLikeHuman(alvo);
        return true;
      }

      const urlMatch = window.location.href.match(/aid=(\d+)/);
      if (urlMatch && !window.location.href.includes('search')) {
        console.log('[AUTO-LOOKUP] OS aberta via URL, aid:', urlMatch[1]);
        return true;
      }

      await sleep(150);
    }
    
    console.warn('[AUTO-LOOKUP] Sem resultados para:', contrato);
    return false;
  }
  async function clicarOSContratoExato(contrato) {
    const contratoDigits = String(contrato || '').replace(/\D/g, '');
    let ultimoTexto = '';
    let primeiroResultado = null;

    for (let i = 0; i < 24; i++) {
      const items = Array.from(document.querySelectorAll(
        'div.found-item-activity, ' +
        '.activity-title, ' +
        '.activity-icon[aid], ' +
        '[data-id^="a_"], ' +
        'div.global-search-found-item, ' +
        '[class*="search-found"], ' +
        '[class*="result-item"], ' +
        '.search-result-item, ' +
        'div.oj-flex.global-search-recent-requests-item, ' +
        'div.oj-flex-item.global-search-recent-query, ' +
        'a[href*="aid="], ' +
        'a[href*="/activity/"], ' +
        'a[href*="activity/"]'
      )).filter(isVisible);

      const itemContrato = items.find(item => {
        const digits = String(item.textContent || '').replace(/\D/g, '');
        return contratoDigits && digits.includes(contratoDigits);
      });

      if (itemContrato) {
        await sleep(CLICK_PAUSE());
        const alvo =
          itemContrato.querySelector?.('.activity-title') ||
          itemContrato.querySelector?.('.activity-icon[aid]') ||
          itemContrato.closest?.('.found-item-activity')?.querySelector?.('.activity-title') ||
          itemContrato.closest?.('.found-item-activity')?.querySelector?.('.activity-icon[aid]') ||
          itemContrato.closest('a, .global-search-recent-requests-item, .oj-flex.global-search-recent-requests-item') ||
          itemContrato;
        console.log('[AUTO-LOOKUP] Clicando no resultado do contrato:', alvo.textContent?.trim().slice(0, 120) || alvo.getAttribute?.('aria-label') || alvo.className);
        await clickLikeHuman(alvo);
        return true;
      }

      if (items.length > 0) {
        if (!primeiroResultado) primeiroResultado = items[0];
        ultimoTexto = items.map(item => item.textContent?.trim().slice(0, 80) || item.getAttribute?.('aria-label') || item.className).join(' | ');

        if (i >= 3) {
          await sleep(CLICK_PAUSE());
          console.log('[AUTO-LOOKUP] Resultado sem contrato visivel; abrindo o primeiro item');
          const alvo =
            primeiroResultado.querySelector?.('.activity-title') ||
            primeiroResultado.querySelector?.('.activity-icon[aid]') ||
            primeiroResultado.closest?.('.found-item-activity')?.querySelector?.('.activity-title') ||
            primeiroResultado.closest?.('.found-item-activity')?.querySelector?.('.activity-icon[aid]') ||
            primeiroResultado.closest('a, .global-search-recent-requests-item, .oj-flex.global-search-recent-requests-item') ||
            primeiroResultado;
          await clickLikeHuman(alvo);
          return true;
        }
      }

      await sleep(150);
    }

    if (primeiroResultado) {
      await sleep(CLICK_PAUSE());
      console.warn('[AUTO-LOOKUP] Sem match exato; clicando no primeiro resultado para:', contrato, ultimoTexto);
      const alvo =
        primeiroResultado.querySelector?.('.activity-title') ||
        primeiroResultado.querySelector?.('.activity-icon[aid]') ||
        primeiroResultado.closest?.('.found-item-activity')?.querySelector?.('.activity-title') ||
        primeiroResultado.closest?.('.found-item-activity')?.querySelector?.('.activity-icon[aid]') ||
        primeiroResultado.closest('a, .global-search-recent-requests-item, .oj-flex.global-search-recent-requests-item') ||
        primeiroResultado;
      await clickLikeHuman(alvo);
      return true;
    }

    console.warn('[AUTO-LOOKUP] Sem resultado exato para:', contrato, ultimoTexto);
    return false;
  }
  async function waitForContractSynced(contrato, timeoutMs = 10000) {
    const key = String(contrato || '').replace(/\D/g, '');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (state.byContract.has(key)) return true;
      await sleep(500);
    }
    return false;
  }

  const cloudJobIds = new Set();

  function normalizePendingWork(data, transport = 'local') {
    const work = data?.work && typeof data.work === 'object'
      ? data.work
      : (data?.job && typeof data.job === 'object' ? data.job : null);
    const contrato = String(work?.contract || data?.contrato || '').replace(/\D/g, '');
    // Nunca transportar telefone, serial ou ID de grupo como contrato.
    if (!/^\d{5,18}$/.test(contrato)) return null;
    const jobId = String(work?.job_id || work?.id || '');
    if (transport === 'cloud' && jobId) cloudJobIds.add(jobId);
    return {
      contrato,
      jobId,
      jobType: String(work?.job_type || 'DOMINIUM_CONTRACT_LOOKUP'),
      messageId: String(work?.message_id || ''),
      chatId: String(work?.chat_id || ''),
      senderId: String(work?.sender_id || ''),
      requestedCloseCode: String(work?.requested_close_code || ''),
      expectedCity: String(work?.expected_city || ''),
      expectedProfileKey: String(work?.expected_profile_key || ''),
      transport,
    };
  }

  async function checkPendingLookup() {
    try {
      const localResponse = await bridgeFetch('/toa/pending-lookup');
      const local = normalizePendingWork(localResponse?.data || localResponse || {}, 'local');
      if (local) return local;
    } catch {}

    try {
      const cloudResponse = await bridgeFetch('/cloud/v1/collector/jobs/next');
      if (!cloudResponse?.ok) return null;
      return normalizePendingWork(cloudResponse?.data || {}, 'cloud');
    } catch {
      return null;
    }
  }

  async function ackLookup(contrato, meta = {}) {
    try {
      const jobId = String(meta?.job_id || '');
      if (jobId && cloudJobIds.has(jobId)) {
        const success = meta.ok === true;
        const response = await bridgeFetch(`/cloud/v1/collector/jobs/${encodeURIComponent(jobId)}/result`, {
          method: 'POST',
          body: JSON.stringify(success ? {
            ok: true,
            snapshot: meta.snapshot,
          } : {
            ok: false,
            error_code: String(meta.reason || 'toa_lookup_failed'),
            retryable: [
              'toa_template_busca_indisponivel',
              'toa_template_detalhes_indisponivel',
              'toa_template_sessao_indisponivel',
              'toa_sem_sessao',
              'toa_consulta_em_andamento',
              'route_tree_lookup_failed',
            ].includes(String(meta.reason || '')),
          }),
        });
        if (!response?.ok) throw new Error(response?.data?.error || 'cloud_ack_failed');
        cloudJobIds.delete(jobId);
        return;
      }
      await bridgeFetch('/toa/ack-lookup', {
        method: 'POST',
        body: JSON.stringify({ contrato, ...meta }),
      });
    } catch (error) {
      console.warn('[AUTO-LOOKUP] falha ao confirmar consulta:', error?.message || error);
    }
  }

  function buildOperationalSnapshot(ctx, work) {
    const capture = ctx?.normalizedCapture || {};
    const equipment = (value) => (Array.isArray(value) ? value : []).map(item => ({
      inventory_id: String(item?.invid || item?.inventory_id || ''),
      kind: String(item?.kind || ''),
      pool: String(item?.pool || ''),
      action_code: String(item?.action_code || ''),
      material_code: String(item?.material_code || item?.code || ''),
      description: String(item?.description || item?.name || item?.type || ''),
      serial: String(item?.serial || '').toUpperCase(),
      quantity: String(item?.quantity || item?.used_quantity || ''),
      available_stock: String(item?.available_stock || ''),
      point: String(item?.point || ''),
    }));
    const technicianName = typeof ctx?.tecnico === 'string'
      ? ctx.tecnico
      : String(ctx?.tecnico?.name || '');
    return {
      schema_version: 'dominium-toa-v1',
      contract: String(ctx?.contrato || work?.contrato || ''),
      activity_id: String(ctx?.aid || ''),
      activity_type: String(ctx?.tipoOS || ctx?.tipoServico || ''),
      status: String(ctx?.status || ''),
      scheduled_date: String(ctx?.date || ctx?.searchRow?.date || ''),
      service_window: String(ctx?.horario || ctx?.janela || ''),
      route: String(ctx?.rota || ctx?.searchRow?.route_name || ''),
      city: String(ctx?.cidade || ''),
      technician: {
        id: String(ctx?.pid || ''),
        login: String(ctx?.externalId || ctx?.searchRow?.external_id || ''),
        name: technicianName,
      },
      technician_observation: String(ctx?.observacao || ''),
      tasks: Array.isArray(ctx?.tasks) ? ctx.tasks : [],
      close_codes: Array.isArray(ctx?.closeCodes) ? ctx.closeCodes : [],
      equipment: {
        installed: equipment(ctx?.installedEquipment || capture?.installed_equipment),
        removed: equipment(ctx?.removedEquipment || capture?.removed_equipment),
        customer: equipment(ctx?.customerEquipment || capture?.customer_equipment),
        unknown: equipment(ctx?.unknownEquipment || capture?.unknown_equipment),
      },
      materials: equipment(ctx?.materials || capture?.materials),
      validation: ctx?.captureValidation || capture?.validation || {},
      captured_at: new Date().toISOString(),
      source: 'toa-extension-direct',
      read_only: true,
    };
  }

  function buildDisconnectSnapshot(ctx, work) {
    const raw = Array.isArray(ctx?.equipamentosRaw) ? ctx.equipamentosRaw : [];
    const classifier = window.TNDisconnectInventory?.classifyDisconnectInventory;
    if (typeof classifier !== 'function') {
      throw makeToaError('disconnect_inventory_classifier_unavailable');
    }
    const {
      installed: added,
      removed,
      unknown,
    } = classifier(raw);
    const normalize = (item, direction) => ({
      serial: String(item?.serial || '').toUpperCase(),
      equipment_type: String(item?.tipo || ''),
      model: String(item?.modelo || ''),
      direction,
      inventory_pool: String(item?.pool || ''),
      inventory_id: String(item?.invid || ''),
      point: String(item?.point || ''),
      action: String(item?.action || ''),
      action_code: String(item?.action_code || ''),
      provider_id: String(item?.provider_id || ''),
    });
    const closeCodes = Array.isArray(ctx?.closeCodes) ? ctx.closeCodes : [];
    const capturedMaterials = (Array.isArray(ctx?.materialsRaw) ? ctx.materialsRaw : []).map(item => ({
      inventory_id: String(item?.inventory_id || ''),
      activity_id: String(item?.activity_id || ''),
      material_code: String(item?.material_code || item?.code || ''),
      description: String(item?.description || item?.name || ''),
      used_quantity: String(item?.used_quantity || item?.quantity || ''),
      available_stock: String(item?.available_stock || ''),
      point: String(item?.point || ''),
      pool: String(item?.pool || ''),
    }));
    return {
      schema_version: 2,
      job_id: String(work?.jobId || ''),
      message_id: String(work?.messageId || ''),
      contract: String(ctx?.contrato || ''),
      activity_id: String(ctx?.aid || ''),
      activity_type: String(ctx?.tipoOS || ctx?.tipoServico || ''),
      status: String(ctx?.status || ''),
      current_close_code: closeCodes.length === 1 ? closeCodes[0] : null,
      activity_observation: String(ctx?.observacao || ''),
      tasks: Array.isArray(ctx?.tasks) ? ctx.tasks : [],
      city: String(ctx?.cidade || work?.expectedCity || ''),
      profile_key: String(work?.expectedProfileKey || 'natal'),
      installer_id: String(ctx?.pid || ''),
      installed_equipments: [],
      removed_equipments: removed.map(item => normalize(item, 'outgoing')),
      added_equipments: added.map(item => normalize(item, 'incoming')),
      unknown_equipments: unknown.map(item => normalize(item, 'unknown')),
      materials: [],
      materials_applicable: false,
      captured_materials_for_audit: capturedMaterials,
      materials_complete: true,
      responsibility: ctx?.responsibility || {},
      capture_validation: ctx?.captureValidation || {},
      direction_source: 'oracle_inventory_pool',
      fetched_at: new Date().toISOString(),
    };
  }

  async function autoLookupLoop() {
    if (state.autoLookupBusy) {
      console.log('[AUTO-LOOKUP] Já ocupado, pulando ciclo');
      return;
    }

    const work = await checkPendingLookup();
    if (!work) return;
    const contrato = work.contrato;

    state.autoLookupBusy = true;
    
    try {
      console.log('[AUTO-LOOKUP] Contrato pendente:', contrato);

      const prev = getLookupAttempt(contrato);
      if (prev && prev.count > 0 && (Date.now() - prev.lastAt) < LOOKUP_RETRY_COOLDOWN_MS) {
        return;
      }

      const attempt = bumpLookupAttempt(contrato);
      state.exportStatus = `🔍 Buscando contrato ${contrato}... (${attempt.count}/${LOOKUP_MAX_TRIES})`;
      render();

      if ((state.searchTemplate?.entries?.length || state.syncTemplate?.entries?.length) &&
          (state.detailsTemplate?.entries?.length || state.syncTemplate?.entries?.length)) {
        const directStartedAt = performance.now();
        try {
          console.log('[TOA-DIRECT] consultando contrato', contrato);
          const direct = await lookupContractDirect(contrato, {
            requireSingleActivity: work.jobType === 'DISCONNECT_ACTIVITY_LOOKUP',
          });
          const elapsedMs = Math.round(performance.now() - directStartedAt);
          if (direct?.ok) {
            state.exportStatus = `✅ Consulta direta: ${contrato} (${elapsedMs}ms)`;
            await ackLookup(contrato, {
              ok: true,
              reason: 'direct',
              source: 'toa-extension-direct',
              job_id: work.jobId,
              snapshot: work.transport === 'cloud'
                ? buildOperationalSnapshot(direct, work)
                : (work.jobType === 'DISCONNECT_ACTIVITY_LOOKUP'
                    ? buildDisconnectSnapshot(direct, work)
                    : undefined),
            });
            clearLookupAttempt(contrato);
            console.log('[TOA-DIRECT] sucesso', {
              contrato: String(contrato), aid: direct.searchRow?.aid, pid: direct.searchRow?.pid,
              date: direct.searchRow?.date, elapsedMs,
            });
            render();
            return;
          }
          if (direct?.error === 'toa_sem_resultados') {
            state.exportStatus = `⚠ Sem resultados: ${contrato}`;
            await ackLookup(contrato, {
              ok: false,
              reason: 'no_results',
              source: 'toa-extension-direct',
              job_id: work.jobId,
            });
            clearLookupAttempt(contrato);
            console.log('[TOA-DIRECT] nenhum resultado', contrato, `${elapsedMs}ms`);
            render();
            return;
          }
          if (direct?.error === 'toa_fora_arvore_dmv') {
            state.exportStatus = `⚠ Fora da árvore DMV: ${contrato}`;
            await ackLookup(contrato, {
              ok: false,
              reason: 'outside_dmv_route_tree',
              source: 'toa-extension-route-tree',
              job_id: work.jobId,
            });
            clearLookupAttempt(contrato);
            console.log('[TOA-DIRECT] contrato existe, mas não está na árvore DMV', contrato, `${elapsedMs}ms`);
            render();
            return;
          }
          if (direct?.error === 'multiple_toa_activities') {
            state.exportStatus = `⚠ Múltiplas atividades: ${contrato}`;
            await ackLookup(contrato, {
              ok: false,
              reason: 'multiple_toa_activities',
              source: 'toa-extension-direct',
              job_id: work.jobId,
            });
            clearLookupAttempt(contrato);
            render();
            return;
          }
        } catch (error) {
          console.warn('[TOA-DIRECT] falhou:', error?.code || error?.message || error);
          if (ROUTE_TREE_ONLY_MODE) {
            state.exportStatus = `⚠ Consulta pela árvore falhou: ${error?.code || error?.message || error}`;
            if (attempt.count >= LOOKUP_MAX_TRIES) {
              await ackLookup(contrato, {
                ok: false,
                reason: error?.code || 'route_tree_lookup_failed',
                source: 'toa-extension-route-tree',
                job_id: work.jobId || undefined,
              });
              clearLookupAttempt(contrato);
            }
            render();
            return;
          }
        }
      } else {
        console.log('[TOA-DIRECT] sessão/árvore ainda indisponíveis');
        if (ROUTE_TREE_ONLY_MODE) {
          state.exportStatus = `⏳ Aguardando sessão/árvore do TOA — ${contrato}`;
          if (attempt.count >= LOOKUP_MAX_TRIES) {
            await ackLookup(contrato, {
              ok: false,
              reason: 'toa_template_sessao_indisponivel',
              source: 'toa-extension-route-tree',
              job_id: work.jobId || undefined,
            });
            clearLookupAttempt(contrato);
          }
          render();
          return;
        }
      }

      // 1. Abre o campo de busca se necessário
      const inputEl = await abrirCampoBuscaSeNecessario();
      
      if (!inputEl) {
        console.error('[AUTO-LOOKUP] Campo de busca NÃO ENCONTRADO');
        state.exportStatus = `⚠ Campo de busca não encontrado — ${contrato}`;
        render();

         const attemptNow = getLookupAttempt(contrato);
         if (attemptNow && attemptNow.count >= LOOKUP_MAX_TRIES) {
           await ackLookup(contrato, {
             ok: false,
             reason: 'no_search_input',
             source: 'toa-extension-page',
             job_id: work.jobId || undefined,
           });
           clearLookupAttempt(contrato);
         }
        return;
      }

      console.log('[AUTO-LOOKUP] Campo encontrado:', inputEl.outerHTML.substring(0, 100));
      await sleep(180 + Math.random() * 180);

      // 2. Digita o contrato e dispara ENTER
      await humanTypeInField(inputEl, String(contrato));
      
      // 3. Aguarda resultados e tenta abrir a OS do contrato
      await sleep(650 + Math.random() * 450);
      const clicou = await clicarOSContratoExato(contrato);
      if (clicou) {
        setTimeout(() => syncCurrentScreenWithBot(true), 1200);
        setTimeout(() => syncCurrentScreenWithBot(true), 3500);
      }
      if (clicou) {
        const sincronizou = await waitForContractSynced(contrato, 10000);
        syncCurrentScreenWithBot(true);
        if (!sincronizou) {
          console.warn('[AUTO-LOOKUP] OS abriu, mas o sync ainda não apareceu no cache local:', contrato);
        }
      }

      if (clicou) {
        state.exportStatus = `✅ OS aberta: ${contrato}`;
        console.log('[AUTO-LOOKUP] ✅ SUCESSO:', contrato);
      } else {
        const attemptNow = getLookupAttempt(contrato);
        const cnt = attemptNow ? attemptNow.count : 0;
        state.exportStatus = `⚠ Sem resultados: ${contrato} (${cnt}/${LOOKUP_MAX_TRIES})`;
      }
      
      render();

      const attemptNow = getLookupAttempt(contrato);
      const tries = attemptNow ? attemptNow.count : 0;
      if (clicou) {
        if (work.jobType === 'DISCONNECT_ACTIVITY_LOOKUP') {
          await sleep(700);
          if (!(state.searchTemplate?.entries?.length || state.syncTemplate?.entries?.length) ||
              !(state.detailsTemplate?.entries?.length || state.syncTemplate?.entries?.length)) {
            await ackLookup(contrato, {
              ok: false,
              reason: 'toa_template_detalhes_indisponivel',
              source: 'toa-extension-page-warmup',
              job_id: work.jobId,
            });
            clearLookupAttempt(contrato);
            return;
          }
          try {
            const direct = await lookupContractDirect(contrato, {
              requireSingleActivity: true,
            });
            if (!direct?.ok) {
              await ackLookup(contrato, {
                ok: false,
                reason: direct?.error || 'disconnect_snapshot_unavailable',
                source: 'toa-extension-page-warmup',
                job_id: work.jobId,
              });
              clearLookupAttempt(contrato);
              return;
            }
            await ackLookup(contrato, {
              ok: true,
              reason: 'visual_warmup_then_direct',
              source: 'toa-extension-direct',
              job_id: work.jobId,
              snapshot: buildDisconnectSnapshot(direct, work),
            });
            clearLookupAttempt(contrato);
            return;
          } catch (error) {
            await ackLookup(contrato, {
              ok: false,
              reason: error?.code || 'disconnect_snapshot_unavailable',
              source: 'toa-extension-page-warmup',
              job_id: work.jobId,
            });
            clearLookupAttempt(contrato);
            return;
          }
        }
        await ackLookup(contrato, { ok: true, reason: 'opened', source: 'toa-extension-page' });
        clearLookupAttempt(contrato);
      } else if (tries >= LOOKUP_MAX_TRIES) {
        await ackLookup(contrato, {
          ok: false,
          reason: 'no_results',
          source: 'toa-extension-page',
          job_id: work.jobId || undefined,
        });
        clearLookupAttempt(contrato);
      } else {
        console.warn('[AUTO-LOOKUP] Sem resultados, vou tentar de novo:', contrato, `try=${tries}/${LOOKUP_MAX_TRIES}`);
        return;
      }

    } catch (err) {
      console.error('[AUTO-LOOKUP] Erro:', err.message);
      state.exportStatus = `❌ Erro: ${err.message}`;
      if (work.jobId) {
        await ackLookup(contrato, {
          ok: false,
          reason: err?.code || 'disconnect_snapshot_unavailable',
          source: 'toa-extension-page',
          job_id: work.jobId,
        });
        clearLookupAttempt(contrato);
      }
      render();
    } finally {
      state.autoLookupBusy = false;
    }
  }

  // Hooks de rede
  const origFetch = window.fetch;
  window.fetch = async function () {
    const r = await origFetch.apply(this, arguments);
    r.clone().text().then(t => {
      if (!t || (!t.startsWith('{') && !t.startsWith('['))) return;
      try {
        const json = JSON.parse(t);
        rememberProviders(json);
        deepScanOFSC(json);
      } catch {}
    }).catch(() => {});
    return r;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tn_method = method;
    this.__tn_url = url;
    this.__tn_headers = {};
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const key = String(name || '').toLowerCase();
    if (['accept', 'x-requested-with', 'x-oa', 'x-platform'].includes(key)) {
      this.__tn_headers = this.__tn_headers || {};
      this.__tn_headers[key] = String(value);
    }
    return origSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__toaDirectReplay) {
      return origSend.apply(this, arguments);
    }
    this.addEventListener('load', function () {
      let j = null;
      try { j = JSON.parse(this.responseText); } catch {}
      try { rememberProviders(j); } catch {}
      try { deepScanOFSC(j); } catch {}
      try { captureTemplatesFromRequest(this.__tn_method, this.__tn_url, body, j, this.__tn_headers); } catch {}
    });
    return origSend.apply(this, arguments);
  };

  window.__TN_TOA_DIRECT_LOOKUP__ = function (contract, options = {}) {
    return lookupContractDirect(contract, options);
  };

  window.__TN_TOA_DIRECT_STATUS__ = function () {
    return {
      instalado: true,
      versao: 'toa-route-tree-direct-3',
      capturaNormalizada: Boolean(window.TNToaInventoryCore),
      ultimoCodigoBaixa: Array.isArray(state.lastDirectResult?.closeCodes)
        ? state.lastDirectResult.closeCodes.join(', ')
        : '',
      templatePesquisa: Boolean(state.searchTemplate?.entries?.length),
      templateDetalhes: Boolean(state.detailsTemplate?.entries?.length),
      templateSessao: Boolean(state.syncTemplate?.entries?.length),
      arvoreRotas: window.TNTOAAutoExport?.treeStatus?.() || null,
      transporteDireto: 'XMLHttpRequest do TOA',
      csrfAutomaticoPeloTOA: true,
      pesquisaCapturadaEm: state.searchTemplate?.capturedAt || null,
      detalhesCapturadosEm: state.detailsTemplate?.capturedAt || null,
      sessaoCapturadaEm: state.syncTemplate?.capturedAt || null,
      ultimaQuantidadeOs: state.lastDirectSearchRows.length,
      ultimoContrato: state.lastDirectResult?.contrato || '',
    };
  };

  // UI
  let isDragging = false, offset = { x: 0, y: 0 };

  function onMouseDown(e) {
    const panel = document.getElementById('tn-panel');
    if (e.target.closest('.tn-header')) {
      isDragging = true;
      offset.x = e.clientX - panel.offsetLeft;
      offset.y = e.clientY - panel.offsetTop;
      panel.style.transition = 'none';
    }
  }

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const panel = document.getElementById('tn-panel');
    if (panel) {
      state.pos.x = e.clientX - offset.x;
      state.pos.y = e.clientY - offset.y;
      panel.style.cssText += `;right:auto;bottom:auto;left:${state.pos.x}px;top:${state.pos.y}px`;
    }
  });

  document.addEventListener('mouseup', () => { isDragging = false; });

  window.tnToggleMin = () => { state.minimized = !state.minimized; render(); };
  window.tnClose = () => { const p = document.getElementById('tn-panel'); if (p) p.remove(); };

  function render() {
    if (!document.body || window.innerHeight < 150) return;
    state.currentAid = getActiveAidFromUrl();
    state.currentContract = getContractFromScreen();

    let panel = document.getElementById('tn-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'tn-panel';
      panel.addEventListener('mousedown', onMouseDown);
      document.body.appendChild(panel);
    }

    const posStyle = state.pos.x !== null
      ? `left:${state.pos.x}px;top:${state.pos.y}px;right:auto;bottom:auto;`
      : 'right:10px;bottom:10px;';

    panel.style.cssText =
      `position:fixed;z-index:9999999;width:${state.minimized ? '180px' : '300px'};` +
      'background:#ffffff;color:#333;border-radius:8px;padding:0;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.15);font-family:sans-serif;' +
      `border:1px solid #ddd;overflow:hidden;${posStyle}`;

    const ctx = state.byContract.get(state.currentContract) || state.byAid.get(state.currentAid);
    if (ctx) {
      const domTec = sanitizeTechnicianName(getTechName());
      if (domTec && domTec !== 'Técnico não identificado') ctx.tecnico = domTec;
    }

    if (ctx && ctx.cpfCliente) lookupCattaForCtx(ctx);

    const visibleCloseCode = Array.from(new Set(
      (Array.isArray(ctx?.closeCodes) ? ctx.closeCodes : [])
        .map(value => String(value || '').trim())
        .filter(value => /^\d+$/.test(value))
    )).join('/');
    const headerHtml =
      '<div class="tn-header" style="display:flex;justify-content:space-between;align-items:center;' +
      'background:#1a1a1a;color:#fff;padding:6px 12px;cursor:move;user-select:none;border-bottom:2px solid #e60000;">' +
      `<span style="font-size:10px;font-weight:bold;">SISTEMA TECHNET${visibleCloseCode ? ` | COD ${visibleCloseCode}` : ''}</span>` +
      '<div style="display:flex;gap:12px;">' +
      `<button onclick="tnToggleMin()" style="background:none;border:0;color:#fff;cursor:pointer;font-size:14px;">${state.minimized ? '□' : '—'}</button>` +
      '<button onclick="tnClose()" style="background:none;border:0;color:#ff4d4d;cursor:pointer;font-size:14px;font-weight:bold;">✕</button>' +
      '</div></div>';

    if (state.minimized) { panel.innerHTML = headerHtml; return; }

    let content = '<div style="padding:12px;background:#fff;">';
    
    content += '<button onclick="window.copyFormattedInfo(event)" style="width:100%;background:#d81b60;color:white;border:none;padding:10px;border-radius:5px;font-weight:bold;font-size:11px;cursor:pointer;margin-bottom:10px;">📋 COPIAR INFO FORMATADA (RET/FTZ)</button>';
    content += '<button onclick="window.copyVisitReport(event)" style="width:100%;background:#0056b3;color:white;border:none;padding:10px;border-radius:5px;font-weight:bold;font-size:11px;cursor:pointer;margin-bottom:10px;">📝 GERAR RELATÓRIO DE VISITA</button>';
    content += '<button onclick="syncTodosComBot()" style="width:100%;background:#1565c0;color:white;border:none;padding:10px;border-radius:5px;font-weight:bold;font-size:11px;cursor:pointer;margin-bottom:10px;">🔄 SYNC COM BOT</button>';
    content += '<button onclick="window.tnExportContatosLote()" style="width:100%;background:#6a1b9a;color:white;border:none;padding:10px;border-radius:5px;font-weight:bold;font-size:11px;cursor:pointer;margin-bottom:10px;">📤 EXPORTAR CONTATOS EM LOTE</button>';

    content += '<div style="font-size:10px;color:#444;background:#f7f7f7;border:1px solid #eee;padding:8px;border-radius:6px;margin-bottom:10px;">' +
      '<div style="font-weight:700;color:#111;margin-bottom:4px;">Status:</div>' +
      `<div>${state.exportStatus || '—'}</div>` +
      `<div style="margin-top:6px;">AIDs no cache: <b>${state.seenAids.size}</b></div>` +
      `<div style="margin-top:6px;">Bridge: ${state.bridgeAvailable ? '✅ Conectado' : '❌ Desconectado'}</div>` +
      (state.detailsTemplate || state.syncTemplate
        ? '<div style="margin-top:6px;color:#2e7d32;font-weight:700;">Template de sessão: OK ✅</div>'
        : '<div style="margin-top:6px;color:#b26a00;font-weight:700;">Template de sessão: aguardando o TOA carregar</div>') +
      ((state.searchTemplate || state.syncTemplate) && (state.detailsTemplate || state.syncTemplate)
        ? '<div style="margin-top:4px;color:#2e7d32;font-weight:700;">Consulta direta pela árvore: PRONTA ⚡</div>'
        : '<div style="margin-top:4px;color:#b26a00;font-weight:700;">Consulta direta: aguardando sessão/árvore</div>') +
      '</div>';

    content += '<hr style="border:0;border-top:1px solid #eee;margin-bottom:10px;">';

    if (!ctx || ctx.contatos.size === 0) {
      content += '<div style="font-size:11px;text-align:center;color:#999;padding:5px;">Aguardando dados...</div>';
    } else {
      content += `<div style="font-size:9px;color:#e60000;font-weight:bold;margin-bottom:2px;">CONTRATO: ${ctx.contrato || ''}</div>`;
      content += `<div style="font-size:10px;color:#333;margin-bottom:10px;font-weight:600;text-transform:uppercase;">${ctx.nome || getNomeFromIndex()}</div>`;
      if (ctx.cpfCliente) {
        content += `<div style="font-size:10px;color:#111;background:#fff3cd;border:1px solid #ffe08a;border-radius:4px;padding:6px;margin-bottom:8px;"><b>CPF CLIENTE:</b> ${ctx.cpfCliente}</div>`;
      }
      
      if (ctx.cpfCliente) {
        content += '<div style="font-size:10px;color:#111;background:#eef6ff;border:1px solid #bfdbfe;border-radius:4px;padding:7px;margin-bottom:8px;">';
        content += '<div style="font-weight:800;margin-bottom:5px;color:#0f3b70;">CONTATOS CATTA</div>';
        if (ctx.cattaLoading) {
          content += '<div style="color:#555;">Consultando Catta pelo CPF...</div>';
        } else if (ctx.cattaError) {
          content += `<div style="color:#b91c1c;">Falha: ${ctx.cattaError}</div>`;
        } else if (Array.isArray(ctx.catta?.phones) && ctx.catta.phones.length) {
          const contatosAtuais = new Set(Array.from(ctx.contatos || []).map(onlyDigits));
          ctx.catta.phones.slice(0, 12).forEach(item => {
            const extra = contatosAtuais.has(onlyDigits(item.digits)) ? '' : ' <b style="color:#0f7a34;">extra</b>';
            content += `<div style="display:flex;justify-content:space-between;gap:6px;margin-top:4px;"><span>${formatPhoneDisplay(item.digits)}</span><span style="color:#64748b;">${item.carrier || ''}${extra}</span></div>`;
          });
        } else if (ctx.catta?.ok) {
          content += '<div style="color:#555;">Nenhum telefone extra no Catta.</div>';
        } else {
          content += '<div style="color:#555;">Aguardando consulta...</div>';
        }
        content += '</div>';
      }
      
      Array.from(ctx.contatos).forEach(num => {
        content +=
          '<div style="background:#f9f9f9;margin-bottom:6px;padding:8px;border-radius:4px;border:1px solid #eee;">' +
          `<div style="font-size:16px;font-weight:bold;color:#1a1a1a;text-align:center;margin-bottom:6px;">${num}</div>` +
          '<div style="display:flex;gap:4px;">' +
          `<button onclick="window.copyFullReport(event,'${ctx.contrato || ''}')" style="flex:1;background:#333;border:0;color:#fff;padding:5px;border-radius:3px;cursor:pointer;font-size:10px;">Copiar Tudo</button>` +
          `<a href="https://wa.me/55${num}" target="_blank" style="flex:1;background:#25d366;border:0;color:#fff;padding:5px;border-radius:3px;text-decoration:none;text-align:center;font-size:10px;font-weight:bold;">WhatsApp</a>` +
          '</div></div>';
      });
    }

    content += '</div>';
    panel.innerHTML = headerHtml + content;
  }

  // Inicialização
  async function init() {
    console.log('[TOA-MAIN] Iniciando...');
    
    await sleep(500);
    await initBridgeProxy();

    const pingFromPage = async () => {
      try {
        await bridgeFetch('/toa/ping', {
          method: 'POST',
          body: JSON.stringify({ source: 'toa-extension-page' }),
        });
      } catch {}
    };
    await pingFromPage();
    setInterval(pingFromPage, 10000);
    
    setInterval(autoLookupLoop, 3000);
    console.log('[AUTO-LOOKUP] polling iniciado (3000ms)');
    
    setInterval(syncCurrentScreenWithBot, 2500);
    setInterval(render, 1200);
    render();
    state.exportStatus = state.bridgeAvailable 
      ? 'Abra 1 OS para capturar o template. Depois exporte em lote.'
      : '⚠ Bridge offline - verifique se o bot está rodando';
    render();
  }

  console.log('[TOA-TECHNET] Content script MAIN injetado');
  init();
})();

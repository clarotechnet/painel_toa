(function () {
  "use strict";

  if (window.__TN_ATLAS_INJECTED__) return;
  window.__TN_ATLAS_INJECTED__ = true;

  const ATLAS_RASTREIO_URL =
    "https://www.atlas.netservicos.com.br:443/nethome/equipamento/relatorioRastreabilidadeEquipamentosSintetico.do?acao=prepareSearch";
  const ATLAS_KEEPALIVE_SERIAL = "6C11BA66A485";
  const ATLAS_KEEPALIVE_INTERVAL_MS = 45000;
  const ATLAS_PENDING_INTERVAL_MS = 2500;
  const ATLAS_RESULT_TIMEOUT_MS = 8000;
  const ATLAS_ACTION_POLL_MS = 1000;
  const ATLAS_PENDING_ACTION_KEY = "__TN_ATLAS_PENDING_ACTION__";
  const ATLAS_DIRECT_ENDPOINT =
    "/nethome/equipamento/relatorioRastreabilidadeEquipamentosSintetico.do";
  const ATLAS_DIRECT_TIMEOUT_MS = 15000;
  const ATLAS_DIRECT_MAX_PAGES = 20;

  const state = {
    bridgeAvailable: false,
    busy: false,
    resumingAction: false,
    isLeader: false,
    tickRunning: false,
    pingRunning: false,
    requestId: 0,
    pendingRequests: new Map(),
    lastStatus: "Inicializando Atlas...",
    lastKeepaliveAt: 0,
    lastKeepaliveAttemptAt: 0,
    lastPingAt: 0,
    lastQueryAt: 0,
    navAt: 0,
  };

  const CODE_BLOCKLIST = new Set([
    "OPERADORA",
    "RASTREABILIDADE",
    "EQUIPAMENTOS",
    "EQUIPAMENTO",
    "MATERIAL",
    "REGISTRO",
    "CONTRATO",
    "CUSTOMER",
    "PREENCHER",
    "PREENCHIMENTO",
    "ASSINANTE",
    "EMPREITEIRA",
    "ALMOXARIFADO",
    "DISTRIBUICAO",
    "GUARARAPES",
    "PARNAMIRIM",
    "CARDLESS",
    "INICIALIZADO",
    "SUSPEITO",
    "OPERACAO",
  ]);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function startAtlasLeaderElection() {
    if (!navigator.locks?.request) {
      state.isLeader = true;
      state.lastStatus = "Atlas lider (fallback sem Web Locks)";
      return;
    }

    navigator.locks.request("tn-atlas-extension-worker-v1", { mode: "exclusive" }, async () => {
      state.isLeader = true;
      state.lastStatus = "Atlas lider ativo";
      console.log("[ATLAS-EXT] Esta aba e a lider unica da fila Atlas");
      await new Promise((resolve) => {
        window.addEventListener("pagehide", resolve, { once: true });
      });
      state.isLeader = false;
    }).catch((error) => {
      // Chrome atual oferece Web Locks. Se a API falhar, manter o bot funcional
      // em uma unica aba e registrar a degradacao para diagnostico.
      state.isLeader = true;
      state.lastStatus = `Atlas lider em fallback: ${error?.message || "erro Web Locks"}`;
    });
  }

  function loadPendingAction() {
    try {
      const raw = sessionStorage.getItem(ATLAS_PENDING_ACTION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function savePendingAction(action) {
    try {
      sessionStorage.setItem(ATLAS_PENDING_ACTION_KEY, JSON.stringify(action));
    } catch {}
  }

  function clearPendingAction() {
    try {
      sessionStorage.removeItem(ATLAS_PENDING_ACTION_KEY);
    } catch {}
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function normalizeCode(value) {
    const serial = String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
    if (!serial) return "";
    if (!/\d/.test(serial)) return "";
    if (/^\d+$/.test(serial) && (serial.length < 10 || serial.length > 18)) return "";
    if (serial.length < 8 || serial.length > 30) return "";
    if (CODE_BLOCKLIST.has(serial)) return "";
    return serial;
  }

  function codesInText(value) {
    const matches = String(value || "").toUpperCase().match(/[A-Z0-9]{8,30}/g) || [];
    const out = [];
    const seen = new Set();
    for (const item of matches) {
      const code = normalizeCode(item);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
    return out;
  }

  function htmlToText(fragment) {
    const div = document.createElement("div");
    div.innerHTML = fragment || "";
    return div.textContent || "";
  }

  function boldCodesInHtml(html, allowedCodes = null) {
    const out = [];
    const seen = new Set();
    const patterns = [
      /<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi,
      /<[^>]+\bstyle\s*=\s*["'][^"']*font-weight\s*:\s*(?:bold|[6-9]00)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
      /<[^>]+\bclass\s*=\s*["'][^"']*(?:bold|negr|forte)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
    ];

    for (const pattern of patterns) {
      let match = null;
      while ((match = pattern.exec(String(html || "")))) {
        for (const code of codesInText(htmlToText(match[1] || ""))) {
          if (allowedCodes && !allowedCodes.has(code)) continue;
          if (seen.has(code)) continue;
          seen.add(code);
          out.push(code);
        }
      }
    }

    return out;
  }

  function boldCodesFromMatchingCells(html, targetCodes = []) {
    const out = [];
    const seen = new Set();
    const targets = new Set((targetCodes || []).map(normalizeCode).filter(Boolean));
    if (!targets.size) return out;

    let match = null;
    const tdPattern = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    while ((match = tdPattern.exec(String(html || "")))) {
      const cellHtml = match[1] || "";
      const cellText = htmlToText(cellHtml);
      const cellCodes = codesInText(cellText);
      if (!cellCodes.some((code) => targets.has(code))) continue;

      const allowed = new Set(cellCodes);
      for (const code of boldCodesInHtml(cellHtml, allowed)) {
        if (seen.has(code)) continue;
        seen.add(code);
        out.push(code);
      }
    }

    return out;
  }

  function pickBaixavel(negritos, serialNorm) {
    const lista = [...new Set((negritos || []).map(normalizeCode).filter(Boolean))];
    if (!lista.length) return "";
    const diferente = lista.find((code) => code !== serialNorm);
    return diferente || lista[0] || "";
  }

  function normalizeContract(value) {
    const digits = String(value || "").replace(/\D+/g, "");
    return /^\d{6,9}$/.test(digits) ? digits : "";
  }

  function boldCodesInElement(element) {
    if (!element) return [];
    const out = [];
    const seen = new Set();
    const addText = (text) => {
      for (const code of codesInText(text)) {
        if (seen.has(code)) continue;
        seen.add(code);
        out.push(code);
      }
    };

    try {
      const weight = window.getComputedStyle(element).fontWeight || "";
      if (weight === "bold" || Number(weight) >= 600) addText(element.textContent || "");
    } catch {}

    element.querySelectorAll("b, strong").forEach((node) => addText(node.textContent || ""));
    element.querySelectorAll("*").forEach((node) => {
      try {
        const weight = window.getComputedStyle(node).fontWeight || "";
        if (weight === "bold" || Number(weight) >= 600) addText(node.textContent || "");
      } catch {}
    });

    return out;
  }

  function hasUsefulResult(result) {
    if (!result || !result.serial_encontrado) return false;
    return Boolean(
      result.serial_baixavel ||
      result.numero_contrato ||
      (Array.isArray(result.enderecaveis) && result.enderecaveis.length)
    );
  }

  function makeNoResultPayload(serial) {
    return {
      no_result: true,
      serial_consultado: normalizeCode(serial),
      serial_encontrado: false,
      data_alteracao: "",
      estado: "",
      tipo_localizacao: "",
      operacao: "",
      numero_contrato: "",
      localizacao: "",
      localizacoes_top3: [],
      enderecaveis: [],
      enderecaveis_negrito: [],
      serial_baixavel: "",
    };
  }

  function pageHasNoRecords() {
    const text = normalizeText(document.body?.innerText || document.body?.textContent || "");
    if (!text) return false;
    return (
      text.includes("nenhum registro encontrado") ||
      text.includes("nenhum registro(s) encontrado") ||
      text.includes("nenhum registro foi encontrado") ||
      text.includes("nao foi encontrado nenhum registro")
    );
  }

  function currentActionSerial(action) {
    if (!action || !Array.isArray(action.serials)) return "";
    const serial = action.serials[action.index || 0];
    return normalizeCode(serial);
  }

  function appendTentativa(action, tentativa) {
    if (!action) return;
    if (!Array.isArray(action.tentativas)) action.tentativas = [];
    action.tentativas.push(tentativa);
  }

  async function resolveBridgeAction(action, payload) {
    if (!action || action.kind !== "query" || !action.requestId) return;
    await bridgeFetch("/atlas/resolve-query", {
      method: "POST",
      body: JSON.stringify({
        requestId: action.requestId,
        ...payload,
        source: "atlas-extension-page"
      })
    });
  }

  function bridgeFetch(path, options = {}) {
    return new Promise((resolve, reject) => {
      const id = ++state.requestId;
      state.pendingRequests.set(id, { resolve, reject });

      window.postMessage({
        type: "TOA_BRIDGE_REQUEST",
        id,
        path,
        options
      }, "*");

      setTimeout(() => {
        if (!state.pendingRequests.has(id)) return;
        state.pendingRequests.delete(id);
        reject(new Error("Bridge proxy timeout"));
      }, 10000);
    });
  }

  async function initBridgeProxy() {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const { type, id, success, result, error } = event.data || {};
      if (type !== "TOA_BRIDGE_RESPONSE" || !state.pendingRequests.has(id)) return;

      const pending = state.pendingRequests.get(id);
      state.pendingRequests.delete(id);
      if (success) pending.resolve(result);
      else pending.reject(new Error(error || "Bridge proxy error"));
    });

    try {
      await bridgeFetch("/atlas/health");
      state.bridgeAvailable = true;
      state.lastStatus = "Bridge Atlas conectado";
      console.log("[ATLAS-EXT] Bridge conectado");
    } catch (error) {
      state.bridgeAvailable = false;
      state.lastStatus = `Bridge Atlas offline: ${error.message}`;
      console.warn("[ATLAS-EXT] Bridge offline:", error.message);
    }
  }

  function getRastreioField() {
    return document.querySelector("#enderecavel, input[name='enderecavel']");
  }

  function pageFilterCodes() {
    const out = [];
    const seen = new Set();
    const addFromText = (value) => {
      for (const code of codesInText(value)) {
        if (seen.has(code)) continue;
        seen.add(code);
        out.push(code);
      }
    };
    const selectors = [
      "#enderecavel",
      "input[name='enderecavel']",
      "#numeroSerie",
      "input[name='numeroSerie']",
      "#numero_serie",
      "input[name='numero_serie']",
    ];
    selectors.forEach((selector) => {
      const el = document.querySelector(selector);
      if (!el) return;
      const value = "value" in el ? el.value : el.textContent || "";
      addFromText(value);
    });

    document.querySelectorAll("tr, td, label, span, div").forEach((node) => {
      const text = node.textContent || "";
      const norm = normalizeText(text);
      if (!text || text.length > 250) return;
      if (norm.includes("enderecavel") || norm.includes("numero de serie")) addFromText(text);
    });
    return out;
  }

  function isOnRastreioPage() {
    return /relatorioRastreabilidadeEquipamentosSintetico/i.test(location.href);
  }

  function ensureRastreioPage() {
    if (isOnRastreioPage() && getRastreioField()) return true;

    if (Date.now() - state.navAt < 12000) return false;

    state.navAt = Date.now();
    state.lastStatus = "Abrindo rastreabilidade Atlas...";
    console.log("[ATLAS-EXT] Navegando para rastreabilidade");
    location.href = ATLAS_RASTREIO_URL;
    return false;
  }

  function clickElement(element) {
    if (!element) return;
    try { element.scrollIntoView({ block: "center", inline: "center" }); } catch {}
    try { element.focus?.(); } catch {}
    try { element.click?.(); } catch {}
  }

  function findReportButton() {
    const direct = document.querySelector("a[onclick*='submeterRelatorio']");
    if (direct) return direct;

    const img = document.querySelector("img[src*='botao_gerarrelatorio']");
    if (img) return img.closest("a") || img;

    const input = Array.from(document.querySelectorAll("input[type='button'], input[type='submit']"))
      .find((node) => /gerar relat/i.test(node.value || ""));
    if (input) return input;

    const button = Array.from(document.querySelectorAll("button"))
      .find((node) => /gerar relat/i.test(node.textContent || ""));
    return button || null;
  }

  async function typeSerial(field, serial) {
    field.focus();
    try { field.select?.(); } catch {}
    field.value = "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(80);

    for (const char of serial) {
      field.value += char;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(35 + Math.random() * 55);
    }

    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function headerKey(text) {
    const value = normalizeText(text);

    if (value.includes("data da alteracao")) return "data";
    if (value.includes("responsavel")) return "responsavel";
    if (value === "estado") return "estado";
    if (value.includes("tipo localizacao")) return "tipo_localizacao";
    if (value.includes("perfil local")) return "perfil_local";
    if (value.includes("numero do contrato")) return "contrato";
    if (value.includes("codigo do cliente")) return "codigo_cliente";
    if (value.includes("operacao")) return "operacao";
    if (value.includes("ordem servico")) return "ordem_servico";
    if (value.includes("customer order")) return "customer_order";
    if (value.includes("work order")) return "work_order";
    if (value.includes("codigo item jde")) return "codigo_item_jde";
    if (value.includes("codigo material sap")) return "codigo_material_sap";

    // ATENÇÃO: no Atlas existem duas colunas diferentes:
    // "Tipo Localização" e "Localização".
    // O bug era justamente não mapear a coluna "Localização" real.
    if (value === "localizacao" || value.endsWith(" localizacao")) return "localizacao";

    if (value === "dmt") return "dmt";
    if (value === "nf") return "nf";
    if (value === "serie") return "serie";
    if (value.includes("classificacao material") || value.includes("classificacacao material")) return "classificacao_material";
    if (value.includes("observacao")) return "observacao";
    if (value.includes("enderec") || value.includes("serial")) return "enderecavel";
    return "";
  }

  function assetHeaderKey(text) {
    const value = normalizeText(text);
    if (value.includes("tipo de equipamento")) return "tipo_equipamento";
    if (value.includes("modelo do equipamento")) return "modelo_equipamento";
    if (value.includes("numero de serie")) return "numero_serie";
    if (value.includes("enderec")) return "enderecavel";
    if (value.includes("empresa material")) return "empresa_material";
    return "";
  }

  function indexMapFromRow(row) {
    const map = {};
    const cells = Array.from(row.querySelectorAll("td, th"));
    cells.forEach((cell, index) => {
      const key = headerKey(cell.textContent || "");
      if (key && !(key in map)) map[key] = index;
    });
    return map;
  }

  function assetIndexMapFromRow(row) {
    const map = {};
    const cells = Array.from(row.querySelectorAll("td, th"));
    cells.forEach((cell, index) => {
      const key = assetHeaderKey(cell.textContent || "");
      if (key && !(key in map)) map[key] = index;
    });
    return map;
  }

  function cellText(cells, key, indexMap) {
    const index = indexMap[key];
    if (!Number.isInteger(index) || index < 0 || index >= cells.length) return "";
    return (cells[index].textContent || "").replace(/\s+/g, " ").trim();
  }

  function cellNode(cells, key, indexMap) {
    const index = indexMap[key];
    if (!Number.isInteger(index) || index < 0 || index >= cells.length) return null;
    return cells[index] || null;
  }

  function collectCodesFromCells(cells, key, indexMap, seenCodes, seenBold, enderecaveis, negritos) {
    const cell = cellNode(cells, key, indexMap);
    if (!cell) return;

    const rowCodes = codesInText(cell.textContent || "");
    const allowedCodes = new Set(rowCodes);
    const rowBold = [
      ...boldCodesInElement(cell),
      ...boldCodesInHtml(cell.innerHTML || "", allowedCodes),
    ];

    rowCodes.forEach((code) => {
      if (seenCodes.has(code)) return;
      seenCodes.add(code);
      enderecaveis.push(code);
    });

    rowBold.forEach((code) => {
      if (seenBold.has(code)) return;
      seenBold.add(code);
      negritos.push(code);
    });
  }

  function getReadableDocuments() {
    const docs = [document];
    document.querySelectorAll("iframe, frame").forEach((frame) => {
      try {
        if (frame.contentDocument) docs.push(frame.contentDocument);
      } catch {}
    });
    return docs;
  }

  function directHistoryRows() {
    return getReadableDocuments().flatMap((doc) =>
      Array.from(doc.querySelectorAll("tr#td1, tr[id='td1']"))
        .filter((row) => row.querySelectorAll("td").length >= 8)
    );
  }

  function collectAssetCodes(rows) {
    const enderecaveis = [];
    const negritos = [];
    const seenCodes = new Set();
    const seenBold = new Set();
    let tipoEquipamento = "";
    let modeloEquipamento = "";
    let numeroSerie = "";

    let assetHeaderRow = null;
    let assetIndexMap = null;
    for (const row of rows) {
      const candidate = assetIndexMapFromRow(row);
      if (candidate.numero_serie !== undefined && candidate.enderecavel !== undefined) {
        assetHeaderRow = row;
        assetIndexMap = candidate;
        break;
      }
    }

    if (!assetHeaderRow || !assetIndexMap) {
      return { enderecaveis, negritos, seenCodes, seenBold, tipo_equipamento: tipoEquipamento, modelo_equipamento: modeloEquipamento, numero_serie: numeroSerie };
    }

    const assetRows = assetHeaderRow?.parentElement
      ? Array.from(assetHeaderRow.parentElement.children).filter((row) => row.tagName === "TR" && row.querySelector("td"))
      : rows;
    const assetStartIndex = Math.max(0, assetRows.indexOf(assetHeaderRow) + 1);

    for (const row of assetRows.slice(assetStartIndex)) {
      const cells = Array.from(row.querySelectorAll("td"));
      if (!cells.length) continue;

      const serialCell = cellNode(cells, "numero_serie", assetIndexMap);
      const endCell = cellNode(cells, "enderecavel", assetIndexMap);
      if (!tipoEquipamento) tipoEquipamento = cellText(cells, "tipo_equipamento", assetIndexMap);
      if (!modeloEquipamento) modeloEquipamento = cellText(cells, "modelo_equipamento", assetIndexMap);
      if (!numeroSerie) numeroSerie = cellText(cells, "numero_serie", assetIndexMap);
      const rowHasUsefulText = normalizeText((serialCell?.textContent || "") + " " + (endCell?.textContent || ""));
      if (!rowHasUsefulText) continue;

      collectCodesFromCells(cells, "numero_serie", assetIndexMap, seenCodes, seenBold, enderecaveis, negritos);
      collectCodesFromCells(cells, "enderecavel", assetIndexMap, seenCodes, seenBold, enderecaveis, negritos);

      const rowAllowed = new Set([
        ...codesInText(serialCell?.textContent || ""),
        ...codesInText(endCell?.textContent || ""),
      ]);
      for (const code of boldCodesInHtml(row.innerHTML || "", rowAllowed)) {
        if (seenBold.has(code)) continue;
        seenBold.add(code);
        negritos.push(code);
      }
    }

    return { enderecaveis, negritos, seenCodes, seenBold, tipo_equipamento: tipoEquipamento, modelo_equipamento: modeloEquipamento, numero_serie: numeroSerie };
  }

  function historyRowFromCellsByMap(cells, indexMap, knownStates) {
    if (!Array.isArray(cells) || !cells.length || !indexMap) return null;

    const dataAlteracao = cellText(cells, "data", indexMap);
    const estado = cellText(cells, "estado", indexMap);
    const tipoLocalizacao = cellText(cells, "tipo_localizacao", indexMap);
    const numeroContrato = normalizeContract(cellText(cells, "contrato", indexMap));
    const operacao = cellText(cells, "operacao", indexMap);
    const localizacao = cellText(cells, "localizacao", indexMap);
    const ordemServico = cellText(cells, "ordem_servico", indexMap);
    const dmt = cellText(cells, "dmt", indexMap);
    const nf = cellText(cells, "nf", indexMap);
    const serie = cellText(cells, "serie", indexMap);

    const hasDate = /\b\d{2}\/\d{2}\/\d{4}\b/.test(dataAlteracao);
    const stateOk = knownStates.has(normalizeText(estado));

    if (!(hasDate || stateOk || numeroContrato || localizacao)) return null;

    return {
      data_alteracao: dataAlteracao,
      estado,
      tipo_localizacao: tipoLocalizacao,
      numero_contrato: numeroContrato,
      operacao,
      localizacao,
      ordem_servico: ordemServico,
      dmt,
      nf,
      serie,
    };
  }

  function buildHistoryRowFromCells(cells, knownStates) {
    if (!Array.isArray(cells) || cells.length < 8) return null;

    const dataAlteracao = String(cells[0] || "").trim();
    const estado = String(cells[2] || "").trim();
    const tipoLocalizacao = String(cells[3] || "").trim();
    const numeroContrato = normalizeContract(cells[5] || "");
    const operacao = String(cells[7] || "").trim();

    // Coluna real "Localização" na tela atual do Atlas.
    // Exemplo do cabeçalho:
    // ... Código Material SAP | Localização | DMT | NF | Série ...
    const localizacao = String(cells[13] || "").replace(/\s+/g, " ").trim();

    const hasDate = /\b\d{2}\/\d{2}\/\d{4}\b/.test(dataAlteracao);
    const stateOk = knownStates.has(normalizeText(estado));

    if (!(hasDate || stateOk || numeroContrato || localizacao)) return null;

    return {
      data_alteracao: dataAlteracao,
      estado,
      tipo_localizacao: tipoLocalizacao,
      numero_contrato: numeroContrato,
      operacao,
      localizacao,
    };
  }

  function summarizeHistoryRows(historyRows = []) {
    const rows = Array.isArray(historyRows) ? historyRows.filter(Boolean) : [];
    const selectedRow = rows.find((row) => row.numero_contrato) || rows[0] || null;
    const localizacoesTop3 = [];
    const seenLocs = new Set();

    for (const row of rows) {
      const loc = String(row.localizacao || "").replace(/\s+/g, " ").trim();
      if (!loc) continue;
      const key = normalizeText(loc);
      if (seenLocs.has(key)) continue;
      seenLocs.add(key);
      localizacoesTop3.push(loc);
      if (localizacoesTop3.length >= 3) break;
    }

    if (selectedRow && !selectedRow.localizacao && localizacoesTop3.length) {
      selectedRow.localizacao = localizacoesTop3[0];
    }

    return { selectedRow, localizacoesTop3, historyRows: rows };
  }

  function extractFixedHistorySummary(rows, knownStates) {
    const parsedRows = [];

    for (const row of rows || []) {
      const cells = Array.isArray(row)
        ? row
        : Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent || "");
      const currentRow = buildHistoryRowFromCells(cells, knownStates);
      if (currentRow) parsedRows.push(currentRow);
    }

    return summarizeHistoryRows(parsedRows);
  }

  function extractFixedHistoryRow(rows, knownStates) {
    return extractFixedHistorySummary(rows, knownStates).selectedRow;
  }

  function extractHistoryByHeader(knownStates) {
    const docs = getReadableDocuments();
    const allRows = [];

    for (const doc of docs) {
      for (const table of Array.from(doc.querySelectorAll("table"))) {
        const tableRows = Array.from(table.rows || []);
        for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex++) {
          const row = tableRows[rowIndex];
          const cells = Array.from(row.querySelectorAll("td, th"));
          if (!cells.length) continue;

          const indexMap = indexMapFromRow(row);
          const isHeader =
            indexMap.data !== undefined &&
            indexMap.responsavel !== undefined &&
            indexMap.estado !== undefined &&
            indexMap.operacao !== undefined &&
            indexMap.localizacao !== undefined;

          if (!isHeader) continue;

          for (const dataRow of tableRows.slice(rowIndex + 1)) {
            const dataCells = Array.from(dataRow.querySelectorAll("td"));
            if (!dataCells.length) continue;
            const parsed = historyRowFromCellsByMap(dataCells, indexMap, knownStates);
            if (parsed) allRows.push(parsed);
          }

          const summary = summarizeHistoryRows(allRows);
          if (summary.selectedRow) return summary;
        }
      }
    }

    return { selectedRow: null, localizacoesTop3: [], historyRows: [] };
  }

  function htmlFragmentText(fragment) {
    const div = document.createElement("div");
    div.innerHTML = fragment || "";
    return (div.textContent || "").replace(/\s+/g, " ").trim();
  }

  function extractAtlasResultFromHtml(serial, filterCodes = []) {
    const html = document.body?.innerHTML || "";
    if (!html) return null;

    const rowRegex = /<tr\b[^>]*id=["']td1["'][^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    const rows = [];
    let rowMatch = null;

    while ((rowMatch = rowRegex.exec(html))) {
      const cells = [];
      let cellMatch = null;
      while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
        cells.push(htmlFragmentText(cellMatch[1]));
      }
      if (cells.length) rows.push(cells);
    }

    if (!rows.length) return null;

    const knownStates = new Set(["suspeito", "inicializado", "baixado", "ativo", "inativo", "transito reversa"]);
    const summary = extractFixedHistorySummary(rows, knownStates);
    const selectedRow = summary.selectedRow;
    if (!selectedRow) return null;

    const serialNorm = normalizeCode(serial);
    const enderecaveis = [...new Set(filterCodes.map(normalizeCode).filter(Boolean))];

    return {
      data_alteracao: selectedRow.data_alteracao || "",
      estado: selectedRow.estado || "",
      tipo_localizacao: selectedRow.tipo_localizacao || "",
      operacao: selectedRow.operacao || "",
      numero_contrato: selectedRow.numero_contrato || "",
      localizacao: selectedRow.localizacao || summary.localizacoesTop3[0] || "",
      localizacoes_top3: summary.localizacoesTop3 || [],
      historico: summary.historyRows || [],
      serial_consultado: serialNorm,
      serial_encontrado: Boolean(
        serialNorm &&
        (enderecaveis.includes(serialNorm) || html.toUpperCase().includes(serialNorm))
      ),
      enderecaveis,
      enderecaveis_negrito: [],
      serial_baixavel: "",
    };
  }

  function buildAtlasResult(selectedRow, serialNorm, filterCodes, assetData, includeHtmlCheck = false, historyRows = []) {
    const summary = summarizeHistoryRows(historyRows.length ? historyRows : [selectedRow]);
    const mainRow = selectedRow || summary.selectedRow || {};
    const localizacoesTop3 = summary.localizacoesTop3 || [];

    const enderecaveis = Array.isArray(assetData?.enderecaveis) ? [...assetData.enderecaveis] : [];
    const negritos = Array.isArray(assetData?.negritos) ? [...assetData.negritos] : [];
    const seenCodes = assetData?.seenCodes instanceof Set ? assetData.seenCodes : new Set(enderecaveis);
    const bodyHtmlRaw = includeHtmlCheck ? String(document.body?.innerHTML || "") : "";
    const bodyHtml = bodyHtmlRaw.toUpperCase();
    const boldAllowed = new Set([...enderecaveis, ...filterCodes, serialNorm].filter(Boolean));
    for (const code of boldCodesInHtml(bodyHtmlRaw, boldAllowed)) {
      if (negritos.includes(code)) continue;
      negritos.push(code);
    }
    for (const code of boldCodesFromMatchingCells(bodyHtmlRaw, [...boldAllowed])) {
      if (negritos.includes(code)) continue;
      negritos.push(code);
    }
    const serialBaixavel = pickBaixavel(negritos, serialNorm);
    const tipoEquipamento = String(assetData?.tipo_equipamento || assetData?.tipoEquipamento || "").trim();

    const textoFormatado = [
      `📄 Número do contrato: ${mainRow.numero_contrato || "-"}`,
      `📦 IMPERIUM${tipoEquipamento ? " / " + tipoEquipamento : ""}: ${serialBaixavel || "-"}`,
      `📅 Data da Alteração: ${mainRow.data_alteracao || "-"}`,
      `📍 Localização: ${localizacoesTop3.length ? localizacoesTop3.join(" ||| ") : (mainRow.localizacao || "-")}`,
    ].join("\n");

    return {
      data_alteracao: mainRow.data_alteracao || "",
      estado: mainRow.estado || "",
      tipo_localizacao: mainRow.tipo_localizacao || "",
      operacao: mainRow.operacao || "",
      numero_contrato: mainRow.numero_contrato || "",
      localizacao: mainRow.localizacao || localizacoesTop3[0] || "",
      localizacoes_top3: localizacoesTop3,
      historico: summary.historyRows || [],
      tipo_equipamento: tipoEquipamento,
      serial_consultado: serialNorm,
      serial_encontrado: Boolean(
        serialNorm &&
        (seenCodes.has(serialNorm) || filterCodes.includes(serialNorm) || (includeHtmlCheck && bodyHtml.includes(serialNorm)))
      ),
      enderecaveis,
      enderecaveis_negrito: negritos,
      serial_baixavel: serialBaixavel,
      texto_formatado: textoFormatado,
      imperium_formatado: textoFormatado,
    };
  }

  function extractAtlasResult(serial) {
    const docs = getReadableDocuments();
    const rows = docs.flatMap((doc) =>
      Array.from(doc.querySelectorAll("tr")).filter((row) => row.querySelector("td"))
    );
    const serialNorm = normalizeCode(serial);
    const filterCodes = pageFilterCodes();
    const knownStates = new Set(["suspeito", "inicializado", "baixado", "ativo", "inativo", "transito reversa"]);
    const td1Rows = directHistoryRows();
    const assetData = collectAssetCodes(rows);

    // PRIORIDADE: cabeçalho real da tabela, porque é o único jeito seguro de pegar
    // a coluna "Localização" sem confundir com "Tipo Localização".
    const byHeader = extractHistoryByHeader(knownStates);
    if (byHeader.selectedRow) {
      return buildAtlasResult(byHeader.selectedRow, serialNorm, filterCodes, assetData, true, byHeader.historyRows);
    }

    if (td1Rows.length) {
      const fixedSummary = extractFixedHistorySummary(td1Rows, knownStates);
      if (fixedSummary.selectedRow) {
        return buildAtlasResult(fixedSummary.selectedRow, serialNorm, filterCodes, assetData, true, fixedSummary.historyRows);
      }
    }

    if (!rows.length) return extractAtlasResultFromHtml(serialNorm, filterCodes);

    let headerRow = null;
    let indexMap = null;
    for (const row of rows) {
      const candidate = indexMapFromRow(row);
      if (candidate.data !== undefined && candidate.estado !== undefined && candidate.contrato !== undefined) {
        headerRow = row;
        indexMap = candidate;
        break;
      }
    }
    if (!indexMap) return extractAtlasResultFromHtml(serialNorm, filterCodes);

    const tableRows = headerRow?.parentElement
      ? Array.from(headerRow.parentElement.children).filter((row) => row.tagName === "TR" && row.querySelector("td"))
      : rows;

    const startIndex = Math.max(0, tableRows.indexOf(headerRow) + 1);
    const dataRows = tableRows.slice(startIndex);

    const parsedRows = [];
    for (const row of dataRows) {
      const cells = Array.from(row.querySelectorAll("td"));
      if (!cells.length) continue;
      const currentRow = historyRowFromCellsByMap(cells, indexMap, knownStates);
      if (currentRow) parsedRows.push(currentRow);
    }

    let summary = summarizeHistoryRows(parsedRows);
    if (!summary.selectedRow) {
      summary = extractFixedHistorySummary(dataRows, knownStates);
    }
    if (!summary.selectedRow) return extractAtlasResultFromHtml(serialNorm, filterCodes);

    return buildAtlasResult(summary.selectedRow, serialNorm, filterCodes, assetData, true, summary.historyRows);
  }

  async function waitResult(serial, timeoutMs = ATLAS_RESULT_TIMEOUT_MS) {
    await sleep(900);
    const startedAt = Date.now();
    let last = null;
    const serialNorm = normalizeCode(serial);

    while (Date.now() - startedAt < timeoutMs) {
      last = extractAtlasResult(serialNorm);
      if (hasUsefulResult(last)) return last;
      if (pageHasNoRecords()) return makeNoResultPayload(serialNorm);
      await sleep(300);
    }

    if (pageHasNoRecords()) return makeNoResultPayload(serialNorm);
    return last;
  }

  function directCells(row) {
    return Array.from(row?.children || []).filter(
      (node) => node.tagName === "TD" || node.tagName === "TH"
    );
  }

  function directRows(table) {
    const rows = [];
    for (const child of Array.from(table?.children || [])) {
      if (child.tagName === "TR") {
        rows.push(child);
      } else if (["THEAD", "TBODY", "TFOOT"].includes(child.tagName)) {
        for (const row of Array.from(child.children || [])) {
          if (row.tagName === "TR") rows.push(row);
        }
      }
    }
    return rows;
  }

  function makeAtlasDirectError(code, message = "") {
    const error = new Error(message || code || "falha_consulta_atlas");
    error.code = code || "falha_consulta_atlas";
    return error;
  }

  function uniqueCaseInsensitive(values) {
    const out = [];
    const seen = new Set();
    for (const value of values || []) {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      const key = normalizeText(text);
      if (!text || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  }

  function atlasDocumentLooksLoggedOut(response, doc) {
    const finalUrl = String(response?.url || "");
    if (/\/(?:login|logon)(?:[/?#]|$)/i.test(finalUrl)) return true;
    if (doc.querySelector("input[type='password']")) return true;
    if (doc.querySelector("form[action*='login' i], form[action*='logon' i]")) return true;
    const title = normalizeText(doc.title || "");
    const body = normalizeText((doc.body?.textContent || "").slice(0, 5000));
    return (
      (title.includes("login") || title.includes("netscaler")) &&
      (body.includes("senha") || body.includes("password") || body.includes("usuario"))
    );
  }

  async function fetchAtlasDocument(url, options = {}, timeoutMs = ATLAS_DIRECT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      response = await fetch(url, {
        ...options,
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw makeAtlasDirectError("atlas_timeout");
      throw makeAtlasDirectError("falha_consulta_atlas", error?.message || "");
    } finally {
      window.clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw makeAtlasDirectError("atlas_sem_sessao", `HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw makeAtlasDirectError(
        `atlas_http_${response.status || 500}`,
        `HTTP ${response.status || 500}`
      );
    }

    let html = "";
    try {
      html = new TextDecoder("windows-1252").decode(await response.arrayBuffer());
    } catch {
      throw makeAtlasDirectError("atlas_resposta_nao_parseavel");
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc?.documentElement) throw makeAtlasDirectError("atlas_resposta_nao_parseavel");
    if (atlasDocumentLooksLoggedOut(response, doc)) {
      throw makeAtlasDirectError("atlas_sem_sessao");
    }
    return { doc, response };
  }

  function extractBoldCodesFromCell(cell) {
    if (!cell) return [];
    const selector = [
      "b",
      "strong",
      "[style*='font-weight: bold' i]",
      "[style*='font-weight:bold' i]",
      "[style*='font-weight: 700' i]",
      "[style*='font-weight:700' i]",
      "[class*='bold' i]",
      "[class*='negr' i]",
    ].join(",");
    const allowed = new Set(codesInText(cell.textContent || ""));
    const out = [];
    const seen = new Set();
    const nodes = [cell, ...Array.from(cell.querySelectorAll(selector))];
    for (const node of nodes) {
      const tag = String(node.tagName || "").toLowerCase();
      const inlineWeight = String(node.style?.fontWeight || "").toLowerCase();
      const className = String(node.getAttribute?.("class") || "").toLowerCase();
      const isBold =
        tag === "b" ||
        tag === "strong" ||
        inlineWeight === "bold" ||
        Number.parseInt(inlineWeight, 10) >= 600 ||
        /(?:^|[\s_-])(?:bold|negr|forte)(?:$|[\s_-])/.test(className);
      if (!isBold) continue;
      for (const code of codesInText(node.textContent || "")) {
        if (!allowed.has(code) || seen.has(code)) continue;
        seen.add(code);
        out.push(code);
      }
    }
    return out;
  }

  function parseAtlasEquipment(doc, serialNorm) {
    const required = [
      "tipo_equipamento",
      "modelo_equipamento",
      "numero_serie",
      "enderecavel",
      "empresa_material",
    ];
    const candidates = [];
    for (const table of Array.from(doc.querySelectorAll("table"))) {
      const rows = directRows(table);
      for (let headerIndex = 0; headerIndex < rows.length; headerIndex++) {
        const headerCells = directCells(rows[headerIndex]);
        if (headerCells.length !== 5) continue;
        const keys = headerCells.map((cell) => assetHeaderKey(cell.textContent || ""));
        const keySet = new Set(keys.filter(Boolean));
        if (keySet.size !== 5 || !required.every((key) => keySet.has(key))) continue;

        const indexMap = {};
        keys.forEach((key, index) => {
          if (key) indexMap[key] = index;
        });
        for (const row of rows.slice(headerIndex + 1)) {
          const cells = directCells(row);
          if (cells.length !== 5 || cells.some((cell) => cell.tagName !== "TD")) continue;
          const numeroSerie = cellText(cells, "numero_serie", indexMap);
          const enderecavelCell = cellNode(cells, "enderecavel", indexMap);
          const enderecaveis = codesInText(enderecavelCell?.textContent || "");
          const enderecaveisNegrito = extractBoldCodesFromCell(enderecavelCell);
          const numeroSerieCodes = codesInText(numeroSerie);
          if (!numeroSerieCodes.length && !enderecaveis.length) continue;
          candidates.push({
            tipo_equipamento: cellText(cells, "tipo_equipamento", indexMap),
            modelo_equipamento: cellText(cells, "modelo_equipamento", indexMap),
            numero_serie: numeroSerie,
            empresa_material: cellText(cells, "empresa_material", indexMap),
            enderecaveis,
            enderecaveis_negrito: enderecaveisNegrito,
            serial_encontrado:
              numeroSerieCodes.includes(serialNorm) || enderecaveis.includes(serialNorm),
          });
        }
      }
    }
    return candidates.find((item) => item.serial_encontrado) || candidates[0] || null;
  }

  function isAtlasHistoryHeader(indexMap) {
    return [
      "data",
      "responsavel",
      "estado",
      "tipo_localizacao",
      "contrato",
      "operacao",
      "localizacao",
    ].every((key) => Number.isInteger(indexMap[key]));
  }

  function parseAtlasHistoryRow(cells, indexMap) {
    const row = {
      data_alteracao: cellText(cells, "data", indexMap),
      responsavel: cellText(cells, "responsavel", indexMap),
      estado: cellText(cells, "estado", indexMap),
      tipo_localizacao: cellText(cells, "tipo_localizacao", indexMap),
      perfil_local: cellText(cells, "perfil_local", indexMap),
      numero_contrato: normalizeContract(cellText(cells, "contrato", indexMap)),
      codigo_cliente: cellText(cells, "codigo_cliente", indexMap),
      operacao: cellText(cells, "operacao", indexMap),
      ordem_servico: cellText(cells, "ordem_servico", indexMap),
      customer_order: cellText(cells, "customer_order", indexMap),
      work_order: cellText(cells, "work_order", indexMap),
      codigo_item_jde: cellText(cells, "codigo_item_jde", indexMap),
      codigo_material_sap: cellText(cells, "codigo_material_sap", indexMap),
      localizacao: cellText(cells, "localizacao", indexMap),
      dmt: cellText(cells, "dmt", indexMap),
      nf: cellText(cells, "nf", indexMap),
      serie: cellText(cells, "serie", indexMap),
      classificacao_material: cellText(cells, "classificacao_material", indexMap),
      observacao: cellText(cells, "observacao", indexMap),
    };
    const knownStates = new Set([
      "suspeito", "inicializado", "baixado", "ativo", "inativo", "transito reversa",
    ]);
    const hasDate = /\b\d{2}\/\d{2}\/\d{4}\b/.test(row.data_alteracao);
    if (!(hasDate || knownStates.has(normalizeText(row.estado)) || row.numero_contrato || row.localizacao)) {
      return null;
    }
    return row;
  }

  function parseAtlasHistory(doc) {
    const parsed = [];
    for (const table of Array.from(doc.querySelectorAll("table"))) {
      const rows = directRows(table);
      for (let headerIndex = 0; headerIndex < rows.length; headerIndex++) {
        const headerCells = directCells(rows[headerIndex]);
        if (!headerCells.length) continue;
        const indexMap = {};
        headerCells.forEach((cell, index) => {
          const key = headerKey(cell.textContent || "");
          if (key && !Number.isInteger(indexMap[key])) indexMap[key] = index;
        });
        if (!isAtlasHistoryHeader(indexMap)) continue;
        for (const row of rows.slice(headerIndex + 1)) {
          const cells = directCells(row);
          if (!cells.length || cells.some((cell) => cell.tagName !== "TD")) continue;
          const item = parseAtlasHistoryRow(cells, indexMap);
          if (item) parsed.push(item);
        }
        break;
      }
    }
    return parsed;
  }

  function dedupeAtlasHistory(rows) {
    const out = [];
    const seen = new Set();
    for (const row of rows || []) {
      const key = [
        row.data_alteracao, row.responsavel, row.estado, row.tipo_localizacao,
        row.numero_contrato, row.operacao, row.localizacao, row.dmt,
      ].map((value) => normalizeText(value)).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }

  function atlasPageUrls(doc, endpointAbsolute) {
    const out = [];
    const seen = new Set();
    for (const link of Array.from(doc.querySelectorAll("a[href*='pageNumber=']"))) {
      try {
        const url = new URL(link.getAttribute("href") || "", endpointAbsolute);
        const pageNumber = Number(url.searchParams.get("pageNumber") || 0);
        if (
          url.origin !== location.origin ||
          pageNumber <= 1 ||
          pageNumber > ATLAS_DIRECT_MAX_PAGES ||
          seen.has(url.href)
        ) continue;
        seen.add(url.href);
        out.push({ url, pageNumber });
      } catch {}
    }
    out.sort((a, b) => a.pageNumber - b.pageNumber);
    return out;
  }

  function atlasNoRecords(doc) {
    const text = normalizeText(doc.body?.textContent || "");
    return (
      text.includes("nenhum registro encontrado") ||
      text.includes("nenhum registro(s) encontrado") ||
      text.includes("nenhum registro foi encontrado") ||
      text.includes("nao foi encontrado nenhum registro")
    );
  }

  function atlasMacAliasCandidates(serialNorm) {
    // CM MAC/eMTA MAC do mesmo aparelho costumam ficar a poucos enderecos de
    // distancia. Restrito a MAC hexadecimal com letras para nao transformar
    // smart cards/IDs numericos em aproximacoes perigosas.
    if (!/^(?=.*[A-F])[0-9A-F]{12}$/.test(serialNorm)) return [];

    let value = 0n;
    try {
      value = BigInt(`0x${serialNorm}`);
    } catch {
      return [];
    }

    const max = 0xffffffffffffn;
    const offsets = [-3, 3, -1, 1, -2, 2, -4, 4];
    const out = [];
    const seen = new Set([serialNorm]);
    for (const offset of offsets) {
      const candidateValue = value + BigInt(offset);
      if (candidateValue < 0n || candidateValue > max) continue;
      const candidate = candidateValue.toString(16).toUpperCase().padStart(12, "0");
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push({ serial: candidate, offset });
    }
    return out;
  }

  async function queryAtlasDirectAttempt(
    requestedSerial,
    querySerial,
    field = "enderecavel",
    aliasOffset = 0
  ) {
    const requestedNorm = normalizeCode(requestedSerial);
    const queryNorm = normalizeCode(querySerial);
    if (!requestedNorm || !queryNorm) {
      return { ok: false, error: "serial_invalido", serial_consultado: requestedNorm || "" };
    }
    const queryByNumeroSerie = field === "numSerie";

    const body = new URLSearchParams({
      acao: "search",
      contentType: "",
      keepFilter: "true",
      pelomenosum: "Pelo menos um filtro deve ser preenchido para realizar a consulta",
      unicocampo: "Preencher somente um dos campos",
      msgRetorno:
        "Relatório submetido com sucesso para processamento. " +
        "Identificador para consulta: {0}",
      numSerie: queryByNumeroSerie ? queryNorm : "",
      enderecavel: queryByNumeroSerie ? "" : queryNorm,
      tipoRelat: "tela",
    });
    const endpointAbsolute = new URL(ATLAS_DIRECT_ENDPOINT, location.origin).href;
    const first = await fetchAtlasDocument(endpointAbsolute, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "text/html,application/xhtml+xml",
      },
      body: body.toString(),
    });

    const equipment = parseAtlasEquipment(first.doc, queryNorm);
    let historico = parseAtlasHistory(first.doc);
    const paginationErrors = [];
    let pagesLoaded = 0;
    const queue = atlasPageUrls(first.doc, endpointAbsolute);
    const queued = new Set(queue.map((item) => item.url.href));
    while (queue.length && pagesLoaded < ATLAS_DIRECT_MAX_PAGES - 1) {
      const page = queue.shift();
      try {
        const next = await fetchAtlasDocument(page.url.href, {
          method: "GET",
          headers: { Accept: "text/html,application/xhtml+xml" },
        });
        pagesLoaded += 1;
        historico.push(...parseAtlasHistory(next.doc));
        for (const discovered of atlasPageUrls(next.doc, endpointAbsolute)) {
          if (queued.has(discovered.url.href)) continue;
          queued.add(discovered.url.href);
          queue.push(discovered);
        }
        queue.sort((a, b) => a.pageNumber - b.pageNumber);
      } catch (error) {
        paginationErrors.push({
          pageNumber: page.pageNumber,
          error: error?.code || error?.message || "falha_paginacao_atlas",
        });
      }
    }

    historico = dedupeAtlasHistory(historico);
    if (!equipment && !historico.length) {
      if (!atlasNoRecords(first.doc)) {
        throw makeAtlasDirectError(
          "atlas_resposta_sem_estrutura",
          `Resposta sem tabela para ${field}=${queryNorm}`
        );
      }
      return {
        ok: false,
        error: "nenhum_registro_encontrado",
        serial_consultado: requestedNorm,
        serial_consulta_atlas: queryNorm,
        campo_consulta_atlas: field,
        serial_resolvido_por_alias: queryNorm !== requestedNorm,
        alias_offset: aliasOffset,
        serial_encontrado: false,
      };
    }

    const selectedIndexRaw = historico.findIndex((row) => row.numero_contrato);
    const selectedIndex = selectedIndexRaw >= 0 ? selectedIndexRaw : 0;
    const selectedRow = historico[selectedIndex] || {};
    const localizacoesTop3 = uniqueCaseInsensitive(
      historico.slice(selectedIndex).map((row) => row.localizacao).filter(Boolean)
    ).slice(0, 3);
    const enderecaveis = uniqueCaseInsensitive(equipment?.enderecaveis || []);
    const enderecaveisNegrito = uniqueCaseInsensitive(
      equipment?.enderecaveis_negrito || []
    ).map(normalizeCode).filter(Boolean);
    const serialBaixavel =
      pickBaixavel(enderecaveisNegrito, requestedNorm) ||
      enderecaveis[0] ||
      queryNorm ||
      requestedNorm ||
      "";
    const tipoEquipamento = String(equipment?.tipo_equipamento || "").trim();
    const numeroContrato = selectedRow.numero_contrato || "";
    const dataAlteracao = selectedRow.data_alteracao || "";
    const localizacao = selectedRow.localizacao || localizacoesTop3[0] || "";
    const textoFormatado = [
      `📄 Número do contrato: ${numeroContrato || "-"}`,
      `📦 IMPERIUM${tipoEquipamento ? ` / ${tipoEquipamento}` : ""}: ${serialBaixavel || requestedNorm || "-"}`,
      `📅 Data da Alteração: ${dataAlteracao || "-"}`,
      `📍 Localização: ${localizacoesTop3.length ? localizacoesTop3.join(" ||| ") : localizacao || "-"}`,
    ].join("\n");

    return {
      ok: true,
      serial_consultado: requestedNorm,
      serial_consulta_atlas: queryNorm,
      campo_consulta_atlas: field,
      serial_resolvido_por_alias: queryNorm !== requestedNorm,
      alias_offset: aliasOffset,
      serial_encontrado: Boolean(
        equipment?.serial_encontrado ||
        enderecaveis.includes(queryNorm) ||
        equipment ||
        historico.length
      ),
      serial_baixavel: serialBaixavel,
      tipo_equipamento: tipoEquipamento,
      modelo_equipamento: String(equipment?.modelo_equipamento || "").trim(),
      numero_serie: String(equipment?.numero_serie || "").trim(),
      enderecaveis,
      enderecaveis_negrito: enderecaveisNegrito,
      numero_contrato: numeroContrato,
      data_alteracao: dataAlteracao,
      estado: selectedRow.estado || "",
      tipo_localizacao: selectedRow.tipo_localizacao || "",
      operacao: selectedRow.operacao || "",
      localizacao,
      localizacao_final: localizacoesTop3.join(" ||| "),
      localizacoes_top3: localizacoesTop3,
      localizacoes: localizacoesTop3,
      localizacoes_top_3: localizacoesTop3,
      total_registros: historico.length,
      paginas_adicionais_carregadas: pagesLoaded,
      partial: paginationErrors.length > 0,
      pagination_errors: paginationErrors,
      historico,
      texto_formatado: textoFormatado,
      imperium_formatado: textoFormatado,
    };
  }

  async function queryAtlasDirect(serial) {
    const serialNorm = normalizeCode(serial);
    if (!serialNorm) return { ok: false, error: "serial_invalido", serial_consultado: "" };

    const attempts = [
      { serial: serialNorm, field: "enderecavel", offset: 0 },
      { serial: serialNorm, field: "numSerie", offset: 0 },
      ...atlasMacAliasCandidates(serialNorm).map((item) => ({
        serial: item.serial,
        field: "enderecavel",
        offset: item.offset,
      })),
    ];
    let lastNoResult = null;

    for (const attempt of attempts) {
      const result = await queryAtlasDirectAttempt(
        serialNorm,
        attempt.serial,
        attempt.field,
        attempt.offset
      );
      if (result?.ok) return result;
      if (result?.error !== "nenhum_registro_encontrado") return result;
      lastNoResult = result;
    }

    return lastNoResult || {
      ok: false,
      error: "nenhum_registro_encontrado",
      serial_consultado: serialNorm,
      serial_encontrado: false,
    };
  }

  function makePendingAction(kind, serials, extra = {}) {
    return {
      kind,
      serials: (serials || []).map((item) => normalizeCode(item)).filter(Boolean),
      index: 0,
      tentativas: [],
      phase: "prepare",
      createdAt: Date.now(),
      timeoutMs: Number(extra.timeoutMs || ATLAS_RESULT_TIMEOUT_MS) || ATLAS_RESULT_TIMEOUT_MS,
      requestId: extra.requestId || null,
    };
  }

  async function resumePendingAction() {
    const action = loadPendingAction();
    if (!state.isLeader || !action || state.resumingAction) return false;

    state.resumingAction = true;
    state.busy = true;

    try {
      while ((action.index || 0) < action.serials.length) {
        const serialNorm = currentActionSerial(action);
        if (!serialNorm) {
          appendTentativa(action, {
            serial: String(action.serials[action.index] || ""),
            ok: false,
            error: "serial_invalido",
          });
          action.index += 1;
          savePendingAction(action);
          continue;
        }

        try {
          state.lastStatus = `Atlas consultando ${serialNorm} via HTTP...`;
          const result = await queryAtlasDirect(serialNorm);
          if (result?.ok && hasUsefulResult(result)) {
            const payload = {
              ok: true,
              serial: serialNorm,
              ...result,
              resultado: result,
              tentativas: [
                ...(Array.isArray(action.tentativas) ? action.tentativas : []),
                {
                  serial: serialNorm,
                  ok: true,
                  serial_baixavel: result.serial_baixavel || "",
                  error: null,
                },
              ],
            };

            clearPendingAction();
            if (action.kind === "query") {
              await resolveBridgeAction(action, payload);
              console.log(
                `[ATLAS-EXT] query HTTP ok request=${action.requestId} serial=${serialNorm} contrato=${result.numero_contrato || "-"} registros=${result.total_registros || 0} paginas=${result.paginas_adicionais_carregadas || 0}`
              );
            } else {
              state.lastKeepaliveAt = Date.now();
              console.log(`[ATLAS-EXT] keepalive HTTP ok serial=${serialNorm}`);
            }

            state.lastStatus = `Atlas OK ${serialNorm}`;
            return true;
          }

          appendTentativa(action, {
            serial: serialNorm,
            ok: false,
            error: result?.error || "nenhum_registro_encontrado",
          });
        } catch (error) {
          appendTentativa(action, {
            serial: serialNorm,
            ok: false,
            error: error?.code || error?.message || "falha_consulta_atlas",
          });
        }

        action.index += 1;
        savePendingAction(action);
      }

      const lastAttempt = action.tentativas?.length
        ? action.tentativas[action.tentativas.length - 1]
        : null;
      const finalError =
        lastAttempt?.error || "nenhum_resultado_com_contrato_encontrado";
      clearPendingAction();

      if (action.kind === "query") {
        await resolveBridgeAction(action, {
          ok: false,
          error: finalError,
          tentativas: action.tentativas || [],
        });
        console.warn(
          `[ATLAS-EXT] query HTTP falhou request=${action.requestId} error=${finalError}`
        );
      }

      state.lastStatus = `Atlas sem resultado: ${finalError}`;
      return true;
    } finally {
      state.resumingAction = false;
      state.busy = false;
    }
  }

  async function runKeepalive() {
    if (!state.isLeader || state.busy || loadPendingAction()) return;
    state.lastKeepaliveAttemptAt = Date.now();

    let pendingCount = 0;
    try {
      const statusResp = await bridgeFetch("/atlas/extension-status");
      pendingCount = Number(statusResp?.data?.pendingQueries || statusResp?.pendingQueries || 0);
    } catch {}

    if (pendingCount > 0) {
      state.lastStatus = `Fila Atlas pendente (${pendingCount}) - keepalive aguardando`;
      return;
    }

    savePendingAction(makePendingAction("keepalive", [ATLAS_KEEPALIVE_SERIAL], { timeoutMs: 6000 }));
    await resumePendingAction();
  }

  async function processPendingQuery() {
    if (!state.isLeader || state.busy || loadPendingAction() || !state.bridgeAvailable) return;

    let response = null;
    try {
      response = await bridgeFetch("/atlas/pending-query");
    } catch (error) {
      state.bridgeAvailable = false;
      state.lastStatus = `Bridge Atlas caiu: ${error.message}`;
      return;
    }

    const query = response?.data?.query || response?.query;
    if (!query?.requestId || !Array.isArray(query.serials) || !query.serials.length) return;

    state.lastQueryAt = Date.now();
    state.lastStatus = `Consultando Atlas: ${query.serials.join(", ")}`;
    savePendingAction(makePendingAction("query", query.serials, {
      requestId: query.requestId,
      timeoutMs: Math.max(10000, ATLAS_RESULT_TIMEOUT_MS)
    }));
    await resumePendingAction();
  }

  async function pingBridge() {
    if (!state.isLeader || state.pingRunning) return;
    state.pingRunning = true;
    try {
      await bridgeFetch("/atlas/ping", {
        method: "POST",
        body: JSON.stringify({
          source: "atlas-extension-page",
          url: location.href
        })
      });
      state.bridgeAvailable = true;
      state.lastPingAt = Date.now();
    } catch (error) {
      state.bridgeAvailable = false;
      state.lastStatus = `Bridge Atlas offline: ${error.message}`;
    } finally {
      state.pingRunning = false;
    }
  }

  async function runAtlasTick() {
    if (!state.isLeader || state.tickRunning) return;
    state.tickRunning = true;
    try {
      if (!state.bridgeAvailable || Date.now() - state.lastPingAt >= 4_000) {
        await pingBridge();
      }
      if (!state.bridgeAvailable) return;

      await resumePendingAction();
      await processPendingQuery();

      const keepaliveReference = Math.max(
        state.lastKeepaliveAt,
        state.lastKeepaliveAttemptAt,
        state.lastQueryAt
      );
      if (Date.now() - keepaliveReference >= ATLAS_KEEPALIVE_INTERVAL_MS) {
        await runKeepalive();
      }
    } finally {
      state.tickRunning = false;
    }
  }

  async function init() {
    console.log("[ATLAS-EXT] Content script Atlas injetado");
    await sleep(500);
    await initBridgeProxy();

    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.type !== "TN_ATLAS_BACKGROUND_TICK") return;
      // O POST/paginacao de uma consulta pode ocupar o tick principal por
      // varios segundos. O heartbeat e independente para o health nao cair.
      if (
        state.isLeader &&
        (!state.bridgeAvailable || Date.now() - state.lastPingAt >= 4_000)
      ) {
        pingBridge().catch(() => {});
      }
      runAtlasTick().catch((error) => {
        console.warn("[ATLAS-EXT] tick do background falhou:", error?.message || error);
      });
    });

    // Fallback quando o service worker for reiniciado. Em aba visivel roda no
    // intervalo normal; em aba oculta o background fornece o tick imediato.
    setInterval(() => { runAtlasTick().catch(() => {}); }, ATLAS_PENDING_INTERVAL_MS);
    await runAtlasTick();
  }

  startAtlasLeaderElection();
  init().catch((error) => {
    console.error("[ATLAS-EXT] erro fatal:", error.message);
  });
})();

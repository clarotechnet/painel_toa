(function initTOADiscoveryExporter(root) {
  "use strict";

  const SENSITIVE = /(?:authorization|cookie|password|secret|token|ticket|csrf|trust|session(?:id|key|hash)?|cpf|cnpj|phone|telefone|mobile|email|address|endereco|postal|cep|customer_name|client_name|nome_cliente)/i;

  function cleanValue(value, key) {
    if (SENSITIVE.test(String(key || ""))) return undefined;
    if (Array.isArray(value)) return value.map((item) => cleanValue(item, key)).filter((item) => item !== undefined);
    if (value && typeof value === "object") {
      const output = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        const clean = cleanValue(childValue, childKey);
        if (clean !== undefined) output[childKey] = clean;
      }
      return output;
    }
    if (typeof value === "string" && /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return "[DESCARTADO]";
    return value;
  }

  function publicDataset(state) {
    return cleanValue({
      metadata: state.metadata || {},
      resources: state.resources || [],
      activities: state.activities || [],
      events: state.events || [],
      routes: state.routes || [],
      endpoints: state.endpoints || [],
      fields: state.fields || [],
      errors: state.errors || [],
      buckets: state.buckets || [],
    }, "root");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function exportJson(state) {
    const text = JSON.stringify(publicDataset(state), null, 2);
    downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), "toa-discovery.json");
  }

  function xml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }

  function columnName(index) {
    let value = index + 1;
    let name = "";
    while (value > 0) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  }

  function sheetXml(headers, rows) {
    const allRows = [headers, ...rows];
    const body = allRows.map((row, rowIndex) => {
      const cells = headers.map((_, columnIndex) => {
        const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
        const raw = row[columnIndex];
        if (rowIndex > 0 && typeof raw === "number" && Number.isFinite(raw)) return `<c r="${ref}"><v>${raw}</v></c>`;
        const style = rowIndex === 0 ? " s=\"1\"" : "";
        return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(raw)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    const lastColumn = columnName(Math.max(0, headers.length - 1));
    const widths = headers.map((header, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(45, Math.max(12, String(header).length + 3))}" customWidth="1"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${lastColumn}${Math.max(1, allRows.length)}"/></worksheet>`;
  }

  function rowsFor(items, headers) {
    return (items || []).map((item) => headers.map((header) => {
      const value = item && item[header];
      if (Array.isArray(value)) return value.join(" | ");
      if (value && typeof value === "object") return JSON.stringify(value);
      return value ?? "";
    }));
  }

  function workbookSheets(state) {
    const data = publicDataset(state);
    const resourcesHeaders = ["resourceId", "userId", "login", "name", "bucket", "resourceType", "parentResourceId", "active", "accountStatus", "availabilityStatus", "loginDisponivel", "situacaoCadastro", "statusRota", "totalOS", "pendentes", "habilidades", "calendario", "grupos", "areasTrabalho", "validation", "capturedAt"];
    const activitiesHeaders = ["activityId", "resourceId", "workOrder", "date", "type", "status", "routePosition", "serviceWindowStart", "serviceWindowEnd", "communicatedWindowStart", "communicatedWindowEnd", "eta", "enrouteAt", "startedAt", "closedAt", "plannedDuration", "actualDuration", "latitude", "longitude", "workArea", "workZone", "closeCode", "completionFlag", "capturedAt"];
    const eventsHeaders = ["activityId", "resourceId", "timestamp", "kind", "actor", "routePosition", "travelMinutes", "finalTravelMinutes", "routingMethod", "resourceFrom", "resourceTo", "reason", "routePlan"];
    const routesHeaders = ["resourceId", "activityId", "routePosition", "travelMinutes", "finalTravelMinutes", "routingMethod", "eta", "capturedAt"];
    const endpointHeaders = ["method", "endpoint", "category", "calls", "parameters", "requestType", "responseType", "responseBytes", "statuses", "schema", "firstSeen", "lastSeen"];
    const fieldHeaders = ["name", "canonical", "type", "path"];
    const errorHeaders = ["at", "stage", "message", "resourceId", "source"];
    const summary = [
      ["Versão", data.metadata.version || ""],
      ["Captura ativa", data.metadata.captureActive ? "Sim" : "Não"],
      ["Iniciada em", data.metadata.startedAt || ""],
      ["Última captura", data.metadata.lastSeen || ""],
      ["Recursos candidatos", data.metadata.resourcesFound || 0],
      ["Recursos validados", data.resources.length],
      ["Com login disponível", data.resources.filter((item) => item.login).length],
      ["Sem login exposto", data.resources.filter((item) => item.name && !item.login).length],
      ["Buckets salvos", data.buckets.length],
      ["Atividades", data.activities.length],
      ["Eventos", data.events.length],
      ["Rotas", data.routes.length],
      ["Endpoints", data.endpoints.length],
      ["Campos", data.fields.length],
      ["Erros/rejeições", data.errors.length],
      ["Sanitizado", "Sim — sem tokens, cookies, autenticação ou dados pessoais desnecessários"],
    ];
    const fixedNames = new Set(["Resumo", "Buckets", "Recursos", "Atividades", "Eventos", "Rotas", "Endpoints", "Campos", "Erros"]);
    const usedNames = new Set(fixedNames);
    const bucketSheetName = (raw) => {
      const base = String(raw || "Bucket").replace(/[\\/:*?\[\]]/g, "-").trim().slice(0, 31) || "Bucket";
      let name = base;
      let suffix = 2;
      while (usedNames.has(name)) {
        const tail = `-${suffix++}`;
        name = `${base.slice(0, 31 - tail.length)}${tail}`;
      }
      usedNames.add(name);
      return name;
    };
    const bucketIndexHeaders = ["bucket", "candidatos", "comDados", "pendentesDetalhe", "savedAt"];
    const bucketSheets = data.buckets.map((bucket) => ({
      name: bucketSheetName(bucket.name),
      headers: resourcesHeaders,
      rows: rowsFor(bucket.resources || [], resourcesHeaders),
    }));
    return [
      { name: "Resumo", headers: ["Indicador", "Valor"], rows: summary },
      { name: "Buckets", headers: bucketIndexHeaders, rows: data.buckets.map((bucket) => [bucket.name, (bucket.resourceIds || []).length || (bucket.resources || []).length, (bucket.resources || []).length, bucket.pendingDetails || 0, bucket.savedAt || ""]) },
      { name: "Recursos", headers: resourcesHeaders, rows: rowsFor(data.resources, resourcesHeaders) },
      ...bucketSheets,
      { name: "Atividades", headers: activitiesHeaders, rows: rowsFor(data.activities, activitiesHeaders) },
      { name: "Eventos", headers: eventsHeaders, rows: rowsFor(data.events, eventsHeaders) },
      { name: "Rotas", headers: routesHeaders, rows: rowsFor(data.routes, routesHeaders) },
      { name: "Endpoints", headers: endpointHeaders, rows: rowsFor(data.endpoints, endpointHeaders) },
      { name: "Campos", headers: fieldHeaders, rows: rowsFor(data.fields, fieldHeaders) },
      { name: "Erros", headers: errorHeaders, rows: rowsFor(data.errors, errorHeaders) },
    ];
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(value) {
    return new Uint8Array([value & 0xFF, (value >>> 8) & 0xFF]);
  }

  function u32(value) {
    return new Uint8Array([value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF]);
  }

  function concat(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { output.set(part, offset); offset += part.length; }
    return output;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function zipStore(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = dosDateTime(new Date());
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);
      const local = concat([
        u32(0x04034B50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
      ]);
      localParts.push(local);
      centralParts.push(concat([
        u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
      ]));
      offset += local.length;
    }
    const central = concat(centralParts);
    const end = concat([
      u32(0x06054B50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0),
    ]);
    return concat([...localParts, central, end]);
  }

  function createXlsx(state) {
    const sheets = workbookSheets(state);
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;
    const files = [
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rootRels },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
      { name: "xl/styles.xml", data: styles },
      ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet.headers, sheet.rows) })),
    ];
    return zipStore(files);
  }

  function exportXlsx(state) {
    const bytes = createXlsx(state);
    downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "TOA_Inventario_Completo.xlsx");
  }

  const api = Object.freeze({ publicDataset, createXlsx, exportJson, exportXlsx });
  root.TOADiscoveryExporter = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

import { normalizeKey, text } from '../utils/text.js';

const MAX_ORDERS = 10000;

function decodeBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch (_) {
    return new TextDecoder('windows-1252').decode(bytes).replace(/^\uFEFF/, '');
  }
}

function detectDelimiter(source) {
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

function parseCsv(source, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === delimiter && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => text(value))) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => text(value))) rows.push(row);
  }
  return rows;
}

function indexMap(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    const key = normalizeKey(header);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  });
  return map;
}

function indexFor(map, name, last = false) {
  const values = map.get(normalizeKey(name)) || [];
  if (!values.length) return null;
  return last ? values[values.length - 1] : values[0];
}

function valueAt(row, map, name, last = false) {
  const index = indexFor(map, name, last);
  return index === null || index >= row.length ? '' : text(row[index]);
}

function firstValue(row, map, names) {
  for (const name of names) {
    const value = valueAt(row, map, name);
    if (value) return value;
  }
  return '';
}

export function bucketFromFilename(filename) {
  const match = text(filename).match(/^Atividades-(.+?)_\d{2}_\d{2}_(?:\d{2}|\d{4})(?:\s+\(\d+\))?\.csv$/i);
  return match ? match[1].toUpperCase() : text(filename).replace(/\.csv$/i, '').toUpperCase();
}

function parseOne(textSource, filename) {
  const source = textSource.replace(/^\uFEFF/, '');
  const rows = parseCsv(source, detectDelimiter(source));
  if (rows.length < 2) throw new Error(`${filename}: CSV vazio ou sem dados.`);
  const headers = rows[0];
  const map = indexMap(headers);
  const required = ['Data', 'Login do Técnico', 'Status da Atividade', 'Cidade', 'Contrato', 'Número da O.S 1', 'Tipo OS 1'];
  const missing = required.filter((name) => indexFor(map, name) === null);
  if (missing.length) throw new Error(`${filename}: colunas ausentes: ${missing.join(', ')}`);

  const orders = [];
  const timelineActivities = [];
  const bucket = bucketFromFilename(filename);
  let currentTechnician = '';

  rows.slice(1).forEach((row, sourceIndex) => {
    const login = valueAt(row, map, 'Login do Técnico').toUpperCase();
    if (login) currentTechnician = login;

    const activityLabel = valueAt(row, map, 'Tipo de Atividade', true);
    const activityKey = normalizeKey(activityLabel);
    const startedAt = valueAt(row, map, 'Início');
    const endedAt = valueAt(row, map, 'Fim');
    if (['refeicao', 'almoco', 'intervalo refeicao'].includes(activityKey)
      && currentTechnician && startedAt && endedAt) {
      timelineActivities.push({
        scheduled_date: valueAt(row, map, 'Data'),
        technician: currentTechnician,
        technician_login: currentTechnician,
        technician_name: currentTechnician,
        status: valueAt(row, map, 'Status da Atividade'),
        service: 'REFEICAO',
        started_at: startedAt,
        ended_at: endedAt,
        service_window: valueAt(row, map, 'Janela de Serviço'),
        time_window: valueAt(row, map, 'Intervalo de Tempo'),
        duration: valueAt(row, map, 'Duração'),
        bucket,
        source_file: filename,
        is_auxiliary: true,
        auxiliary_type: 'meal',
        activity_id: `meal-${sourceIndex + 2}`,
      });
    }

    for (let number = 1; number <= 10; number += 1) {
      const osNumber = valueAt(row, map, `Número da O.S ${number}`);
      if (!osNumber) continue;
      if (orders.length >= MAX_ORDERS) throw new Error(`Limite de ${MAX_ORDERS} OS excedido.`);
      const technician = login || currentTechnician;
      orders.push({
        date: valueAt(row, map, 'Data'),
        scheduled_date: valueAt(row, map, 'Data'),
        technician,
        technician_login: technician,
        technician_name: technician,
        activity_status: valueAt(row, map, 'Status da Atividade'),
        status: valueAt(row, map, `Status da O.S ${number}`) || valueAt(row, map, 'Status da Atividade'),
        toa_status: valueAt(row, map, `Status da O.S ${number}`) || valueAt(row, map, 'Status da Atividade'),
        address: valueAt(row, map, 'Endereço'),
        district: valueAt(row, map, 'Bairro'),
        zip_code: valueAt(row, map, 'CEP/Código Postal'),
        time_window: valueAt(row, map, 'Intervalo de Tempo'),
        service_window: valueAt(row, map, 'Janela de Serviço'),
        city: valueAt(row, map, 'Cidade').toUpperCase(),
        state: valueAt(row, map, 'UF').toUpperCase(),
        customer_name: firstValue(row, map, ['Nome do Cliente', 'Nome']),
        contract: valueAt(row, map, 'Contrato'),
        work_order: valueAt(row, map, 'Número da WO'),
        node: valueAt(row, map, 'Node'),
        os_number: osNumber,
        num_os: osNumber,
        point: valueAt(row, map, `Ponto ${number}`),
        os_status: valueAt(row, map, `Status da O.S ${number}`),
        os_type: valueAt(row, map, `Tipo OS ${number}`),
        service: valueAt(row, map, `Tipo OS ${number}`),
        close_code: valueAt(row, map, `Cód de Baixa ${number}`),
        workzone_key: valueAt(row, map, 'Workzone Key'),
        started_at: startedAt,
        ended_at: endedAt,
        start_end: valueAt(row, map, 'Início - Fim'),
        sla_start: valueAt(row, map, 'Início do SLA'),
        sla_end: valueAt(row, map, 'Fim do SLA'),
        duration: valueAt(row, map, 'Duração'),
        travel_time: valueAt(row, map, 'Tempo de Deslocamento'),
        activity_type: valueAt(row, map, 'Tipo de Atividade', true),
        work_skills: valueAt(row, map, 'Habilidade de Trabalho'),
        work_area: valueAt(row, map, 'Área de Trabalho'),
        assignment_time: valueAt(row, map, 'Tempo de Atribuição da Atividade'),
        reservation_time: valueAt(row, map, 'Tempo de Reserva da Atividade'),
        coordinate_x: valueAt(row, map, 'Coordenada X'),
        coordinate_y: valueAt(row, map, 'Coordenada Y'),
        activity_id: firstValue(row, map, ['ID da Atividade', 'ID Atividade', 'Activity ID', 'AID']),
        source_file: filename,
        bucket,
      });
    }
  });

  return { filename, bucket, orders, timelineActivities, sourceRows: rows.length - 1 };
}

export async function loadToaFiles(files) {
  const results = [];
  const errors = [];
  for (const file of files) {
    try {
      const source = decodeBuffer(await file.arrayBuffer());
      results.push(parseOne(source, file.name));
    } catch (error) {
      errors.push({ filename: file.name, message: error.message });
    }
  }
  if (!results.length) throw new Error(errors.map((item) => item.message).join(' | ') || 'Nenhum CSV TOA válido foi carregado.');
  return {
    files: results.map(({ filename, bucket, sourceRows }) => ({ filename, bucket, sourceRows })),
    orders: results.flatMap((item) => item.orders),
    timelineActivities: results.flatMap((item) => item.timelineActivities),
    errors,
    loadedAt: new Date().toISOString(),
  };
}

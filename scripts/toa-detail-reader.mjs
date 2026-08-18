const clean = (value, limit = 4000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const digits = (value) => String(value ?? '').replace(/\D/g, '');

function identifierText(item, key) {
  return clean(item?._identifier_structure?.[key]?.text);
}

function inventoryItem(raw, fallbackId, aid) {
  const serial = clean(raw?.invsn).replace(/^\*+|\*+$/g, '').toUpperCase();
  const identifier = identifierText(raw, '192');
  const codeMatch = identifier.match(/^(\d{5,})(?:[_\s-]|$)/);
  const code = clean(raw?.['192'] ?? raw?.invcode ?? raw?.code ?? codeMatch?.[1], 120);
  const quantity = clean(raw?.quantity ?? raw?.used_quantity ?? raw?.invqty ?? raw?.qty, 40);
  return {
    inventory_id: clean(raw?.invid ?? fallbackId, 160),
    activity_id: digits(raw?.inv_aid || aid),
    pool: clean(raw?.invpool, 80).toLowerCase(),
    serial,
    code,
    description: identifier || clean(raw?.invname ?? raw?.description ?? code),
    quantity,
    unit: clean(raw?.unit ?? raw?.unidade, 40),
  };
}

/**
 * Converte somente os campos operacionais do sync do Oracle. Nome, endereco,
 * telefone e documento do cliente nao entram no datalake do monitor.
 */
export function normalizeOracleDetail(response, requestedAid) {
  const aid = digits(requestedAid);
  const delta = response?.delta || response?.data?.delta;
  const activity = delta?.Activity?.[aid]
    || Object.values(delta?.Activity || {}).find((item) => digits(item?.aid) === aid);
  if (!delta || !activity) throw new Error('Detalhe TOA nao retornou a atividade solicitada');

  const tasks = [
    { index: 1, os: '193', status: '194', close: '195' },
    { index: 2, os: '196', status: '197', close: '198' },
  ].map((layout) => ({
    task_index: String(layout.index),
    os_number: digits(activity[layout.os]),
    status: clean(activity[layout.status], 120),
    close_code: digits(activity[layout.close]),
    service: identifierText(activity, layout.os) || clean(activity[`tipo_os_${layout.index}`], 240),
  })).filter((task) => task.os_number || task.status || task.close_code);

  const inventory = Object.entries(delta.Inventory || {})
    .filter(([, item]) => digits(item?.inv_aid) === aid)
    .map(([key, item]) => inventoryItem(item, key, aid));
  const equipment = inventory.filter((item) => item.serial);
  const materials = inventory.filter((item) => !item.serial && item.code);
  const observation = [236, 237, 238, 155, 187, 369, 699]
    .map((field) => clean(activity[field]))
    .filter(Boolean).join(' | ');
  const windowStart = clean(activity.service_window_start, 20);
  const windowEnd = clean(activity.service_window_end, 20);

  return {
    activity_id: aid,
    contract: digits(activity.customer_number),
    status: clean(activity.astatus ?? activity.status, 120),
    service_window: windowStart && windowEnd
      ? `${windowStart} - ${windowEnd}` : clean(activity.service_window, 120),
    start_time: clean(activity.activity_start_time ?? activity.start_time, 60),
    end_time: clean(activity.activity_end_time ?? activity.end_time, 60),
    observation,
    orders: tasks,
    installed_equipment: equipment.filter((item) => item.pool === 'install'),
    removed_equipment: equipment.filter((item) => item.pool === 'deinstall'),
    customer_equipment: equipment.filter((item) => item.pool === 'customer'),
    materials,
  };
}

/**
 * O codigo roda no MAIN world da aba TOA. O proprio Oracle fornece trust,
 * versao delta e CSRF da sessao atual; nenhum segredo volta para o Node.
 */
export function detailReplayExpression(route) {
  const safe = {
    aid: digits(route?.activity_id),
    pid: digits(route?.technician_id),
    date: clean(route?.scheduled_date, 10),
  };
  return String.raw`(() => {
    const route = ${JSON.stringify(safe)};
    const read = (key) => {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key) || '';
      try { return JSON.parse(raw); } catch { return raw; }
    };
    const appRoot = globalThis.app;
    const appInstance = globalThis.$app;
    const trust = appRoot?.sessionManager?.()?.getTrustedConnectHash?.();
    if (!route.aid || !route.pid || !route.date || !trust) {
      throw new Error('Sessao TOA ainda nao disponibilizou o protocolo de detalhe');
    }
    let deltaVersion = read('dv') || {};
    try { deltaVersion = appInstance?.deltaProtocol?.()?.getVersion?.()?.exportValue?.() || deltaVersion; } catch {}
    let fakeIds = [];
    try { fakeIds = appInstance?.storageManager?.()?.getFakeIdsManager?.()?.exportAll?.(true) || []; } catch {}
    const fields = {
      __protocol: '7', dv: JSON.stringify(deltaVersion || {}), pid: route.pid,
      u: String(read('ulogin') || ''), f: 'json', pids: '[]', aids: '[]',
      restriction: '0', qid: 'undefined', fakeIds: JSON.stringify(fakeIds || []),
      trust: String(trust), fakeIdsClean: '0', dq: route.date, date: route.date,
      dispatcher: '1', requestedAid: route.aid, requestedDate: route.date, skip_delta: '0',
    };
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    const windowId = sessionStorage.getItem('window_id') || read('window_session_id') || '';
    const url = location.origin + '/?m=sync&a=write&ajax=1&window_id=' + encodeURIComponent(windowId);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true); xhr.withCredentials = true; xhr.timeout = 20000;
      xhr.setRequestHeader('Accept', 'application/json, text/javascript, */*; q=0.01');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('X-OA', '2'); xhr.setRequestHeader('X-PLATFORM', '1');
      xhr.onload = () => resolve({ status: xhr.status, text: String(xhr.responseText || '') });
      xhr.onerror = () => reject(new Error('Falha de rede consultando detalhe TOA'));
      xhr.ontimeout = () => reject(new Error('Timeout consultando detalhe TOA'));
      xhr.send(form);
    });
  })()`;
}

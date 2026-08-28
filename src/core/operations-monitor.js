(function initDominiumMonitor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DominiumMonitor = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function buildApi() {
  "use strict";

  const VIEW_DEFINITIONS = [
    ["teams", "Equipes", "Distribuicao das OS por tecnico"],
    ["monitor", "Monitor de O.S.", "Acompanhamento da lista atual"],
    ["field", "Em campo", "Servicos que ainda estao em execucao"],
    ["pending", "Pendentes", "Servicos que aguardam atendimento ou desfecho"],
    ["completed", "Concluidas", "Servicos encerrados na lista atual"],
    ["disconnects", "Desconexao", "Servicos de desconexao e retirada"],
    ["returns", "Retorno de credenciada", "Retornos e reagendamentos identificados"],
    ["revisits", "Revisitas", "Revisitas calculadas pelo historico do contrato"],
    ["baixa100", "BAIXA 100", "Ordens com codigo de baixa 100"],
    ["reallocations", "Suspensas", "Atividades suspensas e seu destino atual"],
    ["routes", "Console de Rotas", "Linha do dia, situacao e alertas por tecnico"],
    ["capacity", "Capacidade Tecnica", "Carga atual por tecnico"],
  ].map(([key, label, subtitle]) => ({ key, label, subtitle }));

  function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function normalized(value) {
    return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }

  function first(source, keys) {
    for (const key of keys) {
      if (source && text(source[key])) return source[key];
    }
    return "";
  }

  function bucketFromSource(value) {
    const sourceFile = text(value);
    const match = sourceFile.match(
      /^Atividades-(.+?)_\d{2}_\d{2}_(?:\d{2}|\d{4})(?:\s+\(\d+\))?\.csv$/i,
    );
    return match ? match[1].toUpperCase() : "";
  }

  const OPERATION_TIMEZONE_OFFSET = "-03:00";

  function operationDate(year, month, day, hour = 0, minute = 0, second = 0) {
    const parts = [year, month, day, hour, minute, second]
      .map((part) => String(part).padStart(2, "0"));
    return new Date(`${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}:${parts[5]}${OPERATION_TIMEZONE_OFFSET}`);
  }

  function dateParts(value) {
    const iso = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const br = text(value).match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})/);
    if (!br) return null;
    const shortYear = Number(br[3]);
    return [br[3].length === 2 ? 2000 + shortYear : shortYear, Number(br[2]), Number(br[1])];
  }

  function parseDate(value, fallbackDate) {
    const raw = text(value);
    if (!raw) return null;
    const clock = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (clock && fallbackDate) {
      const parts = dateParts(fallbackDate);
      if (parts) return operationDate(...parts, Number(clock[1]), Number(clock[2]), Number(clock[3] || 0));
    }
    const naiveIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
    if (naiveIso) {
      return operationDate(
        Number(naiveIso[1]), Number(naiveIso[2]), Number(naiveIso[3]),
        Number(naiveIso[4] || 0), Number(naiveIso[5] || 0), Number(naiveIso[6] || 0),
      );
    }
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (br) {
      const shortYear = Number(br[3]);
      return operationDate(
        br[3].length === 2 ? 2000 + shortYear : shortYear,
        Number(br[2]), Number(br[1]), Number(br[4] || 0), Number(br[5] || 0),
      );
    }
    const iso = new Date(raw);
    return Number.isNaN(iso.getTime()) ? null : iso;
  }

  function parseWindow(source) {
    for (const key of ["service_window", "time_window", "janela", "start_end"]) {
      const raw = text(source && source[key]);
      const clocks = raw.match(/\b\d{1,2}:\d{2}\b/g) || [];
      if (clocks.length) return { start: clocks[0] || "", end: clocks[1] || "" };
    }
    return { start: "", end: "" };
  }

  function isOracleUnscheduledValue(value) {
    // O OFS usa o ano 3000 como data sentinela para atividades que ainda
    // aparecem na grade/pesquisa, mas nao foram efetivamente agendadas.
    return /^3000-01-01(?:[T\s]|$)/.test(text(value));
  }

  function statusKind(value) {
    const status = normalized(value);
    if (/SUSPENS/.test(status)) return "suspended";
    if (/CONCLUID|FINALIZ|BAIXAD|EXECUTAD|ENCERRAD|COMPLETE|NOTDONE|NOT DONE/.test(status)) return "completed";
    if (/CANCEL/.test(status)) return "canceled";
    if (/EM CAMPO|INICIAD|EM EXECUCAO|EM ROTA|STARTED|ENROUTE|EN ROUTE|WORKING/.test(status)) return "field";
    return "pending";
  }

  function routeState(value) {
    const status = normalized(value);
    if (/SUSPENS/.test(status)) return "suspended";
    if (/CONCLUID|FINALIZ|BAIXAD|EXECUTAD|ENCERRAD|COMPLETE|NOTDONE|NOT DONE/.test(status)) return "completed";
    if (/CANCEL/.test(status)) return "canceled";
    if (/INICIAD|EM CAMPO|EM EXECUCAO|STARTED|WORKING/.test(status)) return "started";
    if (/EM ROTA|ENROUTE|EN ROUTE/.test(status)) return "enroute";
    return "pending";
  }

  function clockMinutes(value) {
    const match = text(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function routeStateLabel(value) {
    return {
      completed: "Concluida",
      started: "Iniciada",
      enroute: "Em rota",
      pending: "Pendente",
      canceled: "Cancelada",
      suspended: "Suspensa",
    }[value] || "Pendente";
  }

  function normalizeOrder(order, selectedDate) {
    const date = text(first(order, ["scheduled_date", "dataagendamento", "date", "data"])) || text(selectedDate);
    const window = parseWindow(order);
    const actualEndRaw = first(order, ["ended_at", "end_time", "termino", "end", "hora_fim"]);
    const actualStartRaw = first(order, ["started_at", "start_time", "inicio", "start", "hora_inicio"]);
    const scheduledFlag = normalized(first(order, ["is_scheduled", "scheduled"]));
    const isUnscheduled = isOracleUnscheduledValue(actualStartRaw)
      || isOracleUnscheduledValue(actualEndRaw)
      || isOracleUnscheduledValue(date)
      || ["FALSE", "0", "NAO", "NO"].includes(scheduledFlag);
    const safeActualEndRaw = isUnscheduled ? "" : actualEndRaw;
    const safeActualStartRaw = isUnscheduled ? "" : actualStartRaw;
    const endRaw = safeActualEndRaw || window.end || first(order, ["sla_end"]);
    const startRaw = safeActualStartRaw || window.start || first(order, ["sla_start"]);
    const activityStatus = first(order, ["activity_status", "status_atividade"]);
    const taskStatus = first(order, ["toa_status", "status", "situacao", "toa_os_status"]);
    // In the TOA export, "Executada" describes the task result while
    // "concluido" is the authoritative lifecycle state of the activity.
    const activityIsClosed = /CONCLUID|FINALIZ|BAIXAD|ENCERRAD|CANCEL|COMPLETE|NOTDONE|NOT DONE/.test(
      normalized(activityStatus),
    );
    const rawOrderStatus = activityIsClosed ? activityStatus : taskStatus || activityStatus;
    const detailState = text(first(order, ["detail_state", "detail_status"])).toLowerCase();
    const statusNeedsValidation = Boolean(detailState && detailState !== "complete")
      && statusKind(rawOrderStatus) === "field";
    // A fotografia Time/get pode ficar alguns instantes atrasada. Uma atividade
    // supostamente em campo so entra na operacao depois que o detalhe oficial
    // confirma o mesmo ciclo de vida; ate la ela fica visivelmente em validacao.
    const orderStatus = statusNeedsValidation ? "VALIDANDO TOA" : rawOrderStatus;
    const isAuxiliary = Boolean(order && order.is_auxiliary);
    const auxiliaryType = text(order && order.auxiliary_type);
    const visualState = isAuxiliary ? "auxiliary" : routeState(orderStatus);
    const sourceFile = text(first(order, ["source_file", "source_filename"]));
    const bucket = text(first(order, ["bucket", "toa_bucket", "resource_parent"]))
      || bucketFromSource(sourceFile);
    return {
      id: text(first(order, ["id_os", "id", "activity_id"])),
      os: text(first(order, ["num_os", "os_number", "numero", "os"])),
      contract: text(first(order, ["contract", "contrato"])),
      service: text(first(order, ["service", "servico", "os_type", "tipo"])),
      status: isAuxiliary ? "PAUSA OPERACIONAL" : text(orderStatus) || "PENDENTE",
      statusKind: isAuxiliary ? "auxiliary" : statusKind(orderStatus),
      routeState: visualState,
      routeStateLabel: isAuxiliary && auxiliaryType === "meal"
        ? "Refeicao" : routeStateLabel(visualState),
      technician: text(first(order, ["technician", "installer", "instalador", "technician_name"])) || "NAO INFORMADO",
      technicianLogin: text(first(order, ["technician_login", "login_tecnico", "login"])),
      team: text(first(order, ["team", "equipe"])) || bucket,
      bucket,
      sourceFile,
      city: text(first(order, ["city", "cidade"])) || "NAO INFORMADA",
      customerName: text(first(order, ["customer_name", "client_name", "nome_cliente"])),
      district: text(first(order, ["district", "bairro"])),
      node: text(first(order, ["node", "node_name"])),
      closeCode: text(first(order, ["close_code", "codigobaixa", "codigo_baixa", "codigo"])),
      observation: text(first(order, ["observation", "observacao", "observacao_tecnico", "activity_notes", "notes", "obs"])),
      isRevisit: [true, 1, "1", "true", "sim", "yes"].includes(
        typeof first(order, ["is_revisita", "is_revisit", "revisita"]) === "string"
          ? normalized(first(order, ["is_revisita", "is_revisit", "revisita"])).toLowerCase()
          : first(order, ["is_revisita", "is_revisit", "revisita"]),
      ),
      revisitOffender: text(first(order, ["ofensor_revisita", "revisit_offender"])),
      example: Boolean(order && order.__example),
      date,
      windowStartRaw: text(window.start),
      windowEndRaw: text(window.end),
      windowStartAt: isUnscheduled ? null : parseDate(window.start, date),
      windowEndAt: isUnscheduled ? null : parseDate(window.end, date),
      actualStartRaw: text(safeActualStartRaw),
      actualEndRaw: text(safeActualEndRaw),
      routeStartRaw: text(first(order, ["route_start", "planned_start", "route_schedule_start"])),
      routeEndRaw: text(first(order, ["route_end", "planned_end", "route_schedule_end"])),
      routeStartAt: parseDate(first(order, ["route_start", "planned_start", "route_schedule_start"]), date),
      routeEndAt: parseDate(first(order, ["route_end", "planned_end", "route_schedule_end"]), date),
      actualStartAt: parseDate(safeActualStartRaw, date),
      actualEndAt: parseDate(safeActualEndRaw, date),
      startRaw: text(startRaw),
      endRaw: text(endRaw),
      startAt: parseDate(startRaw, date),
      endAt: parseDate(endRaw, date),
      duration: text(first(order, ["duration", "duracao"])),
      travelTime: text(first(order, ["travel_time", "tempo_deslocamento", "deslocamento"])),
      workArea: text(first(order, ["work_area", "area_trabalho", "area"])),
      coordinateX: text(first(order, ["coordinate_x", "longitude", "lng"])),
      coordinateY: text(first(order, ["coordinate_y", "latitude", "lat"])),
      activityId: text(first(order, ["activity_id", "aid", "id_atividade"])),
      detailState,
      statusValidating: statusNeedsValidation,
      isScheduled: !isUnscheduled,
      // Fontes antigas/CSV nao possuem detail_state e continuam validas. No
      // datalake ao vivo, apenas 'complete' confirma que a janela veio do
      // detalhe oficial da atividade e nao de uma estimativa anterior.
      windowVerified: !isUnscheduled && (!detailState || detailState === "complete"),
      isAuxiliary,
      auxiliaryType,
      source: order,
    };
  }

  function assignmentScore(order) {
    const statusScore = {
      field: 50,
      pending: 40,
      completed: 30,
      canceled: 20,
      suspended: 0,
    }[order.statusKind] ?? 10;
    const startScore = clockMinutes(order.actualStartRaw) ?? 0;
    const activityScore = /^\d+$/.test(order.activityId)
      ? Number(order.activityId.slice(-7)) / 10000000 : 0;
    return statusScore * 10000 + startScore + activityScore;
  }

  function selectEffectiveOrders(attempts) {
    const selected = new Map();
    attempts.forEach((order) => {
      const key = order.os || order.id || order.activityId;
      const current = selected.get(key);
      if (!current || assignmentScore(order) > assignmentScore(current)) {
        selected.set(key, order);
      }
    });
    return selected;
  }

  function tec1Deadline(order) {
    // TEC1 is measured only against the official service-window limit. Route
    // agenda/estimated end is useful for the timeline, but is not a TEC1 SLA.
    return order.isScheduled && order.windowVerified ? order.windowEndAt : null;
  }

  function tec1State(order, now) {
    if (["completed", "canceled", "suspended"].includes(order.statusKind)) {
      return { key: "done", label: "Encerrada", minutes: null };
    }
    const deadline = tec1Deadline(order);
    if (!deadline) return { key: "unknown", label: "Sem agenda", minutes: null };
    const minutes = Math.round((deadline.getTime() - now.getTime()) / 60000);
    if (minutes < 0) return { key: "late", label: `Estourada ${Math.abs(minutes)} min`, minutes };
    if (minutes <= 60) return { key: "risk", label: `${minutes} min restantes`, minutes };
    return { key: "safe", label: "No prazo", minutes };
  }

  function buildTec1ContractAlerts(rows) {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const contract = text(row?.contract);
      if (!contract || contract === "-") return;
      if (!groups.has(contract)) groups.set(contract, []);
      groups.get(contract).push(row);
    });

    return [...groups.entries()].map(([contract, tasks]) => {
      const ordered = tasks.filter((row) => {
        const minutes = Number(row?.tec1_minutes);
        return Number.isFinite(minutes) && minutes > 0 && minutes <= 30
          && !["completed", "canceled", "suspended"].includes(text(row?.status_kind).toLowerCase());
      }).sort((a, b) => (
        Number(a.tec1_minutes) - Number(b.tec1_minutes)
        || String(a.tec1_deadline || "").localeCompare(String(b.tec1_deadline || ""))
      ));
      if (!ordered.length) return null;
      const focus = ordered[0];
      const minutes = Number(focus.tec1_minutes);
      const threshold = minutes <= 15 ? 15 : 30;
      const technicians = [...new Set(tasks
        .filter((row) => !["completed", "canceled", "suspended"].includes(text(row?.status_kind).toLowerCase()))
        .map((row) => text(row.technician))
        .filter((value) => value && value !== "-"))];
      const activeTasks = tasks.filter(
        (row) => !["completed", "canceled", "suspended"].includes(text(row?.status_kind).toLowerCase()),
      );
      const taskIds = new Set(activeTasks.map((row) => text(row.os)).filter(Boolean));
      const deadline = text(focus.tec1_deadline);
      return {
        key: `${contract}:${deadline || text(focus.window_end)}:${threshold}`,
        kind: "risk",
        contract,
        threshold,
        minutes,
        deadline,
        technician: technicians.join(" e ") || "Nao informado",
        technicians,
        task_count: taskIds.size || activeTasks.length,
        window_start: text(focus.window_start) || "-",
        window_end: text(focus.window_end) || "-",
      };
    }).filter(Boolean).sort((a, b) => a.minutes - b.minutes || a.contract.localeCompare(b.contract));
  }

  function buildUrgentCloseAlerts(rows, value = new Date()) {
    const now = value instanceof Date ? value : new Date(value || Date.now());
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const contract = text(row?.contract);
      const deadline = new Date(row?.tec1_deadline || "");
      if (!contract || contract === "-" || Number.isNaN(deadline.getTime())) return;
      if (["completed", "canceled", "suspended"].includes(text(row?.status_kind).toLowerCase())) return;
      const lateMinutes = Math.floor((now.getTime() - deadline.getTime()) / 60000);
      if (lateMinutes < 45) return;
      const current = groups.get(contract);
      if (!current || lateMinutes > current.lateMinutes) groups.set(contract, { row, lateMinutes });
    });
    return [...groups.entries()].map(([contract, entry]) => {
      const { row, lateMinutes } = entry;
      const phase = lateMinutes >= 60 ? "urgent-60" : "urgent-45";
      return {
        key: `urgent:${contract}:${text(row.tec1_deadline)}:${phase}`,
        kind: "urgent-late",
        phase,
        contract,
        os: text(row.os) || "-",
        date: text(row.date) || "-",
        technician: text(row.technician) || "Nao informado",
        technician_login: text(row.technician_login) || "-",
        bucket: text(row.bucket) || "-",
        status: text(row.status) || "-",
        window_start: text(row.window_start) || "-",
        window_end: text(row.window_end) || "-",
        actual_start: text(row.actual_start) || "-",
        actual_end: text(row.actual_end) || "-",
        deadline: text(row.tec1_deadline),
        late_minutes: lateMinutes,
        label: lateMinutes >= 60
          ? `Janela vencida ha ${lateMinutes} min`
          : `Baixa urgente: ${60 - lateMinutes} min para completar 1 hora`,
        message: speechPronunciationText(
          `Alerta urgente. Baixe imediatamente o contrato ${spokenDigits(contract)}. `
          + `Tecnico ${text(row.technician) || "nao informado"}. Janela vencida ha ${lateMinutes} minutos.`,
        ),
      };
    }).sort((a, b) => b.late_minutes - a.late_minutes || a.contract.localeCompare(b.contract));
  }

  function speechPronunciationText(value) {
    return String(value || "")
      .replace(/\bTEC\s*(?:1|um)\b/gi, "téqui um")
      .replace(/\bATENCAO\b/gi, "atenção")
      .replace(/\bTECNICO\b/gi, "técnico")
      .replace(/\bMUDANCA\b/gi, "mudança")
      .replace(/\bINSTALACAO\b/gi, "instalação")
      .replace(/\bDESCONEXAO\b/gi, "desconexão")
      .replace(/\bNAO\b/gi, "não")
      .replace(/\bO\.?S\.?\b/gi, "O.S.")
      .replace(/\bGPON\b/gi, "G-pon")
      .replace(/\bHFC\b/gi, "H-F-C")
      .replace(/\bTOA\b/gi, "Tôa");
  }

  function spokenDigits(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits ? digits.split("").join(" ") : "não informado";
  }

  function spokenClock(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return "horário não informado";
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return minute ? `${hour} e ${minute}` : `${hour} horas`;
  }

  function buildTec1VoiceMessage(alert) {
    const taskDetail = Number(alert?.task_count || 0) > 1
      ? ` Este contrato possui ${alert.task_count} tarefas.` : "";
    const windowDetail = alert?.window_start !== "-" && alert?.window_end !== "-"
      ? ` Janela das ${spokenClock(alert.window_start)} às ${spokenClock(alert.window_end)}.`
      : " Janela não informada.";
    return speechPronunciationText(
      `Atenção. Faltam ${alert?.threshold} minutos para o téqui um do contrato ${spokenDigits(alert?.contract)}. `
      + `Técnico ${alert?.technician || "não informado"}.${windowDetail}${taskDetail}`,
    );
  }

  function buildTvVoiceMessage(rows, value = new Date()) {
    const now = value instanceof Date ? value : new Date(value || Date.now());
    return (Array.isArray(rows) ? rows : []).slice(0, 2).map((row, index) => {
      const deadline = new Date(row?.tec1_deadline || "");
      const diff = deadline.getTime() - now.getTime();
      const absoluteMinutes = Number.isFinite(diff)
        ? Math.max(1, diff < 0 ? Math.floor(Math.abs(diff) / 60000) : Math.ceil(diff / 60000)) : null;
      const timing = absoluteMinutes === null
        ? "tempo não informado"
        : diff < 0
          ? `atrasada ${absoluteMinutes} minuto${absoluteMinutes === 1 ? "" : "s"}`
          : `faltam ${absoluteMinutes} minuto${absoluteMinutes === 1 ? "" : "s"}`;
      const contractNumber = row?.contract && row.contract !== "-" ? row.contract : row?.os;
      if (diff < 0 && absoluteMinutes >= 45 && row?.deadline_basis === "official_window") {
        return `Prioridade ${index + 1}. Alerta urgente. Baixe imediatamente o contrato ${spokenDigits(contractNumber)}. `
          + `Técnico ${row?.technician || "não informado"}. `
          + `Janela vencida há ${absoluteMinutes} minuto${absoluteMinutes === 1 ? "" : "s"}.`;
      }
      return `Prioridade ${index + 1}. Técnico ${row?.technician || "não informado"}. `
        + `Contrato ${spokenDigits(contractNumber)}. ${timing}.`;
    }).join(" ");
  }

  function orderRow(order, now) {
    const tec1 = tec1State(order, now);
    const deadline = tec1Deadline(order);
    return {
      os: order.os || "-",
      contract: order.contract || "-",
      date: order.date || "-",
      service: order.service || "-",
      city: order.city,
      technician: order.technician,
      technician_login: order.technicianLogin || "-",
      bucket: order.bucket || "-",
      // O Time/get usa estados internos em ingles (started, pending, complete).
      // A tela operacional deve sempre exibir a traducao humana ja normalizada.
      status: (order.statusValidating ? "VALIDANDO TOA" : order.routeStateLabel || order.status || "-").toUpperCase(),
      status_kind: order.statusKind,
      route_state: order.routeState,
      route_state_label: order.routeStateLabel,
      schedule: !order.isScheduled
        ? "Nao agendada"
        : order.startRaw || order.endRaw
        ? `${order.startRaw || "-"} - ${order.endRaw || "-"}`
        : order.routeStartRaw || order.routeEndRaw
          ? `${order.routeStartRaw || "-"} - ${order.routeEndRaw || "-"}`
          : "Sem agenda",
      tec1: tec1.label,
      tec1_kind: tec1.key,
      tec1_minutes: tec1.minutes,
      tec1_deadline: deadline ? deadline.toISOString() : "",
      deadline_basis: deadline ? "official_window"
        : !order.isScheduled ? "unscheduled"
          : order.windowVerified ? "none" : "validating_toa",
      route_start: order.routeStartRaw || "-",
      route_end: order.routeEndRaw || "-",
      route_deadline: order.routeEndAt ? order.routeEndAt.toISOString() : "",
      close_code: order.closeCode || "-",
      observation: order.observation || "-",
      revisit: order.isRevisit ? "SIM" : "NAO",
      revisit_offender: order.revisitOffender || order.technician || "-",
      route: order.node || [order.city, order.district].filter(Boolean).join(" / ") || "-",
      window_start: order.windowStartRaw || "-",
      window_end: order.windowEndRaw || "-",
      actual_start: order.actualStartRaw || "-",
      actual_end: order.actualEndRaw || "-",
      duration: order.duration || "-",
      travel_time: order.travelTime || "-",
      work_area: order.workArea || "-",
      coordinate_x: order.coordinateX || "-",
      coordinate_y: order.coordinateY || "-",
      activity_id: order.activityId || "-",
      example: order.example,
    };
  }

  function routeAlert(order, now) {
    if (order.isAuxiliary || !order.isScheduled || !order.windowVerified || !order.windowEndAt
      || ["completed", "canceled", "suspended"].includes(order.routeState)) return null;
    if (order.routeState === "started" && order.actualStartAt && order.actualStartAt > order.windowEndAt) {
      return {
        key: "started-late",
        severity: "late",
        label: "Iniciada fora da janela",
        detail: `Inicio ${order.actualStartRaw}; limite ${order.windowEndRaw}`,
      };
    }
    const minutes = Math.round((order.windowEndAt.getTime() - now.getTime()) / 60000);
    if (minutes < 0) {
      return {
        key: "window-lost",
        severity: "late",
        label: "Janela de servico pode ter sido perdida",
        detail: `Limite ${order.windowEndRaw}; atraso estimado ${Math.abs(minutes)} min`,
      };
    }
    if ((order.routeState === "pending" || order.routeState === "enroute") && minutes <= 30) {
      return {
        key: "window-risk",
        severity: "risk",
        label: "Janela de servico em risco",
        detail: `${minutes} min ate o limite ${order.windowEndRaw}`,
      };
    }
    return null;
  }

  function buildRouteConsole(orders, now) {
    const startHour = 6;
    const endHour = 22;
    const groups = new Map();
    const alerts = [];
    const activityGroups = new Map();
    orders.forEach((order) => {
      const key = order.activityId
        ? `${order.technician}:${order.activityId}`
        : `os:${order.id || order.os}`;
      const item = activityGroups.get(key) || {
        order,
        osNumbers: [],
        contracts: [],
        closeCodes: [],
        services: [],
      };
      if (order.os && !item.osNumbers.includes(order.os)) item.osNumbers.push(order.os);
      if (order.contract && !item.contracts.includes(order.contract)) item.contracts.push(order.contract);
      if (order.closeCode && !item.closeCodes.includes(order.closeCode)) item.closeCodes.push(order.closeCode);
      if (order.service && !item.services.includes(order.service)) item.services.push(order.service);
      activityGroups.set(key, item);
    });
    activityGroups.forEach((activityGroup) => {
      const { order } = activityGroup;
      const technician = order.technician || "NAO INFORMADO";
      const technicianKey = order.technicianLogin && order.technicianLogin !== "-"
        ? order.technicianLogin : technician;
      const group = groups.get(technicianKey) || {
        technician,
        technician_login: order.technicianLogin || "-",
        bucket: order.bucket || "-",
        total: 0,
        completed: 0,
        started: 0,
        pending: 0,
        activities: [],
      };
      const alert = routeAlert(order, now);
      const timelineStart = order.actualStartRaw || order.windowStartRaw || order.routeStartRaw || order.startRaw;
      const timelineEnd = order.actualEndRaw || order.windowEndRaw || order.routeEndRaw || order.endRaw;
      const startMinutes = clockMinutes(timelineStart);
      let endMinutes = clockMinutes(timelineEnd);
      if (startMinutes !== null && (endMinutes === null || endMinutes <= startMinutes)) {
        endMinutes = startMinutes + 45;
      }
      const activity = {
        id: order.id || order.activityId || order.os,
        activity_id: order.activityId || "-",
        os: activityGroup.osNumbers.join(" / ") || "-",
        os_count: activityGroup.osNumbers.length,
        contract: activityGroup.contracts.join(" / ") || "-",
        date: order.date || "-",
        service: activityGroup.services.join(" + ") || text(order.source.activity_type) || "Atividade",
        city: order.city,
        district: order.district || "-",
        node: order.node || "-",
        technician,
        technician_login: order.technicianLogin || "-",
        bucket: order.bucket || "-",
        status: order.status,
        status_kind: order.statusKind,
        route_state: order.routeState,
        route_state_label: order.routeStateLabel,
        window_start: order.windowStartRaw || "-",
        window_end: order.windowEndRaw || "-",
        actual_start: order.actualStartRaw || "-",
        actual_end: order.actualEndRaw || "-",
        duration: order.duration || "-",
        travel_time: order.travelTime || "-",
        work_area: order.workArea || "-",
        coordinate_x: order.coordinateX || "-",
        coordinate_y: order.coordinateY || "-",
        close_code: activityGroup.closeCodes.join(" / ") || "-",
        timeline_start: timelineStart || "",
        timeline_end: timelineEnd || "",
        start_minutes: startMinutes,
        end_minutes: endMinutes,
        alert,
        is_auxiliary: order.isAuxiliary,
        auxiliary_type: order.auxiliaryType,
        reallocated_to: order.reallocatedTo || "",
        reallocated_to_login: order.reallocatedLogin || "",
        current_status: order.reallocatedStatus || "",
        example: order.example,
      };
      group.total += 1;
      if (order.isAuxiliary) group.auxiliary = (group.auxiliary || 0) + 1;
      else if (order.routeState === "suspended") group.suspended = (group.suspended || 0) + 1;
      else if (order.routeState === "completed") group.completed += 1;
      else if (order.routeState === "started") group.started += 1;
      else group.pending += 1;
      group.activities.push(activity);
      groups.set(technicianKey, group);
      if (alert) alerts.push({
        ...alert,
        os: activity.os,
        contract: activity.contract,
        date: activity.date,
        technician,
        technician_login: activity.technician_login,
        service: activity.service,
        bucket: activity.bucket,
        status: (activity.route_state_label || activity.status || "-").toUpperCase(),
        activity_id: activity.activity_id,
        window_start: activity.window_start,
        window_end: activity.window_end,
        actual_start: activity.actual_start,
        actual_end: activity.actual_end,
        route_state: activity.route_state,
      });
    });
    const technicians = [...groups.values()]
      .map((group) => ({
        ...group,
        activities: group.activities.sort((a, b) => (
          (a.start_minutes ?? Number.MAX_SAFE_INTEGER) - (b.start_minutes ?? Number.MAX_SAFE_INTEGER)
          || a.os.localeCompare(b.os)
        )),
      }))
      .sort((a, b) => (
        b.started - a.started || b.pending - a.pending || a.technician.localeCompare(b.technician)
      ));
    return {
      startHour,
      endHour,
      technicians,
      alerts: alerts.sort((a, b) => (a.severity === "late" ? -1 : 1) - (b.severity === "late" ? -1 : 1)),
      totalActivities: activityGroups.size,
      totalOrders: selectEffectiveOrders(orders.filter((order) => !order.isAuxiliary)).size,
      auxiliaryActivities: orders.filter((order) => order.isAuxiliary).length,
      suspendedActivities: orders.filter((order) => order.statusKind === "suspended").length,
    };
  }

  function localDate(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function clockAt(value, minutes) {
    const date = new Date(value.getTime() + minutes * 60000);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function buildMeetingExamples(value = new Date()) {
    const now = value instanceof Date ? new Date(value) : new Date(value || Date.now());
    const date = localDate(now);
    const cityBuckets = { NATAL: "NTL-DMV", PARNAMIRIM: "PWM-DMV", MOSSORO: "MRO-DMV", FORTALEZA: "FTZ-DMV_01", RECIFE: "JCR-DMV" };
    const technicianLogins = {
      "RAFAEL NUNES": "Z900101", "ANA BEATRIZ": "Z900102", "CARLOS EDUARDO": "Z900103",
      "JULIANA LIMA": "Z900104", "PEDRO LIMA": "Z900105", "MARCOS VINICIUS": "Z900106",
    };
    const example = (item) => ({
      __example: true,
      date,
      bucket: item.bucket || cityBuckets[item.city] || "DEMO-DMV",
      technician_login: item.technician_login || technicianLogins[item.technician] || "ZDEMO",
      ...item,
    });
    return [
      example({ num_os: "990070001", contract: "8807001", service: "INSTALACAO", city: "NATAL", district: "PAJUCARA", node: "NTL-ZN", technician: "RAFAEL NUNES", status: "EM CAMPO", inicio: clockAt(now, -75), termino: clockAt(now, 45), observacao: "Tecnico em atendimento; aguardando validacao do sinal." }),
      example({ num_os: "990070002", contract: "8807002", service: "RETORNO CREDENCIADA", city: "PARNAMIRIM", district: "NOVA PARNAMIRIM", node: "PAR-SUL", technician: "ANA BEATRIZ", status: "CONCLUIDA", inicio: clockAt(now, -180), termino: clockAt(now, -60), close_code: "409", is_revisita: true, ofensor_revisita: "ANA BEATRIZ", observacao: "Retorno concluido apos atendimento anterior no contrato." }),
      example({ num_os: "990070003", contract: "8807003", service: "VISITA TECNICA", city: "NATAL", district: "ALECRIM", node: "NTL-LESTE", technician: "CARLOS EDUARDO", status: "PENDENTE", inicio: clockAt(now, -145), termino: clockAt(now, -25), service_window: `${clockAt(now, -85)} - ${clockAt(now, -25)}`, observacao: "Aguardando disponibilidade do cliente." }),
      example({ num_os: "990070004", contract: "8807004", service: "RETIRAR EMTA", city: "MOSSORO", district: "CENTRO", node: "MOS-CENTRO", technician: "JULIANA LIMA", status: "CONCLUIDA", inicio: clockAt(now, -240), termino: clockAt(now, -120), close_code: "100", observacao: "Equipamento retirado e serial conferido." }),
      example({ num_os: "990070005", contract: "8807005", service: "DESCONEXAO IC / RETIRADA DE EQUIPAMENTO", city: "FORTALEZA", district: "MONTESE", node: "FOR-OESTE", technician: "PEDRO LIMA", status: "SUSPENSA", inicio: clockAt(now, -95), termino: clockAt(now, -70), observacao: "Alocacao anterior suspensa antes da realocacao." }),
      example({ num_os: "990070005", contract: "8807005", service: "DESCONEXAO IC / RETIRADA DE EQUIPAMENTO", city: "FORTALEZA", district: "MONTESE", node: "FOR-OESTE", technician: "RAFAEL NUNES", status: "EM CAMPO", inicio: clockAt(now, -30), termino: clockAt(now, 90), observacao: "Contrato recebido; tecnico ainda nao informou codigo de baixa." }),
      example({ num_os: "990070006", contract: "8807006", service: "RETIRAR EQUIPAMENTO", city: "RECIFE", district: "BOA VIAGEM", node: "REC-SUL", technician: "MARCOS VINICIUS", status: "EM ROTA", inicio: clockAt(now, 15), termino: clockAt(now, 135), observacao: "Serial recebido no grupo e em validacao." }),
      example({ num_os: "990070007", contract: "8807007", service: "VT CUMP ESPECIAL", city: "NATAL", district: "POTENGI", node: "NTL-ZN", technician: "RAFAEL NUNES", status: "PENDENTE", inicio: clockAt(now, 120), termino: clockAt(now, 240), observacao: "Visita programada para a proxima janela." }),
      example({ num_os: "990070008", contract: "8807008", service: "INSTALACAO", city: "NATAL", district: "LAGOA NOVA", node: "NTL-SUL", technician: "RAFAEL NUNES", status: "CANCELADA", inicio: clockAt(now, 180), termino: clockAt(now, 300), close_code: "0", observacao: "Atividade cancelada conforme retorno operacional." }),
    ];
  }

  function groupRows(orders, key, emptyLabel) {
    const groups = new Map();
    orders.forEach((order) => {
      const label = text(order[key]) || emptyLabel;
      const item = groups.get(label) || {
        label, total: 0, field: 0, completed: 0, pending: 0, buckets: new Set(),
      };
      item.total += 1;
      item[order.statusKind] = (item[order.statusKind] || 0) + 1;
      if (order.bucket) item.buckets.add(order.bucket);
      groups.set(label, item);
    });
    return [...groups.values()].map((item) => {
      const { buckets, ...summary } = item;
      return { ...summary, bucket: [...buckets].sort().join(" / ") || "-" };
    }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }

  function view(key, title, subtitle, columns, rows, note) {
    return { key, title, subtitle, columns, rows, available: rows.length > 0, note: rows.length ? "" : note };
  }

  function buildMonitorModel(inputOrders, options = {}) {
    const now = options.now instanceof Date ? new Date(options.now) : new Date(options.now || Date.now());
    const attempts = (Array.isArray(inputOrders) ? inputOrders : []).map((item) => normalizeOrder(item, options.selectedDate));
    const effectiveByOs = selectEffectiveOrders(attempts);
    const orders = [...effectiveByOs.values()];
    attempts.forEach((order) => {
      if (order.statusKind !== "suspended") return;
      const effective = effectiveByOs.get(order.os || order.id || order.activityId);
      if (!effective || effective === order) {
        order.reallocatedTo = "Aguardando nova alocacao";
      } else if (effective.technician !== order.technician) {
        order.reallocatedTo = effective.technician;
        order.reallocatedLogin = effective.technicianLogin;
      } else {
        order.reallocatedTo = "Nova tentativa do mesmo tecnico";
      }
      order.reallocatedStatus = effective?.status || "";
    });
    const timelineActivities = (Array.isArray(options.timelineActivities) ? options.timelineActivities : [])
      .map((item) => normalizeOrder(item, options.selectedDate));
    const rows = orders.map((order) => orderRow(order, now));
    const operationalColumns = [
      { key: "os", label: "OS" }, { key: "contract", label: "Contrato" },
      { key: "service", label: "Servico" }, { key: "city", label: "Cidade" },
      { key: "bucket", label: "Bucket" },
      { key: "technician", label: "Tecnico" }, { key: "status", label: "Status" },
      { key: "observation", label: "Observacao do tecnico" },
    ];
    const serviceMatches = (pattern) => orders.filter((order) => pattern.test(normalized(order.service))).map((order) => orderRow(order, now));
    const isDemo = orders.length > 0 && orders.every((order) => order.example);
    const teamRows = groupRows(orders, "technician", "NAO INFORMADO").map((item) => ({
      team: item.label, bucket: item.bucket, total: item.total,
      field: item.field, completed: item.completed, pending: item.pending,
      example: isDemo,
    }));
    const routeRows = new Map();
    orders.forEach((order) => {
      const route = order.node || [order.city, order.district].filter(Boolean).join(" / ") || "NAO INFORMADA";
      const item = routeRows.get(route) || {
        route, total: 0, field: 0, technicians: new Set(), buckets: new Set(),
      };
      item.total += 1;
      if (order.statusKind === "field") item.field += 1;
      if (order.technician !== "NAO INFORMADO") item.technicians.add(order.technician);
      if (order.bucket) item.buckets.add(order.bucket);
      routeRows.set(route, item);
    });
    const routeViewRows = [...routeRows.values()].map((item) => {
      const { buckets, technicians, ...summary } = item;
      return {
        ...summary,
        bucket: [...buckets].sort().join(" / ") || "-",
        technicians: technicians.size,
        example: isDemo,
      };
    })
      .sort((a, b) => b.total - a.total || a.route.localeCompare(b.route));
    const capacityRows = teamRows.map((item) => ({
      technician: item.team, bucket: item.bucket,
      active: item.field + item.pending, total: item.total,
      status: item.field + item.pending >= 8 ? "Carga alta" : item.field + item.pending >= 4 ? "Atencao" : "Disponivel",
      status_kind: item.field + item.pending >= 8 ? "late" : item.field + item.pending >= 4 ? "risk" : "safe",
      example: isDemo,
    }));
    const views = {
      teams: view("teams", "Equipes", "Distribuicao das OS por tecnico", [
        { key: "team", label: "Tecnico / equipe" }, { key: "bucket", label: "Bucket" },
        { key: "total", label: "Total" },
        { key: "field", label: "Em campo" }, { key: "completed", label: "Concluidas" },
        { key: "pending", label: "Pendentes" },
      ], teamRows, "Nenhum tecnico foi informado na lista atual."),
      monitor: view("monitor", "Monitor de O.S.", "Acompanhamento da lista atual", operationalColumns, rows, "Nenhuma OS na consulta atual."),
      field: view("field", "Em campo", "Servicos que ainda estao em execucao", operationalColumns, rows.filter((row) => row.status_kind === "field"), "Nenhuma OS em campo na lista atual."),
      pending: view("pending", "Pendentes", "Servicos que aguardam atendimento ou desfecho", operationalColumns, rows.filter((row) => row.status_kind === "pending"), "Nenhuma OS pendente na lista atual."),
      completed: view("completed", "Concluidas", "Servicos encerrados na lista atual", operationalColumns.concat([{ key: "close_code", label: "Codigo de baixa" }]), rows.filter((row) => row.status_kind === "completed"), "Nenhuma OS concluida na lista atual."),
      disconnects: view("disconnects", "Desconexao", "Servicos de desconexao e retirada", operationalColumns, serviceMatches(/DESCONEX|RETIRAD/), "Nenhuma desconexao ou retirada identificada na lista atual."),
      returns: view("returns", "Retorno de credenciada", "Retornos e reagendamentos identificados", operationalColumns, serviceMatches(/RETORNO|REAGEND/), "Nenhum retorno identificado na lista atual."),
      revisits: view("revisits", "Revisitas", "Revisitas calculadas pelo historico do contrato", operationalColumns.concat([{ key: "revisit_offender", label: "Ofensor" }]), rows.filter((row) => row.revisit === "SIM"), "Nenhuma revisita calculada na lista atual."),
      baixa100: view("baixa100", "BAIXA 100", "Ordens com codigo de baixa 100", operationalColumns.concat([{ key: "close_code", label: "Codigo" }]), rows.filter((row) => row.close_code === "100"), "Nenhuma OS com codigo 100 na lista atual."),
      routes: view("routes", "Gestao de Rotas", "Distribuicao por cidade, bairro e node", [
        { key: "route", label: "Rota" }, { key: "bucket", label: "Bucket" },
        { key: "total", label: "Total" },
        { key: "field", label: "Em campo" }, { key: "technicians", label: "Tecnicos" },
      ], routeViewRows, "A fonte atual nao trouxe localizacao de rota."),
      capacity: view("capacity", "Capacidade Tecnica", "Carga atual por tecnico", [
        { key: "technician", label: "Tecnico" }, { key: "bucket", label: "Bucket" },
        { key: "active", label: "Carga ativa" },
        { key: "total", label: "Total" }, { key: "status", label: "Leitura" },
      ], capacityRows, "A fonte atual nao trouxe tecnicos para estimar a carga."),
    };
    const suspendedRows = attempts
      .filter((order) => order.statusKind === "suspended")
      .map((order) => ({
        ...orderRow(order, now),
        reallocated_to: [order.reallocatedTo || "Aguardando nova alocacao", order.reallocatedLogin]
          .filter(Boolean).join(" / "),
        current_status: order.reallocatedStatus || "-",
      }));
    views.reallocations = view(
      "reallocations",
      "Suspensas e realocacoes",
      "Historico de atividades suspensas e destino atual da OS",
      operationalColumns.concat([
        { key: "reallocated_to", label: "Destino atual" },
        { key: "current_status", label: "Status atual" },
      ]),
      suspendedRows,
      "Nenhuma atividade suspensa ou realocada no CSV atual.",
    );
    views.routes.console = buildRouteConsole([...attempts, ...timelineActivities], now);
    views.routes.title = "Console de Rotas";
    views.routes.subtitle = "Linha do dia por tecnico, situacao atual e alertas de janela";
    const count = (kind) => orders.filter((order) => order.statusKind === kind).length;
    const bucketCounts = new Map();
    orders.forEach((order) => {
      if (!order.bucket) return;
      bucketCounts.set(order.bucket, (bucketCounts.get(order.bucket) || 0) + 1);
    });
    return {
      generatedAt: now.toISOString(),
      definitions: VIEW_DEFINITIONS.map((item) => ({ ...item })),
      views,
      buckets: [...bucketCounts.entries()]
        .map(([name, countValue]) => ({ name, count: countValue }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      kpis: {
        total: orders.length,
        field: count("field"),
        completed: count("completed"),
        pending: count("pending"),
        canceled: count("canceled"),
        revisits: rows.filter((row) => row.revisit === "SIM").length,
        closedWithCode: rows.filter((row) => row.close_code !== "-").length,
        routeAlerts: views.routes.console.alerts.length,
      },
      isDemo,
    };
  }

  function buildTvDashboard(model) {
    const rows = model?.views?.monitor?.rows || [];
    const activeRows = rows.filter(
      (row) => !["completed", "canceled", "suspended"].includes(row.status_kind),
    );
    const tec1Rank = { late: 0, risk: 1, safe: 2, unknown: 3, done: 4 };
    const tec1Rows = activeRows.filter((row) => Boolean(row.tec1_deadline)).sort((a, b) => (
      (tec1Rank[a.tec1_kind] ?? 9) - (tec1Rank[b.tec1_kind] ?? 9)
      || (a.tec1_minutes ?? Number.MAX_SAFE_INTEGER) - (b.tec1_minutes ?? Number.MAX_SAFE_INTEGER)
      || String(a.os).localeCompare(String(b.os))
    ));
    const urgentTec1 = tec1Rows.filter((row) => ["late", "risk"].includes(row.tec1_kind));
    // Enquanto os detalhes da OS nao trouxerem a janela oficial, a TV nao
    // deve ficar vazia. Usamos somente atividades realmente iniciadas/em rota
    // com agenda valida, identificando claramente que a base e operacional.
    const routePriorities = activeRows
      .filter((row) => ["started", "enroute"].includes(row.route_state)
        && Boolean(row.route_deadline) && row.deadline_basis !== "validating_toa")
      .map((row) => {
        const deadline = new Date(row.route_deadline);
        const minutes = Math.round((deadline.getTime() - new Date(model?.generatedAt || Date.now()).getTime()) / 60000);
        const kind = minutes < 0 ? "late" : minutes <= 60 ? "risk" : "safe";
        return {
          ...row,
          tec1_deadline: row.route_deadline,
          tec1_minutes: minutes,
          tec1_kind: kind,
          tec1: minutes < 0
            ? `Agenda estourada ${Math.abs(minutes)} min`
            : `${minutes} min na agenda`,
          deadline_basis: "route_estimate",
          window_start: "-",
          window_end: "-",
        };
      })
      .sort((a, b) => (
        (a.tec1_minutes ?? Number.MAX_SAFE_INTEGER) - (b.tec1_minutes ?? Number.MAX_SAFE_INTEGER)
        || String(a.os).localeCompare(String(b.os))
      ));
    const routeConsole = model?.views?.routes?.console || { technicians: [], alerts: [] };
    const activeTechnicians = (routeConsole.technicians || []).map((technician) => {
      const current = (technician.activities || [])
        .filter((activity) => ["started", "enroute"].includes(activity.route_state))
        .sort((a, b) => (
          (b.start_minutes ?? -1) - (a.start_minutes ?? -1)
          || String(b.os).localeCompare(String(a.os))
        ))[0];
      return current ? {
        technician: technician.technician,
        technician_login: technician.technician_login,
        bucket: technician.bucket,
        os: current.os,
        service: current.service,
        state: current.route_state,
        state_label: current.route_state_label,
        window_end: current.window_end,
      } : null;
    }).filter(Boolean);
    const missingApi = [
      { key: "next-technician", label: "Próximo técnico", value: "Sem informação", need: "Posição e rota em tempo real" },
      { key: "live-status", label: "Status instantâneo", value: "Sem informação", need: "Eventos de atividade do TOA" },
      { key: "official-tec1", label: "TEC1 oficial", value: "Estimativa local", need: "Regra e eventos oficiais" },
      { key: "inventory", label: "Materiais da OS", value: "Sem informação", need: "Inventários instalados e retirados" },
    ];
    return {
      isDemo: Boolean(model?.isDemo),
      kpis: {
        ...(model?.kpis || {}),
        tec1Risk: urgentTec1.filter((row) => row.tec1_kind === "risk").length,
        tec1Late: urgentTec1.filter((row) => row.tec1_kind === "late").length,
      },
      tec1Rows: (urgentTec1.length ? urgentTec1 : tec1Rows.length ? tec1Rows : routePriorities).slice(0, 12),
      focusBasis: urgentTec1.length || tec1Rows.length ? "official_window" : routePriorities.length ? "route_estimate" : "none",
      activeTechnicians,
      routeAlerts: (routeConsole.alerts || []).slice(0, 8),
      suspended: model?.views?.reallocations?.rows?.length || 0,
      missingApi,
    };
  }

  return {
    VIEW_DEFINITIONS,
    buildMeetingExamples,
    buildMonitorModel,
    buildTec1ContractAlerts,
    buildUrgentCloseAlerts,
    buildTec1VoiceMessage,
    buildTvVoiceMessage,
    buildTvDashboard,
    bucketFromSource,
    normalizeOrder,
    routeState,
    speechPronunciationText,
    statusKind,
    tec1State,
  };
}));

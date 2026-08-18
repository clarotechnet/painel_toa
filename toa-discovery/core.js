(function initTOADiscoveryCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  try {
    Object.defineProperty(root, "__TOA_DISCOVERY_CORE__", {
      value: api,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch (_) {
    root.__TOA_DISCOVERY_CORE__ = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildCore() {
  "use strict";

  const VERSION = "0.3.0";
  const MAX_SCHEMA_FIELDS = 500;
  const MAX_WALK_NODES = 20000;
  const MAX_ENTITY_ITEMS = 5000;
  const MAX_TEXT_BYTES = 4 * 1024 * 1024;

  const SENSITIVE_KEY = /(?:^|_)(?:authorization|cookie|set_cookie|password|passwd|secret|token|ticket|csrf|trust|session(?:id|key|hash)?|auth(?:entication)?|cpf|cnpj|phone|telefone|mobile|email|e_mail|street|address|endereco|postal|cep|customer_name|client_name|nome_cliente)(?:$|_)/i;
  const SENSITIVE_NORMALIZED_KEY = /(?:authorization|cookie|setcookie|password|passwd|secret|token|ticket|csrf|trust|session(?:id|key|hash)?|authentication|authheader|apikey|accesskey|privatekey|credential|cpf|cnpj|phone|telefone|mobile|email|street|address|endereco|postal|cep|customername|clientname|nomecliente)/i;
  const SENSITIVE_HEADER = /^(?:authorization|cookie|set-cookie|x-ofs-csrf-secure|proxy-authorization)$/i;
  const SAFE_ACTION_PARAMS = new Set(["m", "a", "req_name", "screen", "itype", "output", "action", "method"]);

  const FIELD_ALIASES = {
    activityId: ["activityid", "activity_id", "aid", "activityid_", "activity_id_"],
    resourceId: ["resourceid", "resource_id", "providerid", "provider_id", "pid", "hint_pid"],
    userId: ["userid", "user_id", "uid", "hint_uid"],
    login: ["login", "ulogin", "userlogin", "user_login", "hint_ulogin"],
    name: ["resource", "resourcename", "resource_name", "providername", "provider_name", "hint_resource"],
    workOrder: ["apptnumber", "appt_number", "workorder", "work_order", "wo", "wonumber", "wo_number"],
    status: ["status", "activitystatus", "activity_status", "astatus", "route_status"],
    activityType: ["activitytype", "activity_type", "atype", "type_label", "activity_type_label"],
    date: ["date", "activitydate", "activity_date", "route_date"],
    routePosition: ["routeposition", "route_position", "positioninroute", "position_in_route"],
    travelTime: ["traveltime", "travel_time", "travelminutes", "travel_minutes"],
    finalTravelTime: ["finaltraveltime", "final_travel_time", "finaltravelminutes", "final_travel_minutes"],
    routingMethod: ["routingmethod", "routing_method", "travelestimationmethod", "travel_estimation_method"],
    serviceWindowStart: ["servicewindowstart", "service_window_start", "servicewindowfrom", "service_window_from"],
    serviceWindowEnd: ["servicewindowend", "service_window_end", "servicewindowto", "service_window_to"],
    communicatedWindowStart: ["communicatedwindowstart", "communicated_window_start", "customerwindowstart", "customer_window_start"],
    communicatedWindowEnd: ["communicatedwindowend", "communicated_window_end", "customerwindowend", "customer_window_end"],
    eta: ["eta", "estimatedarrival", "estimated_arrival", "estimatedstart", "estimated_start"],
    enrouteAt: ["enrouteat", "enroute_at", "enroutetime", "enroute_time"],
    startedAt: ["startedat", "started_at", "starttime", "start_time", "astart"],
    closedAt: ["closedat", "closed_at", "completedat", "completed_at", "endtime", "end_time", "aend"],
    plannedDuration: ["plannedduration", "planned_duration", "duration", "duration_minutes"],
    actualDuration: ["actualduration", "actual_duration", "workduration", "work_duration"],
    latitude: ["latitude", "lat", "coordinatey", "coordinate_y", "y"],
    longitude: ["longitude", "lng", "lon", "coordinatex", "coordinate_x", "x"],
    workArea: ["workarea", "work_area", "areadetrabalho", "area_de_trabalho"],
    workZone: ["workzone", "work_zone", "workzonelabel", "work_zone_label"],
    closeCode: ["closecode", "close_code", "codigo_baixa", "codigobaixa", "completioncode", "completion_code"],
    completionFlag: ["completionflag", "completion_flag", "flag_conclusao", "flagdeconclusao"],
    occurredAt: ["occurredat", "occurred_at", "timestamp", "eventtime", "event_time", "actiontime", "action_time"],
    eventKind: ["event", "eventtype", "event_type", "kind", "action", "actiontype", "action_type"],
    actor: ["actor", "user", "username", "changedby", "changed_by"],
    resourceFrom: ["resourcefrom", "resource_from", "providerfrom", "provider_from", "fromresource", "from_resource"],
    resourceTo: ["resourceto", "resource_to", "providerto", "provider_to", "toresource", "to_resource"],
    reason: ["reason", "movementreason", "movement_reason", "routechange_reason"],
    routePlan: ["routeplan", "route_plan", "plan", "routingplan", "routing_plan"],
    parentResourceId: ["parentresourceid", "parent_resource_id", "parentproviderid", "parent_provider_id", "parentid", "parent_id"],
    bucket: ["bucket", "bucketname", "bucket_name", "resourcebucket", "resource_bucket", "organizationunit", "organization_unit"],
    resourceType: ["resourcetype", "resource_type", "providertype", "provider_type", "resourcekind", "resource_kind"],
    accountStatus: ["accountstatus", "account_status", "loginstatus", "login_status", "userstatus", "user_status"],
    availabilityStatus: ["availabilitystatus", "availability_status", "workingstatus", "working_status"],
    active: ["active", "isactive", "is_active", "enabled", "isenabled", "is_enabled"],
  };

  const ALIAS_LOOKUP = new Map();
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) ALIAS_LOOKUP.set(normalizeKey(alias), canonical);
  }

  function normalizeKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "")
      .toLowerCase();
  }

  function isSensitiveKey(key) {
    const normalized = String(key || "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
    const compact = normalized.replace(/_/g, "");
    return SENSITIVE_KEY.test(normalized) || SENSITIVE_NORMALIZED_KEY.test(compact);
  }

  function scalarType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value === "object" ? "object" : typeof value;
  }

  function operationalScalar(key, value) {
    if (isSensitiveKey(key)) return undefined;
    if (!["string", "number", "boolean"].includes(typeof value)) return undefined;
    const canonical = ALIAS_LOOKUP.get(normalizeKey(key));
    if (!canonical) return undefined;
    const text = String(value).trim();
    if (!text || text.length > 500) return undefined;
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) return undefined;
    return typeof value === "string" ? text : value;
  }

  function sanitizeEndpoint(rawUrl, baseUrl) {
    try {
      const url = new URL(String(rawUrl || ""), baseUrl || "https://clarobrasil.etadirect.com/");
      const safe = new URL(url.origin + url.pathname);
      const pairs = [];
      for (const [name, value] of url.searchParams.entries()) {
        if (isSensitiveKey(name)) continue;
        if (SAFE_ACTION_PARAMS.has(name.toLowerCase())) pairs.push([name, value.slice(0, 120)]);
      }
      pairs.sort((a, b) => a[0].localeCompare(b[0]));
      for (const pair of pairs) safe.searchParams.append(pair[0], pair[1]);
      return safe.pathname + safe.search;
    } catch (_) {
      return "/";
    }
  }

  function parameterNames(rawUrl, body, baseUrl) {
    const names = new Set();
    try {
      const url = new URL(String(rawUrl || ""), baseUrl || "https://clarobrasil.etadirect.com/");
      for (const name of url.searchParams.keys()) if (!isSensitiveKey(name)) names.add(name);
    } catch (_) {}
    try {
      if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
        for (const name of body.keys()) if (!isSensitiveKey(name)) names.add(name);
      } else if (typeof FormData !== "undefined" && body instanceof FormData) {
        for (const name of body.keys()) if (!isSensitiveKey(name)) names.add(name);
      } else if (typeof body === "string" && body.length < 2 * 1024 * 1024) {
        const trimmed = body.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          const parsed = JSON.parse(trimmed);
          const seen = new WeakSet();
          let visited = 0;
          const collectKeys = (value, prefix, depth) => {
            if (visited++ > 2000 || depth > 6 || value === null || typeof value !== "object") return;
            if (seen.has(value)) return;
            seen.add(value);
            if (Array.isArray(value)) {
              if (value.length) collectKeys(value[0], `${prefix}[]`, depth + 1);
              return;
            }
            for (const [key, child] of Object.entries(value)) {
              if (isSensitiveKey(key)) continue;
              const path = prefix ? `${prefix}.${key}` : key;
              names.add(path);
              collectKeys(child, path, depth + 1);
              if (names.size >= 200) return;
            }
          };
          collectKeys(parsed, "", 0);
        } else if (trimmed.includes("=")) {
          const params = new URLSearchParams(trimmed);
          for (const name of params.keys()) if (!isSensitiveKey(name)) names.add(name);
        }
      }
    } catch (_) {}
    return [...names].sort();
  }

  function parseJson(text) {
    const input = String(text || "").trim();
    if (!input || input.length > MAX_TEXT_BYTES) return null;
    if (!(input.startsWith("{") || input.startsWith("["))) return null;
    try { return JSON.parse(input); } catch (_) { return null; }
  }

  function schemaOf(value) {
    const output = [];
    const seen = new WeakSet();
    let nodes = 0;
    function visit(current, path, depth) {
      if (nodes++ > MAX_WALK_NODES || output.length >= MAX_SCHEMA_FIELDS || depth > 12) return;
      if (current && typeof current === "object") {
        if (seen.has(current)) return;
        seen.add(current);
      }
      if (Array.isArray(current)) {
        output.push(`${path || "$"}[]:array`);
        if (current.length) visit(current[0], `${path || "$"}[]`, depth + 1);
        return;
      }
      if (current && typeof current === "object") {
        for (const [key, child] of Object.entries(current)) {
          if (isSensitiveKey(key)) continue;
          const next = path ? `${path}.${key}` : key;
          output.push(`${next}:${scalarType(child)}`);
          if (child && typeof child === "object") visit(child, next, depth + 1);
          if (output.length >= MAX_SCHEMA_FIELDS) break;
        }
      }
    }
    visit(value, "", 0);
    return [...new Set(output)].sort();
  }

  function canonicalObject(object) {
    const result = {};
    if (!object || typeof object !== "object" || Array.isArray(object)) return result;
    for (const [key, value] of Object.entries(object)) {
      const safe = operationalScalar(key, value);
      if (safe === undefined) continue;
      const canonical = ALIAS_LOOKUP.get(normalizeKey(key));
      if (canonical && result[canonical] === undefined) result[canonical] = safe;
    }
    return result;
  }

  function inferNumericId(path, section) {
    const normalized = String(section || "").toLowerCase();
    const pattern = normalized === "activity" ? "activit(?:y|ies)"
      : normalized === "provider" ? "providers?"
        : normalized === "resource" ? "resources?"
          : section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(path || "").match(new RegExp(`(?:^|\\.)${pattern}\\.(\\d{2,})`, "i"));
    return match ? match[1] : "";
  }

  function extractEntities(value) {
    const resources = new Map();
    const activities = new Map();
    const events = new Map();
    const routes = new Map();
    const fields = new Map();
    const seen = new WeakSet();
    let nodes = 0;

    function store(map, key, item) {
      if (!key || map.size >= MAX_ENTITY_ITEMS) return;
      map.set(String(key), { ...(map.get(String(key)) || {}), ...item });
    }

    function visit(current, path, depth) {
      if (nodes++ > MAX_WALK_NODES || depth > 14 || current === null || current === undefined) return;
      if (typeof current !== "object") return;
      if (seen.has(current)) return;
      seen.add(current);
      if (Array.isArray(current)) {
        current.slice(0, MAX_ENTITY_ITEMS).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
        return;
      }

      const normalized = canonicalObject(current);
      for (const [key, child] of Object.entries(current)) {
        if (isSensitiveKey(key)) continue;
        const canonical = ALIAS_LOOKUP.get(normalizeKey(key));
        if (canonical) {
          const fieldKey = `${canonical}:${scalarType(child)}`;
          if (!fields.has(fieldKey)) fields.set(fieldKey, { name: key, canonical, type: scalarType(child), path: path ? `${path}.${key}` : key });
        }
      }

      const lowerPath = path.toLowerCase();
      const inferredResource = inferNumericId(path, "Provider") || inferNumericId(path, "Resource");
      const inferredActivity = inferNumericId(path, "Activity");
      const resourceId = String(normalized.resourceId || inferredResource || "").trim();
      const activityId = String(normalized.activityId || inferredActivity || "").trim();

      if (resourceId && (normalized.login || normalized.name || /provider|resource/.test(lowerPath))) {
        store(resources, resourceId, {
          resourceId,
          userId: normalized.userId || "",
          login: normalized.login || "",
          name: normalized.name || "",
          statusRota: normalized.status || "",
          parentResourceId: normalized.parentResourceId || "",
          bucket: normalized.bucket || "",
          resourceType: normalized.resourceType || "",
          accountStatus: normalized.accountStatus || "",
          availabilityStatus: normalized.availabilityStatus || "",
          active: normalized.active ?? "",
          loginDisponivel: Boolean(normalized.login),
          capturedAt: new Date().toISOString(),
        });
      }

      if (activityId && (/activity|actividade/.test(lowerPath) || normalized.status || normalized.activityType)) {
        store(activities, activityId, {
          activityId,
          resourceId: normalized.resourceId || inferredResource || "",
          workOrder: normalized.workOrder || "",
          date: normalized.date || "",
          type: normalized.activityType || "",
          status: normalized.status || "",
          routePosition: normalized.routePosition ?? "",
          serviceWindowStart: normalized.serviceWindowStart || "",
          serviceWindowEnd: normalized.serviceWindowEnd || "",
          communicatedWindowStart: normalized.communicatedWindowStart || "",
          communicatedWindowEnd: normalized.communicatedWindowEnd || "",
          eta: normalized.eta || "",
          enrouteAt: normalized.enrouteAt || "",
          startedAt: normalized.startedAt || "",
          closedAt: normalized.closedAt || "",
          plannedDuration: normalized.plannedDuration ?? "",
          actualDuration: normalized.actualDuration ?? "",
          latitude: normalized.latitude ?? "",
          longitude: normalized.longitude ?? "",
          workArea: normalized.workArea || "",
          workZone: normalized.workZone || "",
          closeCode: normalized.closeCode || "",
          completionFlag: normalized.completionFlag ?? "",
          capturedAt: new Date().toISOString(),
        });
      }

      if (activityId && (/history|historico|event|action|movement|moviment/.test(lowerPath) || normalized.occurredAt && normalized.eventKind)) {
        const eventKey = [activityId, normalized.occurredAt || "", normalized.eventKind || "", normalized.resourceId || ""].join("|");
        store(events, eventKey, {
          activityId,
          resourceId: normalized.resourceId || "",
          timestamp: normalized.occurredAt || "",
          kind: normalized.eventKind || "",
          actor: normalized.actor || "",
          routePosition: normalized.routePosition ?? "",
          travelMinutes: normalized.travelTime ?? "",
          finalTravelMinutes: normalized.finalTravelTime ?? "",
          routingMethod: normalized.routingMethod || "",
          resourceFrom: normalized.resourceFrom || "",
          resourceTo: normalized.resourceTo || "",
          reason: normalized.reason || "",
          routePlan: normalized.routePlan || "",
        });
      }

      if ((resourceId || activityId) && (normalized.routePosition !== undefined || normalized.travelTime !== undefined || normalized.routingMethod)) {
        const routeKey = [resourceId, activityId, normalized.routePosition ?? ""].join("|");
        store(routes, routeKey, {
          resourceId,
          activityId,
          routePosition: normalized.routePosition ?? "",
          travelMinutes: normalized.travelTime ?? "",
          finalTravelMinutes: normalized.finalTravelTime ?? "",
          routingMethod: normalized.routingMethod || "",
          eta: normalized.eta || "",
          capturedAt: new Date().toISOString(),
        });
      }

      for (const [key, child] of Object.entries(current)) {
        if (isSensitiveKey(key)) continue;
        visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }

    visit(value, "", 0);
    return {
      resources: [...resources.values()],
      activities: [...activities.values()],
      events: [...events.values()],
      routes: [...routes.values()],
      fields: [...fields.values()],
    };
  }

  function parseResourceHint(text, expectedResourceId) {
    const parsed = parseJson(text);
    if (parsed) {
      const entities = extractEntities(parsed).resources;
      const expected = String(expectedResourceId || "").trim();
      const direct = entities.find((item) => (!expected || String(item.resourceId) === expected) && item.name && (item.login || item.userId))
        || entities.find((item) => item.name && (item.login || item.userId));
      if (direct) return {
        ...direct,
        resourceId: expected || direct.resourceId,
        loginDisponivel: Boolean(direct.login),
        situacaoCadastro: direct.login ? "login_disponivel" : "login_nao_exposto",
      };
    }
    const input = String(text || "").slice(0, MAX_TEXT_BYTES);
    const read = (name, pattern) => {
      const match = input.match(pattern);
      return match ? String(match[1] || "").replace(/\\["']/g, "").trim() : "";
    };
    const resourceId = read("pid", /["']?hint_pid["']?\s*[:=]\s*["']?(\d{2,})/i) || String(expectedResourceId || "").trim();
    const userId = read("uid", /["']?hint_uid["']?\s*[:=]\s*["']?(\d{1,})/i);
    const login = read("login", /["']?hint_ulogin["']?\s*[:=]\s*["']?([A-Za-z0-9._-]{2,})/i);
    const name = read("resource", /["']?hint_resource["']?\s*[:=]\s*["']([^"'<>]{2,120})/i);
    if (!resourceId || !name || (!login && !userId)) return null;
    const plain = input.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const labelValue = (label) => {
      const match = plain.match(new RegExp(`${label}\\s*:?\\s*([^|;]{1,160})`, "i"));
      return match ? match[1].trim() : "";
    };
    return {
      resourceId,
      userId,
      login,
      name,
      loginDisponivel: Boolean(login),
      situacaoCadastro: login ? "login_disponivel" : "login_nao_exposto",
      statusRota: labelValue("Status da Rota"),
      totalOS: labelValue("Total"),
      pendentes: labelValue("Pendente"),
      habilidades: labelValue("Habilidades(?: de Trabalho)?"),
      calendario: labelValue("Calend[aá]rio"),
      grupos: "",
      areasTrabalho: "",
      capturedAt: new Date().toISOString(),
    };
  }

  function categoryFor(endpoint, schema, parameters) {
    const endpointText = String(endpoint || "").toLowerCase();
    const haystack = `${endpointText} ${(schema || []).join(" ")} ${(parameters || []).join(" ")}`.toLowerCase();
    if (/client-metrics/.test(endpointText)) return "configuration";
    if (/hint.*provider|a=provider/.test(endpointText)) return "resource";
    if (/collaboration/.test(haystack)) return "collaboration";
    if (/history|historico|event|movement|actionhistory/.test(haystack)) return "history";
    if (/inventory|requiredinventory|inventario|equipamento/.test(haystack)) return "inventory";
    if (/routeposition|routingmethod|traveltime|route|rota/.test(haystack)) return "route";
    if (/latitude|longitude|coordinate|location|map|polyline|geometry/.test(haystack)) return "location";
    if (/workzone|work_zone/.test(haystack)) return "work_zone";
    if (/capacity|capacidade/.test(haystack)) return "capacity";
    if (/activity|activities|atividade|appt_number|activityid/.test(haystack)) return "activity";
    if (/provider|resource|recurso|p_tree|resourcetreeselection/.test(haystack)) return "resource";
    if (/config|settings|metadata/.test(haystack)) return "configuration";
    return "unknown";
  }

  function summarizeExchange(input) {
    const now = new Date().toISOString();
    const method = String(input.method || "GET").toUpperCase();
    const endpoint = sanitizeEndpoint(input.url, input.baseUrl);
    const parameters = parameterNames(input.url, input.body, input.baseUrl);
    const responseText = String(input.responseText || "");
    const parsed = parseJson(responseText);
    const schema = parsed ? schemaOf(parsed) : [];
    const entities = parsed ? extractEntities(parsed) : { resources: [], activities: [], events: [], routes: [], fields: [] };
    const isHint = /(?:\?|&)m=hint(?:&|$)/i.test(String(input.url || "")) && /(?:\?|&)a=provider(?:&|$)/i.test(String(input.url || ""));
    let expectedResourceId = "";
    if (isHint) {
      try {
        const params = input.body instanceof URLSearchParams ? input.body : new URLSearchParams(typeof input.body === "string" ? input.body : "");
        expectedResourceId = String(params.get("id") || "").trim();
      } catch (_) {}
    }
    const hint = isHint ? parseResourceHint(responseText, expectedResourceId) : null;
    if (hint) entities.resources = [{ ...hint, validation: "hint_provider" }];
    else entities.resources = entities.resources.map((resource) => ({ ...resource, validation: "observed_payload" }));
    const responseType = parsed ? "json" : /html/i.test(String(input.responseType || "")) ? "html" : String(input.responseType || "text").split(";")[0];
    return {
      endpoint: {
        method,
        endpoint,
        category: categoryFor(endpoint, schema, parameters),
        parameters,
        requestType: String(input.requestType || "").split(";")[0],
        responseType,
        responseBytes: Number(input.responseBytes || responseText.length || 0),
        status: Number(input.status || 0),
        schema,
        firstSeen: now,
        lastSeen: now,
      },
      ...entities,
    };
  }

  function collectResourceCandidates(value, source) {
    const found = new Map();
    const seen = new WeakSet();
    let nodes = 0;
    function add(raw, origin) {
      const text = String(raw ?? "").trim();
      if (!/^\d{2,8}$/.test(text)) return;
      if (!found.has(text)) found.set(text, { resourceId: text, source: origin || source || "unknown" });
    }
    function visit(current, path, depth) {
      if (nodes++ > 12000 || depth > 10 || current === null || current === undefined) return;
      if (typeof current !== "object") return;
      if (seen.has(current)) return;
      seen.add(current);
      if (Array.isArray(current)) {
        current.slice(0, 2000).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
        return;
      }
      for (const [key, child] of Object.entries(current)) {
        if (isSensitiveKey(key)) continue;
        const normalized = normalizeKey(key);
        const resourceKey = /^(?:pid|resourceid|resource_id|providerid|provider_id|hintpid|hint_pid|resource)$/.test(normalized);
        if (resourceKey && ["string", "number"].includes(typeof child)) add(child, source || path || key);
        if (child && typeof child === "object") visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
    visit(value, "", 0);
    return [...found.values()];
  }

  function compactText(value, limit) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit || 240);
  }

  function serviceFromTimelineLabel(value) {
    return compactText(value, 600)
      .split(",", 1)[0]
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .trim()
      .slice(0, 180);
  }

  function sanitizeTimeSnapshot(url, responseText) {
    let parsedUrl;
    try { parsedUrl = new URL(String(url || ""), "https://clarobrasil.etadirect.com/"); } catch (_) { return null; }
    if (String(parsedUrl.searchParams.get("m") || "").toLowerCase() !== "time"
      || String(parsedUrl.searchParams.get("a") || "").toLowerCase() !== "get") return null;
    const payload = parseJson(String(responseText || ""));
    const descriptor = payload && payload.p && typeof payload.p === "object" ? payload.p : {};
    const delta = payload && payload.delta && typeof payload.delta === "object" ? payload.delta : {};
    if (!delta.providers || !delta.activities) return null;

    const providers = Object.entries(delta.providers).flatMap(([id, provider]) => {
      if (!provider || typeof provider !== "object") return [];
      return [{
        technician_id: String(id),
        technician_name: compactText(provider.n, 180),
        technician_login: compactText(provider.U, 80),
      }];
    });
    const activities = Object.entries(delta.activities).flatMap(([id, activity]) => {
      if (!activity || typeof activity !== "object" || !/^\d{5,18}$/.test(String(id))) return [];
      return [{
        activity_id: String(id),
        technician_id: String(activity.p ?? ""),
        status: compactText(activity.s || "pending", 40).toLowerCase(),
        activity_type: compactText(activity.t, 40),
        description: serviceFromTimelineLabel(activity.L),
        start_min: Number.isFinite(Number(activity.S)) ? Number(activity.S) : "",
        duration_min: Number.isFinite(Number(activity.d)) ? Number(activity.d) : "",
        travel_min: Number.isFinite(Number(activity.G)) ? Number(activity.G) : "",
        route_position: Number.isFinite(Number(activity.i)) ? Number(activity.i) : "",
      }];
    });
    return {
      source: "toa-live-all-buckets",
      observed_at: new Date().toISOString(),
      group_id: String(payload.gid || descriptor.g || ""),
      group_name: compactText(descriptor.n, 120),
      scheduled_date: compactText(descriptor.D, 10),
      version: delta.version ?? null,
      providers,
      activities,
    };
  }

  return Object.freeze({
    VERSION,
    SENSITIVE_HEADER,
    isSensitiveKey,
    normalizeKey,
    sanitizeEndpoint,
    parameterNames,
    schemaOf,
    extractEntities,
    parseResourceHint,
    categoryFor,
    summarizeExchange,
    collectResourceCandidates,
    sanitizeTimeSnapshot,
  });
});

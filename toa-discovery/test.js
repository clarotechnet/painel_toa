"use strict";

const assert = require("node:assert/strict");
const core = require("./core.js");
const exporter = require("./exporter.js");

assert.equal(core.isSensitiveKey("authorization"), true);
assert.equal(core.isSensitiveKey("CSRFSecureToken"), true);
assert.equal(core.isSensitiveKey("connectionSessionKey"), true);
assert.equal(core.isSensitiveKey("livelookApiKey"), true);

const endpoint = core.sanitizeEndpoint("https://clarobrasil.etadirect.com/?m=Hint&a=provider&id=1430&X-OFS-CSRF-SECURE=secret", "https://clarobrasil.etadirect.com/");
assert.match(endpoint, /m=Hint/i);
assert.match(endpoint, /a=provider/i);
assert.doesNotMatch(endpoint, /1430|secret|csrf/i);

const sample = {
  delta: {
    Provider: {
      1430: { resource_id: "1430", user_id: "2949", login: "Z131558", resource_name: "ACTON ESTENIO" },
    },
    Activity: {
      196222802: {
        activity_id: "196222802",
        provider_id: "1430",
        status: "pending",
        activity_type: "Instalacao",
        route_position: 3,
        coordinate_x: -35.2,
        coordinate_y: -5.8,
        address: "DADO QUE NAO PODE SAIR",
        email: "cliente@example.com",
      },
    },
  },
  auth_ticket: "segredo",
  sessionHash: "segredo",
};

const summary = core.summarizeExchange({
  method: "POST",
  url: "https://clarobrasil.etadirect.com/?m=sync&a=write",
  body: "pid=1430&trust=segredo",
  responseText: JSON.stringify(sample),
  responseType: "application/json",
  status: 200,
});
assert.equal(summary.endpoint.category, "route");
assert.equal(summary.resources[0].resourceId, "1430");
assert.equal(summary.activities[0].activityId, "196222802");
assert.equal(summary.activities[0].routePosition, 3);
assert.ok(summary.endpoint.schema.every((field) => !/address|email|ticket|session/i.test(field)));
assert.ok(summary.endpoint.parameters.every((field) => !/trust/i.test(field)));

const candidates = core.collectResourceCandidates({ provider_id: 1430, nested: { resourceId: "11175" }, id: 999 }, "TEST");
assert.deepEqual(candidates.map((item) => item.resourceId).sort(), ["11175", "1430"]);

const hint = core.parseResourceHint(JSON.stringify({ hint_pid: "33128", hint_uid: 2949, hint_ulogin: "Z131558", hint_resource: "ACTON ESTENIO" }), "1430");
assert.equal(hint.resourceId, "1430");
assert.equal(hint.login, "Z131558");

const hintWithoutLogin = core.parseResourceHint(JSON.stringify({ hint_pid: "33129", hint_uid: 2950, hint_resource: "TECNICO DE FOLGA" }), "33129");
assert.equal(hintWithoutLogin.resourceId, "33129");
assert.equal(hintWithoutLogin.login, "");
assert.equal(hintWithoutLogin.loginDisponivel, false);

const resourceState = core.extractEntities({ resources: [{ resource_id: "33130", resource_name: "TECNICO SEM ROTA", parent_resource_id: "88", account_status: "inactive" }] });
assert.equal(resourceState.resources[0].parentResourceId, "88");
assert.equal(resourceState.resources[0].accountStatus, "inactive");

const pluralActivity = core.extractEntities({ delta: { activities: { 166903430: { status: "pending", x: -35.2, y: -5.8 } } } });
assert.equal(pluralActivity.activities[0].activityId, "166903430");

const live = core.sanitizeTimeSnapshot(
  "https://clarobrasil.etadirect.com/?m=Time&a=get&itype=manage&output=ajax",
  JSON.stringify({
    gid: 256815,
    p: { n: "ALL_BUCKETS", g: 256815, D: "2026-08-13" },
    delta: {
      version: 12,
      providers: { 67380: { n: "TECNICO TESTE", U: "Z123456" } },
      activities: {
        196846949: { p: 67380, s: "started", t: 4, L: "Instalacao, NOME DO CLIENTE, ENDERECO", S: 573, d: 101, G: 17, i: 3 },
      },
    },
  }),
);
assert.equal(live.group_name, "ALL_BUCKETS");
assert.equal(live.providers[0].technician_login, "Z123456");
assert.equal(live.activities[0].description, "Instalacao");
assert.equal(live.activities[0].status, "started");
assert.equal(JSON.stringify(live).includes("NOME DO CLIENTE"), false);
assert.equal(JSON.stringify(live).includes("ENDERECO"), false);
const jsonParameters = core.parameterNames("https://clarobrasil.etadirect.com/client-metrics", JSON.stringify({ metrics: [{ name: "loading", token: "secret" }] }));
assert.deepEqual(jsonParameters, ["metrics", "metrics[].name"]);

const state = {
  metadata: { version: "test", captureActive: true, token: "nao-pode-sair" },
  resources: summary.resources,
  activities: summary.activities,
  events: [],
  routes: summary.routes,
  endpoints: [{ ...summary.endpoint, calls: 1 }],
  fields: summary.fields,
  errors: [],
  buckets: [{ name: "FTZ-DMV_01", savedAt: "2026-08-08T12:00:00Z", resources: summary.resources }],
};
const publicData = exporter.publicDataset(state);
assert.equal(publicData.metadata.token, undefined);
assert.equal(publicData.buckets[0].name, "FTZ-DMV_01");
const xlsx = exporter.createXlsx(state);
assert.equal(xlsx[0], 0x50);
assert.equal(xlsx[1], 0x4B);
const visibleZipText = new TextDecoder().decode(xlsx);
assert.match(visibleZipText, /xl\/worksheets\/sheet8\.xml/);
assert.match(visibleZipText, /xl\/worksheets\/sheet10\.xml/);
assert.match(visibleZipText, /FTZ-DMV_01/);
assert.doesNotMatch(visibleZipText, /nao-pode-sair/);

console.log("TOA Discovery: sanitizacao, extracao operacional e XLSX validados.");

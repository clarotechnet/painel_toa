"use strict";

const CHANNEL = "TOA_DISCOVERY_V1";
let currentState = null;
let lastAutoBucket = "";

const byId = (id) => document.getElementById(id);

function formatDate(value) {
  if (!value) return "Nenhuma captura.";
  try { return `Última captura: ${new Date(value).toLocaleString("pt-BR")}`; } catch (_) { return String(value); }
}

function render(state) {
  currentState = state;
  const metadata = state.metadata || {};
  byId("resourcesFound").textContent = metadata.resourcesFound || 0;
  byId("resourcesValidated").textContent = (state.resources || []).length;
  byId("activities").textContent = (state.activities || []).length;
  byId("events").textContent = (state.events || []).length;
  byId("endpoints").textContent = (state.endpoints || []).length;
  byId("routes").textContent = (state.routes || []).length;
  const badge = byId("captureBadge");
  badge.textContent = metadata.captureActive ? "ATIVA" : "INATIVA";
  badge.className = `badge ${metadata.captureActive ? "online" : "offline"}`;
  byId("templateStatus").textContent = metadata.validationTemplateReady
    ? "Dados da árvore ativos. O complemento de login também está disponível."
    : "A árvore já coleta nomes; abra um técnico uma vez para completar os logins.";
  byId("lastSeen").textContent = formatDate(metadata.lastSeen);
  const buckets = state.buckets || [];
  byId("bucketCount").textContent = `${buckets.length} ${buckets.length === 1 ? "salvo" : "salvos"}`;
  const detected = String(metadata.currentBucket || "").trim();
  const bucketInput = byId("bucketName");
  if (detected && document.activeElement !== bucketInput && (!bucketInput.value || bucketInput.value === lastAutoBucket)) {
    bucketInput.value = detected;
    lastAutoBucket = detected;
  }
  byId("bucketList").innerHTML = buckets.length
    ? buckets.map((bucket) => `<div class="bucket-item"><span>${String(bucket.name || "Bucket").replace(/[<>&]/g, "")}</span><strong>${(bucket.resources || []).length}${bucket.pendingDetails ? ` +${bucket.pendingDetails}` : ""}</strong></div>`).join("")
    : "Nenhum bucket salvo.";
  if (metadata.fastSweepRunning) {
    byId("feedback").textContent = `Varrendo buckets ${metadata.fastSweepPosition || 0}/${metadata.fastSweepTotal || 0}… mantenha o TOA aberto.`;
  }
}

async function load() {
  const response = await chrome.runtime.sendMessage({ scope: CHANNEL, type: "GET_STATE" });
  if (response && response.ok) render(response.state);
}

async function command(command, feedback) {
  byId("feedback").textContent = feedback;
  const response = await chrome.runtime.sendMessage({ scope: CHANNEL, type: "COMMAND", command });
  byId("feedback").textContent = response && response.ok ? "Comando enviado ao TOA." : "Abra o TOA e recarregue a página com a extensão ativa.";
  setTimeout(load, 700);
}

byId("scanButton").addEventListener("click", () => command("SCAN_RESOURCES", "Mapeando árvore e modelos carregados…"));
byId("validateButton").addEventListener("click", () => command("VALIDATE_RESOURCES", "Completando logins dos IDs observados…"));
byId("startBucketsButton").addEventListener("click", async () => {
  if (!confirm("Iniciar uma nova coleta por buckets? A captura acumulada atual será limpa.")) return;
  const bucket = byId("bucketName").value.trim().toUpperCase();
  const response = await chrome.runtime.sendMessage({ scope: CHANNEL, type: "START_BUCKET_COLLECTION", bucket });
  byId("feedback").textContent = response && response.ok
    ? "Coleta iniciada. Use a varredura rápida; depois, se quiser, complete os logins em segundo plano."
    : "Não consegui iniciar. Recarregue o TOA com a extensão ativa.";
  await load();
});
byId("fastSweepButton").addEventListener("click", () => command("FAST_BUCKET_SWEEP", "Localizando e abrindo os buckets visíveis…"));
byId("saveBucketButton").addEventListener("click", async () => {
  const bucket = byId("bucketName").value.trim().toUpperCase();
  if (!bucket) { byId("feedback").textContent = "Informe ou selecione o nome do bucket."; return; }
  const response = await chrome.runtime.sendMessage({ scope: CHANNEL, type: "SAVE_BUCKET", bucket });
  byId("feedback").textContent = response && response.ok
    ? `${response.name}: ${response.total} com dados, ${response.pendingDetails || 0} aguardando detalhes.`
    : String(response && response.error || "Não foi possível salvar o bucket.");
  await load();
});
byId("jsonButton").addEventListener("click", () => {
  if (!currentState) return;
  TOADiscoveryExporter.exportJson(currentState);
  byId("feedback").textContent = "toa-discovery.json exportado.";
});
byId("xlsxButton").addEventListener("click", () => {
  if (!currentState) return;
  TOADiscoveryExporter.exportXlsx(currentState);
  byId("feedback").textContent = "TOA_Inventario_Completo.xlsx exportado.";
});
byId("clearButton").addEventListener("click", async () => {
  if (!confirm("Limpar todos os dados operacionais capturados pela extensão?")) return;
  await chrome.runtime.sendMessage({ scope: CHANNEL, type: "CLEAR_STATE" });
  byId("feedback").textContent = "Captura limpa.";
  await load();
});

load().catch((error) => { byId("feedback").textContent = String(error.message || error); });
setInterval(() => load().catch(() => {}), 1500);

function stagger(seconds) {
  return (_element, index) => seconds * index;
}

function animationFrames(properties) {
  const values = Object.values(properties);
  const length = Math.max(1, ...values.map((value) => (Array.isArray(value) ? value.length : 1)));
  return Array.from({ length }, (_, index) => {
    const frame = {};
    const at = (key, fallback) => {
      const value = properties[key];
      if (Array.isArray(value)) return value[Math.min(index, value.length - 1)];
      return value === undefined ? fallback : value;
    };
    if (properties.opacity !== undefined) frame.opacity = at("opacity", 1);
    if (properties.height !== undefined) frame.height = `${at("height", 0)}px`;
    if (properties.y !== undefined || properties.scale !== undefined) {
      frame.transform = `translateY(${at("y", 0)}px) scale(${at("scale", 1)})`;
    }
    return frame;
  });
}

function animate(targets, properties, options = {}) {
  const elements = targets instanceof Element ? [targets] : [...(targets || [])];
  const players = elements.map((element, index) => element.animate(
    animationFrames(properties),
    {
      duration: Number(options.duration || 0) * 1000,
      delay: Number(typeof options.delay === "function" ? options.delay(element, index) : options.delay || 0) * 1000,
      easing: options.easing || "linear",
      fill: "forwards",
    },
  ));
  return {
    finished: Promise.all(players.map((player) => player.finished.catch(() => undefined))),
  };
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let lastAutomationSignature = "";
let lastToaSignature = "";
let lastToaStatus = "";

function enabled() {
  return !reducedMotion.matches;
}

function visibleWorkspace() {
  return document.querySelector(
    "main > section:not(.hidden), main .dashboard-workspace:not(.hidden), main .close-workspace:not(.hidden)",
  );
}

function enterWorkspace() {
  if (!enabled()) return;
  const workspace = visibleWorkspace();
  if (!workspace) return;
  animate(
    workspace,
    { opacity: [0.72, 1], y: [7, 0] },
    { duration: 0.2, easing: "ease-out" },
  );
}

function revealCards(cards, kind) {
  const elements = [...(cards || [])].filter((item) => item instanceof Element);
  if (!enabled() || !elements.length) return;
  const signature = elements.map((item) => item.textContent?.slice(0, 160)).join("|");
  if (kind === "automation") {
    if (signature === lastAutomationSignature) return;
    lastAutomationSignature = signature;
  } else {
    if (signature === lastToaSignature) return;
    lastToaSignature = signature;
  }
  animate(
    elements,
    { opacity: [0, 1], y: [8, 0] },
    { duration: 0.22, delay: stagger(0.035), easing: "ease-out" },
  );
}

async function toggleDetails(details, expanded) {
  if (!details) return;
  if (!enabled()) {
    details.hidden = !expanded;
    return;
  }
  details.style.overflow = "hidden";
  if (expanded) {
    details.hidden = false;
    const height = details.scrollHeight;
    await animate(
      details,
      { height: [0, height], opacity: [0, 1] },
      { duration: 0.2, easing: "ease-out" },
    ).finished;
    details.style.height = "auto";
    details.style.overflow = "";
    return;
  }
  await animate(
    details,
    { height: [details.scrollHeight, 0], opacity: [1, 0] },
    { duration: 0.16, easing: "ease-in" },
  ).finished;
  details.hidden = true;
  details.style.height = "";
  details.style.opacity = "";
  details.style.overflow = "";
}

function animateStatus(element, kind) {
  if (!enabled() || !element || kind === lastToaStatus) return;
  lastToaStatus = kind;
  animate(
    element,
    { opacity: [0.55, 1], scale: [0.985, 1] },
    { duration: 0.18, easing: "ease-out" },
  );
}

document.addEventListener("dominium:module-change", enterWorkspace);
document.addEventListener("dominium:automation-results", (event) => {
  revealCards(event.detail?.cards, "automation");
});
document.addEventListener("dominium:toa-results", (event) => {
  revealCards(event.detail?.cards, "toa");
});
document.addEventListener("dominium:toa-status", (event) => {
  animateStatus(event.detail?.element, event.detail?.kind || "");
});

document.addEventListener("pointerover", (event) => {
  if (!enabled() || event.pointerType === "touch") return;
  const button = event.target.closest("button:not(:disabled)");
  if (!button || button.contains(event.relatedTarget)) return;
  animate(button, { scale: 1.012 }, { duration: 0.1 });
});

document.addEventListener("pointerout", (event) => {
  if (!enabled() || event.pointerType === "touch") return;
  const button = event.target.closest("button:not(:disabled)");
  if (!button || button.contains(event.relatedTarget)) return;
  animate(button, { scale: 1 }, { duration: 0.1 });
});

globalThis.DOMINIUM_MOTION = { toggleDetails };

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", enterWorkspace, { once: true });
} else {
  enterWorkspace();
}

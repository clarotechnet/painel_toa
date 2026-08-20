const ATLAS_CLOCK_INTERVAL_MS = 2_500;

function emitAtlasTick() {
  self.postMessage({ type: 'atlas_clock_tick', sentAt: Date.now() });
}

setInterval(emitAtlasTick, ATLAS_CLOCK_INTERVAL_MS);
emitAtlasTick();

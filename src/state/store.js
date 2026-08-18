export function createStore() {
  const state = {
    module: 'monitor',
    snapshot: { files: [], orders: [], timelineActivities: [], errors: [], loadedAt: null, source: 'none' },
    datalakeOnline: false,
    city: 'all',
    view: 'routes',
    search: '',
    bucket: 'all',
    status: 'all',
    demo: false,
    demoOrders: null,
  };
  return {
    get: () => state,
    set(patch) { Object.assign(state, patch); return state; },
  };
}

let directoryPromise;

export async function loadTechnicianDirectory() {
  if (!directoryPromise) {
    directoryPromise = fetch('/data/technicians.json', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { technicians: [] })
      .catch(() => ({ technicians: [] }));
  }
  const payload = await directoryPromise;
  const byLogin = new Map();
  (payload.technicians || []).forEach((item) => {
    if (item.login) byLogin.set(String(item.login).trim().toUpperCase(), item);
  });
  return { payload, byLogin };
}

export function applyTechnicianNames(snapshot, directory) {
  const resolve = (row) => {
    const login = String(row.technician_login || row.technician || '').trim().toUpperCase();
    const item = directory.byLogin.get(login);
    const bucket = row.bucket || item?.toa?.bucket || '';
    const city = row.city || item?.toa?.city || '';
    return { ...row, bucket, city, technician_name: item?.name || row.technician_name || login, technician: item?.name || row.technician || login, team: item?.teams?.join(' / ') || row.team || bucket };
  };
  return {
    ...snapshot,
    orders: snapshot.orders.map(resolve),
    timelineActivities: snapshot.timelineActivities.map(resolve),
  };
}

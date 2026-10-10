import postgres from 'postgres';

const STATION_IDS = {
  release: 6,
  cut: 1,
  cnc: 2,
  assembly: 3,
  qc: 4,
};

const SCAN_PATHS = new Set(['/scan', '/release', '/cut', '/cnc', '/assembly', '/qc']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && SCAN_PATHS.has(url.pathname)) {
      return handleScan(request, env, ctx);
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleScan(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const barcode = String(body.barcode || '').trim().toUpperCase();
  const processName = String(body.process || '').trim().toLowerCase();
  const deviceId = String(body.deviceId || 'unknown').slice(0, 64);
  const productionStationId = Object.hasOwn(STATION_IDS, processName)
    ? STATION_IDS[processName]
    : null;

  if (!barcode) {
    return Response.json({ error: 'barcode is required' }, { status: 400 });
  }
  if (barcode.length > 100) {
    return Response.json({ error: 'barcode too long' }, { status: 400 });
  }
  if (!productionStationId) {
    return Response.json({ error: 'a valid production process is required' }, { status: 400 });
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const rows = await sql`
  INSERT INTO barcode_scans (barcode, device_id, production_station_id)
  SELECT ${barcode}::text, ${deviceId}::text, ${productionStationId}::int
  WHERE NOT EXISTS (
    SELECT 1
    FROM barcode_scans
    WHERE barcode = ${barcode}::text
      AND device_id = ${deviceId}::text
      AND production_station_id = ${productionStationId}::int
      AND scanned_at > NOW() - INTERVAL '5 seconds'
  )
  RETURNING id, barcode, device_id, production_station_id, scanned_at
`;

    if (rows.length === 0) {
      return Response.json({ success: true, duplicate: true, barcode });
    }

    return Response.json({ success: true, duplicate: false, scan: rows[0] });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  } finally {
    ctx.waitUntil(sql.end());
  }
}
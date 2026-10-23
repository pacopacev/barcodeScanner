import postgres from 'postgres';

const STATION_IDS = {
  release: 6,
  cut: 1,
  cnc: 2,
  assembly: 3,
  qc: 4,
};

const STATION_SEQUENCE = ['release', 'cut', 'cnc', 'assembly', 'qc'];
const SCAN_PATHS = new Set(['/scan', '/release', '/cut', '/cnc', '/assembly', '/qc']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && SCAN_PATHS.has(url.pathname)) {
      return handleScan(request, env, ctx);
    }

    if (url.pathname === '/api/scans' && request.method === 'GET') {
      return handleBatchScans(request, env, ctx);
    }

    const deleteScanMatch = url.pathname.match(/^\/api\/scans\/(\d+)$/);
    if (deleteScanMatch && request.method === 'DELETE') {
      return handleDeleteScan(deleteScanMatch[1], env, ctx);
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
    const stationIndex = STATION_SEQUENCE.indexOf(processName);
    if (stationIndex > 0) {
      const previousStationId = STATION_IDS[STATION_SEQUENCE[stationIndex - 1]];
      const [previousScan] = await sql`
        SELECT EXISTS (
          SELECT 1
          FROM barcode_scans
          WHERE barcode = ${barcode}::text
            AND production_station_id = ${previousStationId}::int
        ) AS scanned
      `;

      if (!previousScan.scanned) {
        return Response.json(
          { error: `Scan ${STATION_SEQUENCE[stationIndex - 1]} before ${processName}` },
          { status: 409 },
        );
      }
    }

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

async function handleBatchScans(request, env, ctx) {
  const rawBatchIds = new URL(request.url).searchParams.get('batchIds') || '';
  const batchIds = rawBatchIds
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(value => Number(value));

  if (batchIds.length === 0 || batchIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return Response.json({ error: 'Enter one or more positive batch IDs' }, { status: 400 });
  }

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const scans = await sql`
      SELECT
        jbs.batch_id,
        jbs.job_order_number,
        bs.id::text AS scan_id,
        bs.barcode,
        bs.device_id,
        bs.production_station_id,
        bs.scanned_at
      FROM jo_barcode_status AS jbs
      JOIN barcode_scans AS bs ON bs.barcode = jbs.job_order_number
      WHERE jbs.batch_id = ANY(${batchIds}::int[])
      ORDER BY bs.scanned_at DESC
    `;

    return Response.json({ scans });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Could not load scans' }, { status: 500 });
  } finally {
    ctx.waitUntil(sql.end());
  }
}

async function handleDeleteScan(scanId, env, ctx) {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const deleted = await sql`
      DELETE FROM barcode_scans
      WHERE id = ${scanId}::bigint
      RETURNING id::text AS scan_id
    `;

    if (deleted.length === 0) {
      return Response.json({ error: 'Scan not found' }, { status: 404 });
    }

    return Response.json({ success: true, scanId: deleted[0].scan_id });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Could not delete scan' }, { status: 500 });
  } finally {
    ctx.waitUntil(sql.end());
  }
}
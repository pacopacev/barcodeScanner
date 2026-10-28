import postgres from 'postgres';

// Keep these database station IDs aligned with the production workflow and scan-status views.
const STATION_IDS = {
  release: 6,
  cut: 1,
  cnc: 2,
  assembly: 3,
  qc: 4,
};

const STATION_SEQUENCE = ['release', 'cut', 'cnc', 'assembly', 'qc'];
const SCAN_PATHS = new Set(['/scan', '/release', '/cut', '/cnc', '/assembly', '/qc']);

// Batch IDs and job order numbers share one input; their lengths determine the search mode.
export function parseSearchTerms(value) {
  const tokens = String(value ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length || tokens.some(token => !/^\d+$/.test(token))) {
    return null;
  }

  const values = [...new Set(tokens.map(token => Number(token)))];
  if (!values.length || values.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return null;
  }

  if (values.length === 1 && String(values[0]).length === 6) {
    return { mode: 'jon', values };
  }

  if (values.every(id => String(id).length <= 5)) {
    return { mode: 'batch', values };
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Keep barcode writes, scan searches, deletion, and static assets on one Worker entry point.
    if (request.method === 'POST' && SCAN_PATHS.has(url.pathname)) {
      return handleScan(request, env, ctx);
    }

    if (url.pathname === '/api/scans' && request.method === 'GET') {
      return handleBatchScans(request, env, ctx);
    }
    if (url.pathname === '/api/scans_by_jon' && request.method === 'GET') {
      return handleBatchScansByJon(request, env, ctx);
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

// Validate a scan, enforce its preceding station, then insert it idempotently.
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

  console.log('scan-debug', JSON.stringify({
    event: 'request',
    path: new URL(request.url).pathname,
    barcode,
    process: processName,
    stationId: productionStationId,
  }));

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });



  try {
    const [existingScan] = await sql`
      SELECT EXISTS (
        SELECT 1
        FROM barcode_scans
        WHERE barcode = ${barcode}::text
          AND production_station_id = ${productionStationId}::int
      ) AS scanned
    `;

    console.log('scan-debug', JSON.stringify({
      event: 'duplicate-check',
      barcode,
      process: processName,
      stationId: productionStationId,
      found: existingScan.scanned,
    }));

    if (existingScan.scanned) {
      return Response.json({ success: true, duplicate: true, barcode });
    }

    const stationIndex = STATION_SEQUENCE.indexOf(processName);
    if (stationIndex > 0) {
      const previousStationId = STATION_IDS[STATION_SEQUENCE[stationIndex - 1]];
      // NOW() prevents Hyperdrive from caching this read, which must see the latest prior scan.
      const [previousScan] = await sql`
        SELECT EXISTS (
          SELECT 1
          FROM barcode_scans
          WHERE barcode = ${barcode}::text
            AND production_station_id = ${previousStationId}::int
            AND scanned_at <= NOW()
        ) AS scanned
      `;

      console.log('scan-debug', JSON.stringify({
        event: 'sequence-check',
        barcode,
        process: processName,
        expectedPreviousProcess: STATION_SEQUENCE[stationIndex - 1],
        expectedPreviousStationId: previousStationId,
        found: previousScan.scanned,
      }));

      if (!previousScan.scanned) {
        console.warn('scan-debug', JSON.stringify({
          event: 'sequence-rejected',
          barcode,
          process: processName,
          expectedPreviousProcess: STATION_SEQUENCE[stationIndex - 1],
          expectedPreviousStationId: previousStationId,
        }));
        return Response.json(
          { error: `Scan ${STATION_SEQUENCE[stationIndex - 1]} before ${processName}` },
          { status: 409 },
        );
      }
    }

//     const rows = await sql`
//   INSERT INTO barcode_scans (barcode, device_id, production_station_id)
//   SELECT ${barcode}::text, ${deviceId}::text, ${productionStationId}::int
//   WHERE NOT EXISTS (
//     SELECT 1
//     FROM barcode_scans
//     WHERE barcode = ${barcode}::text
//       AND device_id = ${deviceId}::text
//       AND production_station_id = ${productionStationId}::int
//       AND scanned_at > NOW() - INTERVAL '5 seconds'
//   )
//   RETURNING id, barcode, device_id, production_station_id, scanned_at
// `;


const rows = await sql`
  INSERT INTO barcode_scans (barcode, device_id, production_station_id)
VALUES (${barcode}::text, ${deviceId}::text, ${productionStationId}::int)
ON CONFLICT (barcode, production_station_id) DO NOTHING
RETURNING id, barcode, device_id, production_station_id, scanned_at
`;

    console.log('scan-debug', JSON.stringify({
      event: 'insert-result',
      barcode,
      process: processName,
      stationId: productionStationId,
      inserted: rows.length > 0,
    }));

// console.log(rows.length);

    if (rows.length === 0) {
      console.log(rows);
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

// Return every matching scan with operator and station details for batch searches.
async function handleBatchScans(request, env, ctx) {
  const rawBatchIds = new URL(request.url).searchParams.get('batchIds') || '';
  const parsed = parseSearchTerms(rawBatchIds);

  if (!parsed || parsed.mode !== 'batch') {
    return Response.json({ error: 'Enter one or more positive batch IDs' }, { status: 400 });
  }

  const batchIds = parsed.values;

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
        u.first_name,
        bs.production_station_id,
        bs.scanned_at
      FROM jo_barcode_status AS jbs
      JOIN barcode_scans AS bs ON bs.barcode = jbs.job_order_number
      LEFT JOIN users as u ON u.device_id = bs.device_id
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

// Search by a single six-digit job order number rather than one or more batch IDs.
async function handleBatchScansByJon(request, env, ctx) {
  const rawJon = new URL(request.url).searchParams.get('jon') || '';
  const parsed = parseSearchTerms(rawJon);

  if (!parsed || parsed.mode !== 'jon' || parsed.values.length !== 1) {
    return Response.json({ error: 'Enter exactly one valid job order number' }, { status: 400 });
  }

  const jon = parsed.values[0];
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
        u.first_name,
        bs.production_station_id,
        bs.scanned_at
      FROM jo_barcode_status AS jbs
      JOIN barcode_scans AS bs ON bs.barcode = jbs.job_order_number
      LEFT JOIN users as u ON u.device_id = bs.device_id
      WHERE jbs.job_order_number = ${jon}
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


// Delete one scan record by its database ID; the client refreshes its current search afterward.
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
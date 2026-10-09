import postgres from 'postgres';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/scan' && request.method === 'POST') {
      return handleScan(request, env);
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    // Serve static files from /public
    return env.ASSETS.fetch(request);
  },
};

async function handleScan(request, env) {
  try {
    const body = await request.json();

    const barcode = String(body.barcode || '').trim().toUpperCase();
    const deviceId = String(body.deviceId || 'unknown').slice(0, 64);

    if (!barcode) {
      return Response.json({ error: 'barcode is required' }, { status: 400 });
    }

    if (barcode.length > 100) {
      return Response.json({ error: 'barcode too long' }, { status: 400 });
    }

    const sql = postgres(env.HYPERDRIVE.connectionString, {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
    });

    // Server-side duplicate prevention:
    // ignore the same barcode from the same device within 5 seconds.
    const rows = await sql`
      INSERT INTO barcode_scans (barcode, device_id)
      SELECT ${barcode}, ${deviceId}
      WHERE NOT EXISTS (
        SELECT 1
        FROM barcode_scans
        WHERE barcode = ${barcode}
          AND device_id = ${deviceId}
          AND scanned_at > NOW() - INTERVAL '5 seconds'
      )
      RETURNING id, barcode, device_id, scanned_at
    `;

    if (rows.length === 0) {
      return Response.json({
        success: true,
        duplicate: true,
        barcode,
      });
    }

    return Response.json({
      success: true,
      duplicate: false,
      scan: rows[0],
    });
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: err.message || 'Server error' },
      { status: 500 }
    );
  }
}
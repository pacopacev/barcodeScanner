-- Scratch queries for inspecting production and station status views; kept commented for manual use.
-- SELECT jo.id AS job_order_id,
--     jo.job_order_number,
--     p.ma_number,
--     p.name,
--     p.type_id,
--     jo.batch_id,
--     jo.quantity,
--     COALESCE(max(
--         CASE
--             WHEN bs.production_station_id  = 1 THEN 'passed'::text
--             ELSE NULL::text
--         END), 'not passed'::text) AS cut,
--     COALESCE(max(
--         CASE
--             WHEN bs.production_station_id = 2 THEN 'passed'::text
--             ELSE NULL::text
--         END), 'not passed'::text) AS cnc,
--     COALESCE(max(
--         CASE
--             WHEN bs.production_station_id = 3 THEN 'passed'::text
--             ELSE NULL::text
--         END), 'not passed'::text) AS assembly,
--     COALESCE(max(
--         CASE
--             WHEN bs.production_station_id = 4 THEN 'passed'::text
--             ELSE NULL::text
--         END), 'not passed'::text) AS qc
--    FROM job_orders jo
--      LEFT JOIN barcode_scans bs ON bs.barcode = jo.job_order_number
--      LEFT JOIN products p ON p.id = jo.product_id
--   GROUP BY jo.id, jo.job_order_number, p.ma_number, p.name, p.type_id, jo.batch_id, jo.quantity;


--   SELECT * FROM job_station_status WHERE batch_id IN (35)

--   SELECT * FROM jo_barcode_status WHERE batch_id IN (60,61)


--   SELECT j.job_order_number, j.ma_number, j."name",
--          j.type_id, j.batch_id, j.quantity, j."release",
--          j.cut, j.cnc, j.assembly, s.qc AS qc_desktop
--   FROM jo_barcode_status j
--   LEFT JOIN job_station_status s ON s.job_order_id = j.job_order_id
--   WHERE j.batch_id IN (60, 61)
-- `;
  
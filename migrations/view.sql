SELECT jo.id AS job_order_id,
    jo.job_order_number,
    p.ma_number,
    p.name,
    p.type_id,
    jo.batch_id,
    jo.quantity,
    COALESCE(max(
        CASE
            WHEN bs.production_station_id  = 1 THEN 'passed'::text
            ELSE NULL::text
        END), 'not passed'::text) AS cut,
    COALESCE(max(
        CASE
            WHEN bs.production_station_id = 2 THEN 'passed'::text
            ELSE NULL::text
        END), 'not passed'::text) AS cnc,
    COALESCE(max(
        CASE
            WHEN bs.production_station_id = 3 THEN 'passed'::text
            ELSE NULL::text
        END), 'not passed'::text) AS assembly,
    COALESCE(max(
        CASE
            WHEN bs.production_station_id = 4 THEN 'passed'::text
            ELSE NULL::text
        END), 'not passed'::text) AS qc
   FROM job_orders jo
     LEFT JOIN barcode_scans bs ON bs.barcode = jo.job_order_number
     LEFT JOIN products p ON p.id = jo.product_id
  GROUP BY jo.id, jo.job_order_number, p.ma_number, p.name, p.type_id, jo.batch_id, jo.quantity;


  SELECT * FROM job_station_status WHERE batch_id IN (35)
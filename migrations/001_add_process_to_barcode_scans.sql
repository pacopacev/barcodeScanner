-- Preserve the process label on existing scan tables; new writes also use the station ID column.
ALTER TABLE barcode_scans
ADD COLUMN IF NOT EXISTS process TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS telemetry_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  technician_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','failed')),
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 20,
  collector_id TEXT,
  lease_expires_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_queue_status
  ON telemetry_queue(status, lease_expires_at, attempts, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_queue_expiry
  ON telemetry_queue(expires_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_queue_device
  ON telemetry_queue(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lookup_jobs (
  id TEXT PRIMARY KEY,
  contract TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'DOMINIUM_CONTRACT_LOOKUP',
  status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL DEFAULT 'dominium-primary',
  collector_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  lease_expires_at TEXT,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lookup_jobs_queue
  ON lookup_jobs(status, lease_expires_at, attempts, created_at);

CREATE INDEX IF NOT EXISTS idx_lookup_jobs_contract
  ON lookup_jobs(contract, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lookup_jobs_expiry
  ON lookup_jobs(expires_at);


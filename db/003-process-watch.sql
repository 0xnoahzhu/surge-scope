CREATE TABLE IF NOT EXISTS process_monitors (
 id uuid PRIMARY KEY, name text NOT NULL, process_names text[] NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS monitor_targets (
 monitor_id uuid NOT NULL REFERENCES process_monitors(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('domain','target_ip','endpoint_ip')),
 target text NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(monitor_id,kind,target)
);
CREATE TABLE IF NOT EXISTS monitor_alerts (
 id uuid PRIMARY KEY, monitor_id uuid NOT NULL REFERENCES process_monitors(id) ON DELETE CASCADE,
 kind text NOT NULL, target text NOT NULL, process_path text NOT NULL,
 source_id uuid NOT NULL REFERENCES collector_sources(id), request_key text NOT NULL,
 observed_at timestamptz NOT NULL, read_at timestamptz, notified_at timestamptz,
 UNIQUE(monitor_id,kind,target)
);
CREATE INDEX IF NOT EXISTS monitor_alerts_time_idx ON monitor_alerts(observed_at DESC,id);
CREATE INDEX IF NOT EXISTS monitor_alerts_unread_idx ON monitor_alerts(observed_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS monitor_alerts_notify_idx ON monitor_alerts(observed_at) WHERE notified_at IS NULL;

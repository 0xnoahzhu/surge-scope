CREATE TABLE IF NOT EXISTS collector_sources (
 id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS request_events (
 event_id uuid PRIMARY KEY,
 source_id uuid NOT NULL REFERENCES collector_sources(id),
 request_key text,
 observed_at timestamptz NOT NULL,
 event_type text NOT NULL,
 payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS request_events_request_idx ON request_events(source_id,request_key,observed_at DESC);
CREATE INDEX IF NOT EXISTS request_events_time_idx ON request_events(observed_at);
CREATE TABLE IF NOT EXISTS requests (
 source_id uuid NOT NULL REFERENCES collector_sources(id),
 request_key text NOT NULL,
 surge_id bigint NOT NULL,
 engine_identifier bigint,
 started_at timestamptz,
 updated_at timestamptz NOT NULL,
 raw jsonb NOT NULL,
 host text GENERATED ALWAYS AS (raw->>'remoteHost') STORED,
 url text GENERATED ALWAYS AS (raw->>'URL') STORED,
 method text GENERATED ALWAYS AS (raw->>'method') STORED,
 policy_name text GENERATED ALWAYS AS (raw->>'policyName') STORED,
 rule text GENERATED ALWAYS AS (raw->>'rule') STORED,
 process_path text GENERATED ALWAYS AS (raw->>'processPath') STORED,
 device_name text GENERATED ALWAYS AS (raw->>'deviceName') STORED,
 source_address text GENERATED ALWAYS AS (raw->>'sourceAddress') STORED,
 status text GENERATED ALWAYS AS (raw->>'status') STORED,
 completed boolean GENERATED ALWAYS AS ((raw->>'completed')::boolean) STORED,
 failed boolean GENERATED ALWAYS AS ((raw->>'failed')::boolean) STORED,
 rejected boolean GENERATED ALWAYS AS ((raw->>'rejected')::boolean) STORED,
 in_bytes bigint GENERATED ALWAYS AS (COALESCE((raw->>'inBytes')::bigint,0)) STORED,
 out_bytes bigint GENERATED ALWAYS AS (COALESCE((raw->>'outBytes')::bigint,0)) STORED,
 PRIMARY KEY(source_id,request_key)
);
CREATE INDEX IF NOT EXISTS requests_time_idx ON requests(started_at DESC,request_key);
CREATE INDEX IF NOT EXISTS requests_host_idx ON requests(host,started_at DESC);
CREATE INDEX IF NOT EXISTS requests_policy_idx ON requests(policy_name,started_at DESC);
CREATE INDEX IF NOT EXISTS requests_process_idx ON requests(process_path,started_at DESC);
CREATE INDEX IF NOT EXISTS requests_raw_idx ON requests USING gin(raw jsonb_path_ops);

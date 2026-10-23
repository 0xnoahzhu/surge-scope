ALTER TABLE process_monitors ADD COLUMN match_mode text NOT NULL DEFAULT 'process' CHECK (match_mode IN ('process','application'));
CREATE INDEX requests_applications_idx ON requests USING gin ((raw->'scopeProcess'->'applications'));

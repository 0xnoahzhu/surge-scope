ALTER TABLE requests ALTER COLUMN completed SET EXPRESSION AS (CASE WHEN raw->>'completed' IN ('true','false') THEN (raw->>'completed')::boolean ELSE NULL END);
ALTER TABLE requests ALTER COLUMN failed SET EXPRESSION AS (CASE WHEN raw->>'failed' IN ('true','false') THEN (raw->>'failed')::boolean ELSE NULL END);
ALTER TABLE requests ALTER COLUMN rejected SET EXPRESSION AS (CASE WHEN raw->>'rejected' IN ('true','false') THEN (raw->>'rejected')::boolean ELSE NULL END);
ALTER TABLE requests ALTER COLUMN in_bytes SET EXPRESSION AS (CASE WHEN raw->>'inBytes' ~ '^[0-9]{1,19}$' THEN CASE WHEN (raw->>'inBytes')::numeric <= 9223372036854775807 THEN (raw->>'inBytes')::bigint ELSE 0 END ELSE 0 END);
ALTER TABLE requests ALTER COLUMN out_bytes SET EXPRESSION AS (CASE WHEN raw->>'outBytes' ~ '^[0-9]{1,19}$' THEN CASE WHEN (raw->>'outBytes')::numeric <= 9223372036854775807 THEN (raw->>'outBytes')::bigint ELSE 0 END ELSE 0 END);

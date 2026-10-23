# Data model and reliability

## Sources and events

A collector UUID is created with the local queue and persists across application restarts. Deleting that queue creates a new source.

`request_events` uses a UUID primary key for idempotent replay. Each event stores source, request identity, observation timestamp, type, and unmodified semantic JSON payload. Control frames have no request identity but are still archived.

`requests` has a `(source_id, request_key)` primary key. The request key combines engineIdentifier, id, and startDate rounded to milliseconds, accommodating minor floating-point serialization differences between CLI interfaces. `started_at` converts Unix seconds to a timezone-aware timestamp; `updated_at` records the latest observation time.

Generated columns cover host, URL, method, policy, rule, process path, device, source address, status, completion/failure/rejection, and transferred bytes. B-tree indexes cover time, host, policy, and process; a path-ops GIN index covers raw JSON. Contains searches do not necessarily use these indexes; large deployments may need pg_trgm or dedicated search indexes.

The complete raw object retains ports, local/remote addresses, takeover mode, PID, speeds, completion/setup timestamps, timing records, notes, and future unknown fields. Addresses remain text because observed remoteAddress values may contain annotations such as `(Proxy)`.

## Durable writes

1. Read newline-delimited watch JSON incrementally. Archive malformed lines as parse_error observations.
2. Commit the event and deduplication fingerprint in one local SQLite transaction.
3. Write up to 200 events per PostgreSQL transaction with batch inserts/upserts. Continue promptly while a backlog exists; back off on failures.
4. Acknowledge local entries only after PostgreSQL commits. A crash between commit and acknowledgment replays an already-known event UUID.
5. Merge same-request observations by observation time. Older observations cannot overwrite newer state, and completed records do not regress to active.
6. Unsafe boolean/byte values project to NULL/0 without losing original raw values. Invalid request identity/timestamp observations remain archived without a request projection.

Stopping collection and draining the queue are separate lifecycles. Switching database connections stops the old collector and verifies that its queue is empty before saving the new destination. Failure resumes the previous writer.

## Process Watch

Rules store a display name, literal process-path substrings, and an enabled flag. Matching is case-insensitive OR matching. Domain names are lowercase with ports and trailing dots removed. Direct target IPs and observed endpoint IPs use separate kinds.

Creating a rule seeds all existing matching request targets with a database cursor. An advisory transaction lock serializes baseline creation and target discovery. Newly inserted targets produce alerts in the same transaction as request ingestion. Unique keys prevent repeated alerts across snapshots, batches, retries, and restarts.

Disabling a rule stops discovery for that rule. Re-enabling resumes against its previously persisted target set, so targets first observed during the disabled period can be new when observed again. Native notification attempts are recorded separately from read state. The alert list is authoritative; operating-system notification delivery is not guaranteed.

## CSV

The table, aggregates, and export reuse one parameterized filter builder. Export runs in a repeatable-read transaction with a cursor and bounded fetch size. Every matching request is included regardless of the UI page. A temporary file is renamed only after successful completion; failed exports remove the temporary file. The raw JSON column preserves every field in addition to common flattened columns. Formula-like strings are prefixed with an apostrophe before CSV quoting.

## Practical boundaries

This is an observation history, not a complete internal log. Missing CLI output, app downtime, finite recent-record retention, disk exhaustion, or inaccessible storage can prevent complete capture. Last-observed active records can remain active after their final state falls outside Surge retention. The app does not invent missing fields or decrypt traffic.

Queries use a 15-second statement timeout. Event/log storage grows indefinitely by default. For large volumes, introduce time partitions, a reviewed retention policy, and pre-aggregated summaries based on measured workload.

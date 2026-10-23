# Application and descendant monitoring

In Process Watch, select **Application and descendants**, choose one or more `.app` bundles, name the monitor, and create it. Previously stored matching requests seed the target baseline. Subsequent new domains and IPs produce the same persistent alerts as process-name monitors.

Use **View requests** on a monitor or **Filter by application** in Requests. Application filtering combines with the other active filters; CSV exports all matching records, with PID, ownership method, application paths, and full JSON. Request details show application ownership and observed ancestry.

## Attribution

The local Surge request fields `pid`, `processPath`, `local`, and `startDate` correlate with a once-per-second `/bin/ps` snapshot of PID, PPID, process start time, and executable path. No command-line arguments or environments are captured. The collector uses a fixed executable and arguments, timeout, bounded output, and no shell.

Direct bundle ownership uses exact absolute `.app` path boundaries, including nested helpers. External children and grandchildren use observed parent chains. The collector checks local origin, executable equality, a fresh snapshot, and process lifetime. Requests newer than the snapshot wait for a subsequent observation. Since `ps` start times have one-second resolution, requests during the ambiguous first lifetime second are not tree-attributed.

Observed ancestry survives reparenting while the collector is running. Evidence is frozen per request once verified and stored as the collector-owned `scopeProcess` JSON object. Database replay preserves first verified evidence, even when later snapshots have less context. This prevents historical ownership changing after an application exits or the collector restarts. The in-memory evidence cache is bounded to 20,000 requests; durable PostgreSQL evidence remains available.

## Limits

This is sampled attribution, not a kernel process-event recorder. Short-lived processes that exit between samples, processes already orphaned before collection starts, independently launched system services, and requests without usable local PID/path metadata may remain unresolved. Remote-device PIDs are never joined to local processes. Bundle-path ownership can still work without process-tree evidence. Historical external-child ownership cannot be reconstructed if no evidence was captured at request time. No claim is made to capture all descendants or all network traffic.

No elevated privileges, extra accounts, or kernel extensions are required. Sampling failure leaves normal request capture running and reports degraded process-tree availability in collector status.

## Storage and migration

Migration `004-application-watch.sql` adds `process_monitors.match_mode` with default `process`, preserving existing rules. Application rules store exact selected bundle paths in `process_names`. Request `raw.scopeProcess` and event `payload.scopeProcess` contain ownership method, application paths, and observed ancestry. Raw Surge fields otherwise remain unchanged. The migration is additive; the collector does not retroactively infer ancestry from today's process tree.

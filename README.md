# Surge Scope

A local traffic observatory built with Electron, React, and strict TypeScript. The application name is **Surge Scope**, the repository/package name is `surge-scope`, and the database name is `surge_scope`.

## Run

Requires macOS, a running Surge instance, Node.js 24+, and PostgreSQL 17+. Validated with Surge 6.10.0 / Controller 25 and PostgreSQL 18.3.

```sh
npm ci
npm run dev
```

Open Settings and enter the PostgreSQL connection URL, absolute Surge CLI path, and snapshot interval. The app validates the connection, applies migrations, encrypts credentials using Electron safeStorage, and starts collection. This machine already has its dedicated `surge_scope` database configured.

```sh
npm run build    # Type-check all source, scripts, and tests; compile the app
npm start        # Run the compiled desktop application
npm run package  # Build release/Surge-Scope-0.2.1-mac-arm64.dmg
```

## Features

- English by default, with a persistent English/Chinese language selector. Chinese translations live exclusively in Unicode-escaped JSON resources. Source code, comments, documentation, and runtime logs are English.
- Dark, light, and system appearance modes.
- Search hosts, URLs, and processes; filter by time range, status, arbitrary raw fields, or multiple process names. Process names use case-insensitive literal substring matching against the full process path; any listed name may match.
- Paginated request records, complete raw JSON, connection logs, and paginated observation history.
- Group traffic by host, policy, process, protocol/method, device, status, or rule.
- Export **all matching records**, not just the displayed page, to CSV through a native Save dialog. Exports include a raw JSON column, use a bounded-memory database cursor, quote multiline values, and neutralize spreadsheet formulas.
- Process Watch rules accept one or more process names. Existing matching records establish a baseline without alerts. Newly observed domains, target IPs, and connection endpoint IPs create persistent alerts and desktop notifications. Each target is alerted only once per rule and kind, including across restarts.
- Native notifications are grouped to limit notification volume. Their delivery depends on macOS notification permissions; the in-app alert list remains the authoritative record. Endpoint IPs are explicitly distinguished because Surge may report the proxy server rather than the website's IP.

## Collection

```text
Surge CLI watch + active/recent
             |
      SQLite WAL durable queue
             |
      PostgreSQL batch transaction
             |-- request history and current state
             |-- process target discovery and alerts
             |
Electron main process <--- restricted IPC <--- React
```

`watch request` reports newly created requests, often before policy selection or final byte counts are available. The app reconciles `dump active` and `dump recent` every two seconds by default.

Every changed observation retains its unknown fields in `request_events.payload`. Unchanged snapshots are deduplicated. `requests.raw` holds the latest merged state; traffic summaries read that table so cumulative bytes are not counted once per snapshot.

The local queue uses SQLite WAL and FULL synchronous writes. PostgreSQL commits precede local acknowledgments, and event UUIDs make retries idempotent. Queued events drain continuously when a backlog exists. Stopping collection leaves the writer active; quitting leaves pending events for the next launch. A process lock prevents the desktop and default headless collectors from using the same queue simultaneously.

## Database

| Table | Purpose |
|---|---|
| `collector_sources` | Persistent collector identity |
| `request_events` | Original observations and control/error frames |
| `requests` | Latest unique request state and indexed generated columns |
| `process_monitors` | Named process-matching rules |
| `monitor_targets` | Persistent per-rule baseline and discovered targets |
| `monitor_alerts` | New-target alerts, read state, notification attempts |
| `schema_migrations` | Applied SQL migrations |

See [data model](docs/data-model.md) and [observed field dictionary](docs/fields.md).

## Verification

```sh
npm test
# Set DATABASE_URL in your shell for PostgreSQL integration tests.
npm test
npm run test:smoke
npm run db:migrate
npm run collect  # Close the desktop application first.
```

Integration tests delete only records belonging to their random test identities. The Electron smoke test verifies real collection, filters, details, grouping, themes, languages, process monitors, CSV export, and a 375px viewport.

The headless entry point accepts `COLLECT_SECONDS` for bounded runs and `SPOOL_PATH` for an explicit independent source. Configuration and queue files are under `~/Library/Application Support/Surge Scope/`. Do not commit or share that directory.

## Limits

- This is an observation archive, not a complete internal Surge log. The local `recent` response contained only 200 records. App downtime, CLI disconnects, and bursts that exceed this retention window may leave gaps or incomplete final states.
- The app saves CLI metadata. It does not enable MitM/HTTP Capture or promise HTTPS request/response bodies. Body-presence flags are not body content.
- Records and alerts are retained indefinitely. There is no automatic retention policy, partition maintenance, background daemon, or auto-updater. Plan disk capacity for long-running capture.
- Process matching uses paths reported by Surge. A rule with an overly broad substring can match unrelated helpers. IP notifications identify observed addresses, not DNS ownership or authoritative destination identity.
- Fields suggested in the filter input come from recent records, but you can type any raw key. Contains searches and ad-hoc aggregates can become expensive on large datasets; queries have a 15-second statement timeout.
- Native macOS notifications require operating-system permission. Alerts are persisted even when notification delivery is unavailable.

## Versions and packaging

Direct dependencies are pinned to the npm `latest` stable versions available at installation, with a committed lockfile. Business code, scripts, and tests are TypeScript; React uses TSX and database migrations use SQL.

Production dependency audit: zero reported vulnerabilities at verification. The latest electron-builder has a build-time transitive `sprintf-js` moderate advisory (GHSA-hp3w-g68c-fv3c), with no published fixed sprintf-js version at verification. The dependency is not included in runtime application dependencies.

The local macOS artifact is ad-hoc signed, without Developer ID signing or notarization, and is intended for local use. Its Info.plist declares the PostgreSQL local-network purpose. Allow Local Network access when macOS asks; if previously denied, review System Settings > Privacy & Security > Local Network. Terminal-launched smoke tests can inherit terminal permissions and are not a substitute for a standalone launch check.

## Sources

- [Surge CLI documentation](https://manual.nssurge.com/tools/cli.html)
- Local `surge-cli help watch`: request watches newly created records.
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [React versions](https://react.dev/versions)

The official CLI page does not publish a complete request JSON schema. The field dictionary is based on actual local samples and is not presented as a stable official contract.

## Application monitoring

Version 0.2.0 adds application and descendant monitors, native multi-application selection, shared application filters for requests and CSV, and request ownership details. See [application monitoring](docs/application-monitoring.md) for attribution rules and sampling limits.

Version 0.2.1 adds monitor deletion with inline confirmation and cancellation. Deletion removes the selected monitor, its alerts, and target baseline, while retaining captured requests.

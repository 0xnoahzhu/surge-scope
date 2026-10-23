import { buildFilter } from "./filters.js";
import { evaluateMonitors, createMonitor } from "./monitoring.js";
import { exportCsv } from "./csv.js";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EventRecord, Filters, QueryResult } from "./types.js";
function mergePayload(
  older: EventRecord["payload"],
  newer: EventRecord["payload"],
) {
  const merged = { ...older, ...newer };
  const rank = (value: unknown) => {
    const method =
      value && typeof value === "object" && "method" in value
        ? value.method
        : null;
    return method === "process_tree" ? 2 : method === "bundle_path" ? 1 : 0;
  };
  if (
    rank(older.scopeProcess) === 2 ||
    rank(older.scopeProcess) > rank(newer.scopeProcess)
  )
    merged.scopeProcess = older.scopeProcess;
  return merged;
}
const groups: Record<string, string> = {
  host: "host",
  policy: "policy_name",
  process: "process_path",
  method: "method",
  device: "device_name",
  status: "status",
  rule: "rule",
};
export class Database {
  readonly pool: pg.Pool;
  private migrationRoot = process.cwd();
  private migrated = false;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
    this.pool.on("error", () => {
      /* A subsequent operation reports connection failure. */
    });
  }
  async migrate(root: string) {
    this.migrationRoot = root;
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(739102611)");
      await c.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const file of [
        "001-initial.sql",
        "002-safe-projections.sql",
        "003-process-watch.sql",
        "004-application-watch.sql",
      ]) {
        if (
          !(
            await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
              file,
            ])
          ).rowCount
        ) {
          await c.query(await readFile(resolve(root, "db", file), "utf8"));
          await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [
            file,
          ]);
        }
      }
      await c.query("COMMIT");
      this.migrated = true;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async insert(events: EventRecord[]) {
    if (!events.length) return;
    if (!this.migrated) await this.migrate(this.migrationRoot);
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const sources = [...new Set(events.map((e) => e.sourceId))];
      await c.query(
        "INSERT INTO collector_sources(id,name) SELECT x,'Local Surge' FROM unnest($1::uuid[]) x ON CONFLICT DO NOTHING",
        [sources],
      );
      const inserted = await c.query(
        `INSERT INTO request_events(event_id,source_id,request_key,observed_at,event_type,payload)
 SELECT event_id,source_id,request_key,observed_at,event_type,payload FROM jsonb_to_recordset($1::jsonb)
 AS x(event_id uuid,source_id uuid,request_key text,observed_at timestamptz,event_type text,payload jsonb)
 ON CONFLICT DO NOTHING RETURNING event_id`,
        [
          JSON.stringify(
            events.map((e) => ({
              event_id: e.eventId,
              source_id: e.sourceId,
              request_key: e.requestKey,
              observed_at: e.observedAt,
              event_type: e.eventType,
              payload: e.payload,
            })),
          ),
        ],
      );
      const ids = new Set(inserted.rows.map((r) => r.event_id));
      const latest = new Map<string, EventRecord>();
      for (const e of events) {
        if (!ids.has(e.eventId) || !e.requestKey) continue;
        const key = e.sourceId + ":" + e.requestKey,
          old = latest.get(key);
        if (old) {
          const newer = e.observedAt >= old.observedAt ? e : old,
            older = newer === e ? old : e;
          latest.set(key, {
            ...newer,
            payload:
              older.payload.completed === true &&
              newer.payload.completed !== true
                ? older.payload
                : mergePayload(older.payload, newer.payload),
          });
        } else latest.set(key, e);
      }
      const projections = [...latest.values()].map((e) => ({
        source_id: e.sourceId,
        request_key: e.requestKey,
        surge_id: e.payload.id,
        engine_identifier:
          typeof e.payload.engineIdentifier === "number" &&
          Number.isSafeInteger(e.payload.engineIdentifier)
            ? e.payload.engineIdentifier
            : null,
        started_at: new Date(Number(e.payload.startDate) * 1000).toISOString(),
        updated_at: e.observedAt,
        raw: e.payload,
      }));
      if (projections.length)
        await c.query(
          `INSERT INTO requests(source_id,request_key,surge_id,engine_identifier,started_at,updated_at,raw)
 SELECT source_id,request_key,surge_id,engine_identifier,started_at,updated_at,raw FROM jsonb_to_recordset($1::jsonb)
 AS x(source_id uuid,request_key text,surge_id bigint,engine_identifier bigint,started_at timestamptz,updated_at timestamptz,raw jsonb)
 ON CONFLICT(source_id,request_key) DO UPDATE SET
 raw=CASE WHEN requests.completed AND EXCLUDED.raw->>'completed' IS DISTINCT FROM 'true' THEN requests.raw ELSE (requests.raw || EXCLUDED.raw) || CASE
 WHEN requests.raw->'scopeProcess'->>'method' = 'process_tree' OR (CASE requests.raw->'scopeProcess'->>'method' WHEN 'process_tree' THEN 2 WHEN 'bundle_path' THEN 1 ELSE 0 END) >
      (CASE EXCLUDED.raw->'scopeProcess'->>'method' WHEN 'process_tree' THEN 2 WHEN 'bundle_path' THEN 1 ELSE 0 END)
 THEN jsonb_build_object('scopeProcess', requests.raw->'scopeProcess') ELSE '{}'::jsonb END END,
 updated_at=GREATEST(requests.updated_at,EXCLUDED.updated_at)
 WHERE EXCLUDED.updated_at>=requests.updated_at`,
          [JSON.stringify(projections)],
        );
      await evaluateMonitors(
        c,
        events.filter((e) => ids.has(e.eventId)),
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async query(f: Filters): Promise<QueryResult> {
    const { values, clause } = buildFilter(f);
    const group = groups[f.groupBy ?? "host"] ?? "host";
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const summary = (
        await c.query(
          `SELECT count(*)::text AS count,COALESCE(sum(in_bytes),0)::text AS download,COALESCE(sum(out_bytes),0)::text AS upload,count(*) FILTER(WHERE failed OR rejected)::text AS failed FROM requests${clause}`,
          values,
        )
      ).rows[0];
      const rows = (
        await c.query(
          `SELECT * FROM requests${clause} ORDER BY started_at DESC,source_id,request_key LIMIT 100 OFFSET $${values.length + 1}`,
          [...values, Math.max(0, f.page ?? 0) * 100],
        )
      ).rows;
      const grouped = (
        await c.query(
          `SELECT COALESCE(${group},'Unknown') AS label,count(*)::text AS count,sum(in_bytes)::text AS download,sum(out_bytes)::text AS upload FROM requests${clause} GROUP BY ${group} ORDER BY count(*) DESC LIMIT 30`,
          values,
        )
      ).rows;
      const fields = (
        await c.query(
          "SELECT DISTINCT jsonb_object_keys(raw) AS field FROM (SELECT raw FROM requests ORDER BY started_at DESC LIMIT 1000) s ORDER BY field",
        )
      ).rows.map((r) => r.field as string);
      await c.query("COMMIT");
      return {
        rows,
        total: Number(summary.count),
        summary,
        groups: grouped,
        fields,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async events(sourceId: string, requestKey: string, page: number) {
    return (
      await this.pool.query(
        "SELECT event_id,observed_at,event_type,payload FROM request_events WHERE source_id=$1 AND request_key=$2 ORDER BY observed_at DESC,event_id LIMIT 50 OFFSET $3",
        [sourceId, requestKey, page * 50],
      )
    ).rows;
  }
  async monitors(page: number) {
    const monitors = (
      await this.pool.query(
        "SELECT m.*, (SELECT count(*)::text FROM monitor_targets t WHERE t.monitor_id=m.id) AS target_count FROM process_monitors m ORDER BY created_at DESC",
      )
    ).rows;
    const alerts = (
      await this.pool.query(
        "SELECT a.*,m.name AS monitor_name FROM monitor_alerts a JOIN process_monitors m ON m.id=a.monitor_id ORDER BY observed_at DESC,a.id LIMIT 50 OFFSET $1",
        [page * 50],
      )
    ).rows;
    const unread = Number(
      (
        await this.pool.query(
          "SELECT count(*) FROM monitor_alerts WHERE read_at IS NULL",
        )
      ).rows[0].count,
    );
    return { monitors, alerts, unread };
  }
  async createMonitor(
    name: string,
    names: string[],
    mode: "process" | "application" = "process",
  ) {
    const c = await this.pool.connect();
    try {
      await createMonitor(c, name, names, mode);
    } finally {
      c.release();
    }
  }
  async deleteMonitor(id: string) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(739102612)");
      await c.query("DELETE FROM process_monitors WHERE id=$1", [id]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async toggleMonitor(id: string, enabled: boolean) {
    await this.pool.query(
      "UPDATE process_monitors SET enabled=$2 WHERE id=$1",
      [id, enabled],
    );
  }
  async readAlerts() {
    await this.pool.query(
      "UPDATE monitor_alerts SET read_at=now() WHERE read_at IS NULL",
    );
  }
  async claimNotifications() {
    return (
      await this.pool.query(
        `UPDATE monitor_alerts SET notified_at=now() WHERE id IN (SELECT id FROM monitor_alerts WHERE notified_at IS NULL ORDER BY observed_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING target,kind,monitor_id`,
      )
    ).rows;
  }
  exportCsv(f: Filters, path: string) {
    return exportCsv(this.pool, f, path);
  }
  close() {
    return this.pool.end();
  }
}

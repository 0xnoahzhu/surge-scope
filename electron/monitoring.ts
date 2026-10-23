import { matchesApplications } from "./process-tree.js";
import { applicationPredicate } from "./filters.js";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { EventRecord, Payload, ProcessMonitor } from "./types.js";
export interface Target {
  kind: "domain" | "target_ip" | "endpoint_ip";
  target: string;
}
export function matchesProcess(path: unknown, names: string[]): boolean {
  return (
    typeof path === "string" &&
    names.some((name) => path.toLowerCase().includes(name.toLowerCase()))
  );
}
function host(value: string): string | null {
  const text = value.trim();
  if (isIP(text)) return text.toLowerCase();
  try {
    const hostname = new URL(
      text.includes("://") ? text : "https://" + text,
    ).hostname
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "")
      .toLowerCase();
    return hostname || null;
  } catch {
    return null;
  }
}
export function targetsFromPayload(p: Payload): Target[] {
  const result: Target[] = [];
  for (const value of [p.remoteHost, p.URL])
    if (typeof value === "string") {
      const target = host(value);
      if (target)
        result.push({ kind: isIP(target) ? "target_ip" : "domain", target });
    }
  if (typeof p.remoteAddress === "string") {
    const clean = p.remoteAddress.replace(/\s*\([^)]*\)\s*$/, "");
    const target = host(clean);
    if (target && isIP(target)) result.push({ kind: "endpoint_ip", target });
  }
  return [...new Map(result.map((t) => [t.kind + ":" + t.target, t])).values()];
}
export async function evaluateMonitors(c: PoolClient, events: EventRecord[]) {
  // Serialize baseline creation with discovery to avoid a baseline/alert race.
  await c.query("SELECT pg_advisory_xact_lock(739102612)");
  const monitors = (
    await c.query("SELECT * FROM process_monitors WHERE enabled")
  ).rows as ProcessMonitor[];
  if (!monitors.length) return;
  const observations = new Map<
    string,
    {
      monitor_id: string;
      kind: string;
      target: string;
      process_path: string;
      source_id: string;
      request_key: string;
      observed_at: string;
    }
  >();
  for (const e of events) {
    if (!e.requestKey) continue;
    for (const m of monitors) {
      if (
        !(m.match_mode === "application"
          ? matchesApplications(e.payload, m.process_names)
          : matchesProcess(e.payload.processPath, m.process_names))
      )
        continue;
      for (const target of targetsFromPayload(e.payload)) {
        const key = m.id + target.kind + target.target;
        if (!observations.has(key))
          observations.set(key, {
            monitor_id: m.id,
            ...target,
            process_path: String(e.payload.processPath),
            source_id: e.sourceId,
            request_key: e.requestKey,
            observed_at: e.observedAt,
          });
      }
    }
  }
  const values = [...observations.values()];
  if (!values.length) return;
  const added = await c.query(
    `INSERT INTO monitor_targets(monitor_id,kind,target,first_seen_at)
 SELECT monitor_id,kind,target,observed_at FROM jsonb_to_recordset($1::jsonb) AS x(monitor_id uuid,kind text,target text,observed_at timestamptz)
 ON CONFLICT DO NOTHING RETURNING monitor_id,kind,target`,
    [JSON.stringify(values)],
  );
  const keys = new Set(added.rows.map((r) => r.monitor_id + r.kind + r.target));
  const alerts = values
    .filter((r) => keys.has(r.monitor_id + r.kind + r.target))
    .map((r) => ({ ...r, id: randomUUID() }));
  if (alerts.length)
    await c.query(
      `INSERT INTO monitor_alerts(id,monitor_id,kind,target,process_path,source_id,request_key,observed_at)
 SELECT id,monitor_id,kind,target,process_path,source_id,request_key,observed_at FROM jsonb_to_recordset($1::jsonb)
 AS x(id uuid,monitor_id uuid,kind text,target text,process_path text,source_id uuid,request_key text,observed_at timestamptz)
 ON CONFLICT DO NOTHING`,
      [JSON.stringify(alerts)],
    );
}
export async function createMonitor(
  c: PoolClient,
  name: string,
  processNames: string[],
  mode: "process" | "application" = "process",
) {
  await c.query("BEGIN");
  try {
    await c.query("SELECT pg_advisory_xact_lock(739102612)");
    const id = randomUUID();
    await c.query(
      "INSERT INTO process_monitors(id,name,process_names,match_mode) VALUES($1,$2,$3,$4)",
      [id, name, processNames, mode],
    );
    // A transaction cursor bounds memory while seeding all previously observed targets.
    await c.query(
      `DECLARE baseline NO SCROLL CURSOR FOR SELECT raw FROM requests WHERE ${mode === "application" ? applicationPredicate("$1") : "EXISTS (SELECT 1 FROM unnest($1::text[]) n WHERE strpos(lower(process_path),lower(n))>0)"}`,
      [processNames],
    );
    while (true) {
      const rows = (await c.query("FETCH 1000 FROM baseline")).rows;
      if (!rows.length) break;
      const targets = [
        ...new Map(
          rows
            .flatMap((r) => targetsFromPayload(r.raw as Payload))
            .map((t) => [t.kind + ":" + t.target, t]),
        ).values(),
      ];
      if (targets.length)
        await c.query(
          "INSERT INTO monitor_targets(monitor_id,kind,target) SELECT $1,kind,target FROM jsonb_to_recordset($2::jsonb) AS x(kind text,target text) ON CONFLICT DO NOTHING",
          [id, JSON.stringify(targets)],
        );
    }
    await c.query("CLOSE baseline");
    await c.query("COMMIT");
    return id;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

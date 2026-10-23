import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Payload, Json } from "./types.js";
import { requestKey } from "./normalize.js";
const exec = promisify(execFile);
export interface ProcessIdentity {
  pid: number;
  ppid: number;
  started: number;
  path: string;
}
export function applicationPaths(path: unknown): string[] {
  if (typeof path !== "string" || !path.startsWith("/")) return [];
  const result: string[] = [];
  for (const match of path.matchAll(/\.app(?=\/|$)/g))
    result.push(path.slice(0, match.index! + 4));
  return result;
}
export function parseProcesses(text: string): ProcessIdentity[] {
  const rows: ProcessIdentity[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/,
    );
    if (!m) continue;
    const started = Date.parse(m[3] + " UTC");
    if (Number.isFinite(started))
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        started,
        path: m[4].trim(),
      });
  }
  return rows;
}
interface Tracked {
  identity: ProcessIdentity;
  chain: ProcessIdentity[];
}
export class ProcessTree {
  private rows = new Map<number, Tracked>();
  private sampledAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  private running = false;
  private evidence = new Map<string, Json>();
  error: string | null = null;
  update(input: ProcessIdentity[], now = Date.now()) {
    const current = new Map(input.map((p) => [p.pid, p]));
    const next = new Map<number, Tracked>();
    const resolve = (
      p: ProcessIdentity,
      visited = new Set<number>(),
    ): Tracked => {
      const ready = next.get(p.pid);
      if (ready) return ready;
      if (visited.has(p.pid) || visited.size >= 64)
        return { identity: p, chain: [] };
      visited.add(p.pid);
      const chain: ProcessIdentity[] = [];
      const parent = current.get(p.ppid);
      if (
        parent &&
        parent.pid > 1 &&
        !visited.has(parent.pid) &&
        parent.started <= p.started
      )
        chain.push(parent, ...resolve(parent, new Set(visited)).chain);
      const old = this.rows.get(p.pid);
      // Launch ancestry remains valid after reparenting for the same process lifetime.
      if (
        old &&
        old.identity.started === p.started &&
        old.identity.path === p.path
      )
        chain.push(...old.chain);
      const unique = [
        ...new Map(
          chain
            .filter((x) => x.pid !== p.pid)
            .map((x) => [x.pid + ":" + x.started, x]),
        ).values(),
      ].slice(0, 64);
      const result = { identity: p, chain: unique };
      next.set(p.pid, result);
      return result;
    };
    for (const p of input) resolve(p);
    this.rows = next;
    this.sampledAt = now;
    this.error = null;
  }
  async refresh() {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const snapshotStarted = Date.now();
        const { stdout } = await exec(
          "/bin/ps",
          ["-axo", "pid=,ppid=,lstart=,comm="],
          {
            env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
            timeout: 3000,
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        const rows = parseProcesses(stdout);
        if (!rows.length) throw new Error("Empty process snapshot");
        this.update(rows, snapshotStarted);
      } catch {
        this.error =
          "Process tree unavailable; external child attribution is limited.";
      }
    })();
    try {
      await this.pending;
    } finally {
      this.pending = null;
    }
  }
  async start() {
    if (this.running) return;
    this.running = true;
    await this.refresh();
    const tick = async () => {
      if (!this.running) return;
      await this.refresh();
      if (this.running) this.timer = setTimeout(() => void tick(), 1000);
    };
    if (this.running) this.timer = setTimeout(() => void tick(), 1000);
  }
  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.pending;
    this.rows.clear();
    this.sampledAt = 0;
  }
  enrich(payload: Payload, now = Date.now()): Payload {
    const key = requestKey(payload);
    if (!key) return payload;
    const cached = this.evidence.get(key);
    if (cached) return { ...payload, scopeProcess: cached };
    const bundleApps =
      payload.local === true ? applicationPaths(payload.processPath) : [];
    const process =
      typeof payload.pid === "number" ? this.rows.get(payload.pid) : undefined;
    const start = Number(payload.startDate) * 1000;
    // lstart has one-second precision. Reject the ambiguous first second of a lifetime.
    const verified =
      payload.local === true &&
      process &&
      now - this.sampledAt <= 2500 &&
      process.identity.path === payload.processPath &&
      process.identity.started + 1000 <= start &&
      start <= this.sampledAt;
    const chain = verified ? [process.identity, ...process.chain] : [];
    const applications = [
      ...new Set([
        ...bundleApps,
        ...chain.flatMap((p) => applicationPaths(p.path)),
      ]),
    ];
    const metadata: Json = {
      version: 1,
      method: verified
        ? "process_tree"
        : bundleApps.length
          ? "bundle_path"
          : "unresolved",
      applications,
      ancestry: chain.map((p) => ({
        pid: p.pid,
        ppid: p.ppid,
        startedAt: new Date(p.started).toISOString(),
        path: p.path,
      })),
    };
    // Unresolved requests can gain evidence from a later active/recent snapshot.
    if (verified) {
      this.evidence.set(key, metadata);
      if (this.evidence.size > 20000)
        this.evidence.delete(this.evidence.keys().next().value!);
    }
    return { ...payload, scopeProcess: metadata };
  }
}
export function matchesApplications(p: Payload, paths: string[]): boolean {
  if (p.local !== true) return false;
  const meta = p.scopeProcess;
  const apps =
    meta &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    Array.isArray(meta.applications)
      ? meta.applications.filter((x): x is string => typeof x === "string")
      : [];
  return [...apps, ...applicationPaths(p.processPath)].some((app) =>
    paths.includes(app),
  );
}

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { Payload, RuntimeStatus } from "./types.js";
import { parseLine } from "./normalize.js";
import { Spool } from "./spool.js";
import { Database } from "./database.js";
import { ProcessTree } from "./process-tree.js";
const exec = promisify(execFile);
export class Collector {
  private processTree = new ProcessTree();
  private child: ChildProcess | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private polling: Promise<void> | null = null;
  private running = false;
  private disposed = false;
  private received = 0;
  private written = 0;
  private streamError: string | null = null;
  private pollError: string | null = null;
  private databaseError: string | null = null;
  private lastSync: string | null = null;
  private connected = false;
  constructor(
    readonly spool: Spool,
    private db: Database,
    private cli: string,
    private pollSeconds: number,
  ) {
    this.scheduleFlush();
  }
  status(): RuntimeStatus {
    return {
      running: this.running,
      database: this.connected,
      queued: this.spool.count(),
      received: this.received,
      written: this.written,
      lastError:
        this.databaseError ??
        this.streamError ??
        this.pollError ??
        this.processTree.error,
      lastSync: this.lastSync,
      sourceId: this.spool.sourceId,
    };
  }
  private accept(p: Payload, type: string) {
    if (this.spool.enqueue(this.processTree.enrich(p), type)) this.received++;
  }
  resumeWriting() {
    this.disposed = false;
    if (!this.flushTimer) this.scheduleFlush();
  }
  async start() {
    if (this.running) return;
    this.running = true;
    this.disposed = false;
    await this.processTree.start();
    if (!this.running) return;
    this.watch();
    void this.poll();
    if (!this.flushTimer) this.scheduleFlush();
  }
  private watch() {
    if (!this.running) return;
    const child = spawn(this.cli, ["--raw", "watch", "request"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout! });
    lines.on("line", (line) => {
      try {
        this.accept(parseLine(line), "watch");
        this.streamError = null;
      } catch (e) {
        this.streamError = String(e);
        try {
          this.accept({ line, error: String(e) }, "parse_error");
        } catch {
          void this.stop();
        }
      }
    });
    child.stderr?.on("data", () => {
      this.streamError =
        "Surge CLI wrote to stderr; check that Surge is running.";
    });
    child.on("error", (e) => {
      this.streamError = e.message;
    });
    child.on("close", () => {
      lines.close();
      if (this.child === child) this.child = null;
      if (this.running) {
        this.streamError = "Surge subscription disconnected; retrying";
        this.retryTimer = setTimeout(() => this.watch(), 3000);
      }
    });
  }
  private poll() {
    if (this.polling) return this.polling;
    this.polling = (async () => {
      try {
        for (const kind of ["active", "recent"]) {
          if (!this.running) break;
          const { stdout } = await exec(this.cli, ["--raw", "dump", kind], {
            timeout: 10000,
            maxBuffer: 64 * 1024 * 1024,
          });
          const frame = parseLine(stdout);
          const records = frame.requests;
          if (!Array.isArray(records)) {
            this.accept(frame, "snapshot_control");
            continue;
          }
          for (const r of records)
            if (r && typeof r === "object" && !Array.isArray(r))
              this.accept(r, kind);
        }
        this.pollError = null;
      } catch (e) {
        this.pollError = String(e);
      } finally {
        this.polling = null;
        if (this.running)
          this.pollTimer = setTimeout(
            () => void this.poll(),
            this.pollSeconds * 1000,
          );
      }
    })();
    return this.polling;
  }
  private scheduleFlush() {
    if (this.disposed) return;
    this.flushTimer = setTimeout(
      async () => {
        this.flushTimer = null;
        await this.flush();
        this.scheduleFlush();
      },
      this.connected && this.spool.count() > 0 ? 10 : 1000,
    );
  }
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const batch = this.spool.batch();
      if (!batch.length) return;
      try {
        await this.db.insert(batch.map((r) => r.event));
        this.spool.ack(batch.at(-1)!.seq);
        this.written += batch.length;
        this.connected = true;
        this.lastSync = new Date().toISOString();
        this.databaseError = null;
      } catch {
        this.connected = false;
        this.databaseError =
          "PostgreSQL write failed; events remain in the local queue for retry.";
      }
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }
  async stop() {
    this.running = false;
    for (const t of [this.pollTimer, this.retryTimer]) if (t) clearTimeout(t);
    const child = this.child;
    this.child = null;
    if (child) {
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          resolve();
        }, 1500).unref();
      });
    }
    await this.processTree.stop();
    await this.polling;
    await this.flushing;
    await this.flush();
  }
  async shutdown() {
    await this.stop();
    this.disposed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.flushing;
  }
}

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import type { EventRecord, Payload } from "./types.js";
import { fingerprint, requestKey } from "./normalize.js";
export class Spool {
  private db: DatabaseSync;
  private lockPath: string;
  readonly sourceId: string;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.lockPath = path + ".lock";
    try {
      const fd = openSync(this.lockPath, "wx", 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(readFileSync(this.lockPath, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0)
        throw new Error("Queue lock is invalid; inspect " + this.lockPath);
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw new Error(
          "Another collector is using this queue. Close it before starting.",
        );
      unlinkSync(this.lockPath);
      const fd = openSync(this.lockPath, "wx", 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS seen(key TEXT PRIMARY KEY,hash TEXT NOT NULL);`);
    const old = this.db
      .prepare("SELECT value FROM meta WHERE key='source'")
      .get();
    this.sourceId = old ? String(old.value) : randomUUID();
    this.db
      .prepare("INSERT OR IGNORE INTO meta VALUES('source',?)")
      .run(this.sourceId);
  }
  enqueue(payload: Payload, eventType: string): boolean {
    const key = requestKey(payload),
      hash = fingerprint(payload),
      dedupe = key ? `${eventType}:${key}` : null;
    if (
      dedupe &&
      this.db.prepare("SELECT hash FROM seen WHERE key=?").get(dedupe)?.hash ===
        hash
    )
      return false;
    const event: EventRecord = {
      eventId: randomUUID(),
      sourceId: this.sourceId,
      requestKey: key,
      observedAt: new Date().toISOString(),
      eventType,
      payload,
    };
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("INSERT INTO queue(event) VALUES(?)")
        .run(JSON.stringify(event));
      if (dedupe)
        this.db
          .prepare(
            "INSERT INTO seen VALUES(?,?) ON CONFLICT(key) DO UPDATE SET hash=excluded.hash",
          )
          .run(dedupe, hash);
      // A bounded cache is an optimization; PostgreSQL identity still prevents duplicate requests.
      this.db.exec(
        "DELETE FROM seen WHERE rowid IN (SELECT rowid FROM seen ORDER BY rowid DESC LIMIT -1 OFFSET 100000)",
      );
      this.db.exec("COMMIT");
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  batch() {
    return this.db
      .prepare("SELECT seq,event FROM queue ORDER BY seq LIMIT 200")
      .all()
      .map((r) => ({
        seq: Number(r.seq),
        event: JSON.parse(String(r.event)) as EventRecord,
      }));
  }
  ack(seq: number) {
    this.db.prepare("DELETE FROM queue WHERE seq<=?").run(seq);
  }
  count() {
    return Number(this.db.prepare("SELECT count(*) AS n FROM queue").get()!.n);
  }
  close() {
    this.db.close();
    unlinkSync(this.lockPath);
  }
}

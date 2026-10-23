import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { requestKey, parseLine, fingerprint } from "../electron/normalize.js";
import { Spool } from "../electron/spool.js";
import { Database } from "../electron/database.js";
import { Collector } from "../electron/collector.js";
import type { Payload } from "../electron/types.js";
const sample: Payload = {
  id: 12,
  engineIdentifier: 80,
  startDate: 1792649690.5304151,
  completed: false,
  inBytes: 0,
  outBytes: 0,
  remoteHost: "example.test:443",
  method: "HTTPS",
};
test("same Surge request has stable identity despite floating timestamp serialization", () => {
  assert.equal(
    requestKey(sample),
    requestKey({ ...sample, startDate: 1792649690.530415 }),
  );
  assert.notEqual(
    requestKey(sample),
    requestKey({ ...sample, engineIdentifier: 81 }),
  );
  assert.equal(requestKey({ result: "Event subscribed" }), null);
});
test("raw frames reject invalid shape and canonical hashing ignores property ordering", () => {
  assert.throws(() => parseLine("[]"));
  assert.throws(() => parseLine("broken"));
  assert.equal(
    fingerprint({ a: 1, b: { d: 2, c: 3 } }),
    fingerprint({ b: { c: 3, d: 2 }, a: 1 }),
  );
});
test("durable queue survives restart, dedupes unchanged snapshots, retains changes and unknown fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "scope-test-"));
  try {
    let q = new Spool(join(dir, "q.sqlite"));
    const source = q.sourceId;
    assert.ok(
      q.enqueue({ ...sample, extra: { nested: "preserved" } }, "recent"),
    );
    assert.equal(
      q.enqueue({ ...sample, extra: { nested: "preserved" } }, "recent"),
      false,
    );
    q.close();
    q = new Spool(join(dir, "q.sqlite"));
    assert.equal(q.sourceId, source);
    assert.throws(() => new Spool(join(dir, "q.sqlite")), /Another collector/);
    assert.equal(q.count(), 1);
    q.enqueue({ ...sample, inBytes: 50, completed: true }, "recent");
    assert.equal(q.count(), 2);
    assert.deepEqual(q.batch()[0].event.payload.extra, { nested: "preserved" });
    q.ack(q.batch()[0].seq);
    assert.equal(q.count(), 1);
    q.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("failed database flush retains events then recovers exactly once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scope-retry-"));
  const q = new Spool(join(dir, "q.sqlite"));
  let attempts = 0;
  const db = {
    insert: async () => {
      if (++attempts === 1) throw new Error("offline");
    },
  } as unknown as Database;
  const c = new Collector(q, db, "/not-used", 2);
  try {
    q.enqueue(sample, "watch");
    await c.flush();
    assert.equal(q.count(), 1);
    assert.equal(c.status().database, false);
    await c.flush();
    assert.equal(q.count(), 0);
    assert.equal(c.status().written, 1);
  } finally {
    await c.shutdown();
    q.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "PostgreSQL event replay, completion, filters and aggregates",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = new Database(process.env.DATABASE_URL!);
    const source = randomUUID();
    const key = requestKey(sample)!;
    const event = {
      eventId: randomUUID(),
      sourceId: source,
      requestKey: key,
      observedAt: new Date().toISOString(),
      eventType: "watch",
      payload: { ...sample, remoteHost: source + ".test" },
    };
    try {
      await db.migrate(process.cwd());
      await db.insert([event, event]);
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*) FROM request_events WHERE source_id=$1",
            [source],
          )
        ).rows[0].count,
        "1",
      );
      await db.insert([
        {
          ...event,
          eventId: randomUUID(),
          observedAt: new Date(Date.now() + 20).toISOString(),
          eventType: "recent",
          payload: {
            ...event.payload,
            completed: true,
            status: "Completed",
            inBytes: 1024,
            outBytes: 512,
            notes: ["done"],
          },
        },
      ]);
      await db.insert([
        {
          ...event,
          eventId: randomUUID(),
          observedAt: new Date(Date.now() + 40).toISOString(),
        },
      ]);
      const result = await db.query({
        field: "remoteHost",
        value: source,
        groupBy: "host",
      });
      assert.equal(result.total, 1);
      assert.equal(result.summary.download, "1024");
      assert.equal(result.rows[0].raw.completed, true);
      assert.deepEqual(result.rows[0].raw.notes, ["done"]);
      assert.equal(
        (await db.query({ field: "x') OR true --", value: source })).total,
        0,
      );
      await db.insert([
        {
          ...event,
          eventId: randomUUID(),
          requestKey: key + "bad",
          payload: {
            ...event.payload,
            id: 13,
            completed: "invalid",
            inBytes: "999999999999999999999999",
            outBytes: { bad: true },
          },
        },
      ]);
      const abnormal = (
        await db.pool.query(
          "SELECT in_bytes,out_bytes,completed,raw FROM requests WHERE source_id=$1 AND request_key=$2",
          [source, key + "bad"],
        )
      ).rows[0];
      assert.equal(abnormal.in_bytes, "0");
      assert.equal(abnormal.completed, null);
      assert.deepEqual(abnormal.raw.outBytes, { bad: true });
    } finally {
      await db.pool.query("DELETE FROM requests WHERE source_id=$1", [source]);
      await db.pool.query("DELETE FROM request_events WHERE source_id=$1", [
        source,
      ]);
      await db.pool.query("DELETE FROM collector_sources WHERE id=$1", [
        source,
      ]);
      await db.close();
    }
  },
);

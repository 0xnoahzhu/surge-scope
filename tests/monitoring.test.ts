import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { matchesProcess, targetsFromPayload } from "../electron/monitoring.js";
import { csvCell } from "../electron/csv.js";
import { Database } from "../electron/database.js";
import { translate } from "../src/i18n.js";
import type { EventRecord } from "../electron/types.js";
test("process matching is case-insensitive OR matching with literal names", () => {
  assert.equal(
    matchesProcess("/Applications/Brave Browser/Helper", ["telegram", "BRAVE"]),
    true,
  );
  assert.equal(matchesProcess("/Applications/Brave", ["%"]), false);
  assert.equal(matchesProcess(null, ["brave"]), false);
});
test("domain, target IP and proxy endpoint IP are normalized and distinguished", () => {
  assert.deepEqual(
    targetsFromPayload({
      remoteHost: "EXAMPLE.com.:443",
      URL: "https://example.com/path",
      remoteAddress: "1.2.3.4 (Proxy)",
    }),
    [
      { kind: "domain", target: "example.com" },
      { kind: "endpoint_ip", target: "1.2.3.4" },
    ],
  );
  assert.deepEqual(targetsFromPayload({ remoteHost: "[2001:db8::1]:443" }), [
    { kind: "target_ip", target: "2001:db8::1" },
  ]);
});
test("CSV escapes quotes and neutralizes formula cells", () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("  +cmd"), '"\'  +cmd"');
  assert.equal(csvCell(1024), '"1024"');
});
test("English is the unmodified default and Chinese translations are separate", () => {
  assert.equal(translate("Requests", "en"), "Requests");
  assert.notEqual(translate("Requests", "zh"), "Requests");
  assert.equal(translate("unmapped field", "zh"), "unmapped field");
});
test(
  "monitor baseline, persistent dedupe, multiple-process filtering and full CSV export",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = new Database(process.env.DATABASE_URL!);
    const source = randomUUID();
    const name = "Test monitor " + source;
    const processA = "TestProcessA-" + source,
      processB = "TestProcessB-" + source;
    const dir = await mkdtemp(join(tmpdir(), "scope-export-"));
    let monitorId: string | undefined;
    function event(
      id: number,
      domain: string,
      process = processA,
    ): EventRecord {
      return {
        eventId: randomUUID(),
        sourceId: source,
        requestKey: "test:" + id,
        observedAt: new Date().toISOString(),
        eventType: "recent",
        payload: {
          id,
          startDate: Date.now() / 1000,
          engineIdentifier: 1,
          processPath: "/Applications/" + process,
          remoteHost: domain,
          URL: domain,
          completed: true,
          inBytes: 10,
          outBytes: 5,
        },
      };
    }
    try {
      await db.migrate(process.cwd());
      await db.insert([event(1, "known.example:443")]);
      await db.createMonitor(name, [processA, processB]);
      monitorId = (
        await db.pool.query("SELECT id FROM process_monitors WHERE name=$1", [
          name,
        ])
      ).rows[0].id;
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*) FROM monitor_alerts WHERE monitor_id=$1",
            [monitorId],
          )
        ).rows[0].count,
        "0",
      );
      await db.insert([
        event(2, "known.example:443"),
        event(3, "NEW.example:443", processB),
        event(4, "new.example:80"),
      ]);
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*) FROM monitor_alerts WHERE monitor_id=$1",
            [monitorId],
          )
        ).rows[0].count,
        "1",
      );
      await db.insert([event(5, "new.example:443")]);
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*) FROM monitor_alerts WHERE monitor_id=$1",
            [monitorId],
          )
        ).rows[0].count,
        "1",
      );
      await db.toggleMonitor(monitorId!, false);
      await db.insert(
        Array.from({ length: 110 }, (_, i) =>
          event(10 + i, "bulk.example:443", i % 2 ? processA : processB),
        ),
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*) FROM monitor_alerts WHERE monitor_id=$1",
            [monitorId],
          )
        ).rows[0].count,
        "1",
      );
      const result = await db.query({ processNames: [processA, processB] });
      assert.equal(result.total, 115);
      assert.equal(result.rows.length, 100);
      assert.equal(
        (await db.query({ processNames: ["missing-" + source, processB] }))
          .total,
        56,
      );
      const path = join(dir, "requests.csv");
      assert.equal(
        await db.exportCsv({ processNames: [processA, processB] }, path),
        115,
      );
      const csv = await readFile(path, "utf8");
      assert.ok(csv.startsWith('\ufeff"source_id"'));
      assert.equal(csv.split("\r\n").length, 117);
      assert.ok(csv.includes(processA) && csv.includes(processB));
      await db.deleteMonitor(monitorId!);
      await db.deleteMonitor(monitorId!);
      for (const table of ["monitor_targets", "monitor_alerts"])
        assert.equal(
          (
            await db.pool.query(
              `SELECT count(*) FROM ${table} WHERE monitor_id=$1`,
              [monitorId],
            )
          ).rows[0].count,
          "0",
        );
      assert.equal(
        (await db.query({ processNames: [processA, processB] })).total,
        115,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*) FROM process_monitors WHERE id=$1",
            [monitorId],
          )
        ).rows[0].count,
        "0",
      );
    } finally {
      if (monitorId)
        await db.pool.query("DELETE FROM process_monitors WHERE id=$1", [
          monitorId,
        ]);
      await db.pool.query("DELETE FROM requests WHERE source_id=$1", [source]);
      await db.pool.query("DELETE FROM request_events WHERE source_id=$1", [
        source,
      ]);
      await db.pool.query("DELETE FROM collector_sources WHERE id=$1", [
        source,
      ]);
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("source and documentation contain no Chinese character literals", async () => {
  const { readdir } = await import("node:fs/promises");
  async function scan(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (/\.(ts|tsx|cts|json|sql|md|css|html)$/.test(entry.name)) {
        const source = await readFile(path, "utf8");
        assert.equal(/\p{Script=Han}/u.test(source), false, path);
      }
    }
  }
  for (const directory of ["electron", "src", "scripts", "tests", "docs", "db"])
    await scan(directory);
  for (const path of ["README.md", "DESIGN.md", "index.html"])
    assert.equal(
      /\p{Script=Han}/u.test(await readFile(path, "utf8")),
      false,
      path,
    );
});

test("macOS bundle declares why local network access is required", async () => {
  const metadata = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(
    metadata.build.mac.extendInfo?.NSLocalNetworkUsageDescription ?? "",
    /PostgreSQL/,
  );
  assert.equal(metadata.build.mac.identity, "-");
});

test("packaging gives the application a distinct executable UUID before signing", async () => {
  const { assignBundleUuid } = await import("../scripts/after-pack.js");
  const binary = Buffer.alloc(56);
  binary.writeUInt32LE(0xfeedfacf, 0);
  binary.writeUInt32LE(1, 16);
  binary.writeUInt32LE(0x1b, 32);
  binary.writeUInt32LE(24, 36);
  binary.fill(7, 40, 56);
  const patched = assignBundleUuid(binary, "local.noah.surge-scope");
  assert.notDeepEqual(patched.subarray(40), binary.subarray(40));
  assert.deepEqual(patched.subarray(0, 40), binary.subarray(0, 40));
  assert.deepEqual(patched, assignBundleUuid(binary, "local.noah.surge-scope"));
  assert.notDeepEqual(patched, assignBundleUuid(binary, "another.app"));
  assert.throws(() => assignBundleUuid(Buffer.alloc(8), "test"));
});

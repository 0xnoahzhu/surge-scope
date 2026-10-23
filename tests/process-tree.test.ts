import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProcessTree,
  parseProcesses,
  applicationPaths,
  matchesApplications,
} from "../electron/process-tree.js";
import { Database } from "../electron/database.js";
import type { Payload, EventRecord } from "../electron/types.js";
const now = Date.UTC(2026, 9, 22, 12);
const app = "/Applications/Example App.app";
const processes = [
  {
    pid: 10,
    ppid: 1,
    started: now - 10000,
    path: app + "/Contents/MacOS/Example",
  },
  { pid: 11, ppid: 10, started: now - 9000, path: "/bin/zsh" },
  { pid: 12, ppid: 11, started: now - 8000, path: "/usr/local/bin/node" },
  { pid: 13, ppid: 1, started: now - 8000, path: "/usr/local/bin/node" },
];
function request(id = 1, pid = 12): Payload {
  return {
    id,
    pid,
    startDate: (now - 2000) / 1000,
    processPath: "/usr/local/bin/node",
    local: true,
  };
}
test("ps parsing preserves paths with spaces and uses UTC", () => {
  assert.deepEqual(
    parseProcesses(
      " 10 1 Thu Oct 22 11:59:50 2026 /Applications/Example App.app/Contents/MacOS/Example\ninvalid",
    ),
    [processes[0]],
  );
  assert.deepEqual(
    applicationPaths(app + "/Contents/Helper.app/Contents/MacOS/Helper"),
    [app, app + "/Contents/Helper.app"],
  );
});
test("external grandchildren belong to their app, not unrelated same-name processes", () => {
  const tree = new ProcessTree();
  tree.update(processes, now);
  assert.equal(matchesApplications(tree.enrich(request(), now), [app]), true);
  assert.equal(
    matchesApplications(tree.enrich(request(2, 13), now), [app]),
    false,
  );
  assert.equal(
    matchesApplications(tree.enrich({ ...request(3), local: false }, now), [
      app,
    ]),
    false,
  );
  assert.equal(
    matchesApplications(
      tree.enrich({ ...request(4), processPath: "/different/node" }, now),
      [app],
    ),
    false,
  );
});
test("PID reuse, stale snapshots and pre-lifetime requests never inherit ancestry", () => {
  const tree = new ProcessTree();
  tree.update(processes, now);
  assert.equal(
    matchesApplications(
      tree.enrich({ ...request(), startDate: (now - 20000) / 1000 }, now),
      [app],
    ),
    false,
  );
  assert.equal(
    matchesApplications(tree.enrich(request(2), now + 3000), [app]),
    false,
  );
  tree.update(
    [{ pid: 12, ppid: 1, started: now - 1000, path: "/usr/local/bin/node" }],
    now,
  );
  assert.equal(matchesApplications(tree.enrich(request(3), now), [app]), false);
});
test("observed orphans retain ancestry and request evidence survives process exit", () => {
  const tree = new ProcessTree();
  tree.update(processes, now);
  const first = tree.enrich(request(), now);
  tree.update([{ ...processes[2], ppid: 1 }], now + 1000);
  assert.equal(
    matchesApplications(tree.enrich(request(2), now + 1000), [app]),
    true,
  );
  tree.update([], now + 2000);
  assert.deepEqual(
    tree.enrich(request(), now + 2000).scopeProcess,
    first.scopeProcess,
  );
});
test("bundle fallback is bounded to exact app path and remote requests are excluded", () => {
  const p = {
    ...request(),
    pid: 999,
    processPath: app + "/Contents/Frameworks/Helper.app/Contents/MacOS/Helper",
  };
  const tree = new ProcessTree();
  assert.equal(matchesApplications(tree.enrich(p, now), [app]), true);
  assert.equal(
    matchesApplications(tree.enrich(p, now), ["/Applications/Example"]),
    false,
  );
  assert.equal(
    matchesApplications(tree.enrich({ ...p, local: false }, now), [app]),
    false,
  );
});
test(
  "live macOS process sampler can capture this process",
  { skip: process.platform !== "darwin" },
  async () => {
    const tree = new ProcessTree();
    await tree.start();
    assert.equal(tree.error, null);
    await tree.stop();
  },
);
test(
  "application baseline, alerts, query and CSV share application ownership",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = new Database(process.env.DATABASE_URL!);
    const source = randomUUID();
    const name = "App test " + source;
    const uniqueApp = "/Applications/" + source + ".app";
    const dir = await mkdtemp(join(tmpdir(), "scope-app-"));
    let monitor: string | undefined;
    const event = (
      id: number,
      domain: string,
      belongs = true,
    ): EventRecord => ({
      eventId: randomUUID(),
      sourceId: source,
      requestKey: "app-test:" + id,
      observedAt: new Date().toISOString(),
      eventType: "recent",
      payload: {
        id,
        startDate: Date.now() / 1000,
        local: true,
        processPath: "/usr/local/bin/node",
        remoteHost: domain,
        scopeProcess: {
          version: 1,
          method: "process_tree",
          applications: belongs ? [uniqueApp] : [],
        },
      },
    });
    try {
      await db.migrate(process.cwd());
      await db.insert([event(1, "known.example")]);
      await db.createMonitor(name, [uniqueApp], "application");
      monitor = (
        await db.pool.query("SELECT id FROM process_monitors WHERE name=$1", [
          name,
        ])
      ).rows[0].id;
      await db.insert([
        event(2, "known.example"),
        event(3, "new.example"),
        event(4, "other.example", false),
        event(5, "new.example"),
      ]);
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*) FROM monitor_alerts WHERE monitor_id=$1",
            [monitor],
          )
        ).rows[0].count,
        "1",
      );
      assert.equal(
        (await db.query({ applicationPaths: [uniqueApp] })).total,
        4,
      );
      const degraded = event(3, "new.example", false);
      degraded.payload.scopeProcess = {
        version: 1,
        method: "unresolved",
        applications: [],
      };
      await db.insert([degraded]);
      assert.equal(
        (await db.query({ applicationPaths: [uniqueApp] })).total,
        4,
      );
      const orphanReplay = event(3, "new.example", false);
      orphanReplay.payload.scopeProcess = {
        version: 1,
        method: "process_tree",
        applications: [],
      };
      await db.insert([orphanReplay]);
      assert.equal(
        (await db.query({ applicationPaths: [uniqueApp] })).total,
        4,
      );
      const file = join(dir, "apps.csv");
      assert.equal(
        await db.exportCsv({ applicationPaths: [uniqueApp] }, file),
        4,
      );
      assert.ok((await readFile(file, "utf8")).includes(uniqueApp));
    } finally {
      if (monitor)
        await db.pool.query("DELETE FROM process_monitors WHERE id=$1", [
          monitor,
        ]);
      for (const table of ["requests", "request_events"])
        await db.pool.query(`DELETE FROM ${table} WHERE source_id=$1`, [
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

test("descendants inherit an orphaned parent's previously observed ancestry", () => {
  const tree = new ProcessTree();
  tree.update(processes, now);
  tree.update([{ ...processes[1], ppid: 1 }, processes[2]], now + 1000);
  assert.equal(
    matchesApplications(tree.enrich(request(50), now + 1000), [app]),
    true,
  );
});
test("requests newer than a process snapshot wait for a subsequent sample", () => {
  const tree = new ProcessTree();
  tree.update(processes, now);
  const newer = { ...request(60), startDate: (now + 500) / 1000 };
  assert.equal(
    matchesApplications(tree.enrich(newer, now + 1000), [app]),
    false,
  );
  tree.update(
    [{ pid: 12, ppid: 1, started: now + 1000, path: "/usr/local/bin/node" }],
    now + 1500,
  );
  assert.equal(
    matchesApplications(tree.enrich(newer, now + 1500), [app]),
    false,
  );
});

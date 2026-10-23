import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "../electron/database.js";
import { Spool } from "../electron/spool.js";
import { Collector } from "../electron/collector.js";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL");
const db = new Database(url);
await db.migrate(process.cwd());
const spool = new Spool(
  process.env.SPOOL_PATH ??
    join(
      homedir(),
      "Library",
      "Application Support",
      "Surge Scope",
      "queue.sqlite",
    ),
);
const collector = new Collector(
  spool,
  db,
  process.env.SURGE_CLI_PATH ??
    "/Applications/Surge.app/Contents/Applications/surge-cli",
  2,
);
await collector.start();
const timer = setInterval(
  () => console.log(JSON.stringify(collector.status())),
  5000,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await collector.shutdown();
  await db.close();
  spool.close();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
if (process.env.COLLECT_SECONDS)
  setTimeout(() => void stop(), Number(process.env.COLLECT_SECONDS) * 1000);

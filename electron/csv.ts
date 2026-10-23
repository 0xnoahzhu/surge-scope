import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { rename, unlink } from "node:fs/promises";
import type { Pool } from "pg";
import type { Filters } from "./types.js";
import { buildFilter } from "./filters.js";
export function csvCell(value: unknown): string {
  let text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Spreadsheet programs may execute formula cells even when CSV-quoted.
  if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export async function exportCsv(
  pool: Pool,
  filters: Filters,
  path: string,
): Promise<number> {
  const c = await pool.connect();
  const temp = path + ".partial-" + process.pid;
  let count = 0;
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { clause, values } = buildFilter(filters);
    await c.query(
      `DECLARE csv_export NO SCROLL CURSOR FOR SELECT source_id,request_key,surge_id,started_at,host,url,method,policy_name,rule,process_path,device_name,source_address,status,completed,failed,rejected,in_bytes,out_bytes,raw->>'pid' AS pid,raw->'scopeProcess'->>'method' AS ownership_method,raw->'scopeProcess'->'applications' AS application_paths,raw FROM requests${clause} ORDER BY started_at DESC,source_id,request_key`,
      values,
    );
    const headers = [
      "source_id",
      "request_key",
      "surge_id",
      "started_at",
      "host",
      "url",
      "method",
      "policy_name",
      "rule",
      "process_path",
      "device_name",
      "source_address",
      "status",
      "completed",
      "failed",
      "rejected",
      "in_bytes",
      "out_bytes",
      "pid",
      "ownership_method",
      "application_paths",
      "raw",
    ];
    async function* chunks() {
      yield "\ufeff" + headers.map(csvCell).join(",") + "\r\n";
      while (true) {
        const rows = (await c.query("FETCH 1000 FROM csv_export")).rows;
        if (!rows.length) break;
        for (const row of rows) {
          count++;
          yield headers
            .map((k) =>
              csvCell(row[k] instanceof Date ? row[k].toISOString() : row[k]),
            )
            .join(",") + "\r\n";
        }
      }
    }
    await pipeline(
      Readable.from(chunks()),
      createWriteStream(temp, { flags: "wx", mode: 0o600 }),
    );
    await c.query("CLOSE csv_export");
    await c.query("COMMIT");
    await rename(temp, path);
    return count;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    await unlink(temp).catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

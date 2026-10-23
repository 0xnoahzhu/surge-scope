export function applicationPredicate(parameter: string): string {
  return `(raw->>'local'='true' AND EXISTS (SELECT 1 FROM unnest(${parameter}::text[]) app WHERE
    (raw->'scopeProcess'->'applications') @> jsonb_build_array(app)
    OR left(process_path,length(app)+1)=app||'/'))`;
}
import type { Filters } from "./types.js";
export function buildFilter(f: Filters) {
  const values: unknown[] = [],
    where: string[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return "$" + values.length;
  };
  if (f.search)
    where.push(
      `(host ILIKE ${bind("%" + f.search + "%")} OR url ILIKE $${values.length} OR process_path ILIKE $${values.length})`,
    );
  if (f.field && f.value !== undefined && f.value !== "")
    where.push(`(raw->>${bind(f.field)}) ILIKE ${bind("%" + f.value + "%")}`);
  if (f.processNames?.length)
    where.push(
      `EXISTS(SELECT 1 FROM unnest(${bind(f.processNames)}::text[]) name WHERE strpos(lower(process_path),lower(name))>0)`,
    );
  if (f.applicationPaths?.length)
    where.push(applicationPredicate(bind(f.applicationPaths)));
  if (f.from) where.push(`started_at>=${bind(f.from)}::timestamptz`);
  if (f.to) where.push(`started_at<=${bind(f.to)}::timestamptz`);
  if (f.state === "failed") where.push("(failed OR rejected)");
  if (f.state === "active") where.push("NOT completed");
  if (f.state === "completed") where.push("completed");
  return {
    values,
    clause: where.length ? " WHERE " + where.join(" AND ") : "",
  };
}

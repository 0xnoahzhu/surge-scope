import { createHash } from "node:crypto";
import type { Payload } from "./types.js";
export function requestKey(p: Payload): string | null {
  if (
    typeof p.id !== "number" ||
    !Number.isSafeInteger(p.id) ||
    typeof p.startDate !== "number" ||
    !Number.isFinite(p.startDate) ||
    p.startDate < 0 ||
    p.startDate > 253402300799
  )
    return null;
  // Surge serializes the same timestamp with slightly different float precision.
  return `${p.engineIdentifier ?? "unknown"}:${p.id}:${Math.round(p.startDate * 1000)}`;
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export function fingerprint(p: Payload): string {
  return createHash("sha256").update(canonical(p)).digest("hex");
}
export function parseLine(line: string): Payload {
  const x: unknown = JSON.parse(line);
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw new Error("CLI returned a non-object JSON frame");
  return x as Payload;
}

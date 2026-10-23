export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Payload = { [key: string]: Json };
export interface EventRecord {
  eventId: string;
  sourceId: string;
  requestKey: string | null;
  observedAt: string;
  eventType: string;
  payload: Payload;
}
export interface Filters {
  processNames?: string[];
  applicationPaths?: string[];
  search?: string;
  field?: string;
  value?: string;
  from?: string;
  to?: string;
  state?: string;
  page?: number;
  groupBy?: string;
}
export interface RequestRow {
  source_id: string;
  request_key: string;
  surge_id: string;
  started_at: string;
  host: string | null;
  method: string | null;
  policy_name: string | null;
  process_path: string | null;
  status: string | null;
  in_bytes: string;
  out_bytes: string;
  raw: Payload;
}
export interface QueryResult {
  rows: RequestRow[];
  total: number;
  summary: { count: string; download: string; upload: string; failed: string };
  groups: { label: string; count: string; download: string; upload: string }[];
  fields: string[];
}
export interface RuntimeStatus {
  running: boolean;
  database: boolean;
  queued: number;
  received: number;
  written: number;
  lastError: string | null;
  lastSync: string | null;
  sourceId: string;
}
export interface Settings {
  connectionString: string;
  cliPath: string;
  pollSeconds: number;
}
export interface PublicSettings {
  configured: boolean;
  databaseLabel: string;
  cliPath: string;
  pollSeconds: number;
}
export interface StoredEvent {
  event_id: string;
  observed_at: string;
  event_type: string;
  payload: Payload;
}
export interface ProcessMonitor {
  id: string;
  name: string;
  process_names: string[];
  match_mode: "process" | "application";
  enabled: boolean;
  created_at: string;
  target_count?: string;
}
export interface MonitorAlert {
  id: string;
  monitor_id: string;
  monitor_name: string;
  kind: string;
  target: string;
  process_path: string;
  source_id: string;
  request_key: string;
  observed_at: string;
  read_at: string | null;
}
export interface MonitorResult {
  monitors: ProcessMonitor[];
  alerts: MonitorAlert[];
  unread: number;
}
export interface ScopeApi {
  monitors(page: number): Promise<MonitorResult>;
  createMonitor(
    name: string,
    processNames: string[],
    mode?: "process" | "application",
  ): Promise<void>;
  chooseApplications(): Promise<string[]>;
  deleteMonitor(id: string): Promise<void>;
  toggleMonitor(id: string, enabled: boolean): Promise<void>;
  readAlerts(): Promise<void>;
  exportCsv(
    filters: Filters,
  ): Promise<{ canceled: boolean; count?: number; path?: string }>;

  events(
    sourceId: string,
    requestKey: string,
    page: number,
  ): Promise<StoredEvent[]>;
  status(): Promise<RuntimeStatus>;
  settings(): Promise<PublicSettings>;
  saveSettings(s: Settings): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  query(f: Filters): Promise<QueryResult>;
}

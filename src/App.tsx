import { MonitorPanel } from "./MonitorPanel";
import { useLanguage } from "./i18n";
import { useEffect, useState, useCallback, useRef } from "react";
import type {
  Filters,
  QueryResult,
  RequestRow,
  RuntimeStatus,
  PublicSettings,
  StoredEvent,
} from "../electron/types";
import s from "./App.module.css";
const bytes = (v: string | number) => {
  const n = Number(v);
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
};
const time = (v: string) =>
  new Date(v).toLocaleTimeString(document.documentElement.lang, {
    hour12: false,
  });
export function App() {
  const { language, setLanguage, t } = useLanguage();
  const [processInput, setProcessInput] = useState("");
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState("requests"),
    [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [status, setStatus] = useState<RuntimeStatus | null>(null),
    [config, setConfig] = useState<PublicSettings | null>(null),
    [data, setData] = useState<QueryResult | null>(null);
  const [filters, setFilters] = useState<Filters>({ page: 0, groupBy: "host" }),
    [selected, setSelected] = useState<RequestRow | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [live, setLive] = useState(true);
  const [url, setUrl] = useState(""),
    [cli, setCli] = useState(
      "/Applications/Surge.app/Contents/Applications/surge-cli",
    ),
    [poll, setPoll] = useState(2),
    [notice, setNotice] = useState("");
  const [events, setEvents] = useState<StoredEvent[]>([]),
    [eventPage, setEventPage] = useState(0);
  useEffect(() => {
    setEventPage(0);
  }, [selected?.request_key, selected?.source_id]);
  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    if (selected)
      void window.scope
        .events(selected.source_id, selected.request_key, eventPage)
        .then((rows) => {
          if (!cancelled) setEvents(rows);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    return () => {
      cancelled = true;
    };
  }, [selected, eventPage]);
  const generation = useRef(0);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    localStorage.setItem("theme", theme);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (!window.scope) {
      setError(t("Open this interface in the Electron desktop app."));
      return;
    }
    void window.scope
      .settings()
      .then((c) => {
        setConfig(c);
        setCli(c.cliPath);
        setPoll(c.pollSeconds);
        if (!c.configured) setView("settings");
      })
      .catch((e) => setError(String(e)));
  }, []);
  const refresh = useCallback(async () => {
    if (!window.scope) return;
    const gen = ++generation.current;
    try {
      const st = await window.scope.status();
      setStatus(st);
      if (config?.configured) {
        const result = await window.scope.query(filters);
        if (gen === generation.current) {
          setData(result);
          setError("");
        }
      }
    } catch (e) {
      if (gen === generation.current) setError(String(e));
    }
  }, [config, filters]);
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 200);
    const interval = live ? setInterval(() => void refresh(), 3000) : null;
    return () => {
      clearTimeout(t);
      if (interval) clearInterval(interval);
      generation.current++;
    };
  }, [refresh, live]);
  const filter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch, page: 0 }));
    setSelected(null);
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  async function save() {
    await act(async () => {
      await window.scope.saveSettings({
        connectionString: url,
        cliPath: cli,
        pollSeconds: poll,
      });
      setUrl("");
      setConfig(await window.scope.settings());
      setNotice("Connection saved securely. Collection started.");
      setView("requests");
    });
  }
  const current = selected
    ? (data?.rows.find(
        (r) =>
          r.source_id === selected.source_id &&
          r.request_key === selected.request_key,
      ) ?? selected)
    : null;
  return (
    <div className={s.app}>
      <aside className={s.sidebar}>
        <div className={s.brand}>
          <span className={s.mark}>
            S<span>∿</span>
          </span>
          <div>
            Surge Scope<small>TRAFFIC OBSERVATORY</small>
          </div>
        </div>
        <div className={s.workspaceLabel}>
          {t("Workspace")}
          <span>LOCAL</span>
        </div>
        <nav>
          {[
            ["requests", "↗", t("Requests")],
            ["analytics", "◫", t("Analytics")],
            ["settings", "⚙", t("Settings")],
            ["monitors", "◎", t("Process Watch")],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={view === id ? s.navActive : ""}
              onClick={() => setView(id)}
            >
              <span>{icon}</span>
              {label}
              {id === "requests" && data && (
                <b>{data.total.toLocaleString()}</b>
              )}
            </button>
          ))}
        </nav>
        <div className={s.sidebarBottom}>
          <div className={s.source}>
            <span className={status?.running ? s.dot : s.dotOff} />
            <div>
              {status?.running
                ? t("Collector running")
                : t("Collector stopped")}
              <small>
                {config?.databaseLabel || t("Configure PostgreSQL")}
              </small>
            </div>
          </div>
          <label>
            {t("Appearance")}
            <select
              aria-label={t("Appearance theme")}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="system">{t("System")}</option>
              <option value="dark">{t("Dark / Graphite")}</option>
              <option value="light">{t("Light / Paper")}</option>
            </select>
          </label>
          <label>
            {t("Language")}
            <select
              aria-label="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "zh")}
            >
              <option value="en">English</option>
              <option value="zh">{t("Chinese")}</option>
            </select>
          </label>
          <small className={s.version}>SURGE SCOPE / {__APP_VERSION__}</small>
        </div>
      </aside>
      <main className={s.main}>
        <header className={s.header}>
          <div>
            <div className={s.eyebrow}>OBSERVE / {view.toUpperCase()}</div>
            <h1>
              {view === "requests"
                ? t("Requests")
                : view === "analytics"
                  ? t("Analytics")
                  : view === "monitors"
                    ? t("Process Watch")
                    : t("Settings")}
            </h1>
          </div>
          <div className={s.headerActions}>
            <span className={s.liveTag}>
              {status?.running ? "●  LIVE" : "○  PAUSED"}
            </span>
            <button
              disabled={busy || !config?.configured}
              onClick={() =>
                void act(() =>
                  status?.running ? window.scope.stop() : window.scope.start(),
                )
              }
            >
              {status?.running ? t("Stop collection") : t("Start collection")}
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className={s.error}>
            {error}
          </div>
        )}
        {status?.lastError && (
          <div role="status" className={s.error}>
            {status.lastError}
          </div>
        )}
        {notice && (
          <div className={s.notice}>
            {notice.startsWith("CSV exported.")
              ? t("CSV exported.") + notice.slice("CSV exported.".length)
              : t(notice)}
            <button
              aria-label={t("Dismiss notice")}
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        {view === "monitors" ? (
          <MonitorPanel
            t={t}
            language={language}
            onView={(names, mode) => {
              setProcessInput(mode === "application" ? "" : names.join(", "));
              filter({
                processNames: mode === "application" ? [] : names,
                applicationPaths: mode === "application" ? names : [],
              });
              setView("requests");
            }}
          />
        ) : view === "settings" ? (
          <section className={s.settings}>
            <div className={s.sectionNumber}>01 / STORAGE</div>
            <h2>{t("Connect to PostgreSQL")}</h2>
            <p>
              {t(
                "Store request metadata, original events, and statistics in one database. Credentials are encrypted with macOS secure storage.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                {t("Database connection string")}
                <input
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="postgresql://user:password@host:5432/surge_scope"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <small>
                {t("Current:")} {config?.databaseLabel || t("Not configured")}
                {t(". Drain the pending queue before changing connections.")}
              </small>
              <label>
                {t("Surge CLI path")}
                <input
                  required
                  value={cli}
                  onChange={(e) => setCli(e.target.value)}
                />
              </label>
              <label>
                {t("Snapshot interval (seconds)")}
                <input
                  type="number"
                  min={1}
                  max={60}
                  required
                  value={poll}
                  onChange={(e) => setPoll(Number(e.target.value))}
                />
              </label>
              <button className={s.primary} disabled={busy}>
                {busy
                  ? t("Verifying connection...")
                  : t("Verify, save, and collect")}
              </button>
            </form>
            <div className={s.sectionNumber}>02 / COLLECTION</div>
            <h2>{t("Keep every observed field")}</h2>
            <p>
              {t(
                "Subscribe to new requests and reconcile active and recent snapshots. Events enter a durable local queue before PostgreSQL. Closing the app stops collection; recovery is limited to records Surge still retains.",
              )}
            </p>
            <dl>
              <dt>{t("Pending writes")}</dt>
              <dd>
                {status?.queued ?? 0}
                {t("events")}
              </dd>
              <dt>{t("Collector source ID")}</dt>
              <dd className={s.mono}>{status?.sourceId || "—"}</dd>
            </dl>
          </section>
        ) : (
          <>
            <section className={s.metrics}>
              <div>
                <span>{t("Matching requests")}</span>
                <strong>{data?.total.toLocaleString() ?? "—"}</strong>
              </div>
              <div>
                <span>{t("Download")}</span>
                <strong>{data ? bytes(data.summary.download) : "—"}</strong>
              </div>
              <div>
                <span>{t("Upload")}</span>
                <strong>{data ? bytes(data.summary.upload) : "—"}</strong>
              </div>
              <div>
                <span>{t("Failed / rejected")}</span>
                <strong
                  className={Number(data?.summary.failed) > 0 ? s.danger : ""}
                >
                  {data?.summary.failed ?? "—"}
                </strong>
              </div>
              <div className={s.queueMetric}>
                <span>{t("Pending queue")}</span>
                <strong>
                  {status?.queued ?? 0}
                  <small> EVENTS</small>
                </strong>
              </div>
            </section>
            <section className={s.filters} aria-label={t("Request filters")}>
              <input
                aria-label={t("Search requests")}
                className={s.search}
                placeholder={t("Search host, URL, or process...")}
                value={filters.search || ""}
                onChange={(e) => filter({ search: e.target.value })}
              />
              <select
                aria-label={t("Status")}
                value={filters.state || ""}
                onChange={(e) => filter({ state: e.target.value })}
              >
                <option value="">{t("All statuses")}</option>
                <option value="active">{t("Active")}</option>
                <option value="completed">{t("Completed")}</option>
                <option value="failed">{t("Failed / rejected")}</option>
              </select>
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={live}
                  onChange={(e) => setLive(e.target.checked)}
                />
                {t("Auto refresh")}
              </label>
              <button onClick={() => void refresh()}>{t("Refresh")}</button>
              <button
                disabled={exporting || !config?.configured}
                onClick={() => {
                  setExporting(true);
                  void window.scope
                    .exportCsv(filters)
                    .then((r) => {
                      if (!r.canceled) setNotice(`CSV exported. ${r.count}`);
                    })
                    .catch((e) => setError(String(e)))
                    .finally(() => setExporting(false));
                }}
              >
                {t(exporting ? "Exporting..." : "Export CSV")}
              </button>
              <input
                className={s.processFilter}
                aria-label="Process names"
                placeholder={t("Process names, separated by commas")}
                value={processInput}
                onChange={(e) => {
                  setProcessInput(e.target.value);
                  filter({
                    processNames: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                }}
              />
              <div className={s.filterRow}>
                <button
                  onClick={async () => {
                    try {
                      const paths = await window.scope.chooseApplications();
                      if (paths.length) filter({ applicationPaths: paths });
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  {t("Filter by application")}
                </button>
                {!!filters.applicationPaths?.length && (
                  <>
                    <span title={filters.applicationPaths.join(" / ")}>
                      {filters.applicationPaths
                        .map((p) => p.split("/").at(-1))
                        .join(" / ")}
                    </span>
                    <button onClick={() => filter({ applicationPaths: [] })}>
                      {t("Clear application filter")}
                    </button>
                  </>
                )}
              </div>
              <div className={s.filterRow}>
                <input
                  aria-label={t("Filter field")}
                  list="request-fields"
                  placeholder={t("Any raw field")}
                  value={filters.field || ""}
                  onChange={(e) => filter({ field: e.target.value })}
                />
                <datalist id="request-fields">
                  {data?.fields.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
                <input
                  aria-label={t("Field value")}
                  placeholder={t("Field value contains...")}
                  value={filters.value || ""}
                  onChange={(e) => filter({ value: e.target.value })}
                />
                <label>
                  {t("From")}
                  <input
                    aria-label={t("Start time")}
                    type="datetime-local"
                    onChange={(e) =>
                      filter({
                        from: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : undefined,
                      })
                    }
                  />
                </label>
                <label>
                  {t("To")}
                  <input
                    aria-label={t("End time")}
                    type="datetime-local"
                    onChange={(e) =>
                      filter({
                        to: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : undefined,
                      })
                    }
                  />
                </label>
              </div>
            </section>
            {view === "analytics" ? (
              <section className={s.analytics}>
                <div className={s.sectionTitle}>
                  <h2>{t("Traffic distribution")}</h2>
                  <select
                    aria-label={t("Group by")}
                    value={filters.groupBy}
                    onChange={(e) => filter({ groupBy: e.target.value })}
                  >
                    {Object.entries({
                      host: t("Remote host"),
                      policy: t("Policy"),
                      process: t("Process"),
                      method: t("Protocol / method"),
                      device: t("Device"),
                      status: t("Status"),
                      rule: t("Rule"),
                    }).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <span>{t("TOP 30 / CURRENT FILTERS")}</span>
                </div>
                <div className={s.groupHeading}>
                  <span>{t("Group / requests")}</span>
                  <span>{t("Requests")}</span>
                  <span>{t("Download")}</span>
                  <span>{t("Upload")}</span>
                </div>
                {data?.groups.map((g, i) => (
                  <div key={g.label} className={s.group}>
                    <div>
                      <span className={s.rank}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span title={g.label}>{g.label}</span>
                      <div
                        className={s.bar}
                        style={{
                          width: `${Math.max(1, (Number(g.count) / Number(data.groups[0].count)) * 100)}%`,
                        }}
                      />
                    </div>
                    <strong>{Number(g.count).toLocaleString()}</strong>
                    <span>{bytes(g.download)}</span>
                    <span>{bytes(g.upload)}</span>
                  </div>
                ))}
                {!data?.groups.length && (
                  <div className={s.empty}>{t("No matching data")}</div>
                )}
              </section>
            ) : (
              <div className={s.content}>
                <section className={s.tableSection}>
                  <div className={s.tableScroll}>
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Time")}</th>
                          <th>{t("Request / host")}</th>
                          <th>{t("Protocol")}</th>
                          <th>{t("Policy")}</th>
                          <th>{t("Status")}</th>
                          <th>{t("Download")}</th>
                          <th>{t("Upload")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data?.rows.map((r) => (
                          <tr
                            key={r.source_id + r.request_key}
                            className={
                              current?.request_key === r.request_key
                                ? s.selected
                                : ""
                            }
                          >
                            <td className={s.mono}>{time(r.started_at)}</td>
                            <td>
                              <button
                                className={s.hostButton}
                                title={r.host ?? ""}
                                onClick={() => setSelected(r)}
                              >
                                {r.host || t("Unknown host")}
                              </button>
                              <small>
                                {String(
                                  r.raw.pathForStatistics ||
                                    r.process_path ||
                                    t("Unknown process"),
                                )
                                  .split("/")
                                  .filter(Boolean)
                                  .at(-1)}
                              </small>
                            </td>
                            <td>
                              <span className={s.protocol}>
                                {r.method || "—"}
                              </span>
                            </td>
                            <td title={r.policy_name ?? ""}>
                              {r.policy_name || t("Pending")}
                            </td>
                            <td>
                              <span
                                className={
                                  r.raw.failed || r.raw.rejected
                                    ? s.bad
                                    : r.raw.completed
                                      ? s.finished
                                      : s.active
                                }
                              >
                                {r.raw.failed
                                  ? t("Failed")
                                  : r.raw.rejected
                                    ? t("Rejected")
                                    : r.raw.completed
                                      ? t("Completed")
                                      : t("Active")}
                              </span>
                            </td>
                            <td className={s.mono}>{bytes(r.in_bytes)}</td>
                            <td className={s.mono}>{bytes(r.out_bytes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data?.rows.length && (
                      <div className={s.empty}>
                        <h2>
                          {config?.configured
                            ? t("No matching requests")
                            : t("Connect a database to start")}
                        </h2>
                        <p>
                          {config?.configured
                            ? t("Adjust your filters or wait for new requests.")
                            : t(
                                "Configure PostgreSQL in Settings to see real requests here.",
                              )}
                        </p>
                      </div>
                    )}
                  </div>
                  <footer className={s.pagination}>
                    <span>
                      {t("100 per page / Page")} {(filters.page ?? 0) + 1}
                      {t(" ")}
                    </span>
                    <div>
                      <button
                        disabled={!filters.page}
                        onClick={() =>
                          setFilters((f) => ({ ...f, page: (f.page ?? 0) - 1 }))
                        }
                      >
                        {t("Previous")}
                      </button>
                      <button
                        disabled={
                          !data || ((filters.page ?? 0) + 1) * 100 >= data.total
                        }
                        onClick={() =>
                          setFilters((f) => ({ ...f, page: (f.page ?? 0) + 1 }))
                        }
                      >
                        {t("Next")}
                      </button>
                    </div>
                  </footer>
                </section>
                {current && (
                  <aside className={s.detail}>
                    <div className={s.sectionTitle}>
                      <span>REQUEST INSPECTOR</span>
                      <button
                        aria-label={t("Close request details")}
                        onClick={() => setSelected(null)}
                      >
                        ×
                      </button>
                    </div>
                    <h2>{current.host}</h2>
                    <div className={s.detailId}>
                      #{current.surge_id} ·{" "}
                      {new Date(current.started_at).toLocaleString(language)}
                    </div>
                    <h3>{t("Application ownership")}</h3>
                    {(() => {
                      const evidence = current.raw.scopeProcess;
                      if (
                        !evidence ||
                        typeof evidence !== "object" ||
                        Array.isArray(evidence)
                      )
                        return <p>{t("No ownership evidence captured")}</p>;
                      const apps = Array.isArray(evidence.applications)
                        ? evidence.applications.filter(
                            (v): v is string => typeof v === "string",
                          )
                        : [];
                      return (
                        <div>
                          <p>
                            {t(
                              evidence.method === "process_tree"
                                ? "Observed process ancestry"
                                : evidence.method === "bundle_path"
                                  ? "Application bundle path"
                                  : "Unresolved process ownership",
                            )}
                          </p>
                          {apps.map((path) => (
                            <p key={path}>{path}</p>
                          ))}
                          <pre>
                            {JSON.stringify(evidence.ancestry || [], null, 2)}
                          </pre>
                        </div>
                      );
                    })()}
                    <h3>{t("Fields")}</h3>
                    <dl>
                      {Object.entries(current.raw)
                        .filter(([, v]) => typeof v !== "object")
                        .map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{String(v)}</dd>
                          </div>
                        ))}
                    </dl>
                    <h3>{t("Connection log")}</h3>
                    <div className={s.logs}>
                      {Array.isArray(current.raw.notes)
                        ? current.raw.notes.map((n, i) => (
                            <p key={i}>{String(n)}</p>
                          ))
                        : t("No log entries")}
                    </div>
                    <h3>{t("Event history")}</h3>
                    <div className={s.logs}>
                      {events.map((e) => (
                        <details key={e.event_id}>
                          <summary>
                            {time(e.observed_at)} · {e.event_type}
                          </summary>
                          <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                        </details>
                      ))}
                    </div>
                    <div className={s.pagination}>
                      <button
                        disabled={eventPage === 0}
                        onClick={() => setEventPage((p) => p - 1)}
                      >
                        {t("Newer events")}
                      </button>
                      <span>
                        {t("Page")} {eventPage + 1}
                        {t(" ")}
                      </span>
                      <button
                        disabled={events.length < 50}
                        onClick={() => setEventPage((p) => p + 1)}
                      >
                        {t("Older events")}
                      </button>
                    </div>
                    <h3>{t("Full raw JSON")}</h3>
                    <pre>{JSON.stringify(current.raw, null, 2)}</pre>
                  </aside>
                )}
              </div>
            )}
          </>
        )}
        <footer className={s.statusbar}>
          <span>
            <span className={status?.database ? s.dot : s.dotOff} />
            {status?.database
              ? t("PostgreSQL synced")
              : t("Waiting for database writes")}
          </span>
          <span>
            {t("Written")} {status?.written ?? 0} {t("events / Last sync")}{" "}
            {status?.lastSync ? time(status.lastSync) : "—"}
          </span>
          <span>watch + active / recent</span>
        </footer>
      </main>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import type { MonitorResult } from "../electron/types";
import type { Translate, Language } from "./i18n";
import s from "./App.module.css";
export function MonitorPanel({
  t,
  language,
  onView,
}: {
  t: Translate;
  language: Language;
  onView: (names: string[], mode: "process" | "application") => void;
}) {
  const [data, setData] = useState<MonitorResult | null>(null),
    [name, setName] = useState(""),
    [names, setNames] = useState(""),
    [mode, setMode] = useState<"process" | "application">("process"),
    [apps, setApps] = useState<string[]>([]),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [deleting, setDeleting] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await window.scope.monitors(page));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [page]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function act(fn: () => Promise<void>) {
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
  }
  return (
    <section className={s.monitorPanel}>
      <h2>{t("Process Watch")}</h2>
      <p>
        {t(
          "Existing matching requests establish the baseline. New domains and IP addresses trigger alerts.",
        )}
      </p>
      <form
        className={s.monitorForm}
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await window.scope.createMonitor(
              name,
              mode === "application"
                ? apps
                : names
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
              mode,
            );
            setName("");
            setNames("");
            setApps([]);
            setNotice(
              "Monitor created. Existing targets are now the baseline.",
            );
          });
        }}
      >
        <label>
          {t("Monitor name")}
          <input
            aria-label="Monitor name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Browser / Development"
          />
        </label>
        <label>
          {t("Match mode")}
          <select
            aria-label="Monitor match mode"
            value={mode}
            onChange={(e) =>
              setMode(e.target.value as "process" | "application")
            }
          >
            <option value="process">{t("Process names")}</option>
            <option value="application">
              {t("Application and descendants")}
            </option>
          </select>
        </label>
        {mode === "application" ? (
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const selected = await window.scope.chooseApplications();
                  if (selected.length) setApps(selected);
                })
              }
            >
              {t("Choose applications")}
            </button>
            <small>{apps.join(" / ") || t("No applications selected")}</small>
          </div>
        ) : (
          <label>
            {t("Processes")}
            <input
              aria-label="Monitor processes"
              required
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder="Brave Browser, Telegram"
            />
          </label>
        )}
        <button
          className={s.primary}
          disabled={busy || (mode === "application" && !apps.length)}
        >
          {t("Create monitor")}
        </button>
      </form>
      <p>
        {t(
          mode === "application"
            ? "Tracks bundle helpers and observed external descendants. Processes that exit before sampling or launch through system services may remain unresolved."
            : "Name matches are case-insensitive substrings of the process path. Any listed name can match.",
        )}
      </p>
      {error && (
        <div role="alert" className={s.error}>
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className={s.notice}>
          {t(notice)}
        </p>
      )}
      <div className={s.monitorList}>
        {data?.monitors.map((m) => (
          <div className={s.monitorRow} key={m.id}>
            <div>
              <strong>{m.name}</strong>
              <small>
                {t(
                  m.match_mode === "application"
                    ? "Application and descendants"
                    : "Process names",
                )}
              </small>
              <small>{m.process_names.join(" / ")}</small>
            </div>
            <span>
              {m.target_count} {t("Target")}
            </span>
            <span className={m.enabled ? s.active : s.finished}>
              {t(m.enabled ? "Enabled" : "Disabled")}
            </span>
            <button onClick={() => onView(m.process_names, m.match_mode)}>
              {t("View requests")}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(() => window.scope.toggleMonitor(m.id, !m.enabled))
              }
            >
              {t(m.enabled ? "Disable" : "Enable")}
            </button>
            {deleting === m.id ? (
              <div role="group" aria-label={t("Confirm monitor deletion")}>
                <p>
                  {t(
                    "Delete this monitor, its alerts and target baseline? Collected requests will be kept.",
                  )}
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await window.scope.deleteMonitor(m.id);
                      setDeleting(null);
                      setPage(0);
                      setNotice(
                        "Monitor deleted. Collected requests were kept.",
                      );
                    })
                  }
                >
                  {t("Confirm delete")}
                </button>
                <button disabled={busy} onClick={() => setDeleting(null)}>
                  {t("Cancel")}
                </button>
              </div>
            ) : (
              <button disabled={busy} onClick={() => setDeleting(m.id)}>
                {t("Delete")}
              </button>
            )}
          </div>
        ))}
        {!data?.monitors.length && (
          <div className={s.empty}>{t("No monitors configured")}</div>
        )}
      </div>
      <div className={s.sectionTitle}>
        <h2>
          {t("New targets")}{" "}
          <span className={s.alertCount}>
            {data?.unread ?? 0} {t("Unread")}
          </span>
        </h2>
        <button
          disabled={busy || !data?.unread}
          onClick={() => void act(() => window.scope.readAlerts())}
        >
          {t("Mark all read")}
        </button>
      </div>
      <p>
        {t(
          "Desktop notifications require permission in System Settings. Proxy endpoints are labeled separately.",
        )}
      </p>
      <div className={s.tableScroll}>
        <table>
          <thead>
            <tr>
              <th>{t("Observed")}</th>
              <th>{t("Monitor")}</th>
              <th>{t("Target")}</th>
              <th>{t("Process")}</th>
              <th>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.alerts.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.observed_at).toLocaleString(language)}</td>
                <td>{a.monitor_name}</td>
                <td title={a.target}>
                  {a.target}
                  <small>
                    {t(
                      a.kind === "domain"
                        ? "Domain"
                        : a.kind === "target_ip"
                          ? "Target IP"
                          : "Endpoint IP",
                    )}
                  </small>
                </td>
                <td title={a.process_path}>
                  {a.process_path.split("/").at(-1)}
                </td>
                <td>{a.read_at ? "—" : t("New")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.alerts.length && (
          <div className={s.empty}>{t("No alerts yet")}</div>
        )}
      </div>
      <div className={s.pagination}>
        <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
          {t("Previous alerts")}
        </button>
        <span>{page + 1}</span>
        <button
          disabled={!data || data.alerts.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("Older alerts")}
        </button>
      </div>
    </section>
  );
}

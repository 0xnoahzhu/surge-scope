import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  dialog,
  Notification,
} from "electron";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Database } from "./database.js";
import { Spool } from "./spool.js";
import { Collector } from "./collector.js";
import type { Settings, PublicSettings } from "./types.js";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
app.setName("Surge Scope");
let win: BrowserWindow | null = null,
  db: Database | null = null,
  collector: Collector | null = null,
  spool: Spool;
let settings: Settings = {
  connectionString: "",
  cliPath: "/Applications/Surge.app/Contents/Applications/surge-cli",
  pollSeconds: 2,
};
let configPath: string;
let switching = false;
let quitting = false;
const schema = z.object({
  connectionString: z
    .string()
    .max(4096)
    .refine((s) => {
      try {
        return ["postgres:", "postgresql:"].includes(new URL(s).protocol);
      } catch {
        return false;
      }
    }, "Invalid PostgreSQL URL"),
  cliPath: z
    .string()
    .min(1)
    .max(4096)
    .refine((s) => s.startsWith("/"), "CLI path must be absolute"),
  pollSeconds: z.number().int().min(1).max(60),
});
const applicationPath = z
  .string()
  .trim()
  .max(4096)
  .refine(
    (s) =>
      s.startsWith("/") && s.endsWith(".app") && !s.split("/").includes(".."),
    "Choose an absolute .app path",
  );
const filters = z.object({
  applicationPaths: z.array(applicationPath).max(30).optional(),
  processNames: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  search: z.string().max(500).optional(),
  field: z.string().max(200).optional(),
  value: z.string().max(1000).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  state: z.enum(["", "active", "completed", "failed"]).optional(),
  page: z.number().int().min(0).max(100000).optional(),
  groupBy: z
    .enum(["host", "policy", "process", "method", "device", "status", "rule"])
    .optional(),
});
function publicSettings(): PublicSettings {
  let label = "Not connected";
  if (settings.connectionString) {
    const u = new URL(settings.connectionString);
    label = `${u.hostname}:${u.port || 5432}${u.pathname}`;
  }
  return {
    configured: !!settings.connectionString,
    databaseLabel: label,
    cliPath: settings.cliPath,
    pollSeconds: settings.pollSeconds,
  };
}
async function configure(next: Settings, persist: boolean) {
  if (switching) throw new Error("Configuration change in progress");
  switching = true;
  const candidate = new Database(next.connectionString);
  const previous = collector;
  const wasRunning = previous?.status().running;
  try {
    if (persist) await candidate.migrate(root);
    else
      await candidate.migrate(root).catch(() => {
        /* Offline startup still captures to the durable queue. */
      });
    await previous?.shutdown();
    if (
      settings.connectionString !== next.connectionString &&
      spool.count() > 0
    )
      throw new Error(
        "Drain the existing queue before changing the database connection.",
      );
    if (persist) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "Secure storage is unavailable; credentials cannot be saved.",
        );
      const encrypted = safeStorage
        .encryptString(next.connectionString)
        .toString("base64");
      await writeFile(
        configPath + ".tmp",
        JSON.stringify({ ...next, connectionString: encrypted }),
        { mode: 0o600 },
      );
      await rename(configPath + ".tmp", configPath);
    }
    await db?.close();
    db = candidate;
    settings = next;
    collector = new Collector(spool, db, next.cliPath, next.pollSeconds);
    await collector.start();
  } catch (e) {
    await candidate.close();
    previous?.resumeWriting();
    if (previous && wasRunning) await previous.start();
    throw e;
  } finally {
    switching = false;
  }
}
let notifying = false;
let notificationTimer: ReturnType<typeof setInterval> | null = null;
function register() {
  const handle = (name: string, fn: (arg: unknown) => unknown) =>
    ipcMain.handle(name, async (event, arg) => {
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("Untrusted sender");
      try {
        return await fn(arg);
      } catch (e) {
        if (e instanceof z.ZodError)
          throw new Error("Invalid input parameters.");
        const message = e instanceof Error ? e.message : "Operation failed.";
        throw new Error(
          message.replace(
            /postgres(?:ql)?:\/\/[^\s]+/g,
            "[database URL redacted]",
          ),
        );
      }
    });
  handle("scope:monitors", (arg) => {
    if (!db) throw new Error("Configure the database first.");
    return db.monitors(z.number().int().min(0).max(100000).parse(arg));
  });
  handle("scope:choose-applications", async () => {
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      title: "Choose applications to monitor",
      defaultPath: "/Applications",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Applications", extensions: ["app"] }],
    });
    return result.canceled
      ? []
      : z.array(applicationPath).max(30).parse(result.filePaths);
  });
  handle("scope:create-monitor", async (arg) => {
    if (!db) throw new Error("Configure the database first.");
    const m = z
      .object({
        name: z.string().trim().min(1).max(100),
        processNames: z
          .array(z.string().trim().min(1).max(4096))
          .min(1)
          .max(30),
        mode: z.enum(["process", "application"]).default("process"),
      })
      .parse(arg);
    if (m.mode === "application")
      z.array(applicationPath).parse(m.processNames);
    await db.createMonitor(m.name, [...new Set(m.processNames)], m.mode);
  });
  handle("scope:delete-monitor", async (arg) => {
    if (!db) throw new Error("Configure the database first.");
    await db.deleteMonitor(z.uuid().parse(arg));
  });
  handle("scope:toggle-monitor", async (arg) => {
    if (!db) throw new Error("Configure the database first.");
    const m = z.object({ id: z.uuid(), enabled: z.boolean() }).parse(arg);
    await db.toggleMonitor(m.id, m.enabled);
  });
  handle("scope:read-alerts", () => {
    if (!db) throw new Error("Configure the database first.");
    return db.readAlerts();
  });
  handle("scope:export", async (arg) => {
    if (!db || !win) throw new Error("Configure the database first.");
    const f = filters.parse(arg);
    const result = await dialog.showSaveDialog(win, {
      title: "Export filtered requests",
      defaultPath: "surge-scope-requests.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const count = await db.exportCsv(f, result.filePath);
    return { canceled: false, count, path: result.filePath };
  });
  handle("scope:settings", () => publicSettings());
  handle("scope:save-settings", (arg) => configure(schema.parse(arg), true));
  handle(
    "scope:status",
    () =>
      collector?.status() ?? {
        running: false,
        database: false,
        queued: spool.count(),
        received: 0,
        written: 0,
        lastError: null,
        lastSync: null,
        sourceId: spool.sourceId,
      },
  );
  handle("scope:start", () => {
    if (switching) throw new Error("Configuration change in progress.");
    if (!collector) throw new Error("Configure the database first.");
    return collector.start();
  });
  handle("scope:stop", () => {
    if (switching) throw new Error("Configuration change in progress.");
    return collector?.stop();
  });
  handle("scope:events", (arg) => {
    if (!db) throw new Error("Configure the database first.");
    const f = z
      .object({
        sourceId: z.uuid(),
        requestKey: z.string().max(200),
        page: z.number().int().min(0).max(100000),
      })
      .parse(arg);
    return db.events(f.sourceId, f.requestKey, f.page);
  });
  handle("scope:query", (arg) => {
    if (!db) throw new Error("Configure the database first.");
    return db.query(filters.parse(arg));
  });
}
async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 375,
    minHeight: 600,
    title: "Surge Scope",
    backgroundColor: "#101513",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  if (!app.isPackaged && process.argv.includes("--dev"))
    await win.loadURL("http://127.0.0.1:5173");
  else await win.loadFile(join(root, "dist/index.html"));
  if (process.env.SURGE_SCOPE_SCREENSHOT) {
    setTimeout(async () => {
      if (win) {
        const shot = await win.webContents.capturePage();
        await writeFile(process.env.SURGE_SCOPE_SCREENSHOT!, shot.toPNG());
      }
    }, 4000);
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  void app.whenReady().then(async () => {
    const data = app.getPath("userData");
    await mkdir(data, { recursive: true, mode: 0o700 });
    configPath = join(data, "settings.json");
    spool = new Spool(join(data, "queue.sqlite"));
    try {
      const saved = JSON.parse(await readFile(configPath, "utf8"));
      settings = schema.parse({
        ...saved,
        connectionString: safeStorage.decryptString(
          Buffer.from(saved.connectionString, "base64"),
        ),
      });
    } catch {
      /* First run or unavailable secure storage: configure in settings. */
    }
    if (process.env.DATABASE_URL)
      settings.connectionString = process.env.DATABASE_URL;
    register();
    await createWindow();
    if (settings.connectionString) {
      try {
        await configure(settings, false);
      } catch {
        win?.webContents.send(
          "scope:startup-error",
          "Database connection failed. Check Settings.",
        );
      }
    }
    notificationTimer = setInterval(async () => {
      if (!db || notifying || switching || !Notification.isSupported()) return;
      notifying = true;
      try {
        const alerts = await db.claimNotifications();
        if (alerts.length) {
          const notification = new Notification({
            title: "Surge Scope: new process targets",
            body:
              alerts
                .slice(0, 3)
                .map((a) => `${a.kind}: ${a.target}`)
                .join("\n") +
              (alerts.length > 3 ? `\n+${alerts.length - 3} more` : ""),
          });
          notification.on("click", () => {
            win?.show();
            win?.focus();
          });
          notification.show();
        }
      } catch {
        /* Alerts remain visible in the database even if native delivery is unavailable. */
      } finally {
        notifying = false;
      }
    }, 3000);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    if (notificationTimer) clearInterval(notificationTimer);
    void (async () => {
      await collector?.shutdown();
      await db?.close();
      spool?.close();
      app.quit();
    })();
  });
}

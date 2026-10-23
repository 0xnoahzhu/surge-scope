import { _electron as electron, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { translate } from "../src/i18n.js";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL");
const app = await electron.launch({
  args: process.env.PACKAGED_APP ? [] : ["."],
  executablePath: process.env.PACKAGED_APP,
  env: { ...process.env, DATABASE_URL: url } as Record<string, string>,
});
const monitorName = "UI smoke " + randomUUID();
try {
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  await page.waitForFunction(() => Boolean(window.scope));
  await page.evaluate(async (connectionString) => {
    await window.scope.saveSettings({
      connectionString,
      cliPath: "/Applications/Surge.app/Contents/Applications/surge-cli",
      pollSeconds: 2,
    });
  }, url);
  await expect(page.locator("tbody tr").first()).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByRole("button", { name: "Stop collection" }),
  ).toBeEnabled({
    timeout: 15000,
  });
  await page.waitForFunction(async () => {
    const s = await window.scope.status();
    return s.database && s.queued < 50;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("PostgreSQL synced", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Appearance theme").selectOption("dark");
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({
    path: ".local/screenshots/requests-dark.png",
    fullPage: true,
  });
  await page
    .getByPlaceholder("Search host, URL, or process...")
    .fill("this-host-does-not-exist.invalid");
  await expect(
    page.getByRole("heading", { name: "No matching requests" }),
  ).toBeVisible();
  await page.getByPlaceholder("Search host, URL, or process...").fill("");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page
    .getByLabel("Process names", { exact: true })
    .fill("Brave, Telegram");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const exportPath = resolve(".local/smoke-export.csv");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  await expect(page.getByText(/CSV exported/)).toBeVisible();
  expect(
    (await readFile(exportPath, "utf8")).startsWith('\ufeff"source_id"'),
  ).toBeTruthy();
  await page.getByLabel("Process names", { exact: true }).fill("");
  await page.locator("tbody tr").first().getByRole("button").click();
  await expect(
    page.getByRole("heading", { name: "Full raw JSON" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/request-detail.png",
    fullPage: true,
  });
  await page.getByLabel("Close request details").click();
  await page.getByRole("button", { name: "◫ Analytics" }).click();
  await page.getByLabel("Group by").selectOption("policy");
  await page.waitForTimeout(500);
  await page.screenshot({
    path: ".local/screenshots/analytics-dark.png",
    fullPage: true,
  });
  await page.getByLabel("Appearance theme").selectOption("light");
  await page.screenshot({
    path: ".local/screenshots/analytics-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "◎ Process Watch" }).click();
  await page.getByLabel("Monitor name", { exact: true }).fill(monitorName);
  await page
    .getByLabel("Monitor processes", { exact: true })
    .fill("scope-smoke-nonexistent");
  await page
    .getByRole("button", { name: "Create monitor", exact: true })
    .click();
  await expect(page.getByText(monitorName, { exact: true })).toBeVisible();
  const monitorRow = page
    .getByText(monitorName, { exact: true })
    .locator("../..");
  await monitorRow
    .getByRole("button", { name: "Disable", exact: true })
    .click();
  await expect(monitorRow.getByText("Disabled", { exact: true })).toBeVisible();
  await page.getByLabel("Monitor match mode").selectOption("application");
  await page
    .getByLabel("Monitor name", { exact: true })
    .fill(monitorName + " application");
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: ["/Applications/Scope Smoke Test.app"],
    });
  });
  await page
    .getByRole("button", { name: "Choose applications", exact: true })
    .click();
  await expect(
    page.getByText("/Applications/Scope Smoke Test.app", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create monitor", exact: true })
    .click();
  const appRow = page
    .getByText(monitorName + " application", { exact: true })
    .locator("../..");
  await expect(
    appRow.getByText("Application and descendants", { exact: true }),
  ).toBeVisible();
  await appRow
    .getByRole("button", { name: "View requests", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear application filter", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear application filter", exact: true })
    .click();
  await page.getByRole("button", { name: "◎ Process Watch" }).click();
  const deleteRow = page
    .getByText(monitorName + " application", { exact: true })
    .locator("../..");
  await deleteRow.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteRow.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(deleteRow).toBeVisible();
  await deleteRow.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteRow
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByText(monitorName + " application", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".local/screenshots/process-watch.png",
    fullPage: true,
  });
  await page.getByLabel("Language", { exact: true }).selectOption("zh");
  await expect(
    page
      .getByRole("heading", {
        name: translate("Process Watch", "zh"),
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/screenshots/process-watch-zh.png",
    fullPage: true,
  });
  await page.getByLabel("Language", { exact: true }).selectOption("en");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: ".local/screenshots/mobile-light.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "⚙ Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect to PostgreSQL" }),
  ).toBeVisible();
  expect(await page.locator("input[type=password]").inputValue()).toBe("");
  await page.getByLabel("Appearance theme").selectOption("system");
  expect(errors).toEqual([]);
  console.log(
    "Electron smoke passed: real data, filtering, details, grouping, themes, localization, monitoring, multi-process filters, CSV, 375px, encrypted config.",
  );
} finally {
  await app.close();
  const cleanup = new pg.Client({ connectionString: url });
  await cleanup.connect();
  try {
    await cleanup.query(
      "DELETE FROM process_monitors WHERE name=ANY($1::text[])",
      [[monitorName, monitorName + " application"]],
    );
  } finally {
    await cleanup.end();
  }
}

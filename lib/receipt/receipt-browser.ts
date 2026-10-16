import { existsSync } from "node:fs";
import { chromium as playwright, type BrowserContext, type Page } from "playwright-core";

async function launchReceiptContext() {
  if (process.platform === "linux") {
    const { default: chromium } = await import("@sparticuz/chromium");
    chromium.setGraphicsMode = false;
    // Chromium's serverless single-process mode needs the default context;
    // repeatedly creating disposable incognito contexts can terminate it.
    return playwright.launchPersistentContext("", {
      args: chromium.args, executablePath: await chromium.executablePath(),
      headless: true, timeout: 10000, viewport: { width: 800, height: 1200 },
    });
  }
  const executablePath = [
    process.env.RECEIPT_CHROMIUM_EXECUTABLE,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(p => p && existsSync(p));
  if (!executablePath) throw new Error("Receipt Chromium is unavailable");
  return playwright.launchPersistentContext("", { executablePath, headless: true, timeout: 10000, viewport: { width: 800, height: 1200 } });
}

export function createReceiptPageRunner(launch: () => Promise<BrowserContext>) {
  let context: BrowserContext | null = null;
  let queue = Promise.resolve();
  const run = async <T>(render: (page: Page) => Promise<T>): Promise<T> => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!context) {
        const launched = await launch();
        context = launched;
        launched.on("close", () => { if (context === launched) context = null; });
      }
      const active = context;
      deadline = setTimeout(() => { void active.close().catch(() => {}); }, 20000);
      const page = active.pages().find(page => !page.isClosed()) ?? await active.newPage();
      return await render(page);
    } catch (error) {
      // A failed browser is never kept for the next receipt.
      const failed = context;
      context = null;
      if (failed) await failed.close().catch(() => {});
      throw error;
    } finally {
      if (deadline) clearTimeout(deadline);
      release();
    }
  };
  const close = async () => {
    await queue;
    const active = context;
    context = null;
    if (active) await active.close().catch(() => {});
  };
  return { run, close };
}

const receiptBrowser = createReceiptPageRunner(launchReceiptContext);
export const withReceiptPage = receiptBrowser.run;
export const closeReceiptBrowser = receiptBrowser.close;

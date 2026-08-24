/** Open a Linear URL in the system browser or the macOS Linear app. */

import { execFile } from "node:child_process";
import { CliError, usageError } from "./errors.js";

export async function openUrl(url: string, opts: { app?: boolean } = {}): Promise<void> {
  if (opts.app && process.platform !== "darwin") {
    throw usageError("--app currently requires macOS with Linear.app installed; use --web here.");
  }
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32.exe"
        : "xdg-open";
  const args =
    process.platform === "darwin"
      ? opts.app
        ? ["-a", "Linear", url]
        : [url]
      : process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", url]
        : [url];

  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (err, _stdout, stderr) => {
      if (!err) return resolve();
      const detail = stderr.trim();
      reject(new CliError(detail || `Failed to open ${url}: ${err.message}`, "runtime"));
    });
  });
}

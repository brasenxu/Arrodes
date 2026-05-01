/**
 * Cursor MCP shim: loads .env(.local) so the Postgres MCP gets its DSN without
 * storing credentials inside .cursor/mcp.json.
 */
import { spawn } from "node:child_process";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");

config({ path: resolve(projectRoot, ".env") });
config({ path: resolve(projectRoot, ".env.local"), override: true });

const url =
  process.env.ARRODES_MCP_DATABASE_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL;

if (!url) {
  console.error(
    "run-postgres-mcp: Set ARRODES_MCP_DATABASE_URL (recommended read-only URL) or DATABASE_URL_* in .env.local",
  );
  process.exit(1);
}

const child = spawn(
  "npx",
  ["-y", "@modelcontextprotocol/server-postgres", url],
  {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

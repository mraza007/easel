/**
 * Snapshot of the running mcp-server. Exposed to the canvas via WS so the
 * server-management popover can show PID, uptime, and where state is persisted.
 */
import { STATE_FILE_PATH, getStateFileMtime } from "./persistence.js";

const STARTED_AT = Date.now();
const VERSION = "0.0.1";

export interface ServerInfo {
  pid: number;
  startedAt: number;
  version: string;
  statePath: string;
  stateMtime: number | null;
}

export async function getServerInfo(): Promise<ServerInfo> {
  return {
    pid: process.pid,
    startedAt: STARTED_AT,
    version: VERSION,
    statePath: STATE_FILE_PATH,
    stateMtime: await getStateFileMtime(),
  };
}

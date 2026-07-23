import fs from "node:fs/promises";
import path from "node:path";

export type AuditOutcome = "started" | "success" | "error";
export type AuditOperation = "read" | "mutation";

export interface AuditEvent {
  actor: string;
  environment: string;
  operation: AuditOperation;
  outcome: AuditOutcome;
  requestId: string;
  target: Record<string, string>;
  tool: string;
  errorCode?: string;
}

export class AuditLogger {
  constructor(private readonly file: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const handle = await fs.open(this.file, "a", 0o600);
    await handle.close();
    try {
      await fs.chmod(path.dirname(this.file), 0o700);
      await fs.chmod(this.file, 0o600);
    } catch {
      // Some filesystems do not expose POSIX permissions.
    }
  }

  async record(event: AuditEvent): Promise<void> {
    const record = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      actor: event.actor,
      environment: event.environment,
      tool: event.tool,
      operation: event.operation,
      requestId: event.requestId,
      target: event.target,
      outcome: event.outcome,
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    };
    await fs.appendFile(this.file, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

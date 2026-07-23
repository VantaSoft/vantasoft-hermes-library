import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuditLogger } from "../dist/audit.js";

test("audit records contain metadata but no credentials or sensitive payloads", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telvana-audit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "audit.jsonl");
  const audit = new AuditLogger(file);
  await audit.initialize();
  await audit.record({
    actor: "markus:test",
    environment: "staging",
    operation: "mutation",
    outcome: "success",
    requestId: "request-1",
    target: { agentId: "agent_1" },
    tool: "telvana_update_inbound_prompt",
  });

  const raw = fs.readFileSync(file, "utf8");
  const record = JSON.parse(raw.trim());
  assert.equal(record.actor, "markus:test");
  assert.equal(record.environment, "staging");
  assert.deepEqual(record.target, { agentId: "agent_1" });
  assert.equal("apiKey" in record, false);
  assert.equal("payload" in record, false);
  assert.equal("reason" in record, false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

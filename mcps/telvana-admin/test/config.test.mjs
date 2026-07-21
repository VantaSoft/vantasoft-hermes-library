import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../dist/config.js";

function fixture(t, environments) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telvana-config-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "credentials.json");
  fs.writeFileSync(file, JSON.stringify({ environments }), { mode: 0o600 });
  return { directory, file };
}

function environment(overrides = {}) {
  return {
    TELVANA_ENVIRONMENT: "development",
    TELVANA_MCP_ACTOR: "markus:test",
    TELVANA_ENABLE_MUTATIONS: "false",
    TELVANA_ALLOW_PRODUCTION: "false",
    ...overrides,
  };
}

test("environment selection and actor are mandatory", (t) => {
  const { file } = fixture(t, {
    development: {
      baseUrl: "http://127.0.0.1:3000",
      apiKey: "development-key",
    },
  });
  assert.throws(
    () => loadConfig({ TELVANA_MCP_ACTOR: "markus:test" }, file),
    /TELVANA_ENVIRONMENT/,
  );
  assert.throws(
    () => loadConfig({ TELVANA_ENVIRONMENT: "development" }, file),
    /TELVANA_MCP_ACTOR/,
  );
});

test("staging and production require HTTPS", (t) => {
  const { file } = fixture(t, {
    staging: {
      baseUrl: "http://staging.example.test",
      apiKey: "staging-key",
    },
  });
  assert.throws(
    () => loadConfig(environment({ TELVANA_ENVIRONMENT: "staging" }), file),
    /must use HTTPS/,
  );
});

test("production requires a separate startup opt-in", (t) => {
  const { file } = fixture(t, {
    production: {
      baseUrl: "https://api.example.test",
      apiKey: "production-key",
    },
  });
  assert.throws(
    () => loadConfig(environment({ TELVANA_ENVIRONMENT: "production" }), file),
    /Production is disabled/,
  );
  const config = loadConfig(
    environment({
      TELVANA_ENVIRONMENT: "production",
      TELVANA_ALLOW_PRODUCTION: "true",
    }),
    file,
  );
  assert.equal(config.environment, "production");
  assert.equal(config.mutationsEnabled, false);
});

test("mutations require both startup and credential authorization", (t) => {
  const denied = fixture(t, {
    development: {
      baseUrl: "http://127.0.0.1:3000",
      apiKey: "development-key",
      allowMutations: false,
    },
  });
  assert.throws(
    () =>
      loadConfig(
        environment({ TELVANA_ENABLE_MUTATIONS: "true" }),
        denied.file,
      ),
    /Mutations are not authorized/,
  );

  const allowed = fixture(t, {
    development: {
      baseUrl: "http://localhost:3000",
      apiKey: "development-key",
      allowMutations: true,
    },
  });
  const config = loadConfig(
    environment({
      TELVANA_ENABLE_MUTATIONS: "true",
      TELVANA_AUDIT_FILE: path.join(allowed.directory, "audit.jsonl"),
    }),
    allowed.file,
  );
  assert.equal(config.mutationsEnabled, true);
  assert.equal(config.actor, "markus:test");
});

test("development HTTP endpoints are limited to loopback", (t) => {
  const { file } = fixture(t, {
    development: {
      baseUrl: "http://development.example.test",
      apiKey: "development-key",
    },
  });
  assert.throws(() => loadConfig(environment(), file), /loopback host/);
});

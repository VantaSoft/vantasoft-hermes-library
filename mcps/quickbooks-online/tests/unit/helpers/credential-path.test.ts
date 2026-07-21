import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  ensureCredentialDirectory,
  resolveCredentialFile,
} from "../../../src/helpers/credential-path";

describe("QuickBooks credential path", () => {
  const originalHermesHome = process.env.HERMES_HOME;
  const originalOverride = process.env.QUICKBOOKS_ENV_FILE;

  afterEach(() => {
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;

    if (originalOverride === undefined) delete process.env.QUICKBOOKS_ENV_FILE;
    else process.env.QUICKBOOKS_ENV_FILE = originalOverride;

    jest.restoreAllMocks();
  });

  it("uses the active Hermes profile token directory by default", () => {
    process.env.HERMES_HOME = "/profiles/graham";
    delete process.env.QUICKBOOKS_ENV_FILE;

    expect(resolveCredentialFile("/install/server")).toBe(
      "/profiles/graham/mcp-tokens/quickbooks-online/.env",
    );
  });

  it("honors an explicit credential file override", () => {
    process.env.HERMES_HOME = "/profiles/graham";
    process.env.QUICKBOOKS_ENV_FILE = "/secure/qbo.env";

    expect(resolveCredentialFile("/install/server")).toBe("/secure/qbo.env");
  });

  it("falls back to the install-local file outside Hermes", () => {
    delete process.env.HERMES_HOME;
    delete process.env.QUICKBOOKS_ENV_FILE;

    expect(resolveCredentialFile("/install/server")).toBe(
      "/install/server/.env",
    );
  });

  it("expands a home-relative override", () => {
    process.env.QUICKBOOKS_ENV_FILE = "~/qbo/credentials.env";

    expect(resolveCredentialFile("/install/server")).toBe(
      path.join(os.homedir(), "qbo", "credentials.env"),
    );
  });

  it("expands a bare home override", () => {
    process.env.QUICKBOOKS_ENV_FILE = "~";

    expect(resolveCredentialFile("/install/server")).toBe(os.homedir());
  });

  it("creates and restricts the parent directory", () => {
    const mkdir = jest
      .spyOn(fs, "mkdirSync")
      .mockImplementation(() => undefined);
    const chmod = jest
      .spyOn(fs, "chmodSync")
      .mockImplementation(() => undefined);

    ensureCredentialDirectory(
      "/profiles/graham/mcp-tokens/quickbooks-online/.env",
    );

    expect(mkdir).toHaveBeenCalledWith(
      "/profiles/graham/mcp-tokens/quickbooks-online",
      { recursive: true, mode: 0o700 },
    );
    expect(chmod).toHaveBeenCalledWith(
      "/profiles/graham/mcp-tokens/quickbooks-online",
      0o700,
    );
  });

  it("tolerates filesystems without POSIX chmod", () => {
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    jest.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw new Error("ENOTSUP");
    });

    expect(() =>
      ensureCredentialDirectory(
        "/profiles/graham/mcp-tokens/quickbooks-online/.env",
      ),
    ).not.toThrow();
  });
});

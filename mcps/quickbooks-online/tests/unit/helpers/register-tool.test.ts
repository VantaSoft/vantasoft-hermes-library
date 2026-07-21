import { describe, it, expect, afterEach, jest } from "@jest/globals";
import {
  getCrudCategory,
  isToolDisabled,
  RegisterTool,
} from "../../../src/helpers/register-tool";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function clearRestrictionEnvironment(): void {
  delete process.env.QUICKBOOKS_ENABLE_MUTATIONS;
  delete process.env.QUICKBOOKS_DISABLE_WRITE;
  delete process.env.QUICKBOOKS_DISABLE_UPDATE;
  delete process.env.QUICKBOOKS_DISABLE_DELETE;
}

describe("getCrudCategory", () => {
  it("returns WRITE for create_ prefix", () =>
    expect(getCrudCategory("create_invoice")).toBe("WRITE"));
  it("returns WRITE for create- prefix", () =>
    expect(getCrudCategory("create-bill")).toBe("WRITE"));
  it("returns UPDATE for update_ prefix", () =>
    expect(getCrudCategory("update_customer")).toBe("UPDATE"));
  it("returns UPDATE for update- prefix", () =>
    expect(getCrudCategory("update-vendor")).toBe("UPDATE"));
  it("returns DELETE for delete_ prefix", () =>
    expect(getCrudCategory("delete_payment")).toBe("DELETE"));
  it("returns DELETE for delete- prefix", () =>
    expect(getCrudCategory("delete-bill")).toBe("DELETE"));
  it("returns READ for non-mutation prefixes", () => {
    expect(getCrudCategory("get_invoice")).toBe("READ");
    expect(getCrudCategory("search_customers")).toBe("READ");
    expect(getCrudCategory("read_invoice")).toBe("READ");
  });
});

describe("isToolDisabled", () => {
  afterEach(clearRestrictionEnvironment);

  it("never suppresses read tools", () => {
    expect(isToolDisabled("get_invoice")).toBe(false);
    process.env.QUICKBOOKS_DISABLE_WRITE = "true";
    process.env.QUICKBOOKS_DISABLE_UPDATE = "true";
    process.env.QUICKBOOKS_DISABLE_DELETE = "true";
    expect(isToolDisabled("search_customers")).toBe(false);
  });

  it("suppresses every mutation until the operator opts in", () => {
    expect(isToolDisabled("create_invoice")).toBe(true);
    expect(isToolDisabled("update_customer")).toBe(true);
    expect(isToolDisabled("delete_payment")).toBe(true);
  });

  it("enables mutations only with the exact explicit opt-in", () => {
    process.env.QUICKBOOKS_ENABLE_MUTATIONS = "1";
    expect(isToolDisabled("create_invoice")).toBe(true);

    process.env.QUICKBOOKS_ENABLE_MUTATIONS = "true";
    expect(isToolDisabled("create_invoice")).toBe(false);
    expect(isToolDisabled("update_customer")).toBe(false);
    expect(isToolDisabled("delete_payment")).toBe(false);
  });

  it("applies the write restriction after mutation opt-in", () => {
    process.env.QUICKBOOKS_ENABLE_MUTATIONS = "true";
    process.env.QUICKBOOKS_DISABLE_WRITE = "true";
    expect(isToolDisabled("create_invoice")).toBe(true);
    expect(isToolDisabled("create-bill")).toBe(true);
  });

  it("applies the update restriction after mutation opt-in", () => {
    process.env.QUICKBOOKS_ENABLE_MUTATIONS = "true";
    process.env.QUICKBOOKS_DISABLE_UPDATE = "true";
    expect(isToolDisabled("update_customer")).toBe(true);
    expect(isToolDisabled("update-vendor")).toBe(true);
  });

  it("applies the delete restriction after mutation opt-in", () => {
    process.env.QUICKBOOKS_ENABLE_MUTATIONS = "true";
    process.env.QUICKBOOKS_DISABLE_DELETE = "true";
    expect(isToolDisabled("delete_payment")).toBe(true);
    expect(isToolDisabled("delete-bill")).toBe(true);
  });

  it("only treats the exact string true as a category disable", () => {
    process.env.QUICKBOOKS_ENABLE_MUTATIONS = "true";
    process.env.QUICKBOOKS_DISABLE_WRITE = "false";
    expect(isToolDisabled("create_invoice")).toBe(false);
    process.env.QUICKBOOKS_DISABLE_WRITE = "1";
    expect(isToolDisabled("create_invoice")).toBe(false);
  });
});

describe("RegisterTool", () => {
  afterEach(clearRestrictionEnvironment);

  const schema = z.object({ id: z.string() });
  const handler = jest.fn() as any;
  const def = (name: string) =>
    ({
      name,
      description: `desc:${name}`,
      schema,
      handler,
    }) as any;

  it("registers read tools with every definition field", () => {
    const server = { tool: jest.fn() } as unknown as McpServer;
    const definition = def("get_invoice");
    RegisterTool(server, definition);
    expect(server.tool).toHaveBeenCalledWith(
      definition.name,
      definition.description,
      { params: definition.schema },
      definition.handler,
    );
  });

  it("does not register mutations by default", () => {
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("create_invoice"));
    RegisterTool(server, def("update_customer"));
    RegisterTool(server, def("delete_payment"));
    expect(server.tool).not.toHaveBeenCalled();
  });

  it("registers mutations after explicit opt-in", () => {
    process.env.QUICKBOOKS_ENABLE_MUTATIONS = "true";
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("create_invoice"));
    expect(server.tool).toHaveBeenCalledTimes(1);
  });

  it("still skips category-disabled mutations after opt-in", () => {
    process.env.QUICKBOOKS_ENABLE_MUTATIONS = "true";
    process.env.QUICKBOOKS_DISABLE_WRITE = "true";
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("create-bill"));
    expect(server.tool).not.toHaveBeenCalled();
  });

  it("registers read tools even when every category is disabled", () => {
    process.env.QUICKBOOKS_DISABLE_WRITE = "true";
    process.env.QUICKBOOKS_DISABLE_UPDATE = "true";
    process.env.QUICKBOOKS_DISABLE_DELETE = "true";
    const server = { tool: jest.fn() } as unknown as McpServer;
    RegisterTool(server, def("search_invoices"));
    expect(server.tool).toHaveBeenCalledTimes(1);
  });
});

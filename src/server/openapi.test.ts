import { beforeAll, describe, expect, it } from "vitest";
import { loadOperations, validateArgs, type Operation } from "./openapi.js";

const spec = {
  openapi: "3.0.3",
  info: { title: "t", version: "1" },
  paths: {
    "/invoices/{id}": {
      patch: {
        operationId: "updateInvoice",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  amount: { type: "number" },
                  status: { type: "string", enum: ["open", "paid"] },
                  note: { type: "string", nullable: true },
                },
                required: ["amount"],
                additionalProperties: false,
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

let operation: Operation;
beforeAll(async () => {
  operation = (await loadOperations(spec, ["updateInvoice"], 10))[0]!;
});

describe("validateArgs", () => {
  it("accepts arguments that fit the schema", () => {
    const args = { id: "1", limit: 5, body: { amount: 3, status: "paid", note: null } };
    expect(validateArgs(operation, args)).toEqual(args);
  });

  it("rejects unknown and missing top-level arguments", () => {
    expect(() => validateArgs(operation, { id: "1", body: { amount: 1 }, extra: 1 })).toThrow(/extra/);
    expect(() => validateArgs(operation, { body: { amount: 1 } })).toThrow(/id/);
    expect(() => validateArgs(operation, "nope")).toThrow(/object/);
  });

  it.each([
    ["wrong param type", { id: { $ne: "1" }, body: { amount: 1 } }],
    ["out-of-range query value", { id: "1", limit: 500, body: { amount: 1 } }],
    ["wrong body field type", { id: "1", body: { amount: "1" } }],
    ["missing required body field", { id: "1", body: { status: "open" } }],
    ["value outside enum", { id: "1", body: { amount: 1, status: "deleted" } }],
    ["unknown body field", { id: "1", body: { amount: 1, role: "admin" } }],
  ])("rejects %s", (_name, args) => {
    expect(() => validateArgs(operation, args)).toThrow();
  });
});

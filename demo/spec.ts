/** A small OpenAPI spec for the demo invoices API. `x-agent` carries sideagent hints. */
export const spec = {
  openapi: "3.0.3",
  info: { title: "Invoices", version: "1.0.0" },
  paths: {
    "/invoices": {
      get: {
        operationId: "listInvoices",
        summary: "List the user's invoices",
        "x-agent": { responseFields: ["id", "customer", "amount"] },
        responses: { "200": { description: "ok" } },
      },
      post: {
        operationId: "createInvoice",
        summary: "Create an invoice",
        "x-agent": { invalidates: ["invoices"] },
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { customer: { type: "string" }, amount: { type: "number" } },
                required: ["customer", "amount"],
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
    "/invoices/{id}": {
      delete: {
        operationId: "deleteInvoice",
        summary: "Delete an invoice",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "ok" } },
      },
    },
  },
} as const;

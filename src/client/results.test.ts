import { describe, expect, it } from "vitest";
import { formatCell, humanize } from "./results.js";

describe("result formatting", () => {
  it("humanizes keys", () => {
    expect(humanize("createdAt")).toBe("Created at");
    expect(humanize("unit_price")).toBe("Unit price");
    expect(humanize("listInvoices")).toBe("List invoices");
  });
  it("formats cells", () => {
    expect(formatCell(null)).toBe("—");
    expect(formatCell(true)).toBe("Yes");
    expect(formatCell(1200)).toBe((1200).toLocaleString());
    expect(formatCell("x".repeat(200)).length).toBe(81);
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });
  it("never emits html, only strings", () => {
    expect(formatCell("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });
});

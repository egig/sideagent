import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

describe("assistant markdown", () => {
  it("renders formatting but not raw HTML", () => {
    const html = renderToStaticMarkup(
      <Markdown remarkPlugins={[remarkGfm]}>{"**bold** <script>alert(1)</script>\n\n- a\n- b"}</Markdown>,
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>a</li>");
    expect(html).not.toContain("<script>");
  });
});

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serveAdminUi } from "./node.js";
import { adminUiHtml } from "./ui.js";

describe("adminUiHtml", () => {
  it("writes the settings in and cannot be broken out of", () => {
    const html = adminUiHtml("<head><!--sideagent-config--></head>", {
      basePath: "/admin/",
      docsUrl: "</script><script>alert(1)</script>",
    });
    expect(html).toContain('"basePath":"/admin"');
    expect(html).not.toContain("</script><script>alert");
    expect(html).toContain("\\u003c/script>");
  });

  it("points relative links at the mount point so deep routes find their assets", () => {
    expect(adminUiHtml("<!--sideagent-config-->", { basePath: "/admin" })).toContain('<base href="/admin/">');
    expect(adminUiHtml("<!--sideagent-config-->")).toContain('<base href="/">');
    expect(adminUiHtml("<!--sideagent-config-->", { basePath: '/a"><x' })).toContain('<base href="/a&quot;&gt;');
  });
});

describe("serveAdminUi", () => {
  async function site() {
    const dir = await mkdtemp(join(tmpdir(), "sa-ui-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<!--sideagent-config--><div id=root></div>");
    await writeFile(join(dir, "assets", "app-abc.js"), "console.log(1)");
    await writeFile(join(tmpdir(), "sa-secret.txt"), "secret");
    return serveAdminUi({ dir, basePath: "/admin", apiBase: "/api" });
  }
  const get = (path: string) => new Request(`http://x${path}`);

  it("serves the page, assets and the dashboard's own routes under the base path", async () => {
    const ui = await site();
    const root = await ui(get("/admin"))!;
    expect(await root.text()).toContain('window.__SIDEAGENT_ADMIN__={"basePath":"/admin","apiBase":"/api"}');
    const deep = await (await ui(get("/admin/agents/agt_1/knowledge"))!).text();
    expect(deep).toContain("__SIDEAGENT_ADMIN__");
    expect(deep).not.toContain("sa-ui-"); // the server's folder stays out of the page
    const asset = await ui(get("/admin/assets/app-abc.js"))!;
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await ui(get("/admin/assets/missing.js"))!).status).toBe(404);
  });

  it("leaves the API alone when mounted at the root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sa-ui-"));
    await writeFile(join(dir, "index.html"), "<div></div>");
    const ui = serveAdminUi({ dir });
    expect(ui(get("/api/agents"))).toBeNull();
    expect(ui(get("/v1/agents/agt_x"))).toBeNull();
    expect((await ui(get("/agents/agt_x"))!).status).toBe(200);
  });

  it("leaves other paths and methods alone, and stays inside its folder", async () => {
    const ui = await site();
    expect(ui(get("/api/agents"))).toBeNull();
    expect(ui(get("/administrator"))).toBeNull();
    expect(ui(new Request("http://x/admin", { method: "POST" }))).toBeNull();
    expect((await ui(get("/admin/..%2f..%2fsa-secret.txt"))!).status).toBe(404);
    // The URL parser resolves real dot segments before the handler sees them: that path is not under /admin at all.
    expect(ui(get("/admin/%2e%2e/sa-secret.txt"))).toBeNull();
  });
});

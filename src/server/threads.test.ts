import { InMemoryStore } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { LangGraphThreadStore, MemoryThreadStore, ownsThread, threadPrefix, type ThreadStore } from "./threads.js";

const stores: [string, () => ThreadStore][] = [
  ["MemoryThreadStore", () => new MemoryThreadStore()],
  ["LangGraphThreadStore", () => new LangGraphThreadStore(new InMemoryStore())],
];

describe.each(stores)("%s", (_name, make) => {
  it("lists newest first and keeps the first title", async () => {
    const s = make();
    await s.touch("u1", "u1:a", "first");
    await new Promise((r) => setTimeout(r, 2));
    await s.touch("u1", "u1:b", "second");
    await new Promise((r) => setTimeout(r, 2));
    await s.touch("u1", "u1:a", "renamed");
    const list = await s.list("u1");
    expect(list.map((t) => [t.id, t.title])).toEqual([
      ["u1:a", "first"],
      ["u1:b", "second"],
    ]);
  });

  it("keeps users apart, including ids with dots", async () => {
    const s = make();
    await s.touch("a.b@x.com", "t1", "mine");
    expect(await s.has("a.b@x.com", "t1")).toBe(true);
    expect(await s.has("other@x.com", "t1")).toBe(false);
    expect(await s.list("other@x.com")).toEqual([]);
  });

  it("deletes a thread", async () => {
    const s = make();
    await s.touch("u1", "t1", "x");
    await s.delete("u1", "t1");
    expect(await s.has("u1", "t1")).toBe(false);
  });

  it("caps threads per user at 200, dropping the oldest", async () => {
    const s = make();
    let clock = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock++);
    for (let i = 0; i < 202; i++) await s.touch("u1", `t${i}`, "x");
    vi.restoreAllMocks();
    const list = await s.list("u1");
    expect(list).toHaveLength(200);
    expect(await s.has("u1", "t0")).toBe(false);
    expect(await s.has("u1", "t201")).toBe(true);
  });

  it("only owns threads carrying the user's prefix and in their index", async () => {
    const s = make();
    const id = `${threadPrefix("u1")}abc`;
    await s.touch("u1", id, "x");
    expect(await ownsThread(s, "u1", id)).toBe(true);
    expect(await ownsThread(s, "u2", id)).toBe(false);
  });
});

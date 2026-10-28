import { describe, expect, it } from "vitest";
import { modeKey, threadKey, widthKey } from "./storage.js";

describe("storage keys", () => {
  it("keep the 0.4 keys without a storageKey", () => {
    expect(modeKey()).toBe("sideagent:mode");
    expect(widthKey()).toBe("sideagent:width");
    expect(threadKey("/agent")).toBe("sideagent:thread:/agent");
  });

  it("are namespaced by storageKey so two chats do not share them", () => {
    expect(modeKey("preview")).toBe("sideagent:preview:mode");
    expect(widthKey("preview")).toBe("sideagent:preview:width");
    expect(threadKey("/agent", "preview")).toBe("sideagent:preview:thread:/agent");
    expect(modeKey("preview")).not.toBe(modeKey());
  });
});

import { describe, expect, it } from "vitest";
import { createSlots } from "./slots.js";

const taken = (r: ReturnType<ReturnType<typeof createSlots>["reserve"]>) => {
  if ("denied" in r) throw new Error(`denied: ${r.denied}`);
  return r;
};

describe("turn slots", () => {
  it("allows at most N turns per user, counted at once", () => {
    const slots = createSlots(2);
    taken(slots.reserve("u1"));
    taken(slots.reserve("u1"));
    expect(slots.reserve("u1")).toEqual({ denied: "user" });
    // Another user is not affected.
    taken(slots.reserve("u2"));
  });

  it("gives the slot back once, however often release is called", () => {
    const slots = createSlots(1);
    const a = taken(slots.reserve("u1"));
    a.release();
    a.release();
    taken(slots.reserve("u1"));
    // The second release of `a` did not free the slot `b` holds.
    expect(slots.reserve("u1")).toEqual({ denied: "user" });
  });

  it("allows one turn per thread", () => {
    const slots = createSlots(5);
    const a = taken(slots.reserve("u1", "t1"));
    expect(slots.reserve("u1", "t1")).toEqual({ denied: "thread" });
    taken(slots.reserve("u1", "t2"));
    a.release();
    taken(slots.reserve("u1", "t1"));
  });

  it("does not hold the user's slot for a thread-denied turn", () => {
    const slots = createSlots(2);
    taken(slots.reserve("u1", "t1"));
    expect(slots.reserve("u1", "t1")).toEqual({ denied: "thread" });
    taken(slots.reserve("u1", "t2"));
  });
});

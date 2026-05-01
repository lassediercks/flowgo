import { describe, expect, it } from "vitest";
import { addOrReplaceEdge, dropEdgesReferencing } from "./edge";

describe("addOrReplaceEdge", () => {
  it("appends to an empty array", () => {
    const out = addOrReplaceEdge([], { from: "a", to: "b" });
    expect(out).toEqual([{ from: "a", to: "b" }]);
  });

  it("replaces an existing edge between the same pair (same direction)", () => {
    const before = [{ from: "a", to: "b", fromHandle: "r", toHandle: "l" }];
    const out = addOrReplaceEdge(before, {
      from: "a",
      to: "b",
      fromHandle: "t",
      toHandle: "b",
    });
    expect(out).toEqual([
      { from: "a", to: "b", fromHandle: "t", toHandle: "b" },
    ]);
  });

  it("treats edges as undirected (replaces reversed pair too)", () => {
    const before = [{ from: "a", to: "b" }];
    const out = addOrReplaceEdge(before, { from: "b", to: "a" });
    expect(out).toEqual([{ from: "b", to: "a" }]);
  });

  it("leaves unrelated edges in place", () => {
    const before = [
      { from: "a", to: "b" },
      { from: "c", to: "d" },
    ];
    const out = addOrReplaceEdge(before, { from: "a", to: "b" });
    expect(out).toContainEqual({ from: "c", to: "d" });
    expect(out).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const before = [{ from: "a", to: "b" }];
    const snap = JSON.stringify(before);
    addOrReplaceEdge(before, { from: "a", to: "b" });
    expect(JSON.stringify(before)).toBe(snap);
  });
});

describe("dropEdgesReferencing", () => {
  it("removes every edge that touches a removed id", () => {
    const before = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "x", to: "y" },
    ];
    const out = dropEdgesReferencing(before, new Set(["b"]));
    expect(out).toEqual([{ from: "x", to: "y" }]);
  });

  it("returns the input verbatim when no ids match", () => {
    const before = [{ from: "a", to: "b" }];
    const out = dropEdgesReferencing(before, new Set(["z"]));
    expect(out).toEqual(before);
  });
});

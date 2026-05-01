import { describe, expect, it } from "vitest";
import { collectIds, nextUid } from "./id";

describe("nextUid", () => {
  it("returns prefix1 against an empty set", () => {
    expect(nextUid("b", new Set())).toBe("b1");
  });

  it("skips taken ids and picks the smallest free integer", () => {
    expect(nextUid("b", new Set(["b1", "b2"]))).toBe("b3");
  });

  it("fills holes — picks the lowest free n, not max+1", () => {
    expect(nextUid("b", new Set(["b1", "b3"]))).toBe("b2");
  });

  it("treats different prefixes as separate namespaces", () => {
    expect(nextUid("t", new Set(["b1", "b2"]))).toBe("t1");
    expect(nextUid("s", new Set(["s1", "s2", "s3"]))).toBe("s4");
  });

  it("is unaffected by ids that don't match the prefix-integer shape", () => {
    expect(nextUid("b", new Set(["box-foo", "b1"]))).toBe("b2");
  });
});

describe("collectIds", () => {
  it("merges ids from any number of arrays", () => {
    const a = [{ id: "b1" }, { id: "b2" }];
    const b = [{ id: "t1" }];
    const c = [{ id: "s1" }, { id: "s2" }];
    expect(collectIds(a, b, c)).toEqual(new Set(["b1", "b2", "t1", "s1", "s2"]));
  });

  it("deduplicates ids that appear in multiple sources", () => {
    const a = [{ id: "b1" }];
    const b = [{ id: "b1" }, { id: "b2" }];
    expect(collectIds(a, b)).toEqual(new Set(["b1", "b2"]));
  });

  it("returns an empty set when given no sources", () => {
    expect(collectIds()).toEqual(new Set());
  });
});

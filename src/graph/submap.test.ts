import { describe, expect, it } from "vitest";
import { hasSubmapContent, submapPathFor } from "./submap";

describe("submapPathFor", () => {
  it("hangs off root with a single slash", () => {
    expect(submapPathFor("/", "b1")).toBe("/b1");
  });

  it("appends to a nested path with a slash separator", () => {
    expect(submapPathFor("/b1", "b2")).toBe("/b1/b2");
    expect(submapPathFor("/b1/b2", "b3")).toBe("/b1/b2/b3");
  });
});

describe("hasSubmapContent", () => {
  it("returns false when the submap is missing entirely", () => {
    expect(hasSubmapContent({ maps: [] }, "/", "b1")).toBe(false);
  });

  it("returns false when the submap exists but is empty", () => {
    const g = { maps: [{ path: "/b1" }] };
    expect(hasSubmapContent(g, "/", "b1")).toBe(false);
  });

  it("returns true when the immediate submap has any item type", () => {
    expect(
      hasSubmapContent(
        { maps: [{ path: "/b1", boxes: [{}] }] },
        "/",
        "b1",
      ),
    ).toBe(true);
    expect(
      hasSubmapContent(
        { maps: [{ path: "/b1", strokes: [{}] }] },
        "/",
        "b1",
      ),
    ).toBe(true);
  });

  it("returns true when only a deeper descendant has content", () => {
    const g = {
      maps: [
        { path: "/b1" },
        { path: "/b1/b2", boxes: [{}] },
      ],
    };
    expect(hasSubmapContent(g, "/", "b1")).toBe(true);
  });

  it("does not match unrelated maps that share a prefix substring", () => {
    // /b1 must not match /b10 — the prefix check is "/<id>/" not just startsWith.
    const g = { maps: [{ path: "/b10", boxes: [{}] }] };
    expect(hasSubmapContent(g, "/", "b1")).toBe(false);
  });

  it("works for nested current paths", () => {
    const g = {
      maps: [{ path: "/b1/b2", boxes: [{}] }],
    };
    expect(hasSubmapContent(g, "/b1", "b2")).toBe(true);
  });
});

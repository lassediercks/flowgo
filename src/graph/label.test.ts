import { describe, expect, it } from "vitest";
import { MAX_LABEL_LEN, normalizeLabel } from "./label";

describe("normalizeLabel", () => {
  it("returns empty + not-truncated for null / undefined / empty input", () => {
    expect(normalizeLabel(null)).toEqual({ label: "", truncated: false });
    expect(normalizeLabel(undefined)).toEqual({ label: "", truncated: false });
    expect(normalizeLabel("")).toEqual({ label: "", truncated: false });
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeLabel("   hello   ")).toEqual({
      label: "hello",
      truncated: false,
    });
  });

  it("collapses internal non-newline whitespace runs to a single space", () => {
    expect(normalizeLabel("a   b\tc")).toEqual({
      label: "a b c",
      truncated: false,
    });
  });

  it("preserves explicit newlines as hard line breaks", () => {
    expect(normalizeLabel("first\nsecond")).toEqual({
      label: "first\nsecond",
      truncated: false,
    });
  });

  it("trims per-line and keeps interior blank lines", () => {
    expect(normalizeLabel("  a  \n\n  b  ")).toEqual({
      label: "a\n\nb",
      truncated: false,
    });
  });

  it("drops fully-blank leading and trailing lines", () => {
    expect(normalizeLabel("\n\nhi\n\n")).toEqual({
      label: "hi",
      truncated: false,
    });
  });

  it("normalises CRLF and CR to LF", () => {
    expect(normalizeLabel("a\r\nb\rc")).toEqual({
      label: "a\nb\nc",
      truncated: false,
    });
  });

  it("preserves single internal spaces", () => {
    expect(normalizeLabel("Should we roll a dice?")).toEqual({
      label: "Should we roll a dice?",
      truncated: false,
    });
  });

  it("does not strip punctuation, quotes, parens, or non-ASCII", () => {
    const sample = '/fmt.Errorf("line %d: edge needs from to", lineNo)?';
    expect(normalizeLabel(sample)).toEqual({
      label: sample,
      truncated: false,
    });
    expect(normalizeLabel("résumé — “smart quotes”").label).toBe(
      "résumé — “smart quotes”",
    );
  });

  it("hard-caps at MAX_LABEL_LEN by default and reports truncation", () => {
    const long = "x".repeat(MAX_LABEL_LEN + 50);
    const result = normalizeLabel(long);
    expect(result.label.length).toBe(MAX_LABEL_LEN);
    expect(result.truncated).toBe(true);
  });

  it("respects a caller-supplied cap", () => {
    expect(normalizeLabel("abcdef", { maxLength: 3 })).toEqual({
      label: "abc",
      truncated: true,
    });
  });

  it("does not flag truncation when within the cap", () => {
    expect(normalizeLabel("under cap").truncated).toBe(false);
  });

  it("preserves multi-line code-shaped paste with per-line trimming", () => {
    const multi = "func main() {\n    fmt.Println(\"hi\")\n}";
    expect(normalizeLabel(multi).label).toBe(
      'func main() {\nfmt.Println("hi")\n}',
    );
  });
});

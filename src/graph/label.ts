// Label normalisation: a single, pure transform applied to anything
// the user typed/pasted into a contenteditable region. Newlines are
// preserved (they render as hard line breaks in the box / text item),
// but every other whitespace run — spaces, tabs, NBSP, and friends —
// collapses to a single space. Per-line leading/trailing whitespace
// is trimmed, and fully blank leading/trailing lines are dropped.
// The result is hard-capped to `maxLength` characters so a 100kB
// paste can't blow up the file.

export const MAX_LABEL_LEN = 500;

export interface NormalizeOptions {
  readonly maxLength?: number;
}

export interface NormalizeResult {
  readonly label: string;
  readonly truncated: boolean;
}

// Match any whitespace *except* newline. Equivalent to \s minus \n.
const NON_NEWLINE_WS = /[^\S\n]+/g;

export const normalizeLabel = (
  raw: string | null | undefined,
  opts: NormalizeOptions = {},
): NormalizeResult => {
  const cap = opts.maxLength ?? MAX_LABEL_LEN;
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  const lines = text
    .split("\n")
    .map((l) => l.replace(NON_NEWLINE_WS, " ").trim());
  // Drop fully-empty leading / trailing lines while keeping interior
  // blank lines (a user might Shift+Enter twice for a paragraph gap).
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  const collapsed = lines.slice(start, end).join("\n");
  if (collapsed.length > cap) {
    return { label: collapsed.slice(0, cap), truncated: true };
  }
  return { label: collapsed, truncated: false };
};

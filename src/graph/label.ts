// Label normalisation: a single, pure transform applied to anything
// the user typed/pasted into a contenteditable region. Whitespace
// (including any flavour of \s — newlines, tabs, NBSP via ES2018
// unicode whitespace semantics) collapses to a single space; leading
// and trailing whitespace is trimmed; the result is hard-capped to
// `maxLength` characters so a 100kB paste can't blow up the file.

export const MAX_LABEL_LEN = 500;

export interface NormalizeOptions {
  readonly maxLength?: number;
}

export interface NormalizeResult {
  readonly label: string;
  readonly truncated: boolean;
}

export const normalizeLabel = (
  raw: string | null | undefined,
  opts: NormalizeOptions = {},
): NormalizeResult => {
  const cap = opts.maxLength ?? MAX_LABEL_LEN;
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length > cap) {
    return { label: collapsed.slice(0, cap), truncated: true };
  }
  return { label: collapsed, truncated: false };
};

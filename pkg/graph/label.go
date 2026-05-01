package graph

import (
	"strings"
	"unicode"
)

// MaxLabelLen mirrors MAX_LABEL_LEN in the JS editor. Box and text
// labels are clamped to this length on every entry path that produces
// new graph data — JS finish(), MCP add_box / update_box / add_text,
// any future ingestion. The validator flags anything longer in
// already-stored data.
const MaxLabelLen = 500

// NormalizeLabel collapses every run of whitespace (newlines, tabs,
// non-breaking space, …) to a single space, trims the result, and
// hard-caps to maxLen. Mirrors normalizeLabel() in src/graph/label.ts.
//
// Newlines have to go in particular: the .flowgo text format is
// line-based, so a literal newline inside a label corrupts the file
// (the parser splits at the wrong point and the resulting tokens
// don't make sense). Every code path that takes a label from the
// outside world should run it through here before storing.
func NormalizeLabel(raw string) string {
	if raw == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(raw))
	prevSpace := true
	for _, r := range raw {
		if unicode.IsSpace(r) {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		b.WriteRune(r)
		prevSpace = false
	}
	out := b.String()
	if len(out) > 0 && out[len(out)-1] == ' ' {
		out = out[:len(out)-1]
	}
	// Cap on rune boundary so the slice doesn't split a multi-byte
	// codepoint in half.
	runes := []rune(out)
	if len(runes) > MaxLabelLen {
		out = string(runes[:MaxLabelLen])
	}
	return out
}

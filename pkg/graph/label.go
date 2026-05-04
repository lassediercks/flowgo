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

// NormalizeLabel collapses every run of non-newline whitespace to a
// single space, trims each line, drops fully-blank leading / trailing
// lines, and hard-caps to MaxLabelLen. Newlines are preserved — they
// render as hard line breaks in the editor and round-trip through the
// .flowgo file as a `\n` escape inside a quoted label. Mirrors
// normalizeLabel() in src/graph/label.ts.
//
// The .flowgo text format is line-based, so a literal newline inside
// a label would corrupt the file; the serializer in graph.go handles
// the escape and the tokenizer decodes it on the way back in.
func NormalizeLabel(raw string) string {
	if raw == "" {
		return ""
	}
	// Normalise CRLF / CR → LF first so per-line work is uniform.
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	lines := strings.Split(raw, "\n")
	for i, line := range lines {
		lines[i] = collapseNonNewlineWS(line)
	}
	// Drop fully-empty leading / trailing lines while keeping interior
	// blank lines (a user might Shift+Enter twice for a paragraph gap).
	start := 0
	for start < len(lines) && lines[start] == "" {
		start++
	}
	end := len(lines)
	for end > start && lines[end-1] == "" {
		end--
	}
	out := strings.Join(lines[start:end], "\n")
	// Cap on rune boundary so the slice doesn't split a multi-byte
	// codepoint in half.
	runes := []rune(out)
	if len(runes) > MaxLabelLen {
		out = string(runes[:MaxLabelLen])
	}
	return out
}

func collapseNonNewlineWS(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := true
	for _, r := range s {
		if r != '\n' && unicode.IsSpace(r) {
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
	return out
}

package main

import (
	"strings"
	"testing"

	"github.com/lassediercks/flowgo/pkg/graph"
)

// freshGraph mints a graph with a single root map so every action has
// somewhere to land without first calling actSetState.
func freshGraph() *Graph {
	return &Graph{Maps: []NamedMap{{Path: "/"}}}
}

// TestActAddBox_NormalisesLabel covers the regression that motivated
// this test file: an MCP `add_box` call with a literal newline in the
// label was stored verbatim and then corrupted the .flowgo file (the
// line-based parser splits the box directive at the newline).
//
// NormalizeLabel collapses every whitespace run to a single space, so
// the stored label is single-line regardless of what the caller sent.
func TestActAddBox_NormalisesLabel(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "hello", "hello"},
		{"trims_outer_whitespace", "  hello  ", "hello"},
		{"collapses_internal_runs", "a   b\tc", "a b c"},
		{"strips_newlines", "run-opencode.sh\nEntry Point", "run-opencode.sh Entry Point"},
		{"strips_carriage_return", "a\r\nb", "a b"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := freshGraph()
			_, err := actAddBox(g, map[string]any{
				"label": tc.in,
				"x":     float64(0),
				"y":     float64(0),
			})
			if err != nil {
				t.Fatalf("actAddBox: %v", err)
			}
			if len(g.Maps[0].Boxes) != 1 {
				t.Fatalf("expected 1 box, got %d", len(g.Maps[0].Boxes))
			}
			got := g.Maps[0].Boxes[0].Label
			if got != tc.want {
				t.Fatalf("label mismatch:\n  got  %q\n  want %q", got, tc.want)
			}
			if strings.ContainsAny(got, "\r\n") {
				t.Fatalf("normalised label still contains a newline: %q", got)
			}
		})
	}
}

func TestActAddBox_RejectsEmptyLabel(t *testing.T) {
	g := freshGraph()
	_, err := actAddBox(g, map[string]any{
		"label": "",
		"x":     float64(0),
		"y":     float64(0),
	})
	if err == nil {
		t.Fatal("expected error for empty label")
	}
}

func TestActAddBox_RejectsWhitespaceOnlyLabel(t *testing.T) {
	// "   \n\t" normalises to "" and should error like an empty label.
	g := freshGraph()
	_, err := actAddBox(g, map[string]any{
		"label": "   \n\t  ",
		"x":     float64(0),
		"y":     float64(0),
	})
	if err == nil {
		t.Fatal("expected error for whitespace-only label")
	}
}

func TestActAddBox_CapsLongLabel(t *testing.T) {
	long := strings.Repeat("x", graph.MaxLabelLen+200)
	g := freshGraph()
	_, err := actAddBox(g, map[string]any{
		"label": long,
		"x":     float64(0),
		"y":     float64(0),
	})
	if err != nil {
		t.Fatalf("actAddBox: %v", err)
	}
	got := g.Maps[0].Boxes[0].Label
	if len([]rune(got)) > graph.MaxLabelLen {
		t.Fatalf("label not capped: got %d runes, cap %d", len([]rune(got)), graph.MaxLabelLen)
	}
}

func TestActAddBox_AcceptsValidStylingArgs(t *testing.T) {
	g := freshGraph()
	_, err := actAddBox(g, map[string]any{
		"label":   "hi",
		"x":       float64(10),
		"y":       float64(20),
		"sides":   float64(5),
		"palette": float64(7),
		"font":    float64(4),
	})
	if err != nil {
		t.Fatalf("actAddBox: %v", err)
	}
	b := g.Maps[0].Boxes[0]
	if b.Sides != 5 || b.Palette != 7 || b.Font != 4 {
		t.Fatalf("styling round-trip failed: %+v", b)
	}
}

func TestActAddBox_RejectsInvalidSides(t *testing.T) {
	g := freshGraph()
	_, err := actAddBox(g, map[string]any{
		"label": "hi",
		"x":     float64(0),
		"y":     float64(0),
		"sides": float64(7),
	})
	if err == nil {
		t.Fatal("expected error for sides=7")
	}
}

func TestActUpdateBox_NormalisesLabel(t *testing.T) {
	g := freshGraph()
	id, err := actAddBox(g, map[string]any{
		"label": "before",
		"x":     float64(0),
		"y":     float64(0),
	})
	if err != nil {
		t.Fatalf("actAddBox: %v", err)
	}
	rawID := mcpFirstText(id)
	_, err = actUpdateBox(g, map[string]any{
		"id":    rawID,
		"label": "line one\nline two",
	})
	if err != nil {
		t.Fatalf("actUpdateBox: %v", err)
	}
	got := g.Maps[0].Boxes[0].Label
	if got != "line one line two" {
		t.Fatalf("update label mismatch: %q", got)
	}
}

func TestActAddText_NormalisesLabel(t *testing.T) {
	g := freshGraph()
	_, err := actAddText(g, map[string]any{
		"label": "first\nsecond",
		"x":     float64(0),
		"y":     float64(0),
	})
	if err != nil {
		t.Fatalf("actAddText: %v", err)
	}
	got := g.Maps[0].Texts[0].Label
	if strings.ContainsAny(got, "\r\n") {
		t.Fatalf("text label not normalised: %q", got)
	}
}

func TestActAddBox_RoundTripsThroughSerializeParse(t *testing.T) {
	// End-to-end safety net: a normalised label must always survive
	// serialize → parse without breaking the file format.
	g := freshGraph()
	for _, lbl := range []string{
		"plain",
		"with spaces in it",
		`with "quotes"`,
		"after\nnewline",
		"after\ttab",
	} {
		if _, err := actAddBox(g, map[string]any{
			"label": lbl,
			"x":     float64(0),
			"y":     float64(0),
		}); err != nil {
			t.Fatalf("actAddBox(%q): %v", lbl, err)
		}
	}
	text := serialize(*g)
	round, err := parse(text)
	if err != nil {
		t.Fatalf("parse(serialize(g)) failed: %v\n--- serialised ---\n%s", err, text)
	}
	if len(round.Maps) == 0 || len(round.Maps[0].Boxes) != len(g.Maps[0].Boxes) {
		t.Fatalf("round-trip lost boxes:\n--- serialised ---\n%s", text)
	}
}

// mcpFirstText pulls the first text payload from a tool result, which
// is what add_box returns (the new id wrapped in mcpToolText).
func mcpFirstText(v any) string {
	type content struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	type result struct {
		Content []content `json:"content"`
	}
	if r, ok := v.(map[string]any); ok {
		if cs, ok := r["content"].([]map[string]any); ok && len(cs) > 0 {
			if s, ok := cs[0]["text"].(string); ok {
				return s
			}
		}
	}
	// Fall back: tool results are typed structurally, so reach in via
	// reflection-free access on the known shape.
	if r, ok := v.(map[string]any); ok {
		if cs, ok := r["content"].([]any); ok && len(cs) > 0 {
			if c, ok := cs[0].(map[string]any); ok {
				if s, ok := c["text"].(string); ok {
					return s
				}
			}
		}
	}
	return ""
}

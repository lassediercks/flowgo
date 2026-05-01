package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
)

var version = "dev"

//go:embed index.html
var indexHTML string

//go:embed .release-please-manifest.json
var releasePleaseManifest []byte

type Box struct {
	ID      string  `json:"id"`
	Label   string  `json:"label"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Sides   int     `json:"sides,omitempty"`
	Palette int     `json:"palette,omitempty"`
	Font    int     `json:"font,omitempty"`
}

type Edge struct {
	From       string `json:"from"`
	FromHandle string `json:"fromHandle,omitempty"`
	To         string `json:"to"`
	ToHandle   string `json:"toHandle,omitempty"`
}

type Text struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

type Line struct {
	ID string  `json:"id"`
	X1 float64 `json:"x1"`
	Y1 float64 `json:"y1"`
	X2 float64 `json:"x2"`
	Y2 float64 `json:"y2"`
}

type Stroke struct {
	ID     string      `json:"id"`
	Points [][]float64 `json:"points"`
}

type NamedMap struct {
	Path    string   `json:"path"`
	Boxes   []Box    `json:"boxes"`
	Edges   []Edge   `json:"edges"`
	Texts   []Text   `json:"texts,omitempty"`
	Lines   []Line   `json:"lines,omitempty"`
	Strokes []Stroke `json:"strokes,omitempty"`
}

type Graph struct {
	Maps []NamedMap `json:"maps"`
}

var (
	mu       sync.Mutex
	filePath string
)

func main() {
	if len(os.Args) < 2 {
		printUsage(os.Stderr)
		os.Exit(1)
	}
	switch os.Args[1] {
	case "serve":
		runServe(os.Args[2:])
		return
	}
	bindHost := "127.0.0.1"
	var positional []string
	for _, a := range os.Args[1:] {
		switch a {
		case "version", "-v", "--version":
			printVersion(os.Stdout)
			return
		case "help", "-h", "--help":
			printUsage(os.Stdout)
			return
		case "--host":
			bindHost = "0.0.0.0"
		default:
			if strings.HasPrefix(a, "-") {
				fmt.Fprintf(os.Stderr, "unknown flag: %s\n", a)
				os.Exit(1)
			}
			positional = append(positional, a)
		}
	}
	if len(positional) < 1 {
		printUsage(os.Stderr)
		os.Exit(1)
	}
	filePath = positional[0]

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		if err := os.WriteFile(filePath, []byte(""), 0644); err != nil {
			die("create file: %v", err)
		}
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(indexHTML))
	})
	http.HandleFunc("/state", handleState)
	http.HandleFunc("/save", handleSave)
	http.HandleFunc("/version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, resolveVersionString())
	})
	http.HandleFunc("/mcp", handleMCP)

	ln, err := net.Listen("tcp", bindHost+":0")
	if err != nil {
		die("listen: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	url := fmt.Sprintf("http://%s:%d", bindHost, addr.Port)
	fmt.Printf("flowgo editing %s\n  GUI: %s\n  MCP: %s/mcp\n", filePath, url, url)
	if bindHost == "127.0.0.1" {
		openBrowser(url)
	} else {
		fmt.Printf("  (bound to all interfaces — substitute 0.0.0.0 with the host's IP / localhost when you connect)\n")
	}
	if err := http.Serve(ln, nil); err != nil {
		die("serve: %v", err)
	}
}

func handleState(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	data, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	g, err := parse(string(data))
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(g)
}

func handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var g Graph
	if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	mu.Lock()
	defer mu.Unlock()
	if err := os.WriteFile(filePath, []byte(serialize(g)), 0644); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.WriteHeader(204)
}

func parse(s string) (Graph, error) {
	var g Graph
	findOrCreate := func(path string) int {
		for i, m := range g.Maps {
			if m.Path == path {
				return i
			}
		}
		g.Maps = append(g.Maps, NamedMap{Path: path})
		return len(g.Maps) - 1
	}
	cur := findOrCreate("/")

	sc := bufio.NewScanner(strings.NewReader(s))
	lineNo := 0
	for sc.Scan() {
		lineNo++
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		toks := tokenize(line)
		if len(toks) == 0 {
			continue
		}
		switch toks[0] {
		case "map":
			if len(toks) < 2 {
				return g, fmt.Errorf("line %d: map needs path", lineNo)
			}
			cur = findOrCreate(toks[1])
		case "box":
			if len(toks) < 5 {
				return g, fmt.Errorf("line %d: box needs id label x y", lineNo)
			}
			x, err := strconv.ParseFloat(toks[3], 64)
			if err != nil {
				return g, fmt.Errorf("line %d: bad x: %v", lineNo, err)
			}
			y, err := strconv.ParseFloat(toks[4], 64)
			if err != nil {
				return g, fmt.Errorf("line %d: bad y: %v", lineNo, err)
			}
			box := Box{ID: toks[1], Label: toks[2], X: x, Y: y}
			if len(toks) >= 6 {
				sides, err := strconv.Atoi(toks[5])
				if err != nil {
					return g, fmt.Errorf("line %d: bad sides: %v", lineNo, err)
				}
				if sides == 3 || sides == 5 || sides == 6 {
					box.Sides = sides
				}
			}
			if len(toks) >= 7 {
				palette, err := strconv.Atoi(toks[6])
				if err != nil {
					return g, fmt.Errorf("line %d: bad palette: %v", lineNo, err)
				}
				if palette >= 2 && palette <= 9 {
					box.Palette = palette
				}
			}
			if len(toks) >= 8 {
				font, err := strconv.Atoi(toks[7])
				if err != nil {
					return g, fmt.Errorf("line %d: bad font: %v", lineNo, err)
				}
				if font >= 2 && font <= 9 {
					box.Font = font
				}
			}
			g.Maps[cur].Boxes = append(g.Maps[cur].Boxes, box)
		case "edge":
			if len(toks) < 3 {
				return g, fmt.Errorf("line %d: edge needs from to", lineNo)
			}
			fromID, fromH := splitEndpoint(toks[1])
			toID, toH := splitEndpoint(toks[2])
			g.Maps[cur].Edges = append(g.Maps[cur].Edges, Edge{From: fromID, FromHandle: fromH, To: toID, ToHandle: toH})
		case "text":
			if len(toks) < 5 {
				return g, fmt.Errorf("line %d: text needs id label x y", lineNo)
			}
			x, err := strconv.ParseFloat(toks[3], 64)
			if err != nil {
				return g, fmt.Errorf("line %d: bad x: %v", lineNo, err)
			}
			y, err := strconv.ParseFloat(toks[4], 64)
			if err != nil {
				return g, fmt.Errorf("line %d: bad y: %v", lineNo, err)
			}
			g.Maps[cur].Texts = append(g.Maps[cur].Texts, Text{ID: toks[1], Label: toks[2], X: x, Y: y})
		case "line":
			if len(toks) < 6 {
				return g, fmt.Errorf("line %d: line needs id x1 y1 x2 y2", lineNo)
			}
			coords := make([]float64, 4)
			for i, t := range toks[2:6] {
				v, err := strconv.ParseFloat(t, 64)
				if err != nil {
					return g, fmt.Errorf("line %d: bad coord: %v", lineNo, err)
				}
				coords[i] = v
			}
			g.Maps[cur].Lines = append(g.Maps[cur].Lines, Line{ID: toks[1], X1: coords[0], Y1: coords[1], X2: coords[2], Y2: coords[3]})
		case "stroke":
			if len(toks) < 4 {
				return g, fmt.Errorf("line %d: stroke needs id and at least two points", lineNo)
			}
			pts := make([][]float64, 0, len(toks)-2)
			for _, pair := range toks[2:] {
				parts := strings.SplitN(pair, ",", 2)
				if len(parts) != 2 {
					return g, fmt.Errorf("line %d: bad stroke point %q", lineNo, pair)
				}
				px, err := strconv.ParseFloat(parts[0], 64)
				if err != nil {
					return g, fmt.Errorf("line %d: bad stroke x: %v", lineNo, err)
				}
				py, err := strconv.ParseFloat(parts[1], 64)
				if err != nil {
					return g, fmt.Errorf("line %d: bad stroke y: %v", lineNo, err)
				}
				pts = append(pts, []float64{px, py})
			}
			g.Maps[cur].Strokes = append(g.Maps[cur].Strokes, Stroke{ID: toks[1], Points: pts})
		default:
			return g, fmt.Errorf("line %d: unknown directive %q", lineNo, toks[0])
		}
	}
	return g, sc.Err()
}

func tokenize(line string) []string {
	var out []string
	var cur strings.Builder
	inQuote := false
	escape := false
	for _, r := range line {
		switch {
		case escape:
			cur.WriteRune(r)
			escape = false
		case r == '\\':
			escape = true
		case r == '"':
			inQuote = !inQuote
		case !inQuote && (r == ' ' || r == '\t'):
			if cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}

func serialize(g Graph) string {
	var b strings.Builder
	// Drop empty maps; they will be re-created on demand if navigated to.
	var nonEmpty []NamedMap
	for _, m := range g.Maps {
		if len(m.Boxes) == 0 && len(m.Edges) == 0 && len(m.Texts) == 0 && len(m.Lines) == 0 && len(m.Strokes) == 0 {
			continue
		}
		nonEmpty = append(nonEmpty, m)
	}
	multi := len(nonEmpty) > 1
	for i, m := range nonEmpty {
		if i > 0 {
			b.WriteString("\n")
		}
		if multi || m.Path != "/" {
			fmt.Fprintf(&b, "map %s\n", m.Path)
		}
		for _, box := range m.Boxes {
			emitSides := box.Sides == 3 || box.Sides == 5 || box.Sides == 6
			emitPalette := box.Palette >= 2 && box.Palette <= 9
			emitFont := box.Font >= 2 && box.Font <= 9
			fmt.Fprintf(&b, "box %s %s %g %g", box.ID, quote(box.Label), box.X, box.Y)
			if emitSides || emitPalette || emitFont {
				sides := box.Sides
				if !emitSides {
					sides = 4
				}
				fmt.Fprintf(&b, " %d", sides)
			}
			if emitPalette || emitFont {
				palette := box.Palette
				if !emitPalette {
					palette = 1
				}
				fmt.Fprintf(&b, " %d", palette)
			}
			if emitFont {
				fmt.Fprintf(&b, " %d", box.Font)
			}
			b.WriteString("\n")
		}
		if len(m.Boxes) > 0 && len(m.Edges) > 0 {
			b.WriteString("\n")
		}
		for _, e := range m.Edges {
			fmt.Fprintf(&b, "edge %s %s\n", joinEndpoint(e.From, e.FromHandle), joinEndpoint(e.To, e.ToHandle))
		}
		if (len(m.Boxes) > 0 || len(m.Edges) > 0) && len(m.Texts) > 0 {
			b.WriteString("\n")
		}
		for _, t := range m.Texts {
			fmt.Fprintf(&b, "text %s %s %g %g\n", t.ID, quote(t.Label), t.X, t.Y)
		}
		if (len(m.Boxes) > 0 || len(m.Edges) > 0 || len(m.Texts) > 0) && len(m.Lines) > 0 {
			b.WriteString("\n")
		}
		for _, l := range m.Lines {
			fmt.Fprintf(&b, "line %s %g %g %g %g\n", l.ID, l.X1, l.Y1, l.X2, l.Y2)
		}
		if (len(m.Boxes) > 0 || len(m.Edges) > 0 || len(m.Texts) > 0 || len(m.Lines) > 0) && len(m.Strokes) > 0 {
			b.WriteString("\n")
		}
		for _, s := range m.Strokes {
			if len(s.Points) < 2 {
				continue
			}
			fmt.Fprintf(&b, "stroke %s", s.ID)
			for _, p := range s.Points {
				if len(p) < 2 {
					continue
				}
				fmt.Fprintf(&b, " %g,%g", p[0], p[1])
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}

func splitEndpoint(s string) (string, string) {
	if i := strings.Index(s, ":"); i >= 0 {
		return s[:i], s[i+1:]
	}
	return s, ""
}

func joinEndpoint(id, handle string) string {
	if handle == "" {
		return id
	}
	return id + ":" + handle
}

func quote(s string) string {
	if s == "" || strings.ContainsAny(s, " \t\"\\") {
		r := strings.NewReplacer("\\", "\\\\", "\"", "\\\"")
		return "\"" + r.Replace(s) + "\""
	}
	return s
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func die(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}

func printUsage(w *os.File) {
	fmt.Fprintf(w, `flowgo — browser-based mind-map editor backed by a plain-text file.

Usage:
  flowgo <file.flowgo>             open the editor (binds 127.0.0.1 only)
  flowgo <file.flowgo> --host      bind 0.0.0.0 (reach from outside this machine/container)
  flowgo serve [flags]             public mode: multi-workspace MCP + share-via-webhook
                                   (run 'flowgo serve --help' for flags)
  flowgo version                   print version info
  flowgo help                      show this message
`)
}

func resolveVersionString() string {
	if version != "dev" {
		return version
	}
	var m map[string]string
	if err := json.Unmarshal(releasePleaseManifest, &m); err == nil {
		if v := m["."]; v != "" {
			return v
		}
	}
	return "dev"
}

func compactVersion() string {
	v := version
	var rev string
	dirty := false
	if info, ok := debug.ReadBuildInfo(); ok {
		if v == "dev" && info.Main.Version != "" && info.Main.Version != "(devel)" {
			v = info.Main.Version
		}
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				if len(s.Value) > 12 {
					rev = s.Value[:12]
				} else {
					rev = s.Value
				}
			case "vcs.modified":
				if s.Value == "true" {
					dirty = true
				}
			}
		}
	}
	if rev == "" {
		return v
	}
	suffix := ""
	if dirty {
		suffix = "+dirty"
	}
	return v + " (" + rev + suffix + ")"
}

func printVersion(w *os.File) {
	v := resolveVersionString()
	var rev, when string
	modified := ""
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				rev = s.Value
			case "vcs.time":
				when = s.Value
			case "vcs.modified":
				if s.Value == "true" {
					modified = "+dirty"
				}
			}
		}
	}
	fmt.Fprintf(w, "flowgo %s", v)
	if rev != "" {
		short := rev
		if len(short) > 12 {
			short = short[:12]
		}
		fmt.Fprintf(w, " (%s%s", short, modified)
		if when != "" {
			fmt.Fprintf(w, ", %s", when)
		}
		fmt.Fprintf(w, ")")
	}
	fmt.Fprintln(w)
}

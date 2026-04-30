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

type Box struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

type Edge struct {
	From       string `json:"from"`
	FromHandle string `json:"fromHandle,omitempty"`
	To         string `json:"to"`
	ToHandle   string `json:"toHandle,omitempty"`
}

type NamedMap struct {
	Path  string `json:"path"`
	Boxes []Box  `json:"boxes"`
	Edges []Edge `json:"edges"`
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
	case "version", "-v", "--version":
		printVersion(os.Stdout)
		return
	case "help", "-h", "--help":
		printUsage(os.Stdout)
		return
	}
	filePath = os.Args[1]

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

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		die("listen: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	url := fmt.Sprintf("http://127.0.0.1:%d", addr.Port)
	fmt.Printf("flowgo editing %s at %s\n", filePath, url)
	openBrowser(url)
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
			g.Maps[cur].Boxes = append(g.Maps[cur].Boxes, Box{ID: toks[1], Label: toks[2], X: x, Y: y})
		case "edge":
			if len(toks) < 3 {
				return g, fmt.Errorf("line %d: edge needs from to", lineNo)
			}
			fromID, fromH := splitEndpoint(toks[1])
			toID, toH := splitEndpoint(toks[2])
			g.Maps[cur].Edges = append(g.Maps[cur].Edges, Edge{From: fromID, FromHandle: fromH, To: toID, ToHandle: toH})
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
		if len(m.Boxes) == 0 && len(m.Edges) == 0 {
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
			fmt.Fprintf(&b, "box %s %s %g %g\n", box.ID, quote(box.Label), box.X, box.Y)
		}
		if len(m.Boxes) > 0 && len(m.Edges) > 0 {
			b.WriteString("\n")
		}
		for _, e := range m.Edges {
			fmt.Fprintf(&b, "edge %s %s\n", joinEndpoint(e.From, e.FromHandle), joinEndpoint(e.To, e.ToHandle))
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
  flowgo <file.flowgo>     open the editor on the given file (created if missing)
  flowgo version           print version info
  flowgo help              show this message
`)
}

func printVersion(w *os.File) {
	v := version
	var rev, when string
	modified := ""
	if info, ok := debug.ReadBuildInfo(); ok {
		// Prefer the ldflags-injected version (set on release builds).
		// Only fall back to the module version for default `go install` builds.
		if v == "dev" && info.Main.Version != "" && info.Main.Version != "(devel)" {
			v = info.Main.Version
		}
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

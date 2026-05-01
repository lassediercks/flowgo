package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"

	"github.com/lassediercks/flowgo/pkg/graph"
)

// Re-export the graph types and parser/serializer under their original
// unqualified names so the rest of this binary (mcp.go, serve.go,
// workspace.go, validate*.go) keeps compiling without churn. External
// consumers should import github.com/lassediercks/flowgo/pkg/graph
// directly instead of relying on these aliases.
type (
	Box      = graph.Box
	Edge     = graph.Edge
	Text     = graph.Text
	Line     = graph.Line
	Stroke   = graph.Stroke
	NamedMap = graph.NamedMap
	Graph    = graph.Graph
)

var (
	parse     = graph.Parse
	serialize = graph.Serialize
)

var version = "dev"

//go:embed dist/index.html
var indexHTML string

//go:embed .release-please-manifest.json
var releasePleaseManifest []byte

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

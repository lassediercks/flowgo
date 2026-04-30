# flowgo

A tiny mind-map / flowchart editor that round-trips between a browser GUI and a
plain-text `.flowgo` file. Every change in the GUI rewrites the file, and the
file is the source of truth — you can hand-edit it, version-control it, or
generate it from another tool.

## Install

From a checkout of this repo:

```
go install .
```

This drops a `flowgo` binary into `$(go env GOBIN)` (or `$(go env GOPATH)/bin`).
Make sure that directory is on your `PATH`.

For a one-off build without installing:

```
go build -o flowgo .
```

Verify:

```
flowgo version
flowgo help
```

## Run

```
flowgo mindmap.flowgo
```

The binary starts an HTTP server on a random `127.0.0.1` port, prints the URL,
and tries to open your browser. If the file doesn't exist it's created empty.

## Editor

| Action                                     | Result                                       |
|--------------------------------------------|----------------------------------------------|
| `+ Box` / double-click empty canvas        | Add a new box (centered at cursor) and edit  |
| Click a box                                | Select it                                    |
| Double-click a box                         | Edit its label inline (Enter / Escape)       |
| Drag a box body                            | Move it (and any other boxes selected)       |
| ⌥-drag a box body                          | Duplicate the selection and drag the copies  |
| Drag on empty canvas                       | Rubber-band select boxes; Shift to add       |
| Drag a blue dot to another box / handle   | Create a connection (replaces any prior one) |
| Drag a blue dot into empty space           | Spawn a new box and connect to it            |
| `Connect` button → click source, target    | Create a connection (auto-picks handles)     |
| Click an edge                              | Select it (turns blue + thicker)             |
| `Delete` / `Backspace`                     | Remove all selected boxes / the selected edge|
| Middle-click or ⌘-click a box              | Enter its submap                             |
| `↑ Up` / breadcrumb segments               | Navigate back up                             |

Connections are undirected and at most one exists between any pair of boxes —
creating a new one between A and B replaces any prior connection.

Each map has its own box-ID namespace; deleting a box also removes its submap
and all descendants.

## File format

Plain UTF-8 text, one directive per line, `#` for comments.

```
# optional map header; defaults to "/" if omitted
map /

box <id> <label> <x> <y>
edge <id>[:<handle>] <id>[:<handle>]
```

- `id` is alphanumeric; unique within its map.
- `label` is bare word or `"quoted string"` (use `\"` and `\\` to escape).
- `<handle>` is one of `t`, `r`, `b`, `l`, `tl`, `tr`, `bl`, `br` — a side or
  corner of the box. Omit to let the renderer auto-pick the nearest handle.
- `map <path>` switches the current map. Paths look like `/`, `/b1`, `/b1/c2`.
  Each path corresponds to "the inside of" the box at that path.

### Example

```
box b1 "Project" 120 100
box b2 "Notes"   320 100
edge b1:r b2:l

map /b1
box c1 "Goals"     100 100
box c2 "Open issues" 280 100
edge c1 c2

map /b1/c2
box d1 "Bug #42" 100 100
```

Files without any `map` directive parse as a single root map — fully
backwards-compatible with the flat form.

## Releases

Releases are managed by [release-please](https://github.com/googleapis/release-please).
Push commits to `main` using
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`feat!:` for breaking changes, etc.) and the workflow will open a "release-PR".
Merging that PR tags a new version, creates a GitHub release, and attaches
prebuilt binaries for `linux/{amd64,arm64}`, `darwin/{amd64,arm64}`, and
`windows/amd64`.

Versioning policy (configured in `release-please-config.json`):

- Tags are plain semver (`0.0.1`, `0.0.2`, …) — no `v` prefix.
- We're in the pre-1.0 phase: `bump-patch-for-minor-pre-major` makes regular
  `feat:` commits bump the patch (so we stay in `0.0.*`); breaking changes
  (`feat!:` / `BREAKING CHANGE:`) bump the minor (`0.0.* → 0.1.0`).

The version baked into the release binaries is set via
`-ldflags "-X main.version=<tag>"` and is shown by `flowgo version`.


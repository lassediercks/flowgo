// Server-injected feature flags, read off the editor's own URL the
// same way EMBED_MODE is (see embed.ts) — the embedder controls what
// it links to, the bundle stays unaware of who's hosting it.
//
// IMAGES_ENABLED gates paste-from-clipboard / drag-and-drop image
// insert (media.ts) and the corresponding help-overlay line. It
// defaults ON: every embedder that doesn't say otherwise — the CLI,
// Obsidian, VS Code, a standalone build — keeps image paste working,
// because POST /media (content-addressed storage next to the .flowgo
// file) is available there. flowgo-website is the one embedder
// without that storage wired up server-side (no /media route), so it
// is the one place that explicitly opts out with `?images=0` on the
// /editor iframe's src (see renderAppShell in flowgo-website's
// main.go). Absent, empty, or unrecognized values read as enabled;
// only an explicit "0" / "false" turns it off — same convention as
// embedFlag, mirrored rather than shared because the two flags default
// in opposite directions.
const imagesFlag = (v: string | null): boolean => {
  if (v === null) return true;
  const s = v.trim().toLowerCase();
  return s !== "0" && s !== "false";
};

export const IMAGES_ENABLED: boolean =
  typeof location === "undefined" ||
  imagesFlag(new URLSearchParams(location.search).get("images"));

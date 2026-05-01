import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = fileURLToPath(new URL(".", import.meta.url));

// Vite root is src/editor (the source HTML lives there). The build
// emits a single self-contained index.html into dist/, which the Go
// binary embeds via //go:embed dist/index.html. Devs run `npm run dev`
// for an HMR server and `npm run build` before `go build`.
export default defineConfig({
  root: resolve(here, "src/editor"),
  publicDir: false,
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  plugins: [viteSingleFile()],
});

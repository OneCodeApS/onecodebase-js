import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Read the version straight from package.json so the built bundle always stamps
// the right SDK version (see src/version.ts) — no second place to keep in sync.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // Emit per-format declarations: index.d.ts (esm) + index.d.cts (cjs).
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  target: "es2020",
  // Inlined into the bundle wherever `__SDK_VERSION__` appears.
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
  // @supabase/postgrest-js stays an external runtime dependency rather than
  // being bundled in, so consumers dedupe it and we don't ship a copy.
  external: ["@supabase/postgrest-js"],
});

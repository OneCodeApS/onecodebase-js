import { defineConfig } from "tsup";

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
  // @supabase/postgrest-js stays an external runtime dependency rather than
  // being bundled in, so consumers dedupe it and we don't ship a copy.
  external: ["@supabase/postgrest-js"],
});

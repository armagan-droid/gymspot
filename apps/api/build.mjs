// Production bundle (T5.4): one ESM file per entry; workspace TS packages are
// bundled in. The native Argon2 binding stays external and is installed in the image.
import { build } from "esbuild";

await build({
  entryPoints: {
    server: "src/server.ts",
    "admin-cli": "src/cli/admin-cli.ts",
    "calibration-report": "src/cli/calibration-report.ts",
  },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  external: ["@node-rs/argon2", "pg-native"],
  // some CommonJS dependencies call require(); give ESM output one
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  sourcemap: true,
  logLevel: "info",
});

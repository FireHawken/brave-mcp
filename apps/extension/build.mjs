import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const rootDir = resolve(".");
const distDir = resolve(rootDir, "dist");
const staticDir = resolve(rootDir, "static");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: {
    background: "src/background.ts",
    options: "src/options.ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome130",
  outdir: distDir,
  sourcemap: true,
});

await cp(staticDir, distDir, { recursive: true });


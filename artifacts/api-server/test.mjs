import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(artifactDir, ".test-dist");

await rm(outputDir, { recursive: true, force: true });
await build({
  entryPoints: [path.join(artifactDir, "test/live-score-integrity.test.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["pg-native"],
  banner: {
    js: `import { createRequire as __createRequire } from "node:module";
globalThis.require = __createRequire(import.meta.url);`,
  },
  outdir: outputDir,
});

const child = spawn(
  process.execPath,
  ["--test", path.join(outputDir, "live-score-integrity.test.js")],
  {
    stdio: "inherit",
    env: process.env,
  },
);
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
await rm(outputDir, { recursive: true, force: true });
process.exitCode = exitCode;

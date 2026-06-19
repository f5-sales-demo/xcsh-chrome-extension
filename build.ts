import * as fs from "node:fs";

await Bun.build({
  entrypoints: ["src/accessibility-tree.ts"],
  outdir: "dist",
  target: "browser",
  minify: false,
});

await Bun.build({
  entrypoints: ["src/service-worker.ts"],
  outdir: "dist",
  target: "browser",
  minify: false,
  format: "esm",
});

fs.copyFileSync("manifest.json", "dist/manifest.json");
console.log("built dist/");

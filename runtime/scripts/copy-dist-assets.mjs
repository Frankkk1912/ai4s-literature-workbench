// Copies build assets that tsc does not emit: the public SPA, and every .mjs
// module in src/lib. The compiled bridge loads these at runtime, so copying the
// whole folder means a new helper cannot be left out of the published package.
import { cpSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";

cpSync("src/public", "dist/public", { recursive: true });
mkdirSync("dist/lib", { recursive: true });
for (const f of readdirSync("src/lib")) {
  if (f.endsWith(".mjs")) copyFileSync(`src/lib/${f}`, `dist/lib/${f}`);
}

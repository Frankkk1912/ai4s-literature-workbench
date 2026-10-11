// Copies build assets that tsc does not emit: the public SPA and the
// .mjs onboarding core + helper that the compiled bridge loads at runtime.
import { cpSync, copyFileSync, mkdirSync } from "node:fs";

cpSync("src/public", "dist/public", { recursive: true });
mkdirSync("dist/lib", { recursive: true });
for (const f of ["onboarding-core.mjs", "credential-utils.mjs"]) {
  copyFileSync(`src/lib/${f}`, `dist/lib/${f}`);
}

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Walk up from `startDir` to the nearest directory that contains `marker`, checking
 * `startDir` itself and at most `maxLevels` parents.
 *
 * Code that finds files by counting `..` segments from `import.meta.url` breaks when
 * the same source is bundled into one file at a different depth. Looking for a marker
 * file works from both `dist/transports/` and `bundle/`.
 */
export function findUp(startDir: string, marker: string, maxLevels = 8): string | undefined {
  let dir = startDir;
  for (let level = 0; level <= maxLevels; level += 1) {
    if (existsSync(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

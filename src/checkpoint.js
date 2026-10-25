import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

/** In-memory checkpoint (handy for tests). */
export function memoryCheckpoint(initial = null) {
  let value = initial;
  return { load: () => value, save: (v) => { value = v; } };
}

/**
 * File-backed checkpoint. Writes to a temp file then renames, so a crash
 * mid-write can never leave a half-written (corrupt) checkpoint behind.
 */
export function fileCheckpoint(path) {
  return {
    load: () => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null),
    save: (v) => {
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(v));
      renameSync(tmp, path);
    },
  };
}

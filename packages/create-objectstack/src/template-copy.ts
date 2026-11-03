// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Materializes a bundled template onto disk. Kept out of index.ts because that
// module calls `program.parse()` on import — anything a test needs must be
// importable without running the CLI.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Template files committed under a placeholder name, mapped to the name they
 * must land under in a scaffolded project.
 *
 * `npm pack` / `pnpm pack` strip `.gitignore` (and `.npmrc`) from a tarball
 * unconditionally, at every depth — so a template dotfile committed under its
 * real name never reaches the registry. `src/templates/blank/.gitignore` was
 * copied to `dist/templates/blank/.gitignore` by the build and then dropped at
 * publish, and every project scaffolded from the published package came out
 * with no `.gitignore` at all, leaving `node_modules/` and the `.env` the
 * README tells users to fill with secrets un-ignored (#3120).
 *
 * The strip list is not "every dotfile": `.dockerignore` packs fine and stays
 * literal. Don't add entries by guesswork — the packing ratchet in
 * `template-consistency.test.ts` packs the real package and fails with the
 * required alias if a template file goes missing from the tarball.
 */
export const TEMPLATE_FILE_ALIASES = new Map<string, string>([
  ['_gitignore', '.gitignore'],
]);

// The name a template entry lands under in the scaffolded project.
function outputName(entry: fs.Dirent): string {
  return entry.isFile()
    ? (TEMPLATE_FILE_ALIASES.get(entry.name) ?? entry.name)
    : entry.name;
}

/**
 * The project-relative paths in `dest` that copying `src` onto it would
 * overwrite, or that stand where the template needs a directory. Empty means
 * `copyDir` can run without replacing anything the user already has.
 *
 * Read-only, and meant to run BEFORE the first write: a scaffold into a
 * directory that already has contents (the current directory is the one path
 * that allows that) must refuse with the directory byte-identical, not stop
 * halfway through the copy. Files the template does not write — a `.git/`, a
 * notes file — are not collisions and are left alone by `copyDir`.
 */
export function findTemplateCollisions(src: string, dest: string, rel = ''): string[] {
  const collisions: string[] = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const outName = outputName(entry);
    const destPath = path.join(dest, outName);
    const relPath = rel ? `${rel}/${outName}` : outName;
    let existing: fs.Stats | undefined;
    try {
      existing = fs.lstatSync(destPath);
    } catch {
      existing = undefined;
    }
    if (entry.isDirectory()) {
      if (!existing) continue;
      if (existing.isDirectory()) {
        collisions.push(...findTemplateCollisions(path.join(src, entry.name), destPath, relPath));
      } else {
        collisions.push(relPath);
      }
    } else if (entry.isFile() && existing) {
      collisions.push(relPath);
    }
  }
  return collisions;
}

/**
 * Recursively copy `src` onto `dest`, restoring aliased filenames, pushing the
 * project-relative path of every written file onto `collected`.
 */
export function copyDir(src: string, dest: string, collected: string[], rel = '') {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const outName = outputName(entry);
    const destPath = path.join(dest, outName);
    const relPath = rel ? `${rel}/${outName}` : outName;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, collected, relPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      collected.push(relPath);
    }
  }
}

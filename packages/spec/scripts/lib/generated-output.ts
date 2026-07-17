// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared output sink for the spec's generators.
 *
 * Every generated file goes through `emit()`, every wholesale-regenerated
 * folder through `manageDir()`. Nothing touches the output tree until
 * `flush()`, so the write and `--check` modes run byte-for-byte identical
 * generation logic and differ only in the final disposition — write to disk,
 * or compare against it. That shared path is what makes `--check` trustworthy:
 * it cannot pass on output a real run wouldn't produce, because it *is* the
 * real run minus the writes.
 *
 * `--check` reports three kinds of drift:
 *   +  emitted but absent on disk        (spec added it)
 *   ~  emitted and different on disk     (spec changed it)
 *   -  on disk, owned, and not emitted   (spec no longer defines it)
 *
 * The third kind is why `manageDir()` exists. A generator that wipes its
 * output folder before rewriting will delete such a file on the next real run,
 * so the check must fail on it too. `git diff --exit-code` cannot see this
 * class at all — a stale *untracked* leftover is invisible to it.
 */

import fs from 'fs';
import path from 'path';

/** Decides which on-disk paths a managed dir's regeneration owns. */
export type Owns = (absPath: string) => boolean;

export interface FlushOptions {
  /** Human name of the generated surface, for drift messages. */
  surface: string;
  /** Shell line that regenerates + stages the surface. */
  regenerate: string;
  /**
   * Guard against a vacuously-green check. A run whose inputs failed to load
   * emits nothing, and "nothing differs" would read as success — the gate
   * would pass while checking nothing at all. Return a message to fail with,
   * or null when the inputs look sane.
   */
  guard?: () => string | null;
}

export function createSink(options: { check: boolean; repoRoot: string }) {
  const { check, repoRoot } = options;

  /** Absolute path → intended content. */
  const emitted = new Map<string, string>();
  /** Absolute dir → predicate for the paths its regeneration owns. */
  const managed = new Map<string, Owns>();

  const rel = (p: string) => path.relative(repoRoot, p);

  function emit(filePath: string, content: string): void {
    emitted.set(path.resolve(filePath), content);
  }

  /**
   * Mark `dir` as regenerated wholesale. `owns` narrows that to part of the
   * folder when the generator only replaces some entries and leaves the rest
   * (hand-written files, another generator's output) alone; it defaults to the
   * whole tree.
   */
  function manageDir(dir: string, owns: Owns = () => true): void {
    managed.set(path.resolve(dir), owns);
  }

  /**
   * Whether this run generated `filePath`. For a generator whose later output
   * depends on its earlier output — e.g. an index that links only the pages
   * that got generated — ask this rather than the disk. In write mode the two
   * agree (the folder was just wiped and rewritten), but under `--check`
   * nothing is written and the disk still holds the stale tree, so reading it
   * would make the check diverge from the run it is meant to model.
   */
  function wasEmitted(filePath: string): boolean {
    return emitted.has(path.resolve(filePath));
  }

  function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : [full];
    });
  }

  /** Every on-disk path a real run would delete before rewriting. */
  function ownedOnDisk(): string[] {
    return [...managed].flatMap(([dir, owns]) => walk(dir).filter(owns));
  }

  /** Remove now-empty dirs left behind after deleting owned files. */
  function pruneEmptyDirs(root: string): void {
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(root, entry.name);
      pruneEmptyDirs(child);
      if (fs.readdirSync(child).length === 0) fs.rmdirSync(child);
    }
  }

  function flush(opts: FlushOptions): void {
    const failure = opts.guard?.();
    if (failure) {
      console.error(`\n✗ ${failure}\n`);
      process.exit(1);
    }

    if (!check) {
      for (const file of ownedOnDisk()) fs.rmSync(file, { force: true });
      for (const dir of managed.keys()) pruneEmptyDirs(dir);
      for (const [file, content] of emitted) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      }
      console.log(`\n✅ Generated ${emitted.size} files`);
      return;
    }

    const added: string[] = [];
    const changed: string[] = [];
    for (const [file, content] of emitted) {
      if (!fs.existsSync(file)) added.push(rel(file));
      else if (fs.readFileSync(file, 'utf-8') !== content) changed.push(rel(file));
    }
    const stale = ownedOnDisk()
      .filter((f) => !emitted.has(path.resolve(f)))
      .map(rel);

    const drift = [
      ...added.map((f) => `  + ${f} (missing — spec adds it)`),
      ...changed.map((f) => `  ~ ${f} (out of date)`),
      ...stale.map((f) => `  - ${f} (stale — spec no longer defines it)`),
    ];

    if (drift.length === 0) {
      console.log(`✅ ${emitted.size} generated files in sync with packages/spec`);
      return;
    }

    console.error(
      `\n✗ ${opts.surface} is out of date with packages/spec:\n\n` +
        drift.join('\n') +
        `\n\nThese files are GENERATED — do not hand-edit them. Regenerate and commit:\n\n` +
        `${opts.regenerate}\n`,
    );
    process.exit(1);
  }

  return { emit, manageDir, wasEmitted, flush };
}

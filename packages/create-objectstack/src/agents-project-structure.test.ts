// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The scaffolded AGENTS.md is the first thing a coding agent reads in a new
// project, and its "Project Structure" block tells it where each kind of
// metadata goes. A directory that `objectstack.config.ts` does not import is
// never loaded, and `objectstack validate` neither counts nor checks what it
// holds — so a block that names such a directory sends the agent's work
// somewhere it silently does nothing, and validate still passes. This pins the
// block's `src/` directories to the barrels each bundled template's config
// imports, both ways: no directory the config never loads, none it loads left
// out.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from './template-registry.js';

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const AGENTS_MD = fs.readFileSync(path.join(templatesDir, 'AGENTS.md'), 'utf8');

/** The `src/` directories the "Project Structure" tree names, in order. */
function projectStructureDirs(markdown: string): string[] {
  const section = markdown.split(/^## Project Structure$/m)[1];
  if (section === undefined) throw new Error('AGENTS.md has no "## Project Structure" section');
  const tree = /```\n([\s\S]*?)\n```/.exec(section)?.[1];
  if (tree === undefined) throw new Error('the Project Structure section has no fenced tree');
  const lines = tree.split('\n');
  const srcAt = lines.findIndex((l) => /[├└]── src\/\s*$/.test(l));
  if (srcAt === -1) throw new Error('the Project Structure tree has no src/ entry');
  const dirs: string[] = [];
  for (const line of lines.slice(srcAt + 1)) {
    const m = /^│\s+[├└]── ([a-z0-9_-]+)\/\s/.exec(line);
    if (!m) break;
    dirs.push(m[1]);
  }
  return dirs;
}

/** The `./src/<dir>` barrels a template's config imports, in order. */
function configBarrels(configSource: string): string[] {
  return [...configSource.matchAll(/^import \* as \w+ from '\.\/src\/([a-z0-9_-]+)(?:\/index(?:\.js|\.ts)?)?';$/gm)].map((m) => m[1]);
}

const bundled = Object.entries(TEMPLATES).flatMap(([name, t]) => {
  const config = path.join(templatesDir, t.source.dir, 'objectstack.config.ts');
  return fs.existsSync(config) ? [{ name, config }] : [];
});

describe('the scaffolded AGENTS.md Project Structure names exactly the directories the config loads', () => {
  it('reads at least one bundled template with a config (the pin is not vacuous)', () => {
    expect(bundled.length).toBeGreaterThan(0);
    expect(projectStructureDirs(AGENTS_MD).length).toBeGreaterThan(0);
  });

  for (const { name, config } of bundled) {
    it(`template "${name}": the block's src/ directories are its config's barrel imports`, () => {
      const barrels = configBarrels(fs.readFileSync(config, 'utf8'));
      expect(barrels.length, `no ./src barrel import read from ${config}`).toBeGreaterThan(0);
      expect([...projectStructureDirs(AGENTS_MD)].sort()).toEqual([...barrels].sort());
    });
  }

  it('says a directory must be wired in objectstack.config.ts before it is loaded or validated', () => {
    const section = AGENTS_MD.split(/^## Project Structure$/m)[1].split(/^## /m)[0];
    expect(section).toContain('objectstack.config.ts');
    expect(section).toMatch(/never loaded/);
  });
});

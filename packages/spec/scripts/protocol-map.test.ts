// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PROTOCOL_MAP.md is hand-written and repo-internal (it is not in the package's
 * npm `files` list, so it never ships). Nothing regenerates it, which means a
 * rename that moves a `*.zod.ts` leaves its row pointing at a file that no
 * longer exists and no build step notices.
 *
 * That is not hypothetical: the Dataset→Seed rename (#1620, ADR-0021) left
 * `src/data/dataset.zod.ts` dangling here, and by the time this gate was added
 * 25 of the 132 links were dead — an entire section (`src/hub`) had been
 * deleted wholesale. This asserts every link resolves; it deliberately does NOT
 * assert the reverse (that every schema is listed), since the map is a curated
 * digest, not a generated index.
 *
 * Sibling gate: #3138 covers the same #1620 fallout on the *generated* side —
 * `build-skill-references.ts`'s SKILL_MAP held the identical stale
 * `data/dataset.zod.ts` pointer. That one is a regenerate-and-diff check on
 * artifacts that ship to third parties, so it runs as `check:skill-refs` in
 * lint.yml. This file is hand-written and never generated, so a plain assertion
 * is the whole job; it rides Test Core, whose `packages/**` filter has no
 * blind spot for spec changes.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = resolve(packageRoot, 'PROTOCOL_MAP.md');

/** Matches the `](src/...)` target of every markdown link in the tables. */
const LINK_RE = /\]\((src\/[^)]+)\)/g;

function protocolMapLinks(): string[] {
  const md = readFileSync(mapPath, 'utf8');
  return [...md.matchAll(LINK_RE)].map((m) => m[1]);
}

describe('PROTOCOL_MAP.md', () => {
  it('links only to files that exist', () => {
    const dead = protocolMapLinks().filter((link) => !existsSync(resolve(packageRoot, link)));

    expect(dead, `PROTOCOL_MAP.md links to ${dead.length} file(s) that do not exist:\n` +
      dead.map((d) => `  - ${d}`).join('\n') +
      '\n\nRepoint the row at the schema that replaced it, or drop the row if the concept is gone.').toEqual([]);
  });

  it('actually finds links to check (guards against the regex silently matching nothing)', () => {
    expect(protocolMapLinks().length).toBeGreaterThan(100);
  });
});

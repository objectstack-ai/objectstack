/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The shipped schema-catalog gantt fixture is migrated off the retired
 * `timeScale` alias (objectui#6355).
 *
 * The ruling retires the alias and migrates the in-repo authors in one PR, so
 * this repo must not keep shipping a catalog entry spelling the key it just made
 * unauthorable — that entry is a worked example users copy.
 *
 * Lives in `@object-ui/types` because it needs both halves at once: node types
 * to read the fixture off disk (`tsconfig.test.json` declares them, and other
 * tests here already read files) and the published Zod validator to judge it.
 * `packages/plugin-timeline`'s test tsconfig carries no node types, and
 * `scripts/__tests__` — the repo's other file-reading test home — cannot resolve
 * `@object-ui/types/zod` at all, since `scripts/` is not a workspace package and
 * has no dependency edge to it. Its siblings — the registration's `examples.gantt` block and the
 * designer inputs — are pinned in
 * `packages/plugin-timeline/src/__tests__/timeline-inrepo-authors-migrated.test.tsx`,
 * and the refusal that makes the retirement audible is pinned in
 * `packages/types/src/__tests__/timeline-timescale-retired.test.ts`.
 *
 * The assertion is not that the string changed. The fixture is parsed by the
 * published validator — the same one that now REFUSES its pre-migration form —
 * so a rename that left the document invalid, or a value that stopped being
 * reachable, fails here.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TimelineSchema } from '../zod/data-display.zod.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'examples/schema-catalog/src/schemas/plugin-timeline/gantt-style-timeline.json',
);

describe('schema-catalog gantt fixture uses the canonical `scale` (objectui#6355)', () => {
  it('the fixture this pin reads is actually on disk', () => {
    // Asserted before anything reads it: a path that silently resolved to
    // nothing would turn every assertion below into a vacuous pass.
    expect(fs.existsSync(FIXTURE), `fixture not found at ${FIXTURE}`).toBe(true);
  });

  it('authors `scale`, not the retired alias, and still validates', () => {
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;

    expect(doc.variant, 'fixture is no longer the gantt one this pin was written for').toBe('gantt');
    expect(doc.timeScale, 'the schema-catalog fixture still authors the RETIRED alias').toBeUndefined();
    expect(doc.scale).toBe('month');

    const parsed = TimelineSchema.safeParse(doc);
    expect(parsed.success ? null : parsed.error.issues).toBe(null);
  });

  it('the pre-migration form of that same fixture is REFUSED', () => {
    // Counter-probe, and the tightest statement of what the migration bought:
    // this exact document with only the key renamed back does not parse. Without
    // it, the assertion above would also pass against a validator that accepts
    // both spellings.
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
    const { scale, ...rest } = doc;
    const preMigration = { ...rest, timeScale: scale };

    const parsed = TimelineSchema.safeParse(preMigration);
    expect(parsed.success, 'the retired spelling of the shipped fixture still parses').toBe(false);
  });
});

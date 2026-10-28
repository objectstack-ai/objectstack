// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #27015 — the in-tree anchor is not older than the newest aged-out deletion.
//
// A build that cannot reach origin/main (cloud's EE image stage, an air-gapped
// or tagless clone) runs the #4650 deletion gate against the committed
// `authorable-surface.base.json` (#5235). Every `[RETIRED]` line the anchor
// still records and the live surface has since dropped must then be dated by
// proof 1 of that gate. Its registry half (RETIRED_KEYS_BY_MAJOR) is in the
// tree; its tag half (`@objectstack/spec@<major - 1>.0.0`, #25767) is not, and
// such a build can neither read nor fetch it. So a tombstone deletion that only
// the tag dates is one the offline build refuses.
//
// That is what happened: #26599 (dbf7e04adf) aged the ≤16.x kits out and
// deleted 38 tag-dated lines, while the anchor stayed at 85c6d76ec42a, before
// that commit. Every online build passed; `@objectstack/spec#build` failed in
// every offline one, and nothing in this repository noticed.
//
// This pin reads only committed files — no git, no tag, no build — which is
// exactly what the offline build has, and asks the one question that build
// cannot answer: is there a deleted tombstone that only the tag could date?
// It deliberately leaves out deletions the gate proves from the build itself
// (a def no longer on the surface, proof 3; a never-tombstoned line, proof 4),
// and it is stricter than the gate on one shape: a tombstone in a def that is
// still on the surface but no longer reachable from the metadata roots (proof
// 2), which only the generator's Zod graph can tell. That errs toward a
// re-anchor, never toward a broken offline build.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_KEYS_BY_MAJOR } from '../src/migrations/registry';
import { carryAuthorableKey } from './lib/renamed-defs';
import {
  AUTHORABLE_SURFACE_DIR_NAME,
  readShards,
  type AuthorableSurfaceShard,
} from './lib/sharded-artifacts';

const SPEC_DIR = fileURLToPath(new URL('..', import.meta.url));
const RETIRED_MARK = ' [RETIRED]';
/** build-schemas.ts `TOMBSTONE_AGE_MAJORS` (#25767). */
const TOMBSTONE_AGE_MAJORS = 1;
const CURRENT_MAJOR = Number.parseInt(
  JSON.parse(fs.readFileSync(path.join(SPEC_DIR, 'package.json'), 'utf-8')).version,
  10,
);

const anchor = JSON.parse(
  fs.readFileSync(path.join(SPEC_DIR, 'authorable-surface.base.json'), 'utf-8'),
) as { baseRev: string; keys: string[] };

const liveKeys = new Set(
  readShards<AuthorableSurfaceShard>(path.join(SPEC_DIR, AUTHORABLE_SURFACE_DIR_NAME))
    .flatMap((s) => s.doc.keys)
    .map((e) => e.replace(RETIRED_MARK, '')),
);
const liveDefs = new Set([...liveKeys].map((k) => k.slice(0, k.indexOf(':'))));

/** The earliest major that registers each key, carried through def renames (build-schemas.ts `registeredRetiredKeys`). */
const registeredAt = new Map<string, number>();
for (const [major, keys] of Object.entries(RETIRED_KEYS_BY_MAJOR)) {
  for (const key of keys) {
    const carried = carryAuthorableKey(key);
    const prev = registeredAt.get(carried);
    if (prev === undefined || Number(major) < prev) registeredAt.set(carried, Number(major));
  }
}

describe('authorable-surface.base.json is not older than the newest aged-out deletion (#27015)', () => {
  it('reads a real anchor and a real surface', () => {
    expect(anchor.baseRev).toMatch(/^[0-9a-f]{40}$/);
    expect(anchor.keys.length).toBeGreaterThan(0);
    expect(liveKeys.size).toBeGreaterThan(0);
  });

  it('records no deleted tombstone that only the dating release tag can date', () => {
    const tagDatedOnly = anchor.keys
      .filter((e) => e.endsWith(RETIRED_MARK))
      .map((e) => carryAuthorableKey(e.replace(RETIRED_MARK, '')))
      .filter((key) => !liveKeys.has(key) && liveDefs.has(key.slice(0, key.indexOf(':'))))
      .filter((key) => {
        const major = registeredAt.get(key);
        return major === undefined || CURRENT_MAJOR - major < TOMBSTONE_AGE_MAJORS;
      });

    expect(
      tagDatedOnly,
      `The anchor (baseRev ${anchor.baseRev.slice(0, 12)}) still records ${tagDatedOnly.length} [RETIRED] ` +
        `line(s) that the live surface has dropped and that RETIRED_KEYS_BY_MAJOR does not date. Online, ` +
        `the release tag @objectstack/spec@${CURRENT_MAJOR - TOMBSTONE_AGE_MAJORS}.0.0 dates them; a build ` +
        `with no route to origin/main has no tag, so its spec build fails the #4650 deletion gate on these ` +
        `lines (#27015). Once the deletion is on origin/main, re-anchor in a commit of its own from a branch ` +
        `cut there: \`pnpm --filter @objectstack/spec gen:authorable-surface-base\`. In the PR that deletes ` +
        `the lines, the anchor cannot move yet; date each key there instead with an exact entry under ` +
        `src/migrations/entries/retired-keys/ at its true major.`,
    ).toEqual([]);
  });
});

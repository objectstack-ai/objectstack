/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins for `scripts/page-key-read-census.mjs` (objectui#9438).
 *
 * The card this instrument answers has NO live instance left: both page keys it
 * records -- `priority` and `disableDiscussion` -- were removed before the
 * census existed. An instrument authored against a clean tree reports a clean
 * tree whether or not it works, so the card asks for the demonstration first:
 * fire on the retired specimens, stay quiet on a declared key read the SAME WAY
 * through the SAME PATH.
 *
 * That pairing is the whole design of this file. Every specimen below has a
 * control that differs from it in ONE respect -- the key -- so a green is a
 * measurement and not an absence.
 *
 * Four groups, failing for four different reasons:
 *
 * 1. THE SPECIMENS. The two retired reads, restored in the shapes they were
 *    actually written in (a loosely-typed candidate; a value behind `as any`,
 *    reached across a package boundary). A regression here means the census has
 *    stopped being able to fail at all.
 * 2. THE ORACLE. `PageSchema` answers, not a key list. A regression here moves
 *    the verdicts without changing what was walked -- the direction in which a
 *    census lies while still printing numbers.
 * 3. THE PROPAGATION. One case per rule the specimens depend on, including the
 *    two roots a grep cannot see and the cast a type-driven walk cannot see
 *    through.
 * 4. THE BOUNDARIES. What the census says it does not answer, asserted, so the
 *    header's claims stay falsifiable rather than decorative.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import { PageSchema } from '@objectstack/spec/ui';

import {
  askSchema,
  aliasFromMessage,
  censusReads,
  judgeReads,
  evaluateControls,
  derivePassThroughHelpers,
  BASE_PAGE,
  NONSENSE_KEY,
  METADATA_HOOK,
  PAGE_CACHE_MEMBER,
  REPO_ROOT,
} from '../page-key-read-census.mjs';

type Source = { path: string; text: string };
type Read = { file: string; line: number; key: string; text: string };
type Row = { key: string; verdict: 'declared' | 'alias' | 'refused'; canonical?: string; sites: Read[] };

/** The census reads its sources; `.mjs` carries no types, so they are named here. */
const readsOf = (sources: Source[]): Read[] => censusReads(sources).reads as Read[];

const src = (rel: string, text: string): Source => ({ path: join(REPO_ROOT, rel), text });

/** Keys the census reports as NOT accepted by `PageSchema`, with their verdict. */
function refusedKeys(sources: Source[]): Array<{ key: string; verdict: string; canonical?: string }> {
  return (judgeReads(readsOf(sources), PageSchema) as Row[])
    .filter((row) => row.verdict !== 'declared')
    .map((row) => ({ key: row.key, verdict: row.verdict, canonical: row.canonical }));
}

function keysRead(sources: Source[]): string[] {
  return [...new Set(readsOf(sources).map((r) => r.key))].sort();
}

// ---------------------------------------------------------------------------
// The two specimens, in the shapes they were written in
// ---------------------------------------------------------------------------

/**
 * Specimen A -- the `priority` sort. A page-metadata array walked out of the
 * cache into a `filter`, then sorted on a key `PageSchema` refuses, so every
 * candidate read `0` and the comparator was a no-op that read as an ordering
 * feature.
 */
const SPECIMEN_A = (key: string) => src('packages/react/src/hooks/usePageAssignment.ts', `
import { useMemo } from 'react';
import { useMetadata } from '../context/AppShellContext.js';

export function usePageAssignment(objectName?: string) {
  const meta = useMetadata();
  const matched = useMemo(() => {
    const pages: any[] = Array.isArray(meta.pages) ? meta.pages : [];
    const candidates = pages.filter(p => p.object === objectName);
    candidates.sort((a, b) => (b.${key} ?? 0) - (a.${key} ?? 0));
    return candidates[0];
  }, [meta.pages, objectName]);
  return { page: matched, slots: null };
}
`);

/**
 * Specimen B -- `(effectivePage as any)?.disableDiscussion`. Two files and a
 * package boundary: the hook returns the page at a MEMBER, the view
 * destructures it, aliases it through `||`, and reads the key behind a cast.
 * Neither the cast nor the `any` return type leaves anything for a type-driven
 * walk to hold on to.
 */
const SPECIMEN_B_HOOK = src('packages/react/src/hooks/usePageAssignment.ts', `
import { useMetadata } from '../context/AppShellContext.js';

export function usePageAssignment(objectName?: string) {
  const meta = useMetadata();
  const pages: any[] = meta.pages;
  const matched = pages.find(p => p.object === objectName);
  return { page: matched, slots: null, loading: false, error: null };
}
`);

const SPECIMEN_B_VIEW = (key: string) => src('packages/app-shell/src/views/RecordDetailView.tsx', `
import { usePageAssignment } from '@object-ui/react';
import { buildDefaultPageSchema } from '@object-ui/plugin-detail';

export function RecordDetailView({ objectName, objectDef }: any) {
  const { page: assignedPage, slots: assignedSlots } = usePageAssignment(objectName);
  const synthesizedPage = assignedPage ? null : buildDefaultPageSchema(objectDef, assignedSlots);
  const effectivePage = assignedPage || synthesizedPage;
  const suppressed = (effectivePage as any)?.${key} === true;
  return suppressed ? null : effectivePage;
}
`);

describe('page-key read census -- 1. the specimens it was authored against', () => {
  it('fires on the retired `priority` sort, and the SAME sort on a declared key is quiet', () => {
    expect(refusedKeys([SPECIMEN_A('priority')])).toEqual([
      { key: 'priority', verdict: 'refused', canonical: undefined },
    ]);

    // The control: one word different, same walk, same oracle. `isDefault` is
    // declared on `PageSchema`, so nothing is reported -- which is what makes
    // the finding above a reading rather than a scanner that fires on anything.
    expect(refusedKeys([SPECIMEN_A('isDefault')])).toEqual([]);
    expect(keysRead([SPECIMEN_A('isDefault')])).toContain('isDefault');
  });

  it('fires on the retired `disableDiscussion` read ACROSS the package boundary', () => {
    const sources = [SPECIMEN_B_HOOK, SPECIMEN_B_VIEW('disableDiscussion')];
    expect(refusedKeys(sources)).toEqual([
      { key: 'disableDiscussion', verdict: 'refused', canonical: undefined },
    ]);

    // Same control, one level harder: the declared key travels the identical
    // route -- destructure, `||`, `as any`, optional chain -- and is quiet.
    const control = [SPECIMEN_B_HOOK, SPECIMEN_B_VIEW('isDefault')];
    expect(refusedKeys(control)).toEqual([]);
    expect(keysRead(control)).toContain('isDefault');
  });

  it('a nonsense key in the same position is refused, so the oracle discriminates', () => {
    expect(refusedKeys([SPECIMEN_A(NONSENSE_KEY)])).toEqual([
      { key: NONSENSE_KEY, verdict: 'refused', canonical: undefined },
    ]);
  });

  it('reports the read SITE, not just the key -- a finding nobody can locate is not a finding', () => {
    const hit = readsOf([SPECIMEN_B_HOOK, SPECIMEN_B_VIEW('disableDiscussion')])
      .find((r) => r.key === 'disableDiscussion')!;
    expect(hit.file).toBe('packages/app-shell/src/views/RecordDetailView.tsx');
    expect(hit.line).toBeGreaterThan(0);
    expect(hit.text).toContain('disableDiscussion');
  });
});

// ---------------------------------------------------------------------------
// 2. The oracle
// ---------------------------------------------------------------------------

describe('page-key read census -- 2. the oracle is PageSchema, not a key list', () => {
  it('its own controls hold: a base page parses and a nonsense key is refused', () => {
    expect(evaluateControls(PageSchema)).toMatchObject({ baseGreen: true, nonsenseRefused: true, ok: true });
  });

  it('separates a DECLARED key from a REFUSED one', () => {
    expect(askSchema(PageSchema, 'isDefault').verdict).toBe('declared');
    expect(askSchema(PageSchema, 'slots').verdict).toBe('declared');
    expect(askSchema(PageSchema, 'priority').verdict).toBe('refused');
    expect(askSchema(PageSchema, 'disableDiscussion').verdict).toBe('refused');
  });

  it('reads the schema\'s own alias guidance rather than keeping a second copy of it', () => {
    // `pageType` is refused AND the schema names what it should have been. A
    // census that only knew "declared or not" would report this identically to
    // `priority`, losing the one thing that tells an author what to write.
    expect(askSchema(PageSchema, 'pageType')).toMatchObject({ verdict: 'alias', canonical: 'type' });
    expect(aliasFromMessage('Did you mean `pageType` → `type`?', 'pageType')).toBe('type');
    expect(aliasFromMessage('Did you mean `pageType` -> `type`?', 'pageType')).toBe('type');
    expect(aliasFromMessage('Unrecognized key(s): `priority`.', 'priority')).toBeNull();
  });

  it('a declared key that fails on its VALUE is still declared, not refused', () => {
    // The probe value is wrong for every declared key on purpose, so the test
    // that separates the two verdicts has to be the `unrecognized_keys` issue
    // and not "did it parse". If that ever inverts, every declared key in the
    // tree becomes a finding at once.
    const result = PageSchema.safeParse({ ...BASE_PAGE, isDefault: Symbol.for('nope') as never });
    expect(result.success).toBe(false);
    expect(askSchema(PageSchema, 'isDefault').verdict).toBe('declared');
  });
});

// ---------------------------------------------------------------------------
// 3. Propagation
// ---------------------------------------------------------------------------

const DESTRUCTURED_ROOT = src('packages/app-shell/src/views/PageView.tsx', `
import { useMetadata } from '../providers/MetadataProvider.js';

export function PageView() {
  const { pages, objects } = useMetadata();
  const page = pages.find((p: any) => p.name === 'home');
  return (page as any).${'someUndeclaredKey'};
}
`);

const PASS_THROUGH_HELPER = src('packages/app-shell/src/utils/preferLocal.ts', `
export function preferLocal<T extends { name?: unknown }>(
  list: readonly T[] | undefined | null,
  name: string | undefined | null,
): T | undefined {
  return list ? list.find((x) => x.name === name) : undefined;
}
`);

const VIA_HELPER = src('packages/app-shell/src/views/PageView.tsx', `
import { useMetadata } from '../providers/MetadataProvider.js';
import { preferLocal } from '../utils/preferLocal.js';

export function PageView({ pageName }: any) {
  const { pages } = useMetadata();
  const page = preferLocal(pages as any[], pageName);
  return (page as any).someUndeclaredKey;
}
`);

describe('page-key read census -- 3. propagation', () => {
  it('finds the root a `.pages` grep cannot see: `const { pages } = useMetadata()`', () => {
    // This is not a hypothetical shape. It is how `PageView` reaches the cache,
    // and it is why the instrument is a walk rather than a grep: the text
    // `.pages` does not occur in that file at all.
    expect(DESTRUCTURED_ROOT.text).not.toContain('.pages');
    expect(refusedKeys([DESTRUCTURED_ROOT]).map((r) => r.key)).toEqual(['someUndeclaredKey']);
  });

  it('looks THROUGH `as any` rather than at it', () => {
    const cast = SPECIMEN_B_VIEW('disableDiscussion');
    const bare = src(cast.path, cast.text.replace('(effectivePage as any)?.', 'effectivePage.'));
    expect(bare.text).not.toContain('as any');
    expect(refusedKeys([SPECIMEN_B_HOOK, bare]).map((r) => r.key)).toEqual(['disableDiscussion']);
  });

  it('derives generic pass-through helpers from their SIGNATURE, not their name', () => {
    const helpers = derivePassThroughHelpers([PASS_THROUGH_HELPER]);
    expect(helpers.get('preferLocal')).toEqual({ index: 0, from: 'array' });
    expect(refusedKeys([PASS_THROUGH_HELPER, VIA_HELPER]).map((r) => r.key)).toEqual(['someUndeclaredKey']);

    // Without the helper's own file in the source set the signature is unknown,
    // so the walk stops there. Recorded because it is the difference between a
    // boundary and a bug: the census under-reports, it does not guess.
    expect(refusedKeys([VIA_HELPER])).toEqual([]);
  });

  it('does not judge reads on a value that never came from the cache', () => {
    const unrelated = src('packages/app-shell/src/views/Other.tsx', `
export function Other({ page }: any) {
  return page.disableDiscussion;
}
`);
    expect(readsOf([unrelated])).toEqual([]);
    // ...and the same read IS found once the value comes from the cache, so the
    // quiet above is about provenance and not about the key.
    expect(keysRead([SPECIMEN_B_HOOK, SPECIMEN_B_VIEW('disableDiscussion')])).toContain('disableDiscussion');
  });
});

// ---------------------------------------------------------------------------
// 4. Boundaries
// ---------------------------------------------------------------------------

describe('page-key read census -- 4. the boundaries it claims', () => {
  it('stops at an ordinary function call, as the header says it does', () => {
    const handedOff = src('packages/app-shell/src/views/RecordDetailView.tsx', `
import { usePageAssignment } from '@object-ui/react';

function hasExplicitAttachments(p: any) {
  return p.disableDiscussion === true;
}

export function RecordDetailView({ objectName }: any) {
  const { page } = usePageAssignment(objectName);
  return hasExplicitAttachments(page as any);
}
`);
    // `p.object` inside the hook IS found, so the walk reached both files --
    // the absent `disableDiscussion` is the boundary, not a dead scanner.
    expect(keysRead([SPECIMEN_B_HOOK, handedOff])).toEqual(['object']);
  });

  it('says nothing about a computed read, because there is no key to judge', () => {
    const computed = src('packages/app-shell/src/views/PageView.tsx', `
import { useMetadata } from '../providers/MetadataProvider.js';

export function PageView({ key }: any) {
  const { pages } = useMetadata();
  const page = pages.find((p: any) => p.name === 'home');
  return (page as any)[key];
}
`);
    // `p.name` is found in the same file, which is what makes the absence of
    // the computed read a boundary rather than a file the walk never entered.
    expect(keysRead([computed])).toEqual(['name']);
  });

  it('ignores members every JavaScript object has', () => {
    const builtin = src('packages/app-shell/src/views/PageView.tsx', `
import { useMetadata } from '../providers/MetadataProvider.js';

export function PageView() {
  const { pages } = useMetadata();
  const page = pages.find((p: any) => p.name === 'home');
  return String((page as any).toString);
}
`);
    expect(keysRead([builtin])).toEqual(['name']);
  });

  it('names its seam in one place, so a reader can check the anchor is still real', () => {
    expect(METADATA_HOOK).toBe('useMetadata');
    expect(PAGE_CACHE_MEMBER).toBe('pages');
  });
});

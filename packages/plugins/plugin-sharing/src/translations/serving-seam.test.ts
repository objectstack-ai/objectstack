// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The provenance companion is READ at serving time, not merely recorded.
//
// ## What this file pins, and what it deliberately does not
//
// `os i18n extract --source-hashes` writes `<locale>.source-hashes.generated.ts`
// (maintainer ruling #12069 Option A, #11671) and `withSourceFallback`
// substitutes the current source for a leaf whose record disagrees with it.
// Those two halves landed apart: recording rolled out to all nine bundle sets
// and the reading half stayed in `@objectstack/platform-objects`. Eight sets
// then recorded the drift and went on serving the superseded draft, with every
// gate green.
//
// This set is where that gap was measured, on a leaf recorded in es-ES ALONE —
// which is why no gate could see it. `check:i18n` compares key sets and they
// still matched; `check:i18n-coverage` counts a present leaf as translated; and
// `check:i18n-stale-fill`'s cross-locale rule needs a SECOND locale holding the
// same stale bytes before it can testify. One locale, no second witness.
//
// The division of labour with the gate is worth stating, because neither half
// is sufficient alone:
//
//   - THIS test proves the barrel BEHAVES — revise the source underneath the
//     recorded leaf and `SharingTranslations` serves the current source. It
//     drives the real `./index.js`, not a reconstruction of it.
//   - `check:i18n-stale-fill`'s UNSERVED PROVENANCE verdict proves every OTHER
//     bundle set's barrel is wired the same way, which no test in this package
//     can see.
//
// ⚠️ A version of this test that asserted over the committed tree alone would
// be VACUOUS and would look identical to this one: a record is only ever
// written for a leaf that IS a byte copy of the CURRENT source, so the tree
// arrives 0-stale by construction and "served === source" holds whether or not
// the seam is wired. The source has to be MOVED for the two to differ, which is
// what the mock below does.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withSourceFallback, findStaleFills } from '@objectstack/platform-objects/apps';
import { enObjects } from './en.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';

/** The leaf the gap was measured on: recorded in es-ES only. */
const PATH = ['objects', 'sys_share_link', 'fields', 'token', 'label'] as const;
const REVISED = 'Share token';

const read = (data: unknown): unknown =>
  PATH.reduce<any>((node, key) => (node == null ? undefined : node[key]), data);

/**
 * The generated `objects` map with the source string behind the recorded leaf
 * revised — the state an `os i18n extract` run leaves behind after the label is
 * edited: `en` is rewritten from the source every run and never merged (#8543),
 * while the translated locales keep merge semantics and strand the previous
 * text.
 */
function revisedObjects() {
  const next = structuredClone(enObjects) as any;
  next.sys_share_link.fields.token.label = REVISED;
  return next;
}

/** The same thing as a `TranslationData` — what the barrel passes as `source`. */
const revisedSource = () => ({ objects: revisedObjects() });

describe('SharingTranslations — the provenance companion is read at serving time', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('./en.objects.generated.js');
  });

  it('the leaf under test is recorded in es-ES and is a byte copy of the current source', () => {
    const path = PATH.join('.');
    expect(esESGeneratedSourceHashes[path]).toBeTypeOf('string');
    expect(read({ objects: esESObjects })).toBe(read({ objects: enObjects }));
  });

  it('records the drift once the source moves — the evidence that already existed', () => {
    const stale = findStaleFills({ objects: esESObjects }, revisedSource(), esESGeneratedSourceHashes);
    expect(stale.map((s) => s.path)).toEqual([PATH.join('.')]);
  });

  it('SERVES the current source when the source moves under the recorded leaf', async () => {
    vi.doMock('./en.objects.generated.js', () => ({ enObjects: revisedObjects() }));
    const { SharingTranslations } = await import('./index.js');
    expect(read(SharingTranslations['es-ES'])).toBe(REVISED);
    // The locales with no record for this path are legacy-trusted and untouched —
    // recovery is per-locale, which is the half of ruling #8765 Option B that a
    // blanket "fall back to source" would have destroyed.
    expect(read(SharingTranslations['zh-CN'])).toBe('令牌');
  });

  it('NEGATIVE CONTROL: the same bundle with no companion serves the superseded draft', () => {
    const unserved = withSourceFallback({ objects: esESObjects }, revisedSource(), undefined, undefined);
    expect(read(unserved)).toBe('Token');
  });

  it('substitutes nothing while the source has not moved', async () => {
    const { SharingTranslations } = await import('./index.js');
    expect(read(SharingTranslations['es-ES'])).toBe(read({ objects: enObjects }));
  });
});

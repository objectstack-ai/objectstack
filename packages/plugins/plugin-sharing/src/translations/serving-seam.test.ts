// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The provenance companion is READ at serving time, not merely recorded.
//
// ## What this file pins, and what it deliberately does not
//
// `os i18n extract --source-hashes` writes `<locale>.source-hashes.generated.ts`
// (maintainer ruling #12069 Option A, commit 09b4f4e4e) and `withSourceFallback`
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

import { describe, it, expect, vi } from 'vitest';
import { withSourceFallback, findStaleFills } from '@objectstack/platform-objects/apps';
import { enObjects } from './en.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';
// The barrel as committed, loaded HERE, at module top. Both of this file's
// barrel loads happen at module top and neither inside a case: a fresh load of
// the barrel and its bundles inside a case is charged to vitest's per-case
// budget (5000ms by default), so the verdict would turn on how loaded the
// machine is, while at module top the same load is charged to the COLLECT
// phase, where no per-case budget applies. The second load, against a moved
// source, is below `revisedSource`. Same reasoning as the core precedent
// `packages/core/src/service-resolution-discriminator.contract.test.ts`.
import { SharingTranslations } from './index.js';

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

// The SAME barrel, evaluated a second time with the source string behind the
// recorded leaf revised. This setup has to run before the load it shapes, which
// is why it sits here at module top rather than in a hook: `resetModules` drops
// the copy the static import above cached, so the import below evaluates the
// barrel afresh against the mock, and `doUnmock` takes the mock straight back
// out, so the static bindings and every case see the committed bundles.
vi.resetModules();
vi.doMock('./en.objects.generated.js', () => ({ enObjects: revisedObjects() }));
const { SharingTranslations: servedAfterSourceMoved } = await import('./index.js');
vi.doUnmock('./en.objects.generated.js');

describe('SharingTranslations — the provenance companion is read at serving time', () => {
  it('the leaf under test is recorded in es-ES and is a byte copy of the current source', () => {
    const path = PATH.join('.');
    expect(esESGeneratedSourceHashes[path]).toBeTypeOf('string');
    expect(read({ objects: esESObjects })).toBe(read({ objects: enObjects }));
  });

  it('records the drift once the source moves — the evidence that already existed', () => {
    const stale = findStaleFills({ objects: esESObjects }, revisedSource(), esESGeneratedSourceHashes);
    expect(stale.map((s) => s.path)).toEqual([PATH.join('.')]);
  });

  it('SERVES the current source when the source moves under the recorded leaf', () => {
    expect(read(servedAfterSourceMoved['es-ES'])).toBe(REVISED);
    // The locales with no record for this path are legacy-trusted and untouched —
    // recovery is per-locale, which is the half of ruling #8765 Option B that a
    // blanket "fall back to source" would have destroyed.
    expect(read(servedAfterSourceMoved['zh-CN'])).toBe('令牌');
  });

  it('NEGATIVE CONTROL: the same bundle with no companion serves the superseded draft', () => {
    const unserved = withSourceFallback({ objects: esESObjects }, revisedSource(), undefined, undefined);
    expect(read(unserved)).toBe('Token');
  });

  it('substitutes nothing while the source has not moved', () => {
    expect(read(SharingTranslations['es-ES'])).toBe(read({ objects: enObjects }));
  });
});

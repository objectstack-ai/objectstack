/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-detail` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3161, objectstack#4115 ledger batch 7).
 *
 *  - `FeedFilterMode` was a hand copy of the spec's four-member enum under the
 *    spec's own name, in a file that already imported the sibling
 *    `FeedItemType` from the spec vocabulary. It is a re-export now, pinned
 *    below by TYPE IDENTITY (not by listing the four members again — a test
 *    that restates the copy cannot detect the copy).
 *
 *  - `ObjectFieldLike` → `ObjectDefFieldLike`. This is the case the guard's
 *    header calls "the SPEC export is the imprecise one": the spec's
 *    `ObjectFieldLike` ends in `[key: string]: any`, so deriving from it would
 *    have traded a precise three-key layout contract for a bag. The pin below
 *    states that reason as a fact, so the day the spec tightens its declaration
 *    the reason expires loudly instead of silently.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as React from 'react';
import { FeedFilterMode as SpecFeedFilterModeEnum } from '@objectstack/spec/data';
import type { FeedFilterMode as SpecFeedFilterMode } from '@objectstack/spec/data';
import type { ObjectFieldLike as SpecObjectFieldLike } from '@objectstack/spec/system';
import type { RecordAlertProps as SpecRecordAlertProps } from '@objectstack/spec/ui';

import type { FeedFilterMode } from '../RecordActivityTimeline';
import type { ObjectDefFieldLike } from '../synth/buildDefaultPageSchema';
import { normalizeFilterMode } from '../renderers/recordActivityFeed';
import type { RecordAlertRenderer } from '../renderers/record-alert';

describe('FeedFilterMode is the spec enum, at runtime as well as in types', () => {
  it('accepts every member the spec declares — read from the spec, not restated', () => {
    for (const mode of SpecFeedFilterModeEnum.options) {
      expect(normalizeFilterMode(mode, 'record:activity')).toBe(mode);
    }
  });

  it('still falls back for a value the spec does not declare', () => {
    expect(normalizeFilterMode('everything', 'record:activity')).toBe('all');
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off             */
/* "type-check" (objectui#4291 retired the narrow project that named this      */
/* file alone, once the package left TEST_DEBT in objectui#4040).              */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe('the two verdicts are pinned at compile time', () => {
  it('FeedFilterMode is the spec type itself', () => {
    type _SpecIsReal = Assert<Equal<IsAny<SpecFeedFilterMode>, false>>;
    type _IsTheSpecType = Assert<Equal<FeedFilterMode, SpecFeedFilterMode>>;
    expect(true).toBe(true);
  });

  it('ObjectDefFieldLike stays local because the SPEC declaration is the loose one', () => {
    type _SpecIsReal = Assert<Equal<IsAny<SpecObjectFieldLike>, false>>;

    // The reason for the rename, as an assertion: an index signature on the
    // spec's side means `extends`-ing it would make every misspelled key legal
    // here (objectstack#4075, from the other direction). When the spec tightens
    // `ObjectFieldLike`, this line fails and the symbol is due for re-triage —
    // it may become derivable.
    type _SpecIsABag = Assert<Extends<string, keyof SpecObjectFieldLike>>;
    type _LocalIsNot = Assert<Equal<Extends<string, keyof ObjectDefFieldLike>, false>>;

    // Different subsystems, and the key sets say so: the spec's is the
    // TRANSLATABLE surface `translateObject` walks; this one is what the detail
    // synthesizer lays out with.
    type _SpecCarriesHelp = Assert<HasKey<SpecObjectFieldLike, 'help'>>;
    type _LocalCarriesGroup = Assert<HasKey<ObjectDefFieldLike, 'group'>>;
    type _LocalCarriesHidden = Assert<HasKey<ObjectDefFieldLike, 'hidden'>>;

    expect(true).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* objectui#7265, this package's slice — `RecordAlertProps`.                   */
/*                                                                            */
/* Appended here rather than given a file of its own: this IS the package's    */
/* spec-symbol parity file, and the shape it already holds (a RENAME, pinned   */
/* by what the spec means rather than by what the copy said) is exactly the    */
/* shape this one needs. The block, the site and the empty-ledger path are     */
/* pinned one level up, in scripts/__tests__ beside the gate they are about.   */
/* -------------------------------------------------------------------------- */

describe('the renderer props convention this directory already kept', () => {
  // ⛔ Rooted at THIS FILE, never at `process.cwd()` — a package test runs under
  // two different cwds depending on the invocation (`check:test-path-roots`).
  const renderersDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderers');

  /** Every `React.FC<Name>` annotation in the renderers directory, file by file. */
  const annotations = (): Array<{ file: string; propsType: string }> => {
    const out: Array<{ file: string; propsType: string }> = [];
    for (const name of fs.readdirSync(renderersDir).sort()) {
      if (!name.endsWith('.tsx')) continue;
      const text = fs.readFileSync(path.join(renderersDir, name), 'utf8');
      for (const hit of text.matchAll(/React\.FC<\s*([A-Za-z0-9_]+)\s*>/g)) {
        out.push({ file: name, propsType: hit[1] });
      }
    }
    return out;
  };

  it('the scan finds annotations at all — the control', () => {
    // A convention derived from an empty population is a green that means
    // nothing. This leg fails if the directory moves, is renamed, or stops
    // spelling its components `React.FC<…>`.
    expect(annotations().length).toBeGreaterThan(1);
  });

  it('every renderer names its props type `…RendererProps`, never the block name', () => {
    // This is the reason `RecordAlertProps` was the LAST entry in the gate's
    // DEBT ledger while its siblings were never in it: `@objectstack/spec/ui`
    // owns a `Record<Block>Props` for each of the blocks rendered here, so the
    // `Renderer` infix is what keeps a renderer's props type out of the spec's
    // namespace. Derived from the directory rather than listed, so a renderer
    // added later is judged too.
    const offenders = annotations().filter((a) => !a.propsType.endsWith('RendererProps'));
    expect(
      offenders,
      'a renderer in this directory types its component with a props type that is not '
        + 'spelled `…RendererProps`. If the name is one @objectstack/spec exports, '
        + '`pnpm check:spec-symbols` will fail on it as a hand-written mirror of the '
        + "block's authored properties — which is what objectui#7265's last slice "
        + 'repaired. Rename the props type, or delete this assertion deliberately.',
    ).toEqual([]);
  });
});

describe('RecordAlertRendererProps is NOT the spec bag it wraps', () => {
  it('is pinned at compile time', () => {
    // The measurement that refused BIND, as assertions. The spec's
    // `RecordAlertProps` is the block's AUTHORED property bag; the renderer's
    // props are the React envelope that carries it. `severity` belongs to the
    // first and `schema` to the second, and the spec's declaration has no index
    // signature, so both questions have real answers on that side.
    type _SpecIsReal = Assert<Equal<IsAny<SpecRecordAlertProps>, false>>;
    type _SpecCarriesSeverity = Assert<HasKey<SpecRecordAlertProps, 'severity'>>;
    type _SpecIsNotTheEnvelope = Assert<Equal<HasKey<SpecRecordAlertProps, 'schema'>, false>>;

    // ⛔ Deliberately NOT asserted with `HasKey` on the renderer's side: its
    // props carry `[k: string]: any`, so `K extends keyof T` is true for every
    // K there and the question would answer itself. Identity is the probe that
    // still discriminates.
    type _RendererIsNotTheBag = Assert<
      Equal<Equal<React.ComponentProps<typeof RecordAlertRenderer>, SpecRecordAlertProps>, false>
    >;

    expect(true).toBe(true);
  });
});

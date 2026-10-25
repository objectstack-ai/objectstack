/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6783 — the THIRD channel of the degenerate-config-bag hazard: the
 * bag an `element:*` renderer reads, `{ ...schema.props, ...schema.properties }`.
 *
 * `??` only replaces `null`/`undefined`, so a non-object bag went straight into
 * the object spread and was re-read as its own character indices. Five modules
 * under `renderers/basic/` carried a copy of that read — `elements.tsx`,
 * `data-list.tsx`, `text-input.tsx`, `record-picker.tsx`,
 * `metadata-viewer.tsx` — and none of them asked the question
 * `packages/react` converged on one answer for (objectui#6761's `isConfigBag`).
 *
 * ## BASE_READING — measured on `107babef6`, this branch's base
 *
 * Captured by running the legs below against the five pre-fix copies (the fix
 * reverted in the worktree, `readProps.ts` absent), and pasted verbatim:
 *
 *   readProps({ type, properties: 'not-a-bag' })
 *     -> keys ["0","1","2","3","4","5","6","7","8"]
 *   readProps({ type, props: 'not-a-bag' })
 *     -> keys ["0","1","2","3","4","5","6","7","8"]
 *   readProps({ type, props: { content: 'X' }, properties: 'not-a-bag' })
 *     -> keys ["0","1","2","3","4","5","6","7","8","content"]
 *   readProps({ type, properties: ['a','b'] })
 *     -> keys ["0","1"]
 *
 * ⇒ nine keys nobody authored, on the same node shape objectui#6752 and
 * objectui#6760 already cleaned upstream.
 *
 * ## What did NOT move, also measured on the same base
 *
 * Ablating this card back to the pre-fix tree — the shared reader's body
 * returned to `?? {}` AND all five modules restored from `107babef6` — moves
 * 7 of the 16 assertions below and leaves 9 standing. Every DOM assertion in
 * "what the guard does not buy" is among the 9. That is the honest reading of this card and it is
 * recorded rather than smoothed over: all five renderers read NAMED keys off
 * this bag, and the single onward spread — `metadata-viewer`'s
 * `<StateMachineView {...props} />` — hands the bag to components that
 * destructure named `ViewerProps` fields. So the indexed keys were computed and
 * then dropped, and no rendered output on this base changes either way. The
 * guard buys what objectui#6752 measured ITS guard buys: the authored value's
 * shape is not reinterpreted. Nothing more, today; the property starts paying
 * the moment one of these five spreads its bag onto a DOM element, which
 * `metadata-viewer` is one refactor away from.
 *
 * ## The three channels are in SERIES, and this leg proves it on this base
 *
 * The probe below drives a node through the REAL `SchemaRenderer`, so both
 * upstream guards are in force, and reads what the renderer actually receives.
 * Measured on `107babef6`: `schema.properties` still holds the authored
 * `'not-a-bag'` when it reaches the component. Upstream does not sanitize this
 * channel — by design (objectui#6752's guard exists to PRESERVE the authored
 * shape) — so the renderer-side read is the only thing that can close it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, cleanup } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// A degenerate `properties` value on a test-registered type is the point: it
// crosses through the one test helper for undeclared input (objectui#11466).
import { undeclaredNode } from '@object-ui/test-support';
import { readProps } from '../readProps';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

afterEach(cleanup);

const keysOf = (schema: unknown) => Object.keys(readProps(schema));

describe('objectui#6783 — a degenerate config bag contributes no keys', () => {
  it('a degenerate `properties` is not enumerated into indexed keys', () => {
    // BASE_READING: ["0" … "8"].
    expect(keysOf({ type: 'element:text', properties: 'not-a-bag' })).toEqual([]);
  });

  it('a degenerate `props` is not enumerated either — the same question on the alias', () => {
    // BASE_READING: ["0" … "8"].
    expect(keysOf({ type: 'element:text', props: 'not-a-bag' })).toEqual([]);
  });

  it('a degenerate bag on ONE side leaves the other side intact', () => {
    // BASE_READING: ["0" … "8","content"], in that order — the ablation
    // corrected the prediction here. The nine indices sort AHEAD of the
    // authored key whatever the spread order, because integer-like keys come
    // first in JS property order; `content` itself survived pre-fix, so what
    // this pins is the ABSENCE of the nine, not the presence of `content`.
    expect(keysOf({ props: { content: 'X' }, properties: 'not-a-bag' })).toEqual(['content']);
    expect(keysOf({ props: 'not-a-bag', properties: { content: 'Y' } })).toEqual(['content']);
  });

  it('an ARRAY is degenerate too — `typeof [] === "object"` is why the predicate has two halves', () => {
    // BASE_READING: ["0","1"].
    expect(keysOf({ properties: ['a', 'b'] })).toEqual([]);
  });

  it('the empty-ish values behave exactly as they did — `??` and the predicate agree here', () => {
    expect(keysOf({})).toEqual([]);
    expect(keysOf({ properties: null, props: undefined })).toEqual([]);
    expect(keysOf(undefined)).toEqual([]);
    // A number spreads to nothing even pre-fix; pinned so the fix is not read
    // as having introduced this.
    expect(keysOf({ properties: 42 })).toEqual([]);
  });

  it('objectui#5123 precedence is untouched: `properties` wins a contested key', () => {
    const bag = readProps<{ content?: string; only?: string }>({
      props: { content: 'FROM_PROPS', only: 'FROM_PROPS' },
      properties: { content: 'FROM_PROPERTIES' },
    });
    expect(bag.content).toBe('FROM_PROPERTIES');
    expect(bag.only).toBe('FROM_PROPS');
  });
});

describe('objectui#6783 — the three channels are in series, measured end to end', () => {
  const PROBE = 'test:degenerate_bag_probe';

  function registerProbe() {
    ComponentRegistry.register(
      'degenerate_bag_probe',
      ({ schema }: { schema: any }) => (
        <div
          data-testid="probe"
          data-authored-properties={String(schema?.properties)}
          data-authored-type={typeof schema?.properties}
          data-bag-keys={Object.keys(readProps(schema)).join(',')}
        />
      ),
      { namespace: 'test', skipFallback: true }
    );
    if (!ComponentRegistry.get(PROBE)) throw new Error(`${PROBE} is not registered`);
  }

  it('the authored degenerate value still REACHES the renderer through SchemaRenderer', () => {
    registerProbe();
    const { getByTestId } = render(
      <SchemaRenderer schema={undeclaredNode({ type: PROBE, properties: 'not-a-bag' })} />
    );

    // Neither objectui#6752's evaluation guard nor objectui#6760's hoist
    // sanitizes the authored value — they PRESERVE its shape, which is what
    // leaves this third channel the only place the question can be answered.
    const probe = getByTestId('probe');
    expect(probe.getAttribute('data-authored-type')).toBe('string');
    expect(probe.getAttribute('data-authored-properties')).toBe('not-a-bag');
  });

  it('and the bag that renderer computes from it now carries nothing', () => {
    registerProbe();
    const { getByTestId } = render(
      <SchemaRenderer schema={undeclaredNode({ type: PROBE, properties: 'not-a-bag' })} />
    );

    // BASE_READING through the same path: "0,1,2,3,4,5,6,7,8".
    expect(getByTestId('probe').getAttribute('data-bag-keys')).toBe('');
  });
});

describe('objectui#6783 — what the guard does not buy (measured, not predicted)', () => {
  // One renderer per module that carried a copy. Each renders identically with
  // a degenerate bag and with no bag at all — GREEN on the pre-fix tree too.
  const CASES: Array<[string, string]> = [
    ['elements.tsx', 'element:text'],
    ['data-list.tsx', 'element:definition-list'],
    ['text-input.tsx', 'element:text_input'],
    ['record-picker.tsx', 'element:record_picker'],
    ['metadata-viewer.tsx', 'element:metadata_viewer'],
  ];

  it.each(CASES)('%s — `%s` renders the same with a degenerate bag as with none', (_file, type) => {
    const C = ComponentRegistry.get(type) as React.ComponentType<any>;
    if (!C) throw new Error(`${type} is not registered`);

    const degenerate = render(<C schema={{ type, properties: 'not-a-bag' }} />);
    const degenerateHtml = degenerate.container.innerHTML;
    cleanup();

    const absent = render(<C schema={{ type }} />);
    expect(degenerateHtml).toBe(absent.container.innerHTML);
  });
});

/**
 * The convergence, ratcheted. objectui#6761's lesson is that convergence alone
 * fixes today and not tomorrow: every spelling of this read is an expression
 * that produces no error when it drifts, so nothing would report a sixth copy
 * appearing next week. This scan makes the CHEAP path — copying the four lines
 * that used to be in each of these modules — fail.
 */
describe('objectui#6783 — one reader, and the pin that keeps it one', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const BASIC_ROOT = path.resolve(here, '..');

  const productionSources = () =>
    readdirSync(BASIC_ROOT, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
      .map((e) => e.name)
      .sort();

  /** `schema.props ?? {}` / `schema?.properties || {}` — either bag, either fallback. */
  const LOCAL_BAG_READ =
    /\??\.\s*(?:props|properties)\s*(?:\?\?|\|\|)\s*\{\s*\}/g;

  /**
   * Comments out first: this scans for a runtime READ, and the shared reader's
   * own docblock quotes the four lines it replaced verbatim. Prose naming the
   * removed spelling is the opposite of the drift being pinned — reporting it
   * would train the next author to stop writing the explanation.
   */
  const stripComments = (source: string) =>
    mask(source);

  it('no module under renderers/basic reads a config bag with its own `?? {}` fallback', () => {
    const found: string[] = [];
    for (const name of productionSources()) {
      const source = stripComments(readFileSync(path.join(BASIC_ROOT, name), 'utf8'));
      LOCAL_BAG_READ.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = LOCAL_BAG_READ.exec(source)) !== null) {
        found.push(`${name}: ${match[0].replace(/\s+/g, ' ')}`);
      }
    }
    // Every one of these is the copy objectui#6783 removed. Adding an entry
    // here is claiming a NEW question; importing `readProps` is saying it is
    // this one.
    expect(found).toEqual([]);
  });

  it('every module that reads a config bag imports the shared reader', () => {
    for (const name of ['elements.tsx', 'data-list.tsx', 'text-input.tsx', 'record-picker.tsx', 'metadata-viewer.tsx']) {
      const source = readFileSync(path.join(BASIC_ROOT, name), 'utf8');
      expect(source, `${name} no longer imports the shared reader`).toMatch(
        /import \{ readProps \} from '\.\/readProps';/
      );
    }
  });

  it('the shared reader asks `@object-ui/react`’s one predicate, not a local retelling', () => {
    const source = readFileSync(path.join(BASIC_ROOT, 'readProps.ts'), 'utf8');
    expect(source).toMatch(/import \{ isConfigBag \} from '@object-ui\/react';/);
    // The conjunction objectui#6761's own pin scans for, spelled here would be
    // the seventh copy — one package over, where that pin cannot see it.
    expect(source).not.toMatch(/Array\.isArray/);
  });
});

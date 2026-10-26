/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `app-schema-renderer.mobileNavMode` is a published VOCABULARY, not free text
 * (objectui#3985, maintainer ruling 2026-08-10).
 *
 * ## What was wrong
 *
 * The registration declared `{ name: 'mobileNavMode', type: 'string' }` while
 * the renderer implemented a small closed set. `checkType`'s string arm asks
 * only `typeof value === 'string'`, so `mobileNavMode="bottom-nav"` — the
 * hyphenated spelling of the underscored value, the single most likely typo on
 * this key — passed the manifest gate, passed the parser, reached the renderer,
 * missed its one equality test, and rendered the default. No diagnostic at any
 * layer. The designer drew a free-text box rather than a picker for the same
 * reason. That is objectui#3972's family with the polarity flipped: the
 * declaration was WIDER than the implementation, so the `invalid-enum` that
 * should have fired never could.
 *
 * The union also carried a third member with a JSDoc line promising "collapsed
 * sidebar" behaviour and zero read points, i.e. a value whose entire effect was
 * to be indistinguishable from the default. It is retired here under ADR-0049
 * enforce-or-remove; the ruling is explicit that making it behaviour is an
 * implementation card first.
 *
 * ## What this file pins, and where each pin actually fires
 *
 *   1. THE DECLARATION — an `enum` over exactly the implemented values. Fails
 *      in this run if the declaration is widened back to `string`, or if a
 *      value with no read point is added to the published vocabulary.
 *   2. THE VERDICT, through the real validator — `manifestFromConfigs` over the
 *      LIVE registration plus `compile`, never a hand-written manifest that
 *      could agree with itself. A misspelling and the retired value both come
 *      back `invalid-enum` at severity `error`; both legal values come back
 *      clean, which is the control that stops "no diagnostics" from passing for
 *      an empty reason.
 *   3. THE TYPE — a `@ts-expect-error` on the retired literal. This one does
 *      NOT fire in the Vitest run: Vitest transpiles without type-checking, so
 *      re-widening `MobileNavMode` leaves this file green here and fails
 *      `pnpm --filter @object-ui/layout type-check` instead ("Unused
 *      '@ts-expect-error' directive"). Said out loud because a pin whose gate
 *      you cannot name is a pin nobody will re-run.
 *
 * Behaviour of the two surviving values is pinned where behaviour belongs, on
 * the rendered DOM, in `AppSchemaRenderer.test.tsx` — a declaration test that
 * also claimed to prove rendering would be proving it from the wrong face.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentRegistry } from '@object-ui/core';
import { compile, manifestFromConfigs } from '@object-ui/sdui-parser';

import { registerLayout, type MobileNavMode } from '../index';

const TYPE = 'app-schema-renderer';

beforeAll(() => {
  // The barrel registers on evaluation; say so explicitly, so an import-order
  // accident is not what makes these claims true.
  registerLayout();
});

const inputs = () => ComponentRegistry.getConfig(TYPE)?.inputs ?? [];
const navModeInput = () => inputs().find((input) => input.name === 'mobileNavMode');

/**
 * A manifest built the way `renderers/layout/page.tsx` builds the JSX-page
 * compiler's whitelist — from the live registry — so these verdicts are the
 * ones a real author gets, not the ones a fixture was written to produce.
 */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const diagnose = (value: string) =>
  compile(`<${TYPE} mobileNavMode="${value}" />`, liveManifest()).diagnostics;

describe('the `mobileNavMode` declaration is the implemented vocabulary (objectui#3985)', () => {
  it('declares an `enum`, not free text', () => {
    expect(
      navModeInput(),
      [
        '`app-schema-renderer` no longer declares `mobileNavMode` at all. The key is still read',
        'by the renderer, so dropping the declaration does not retire it — it only hides it:',
        '`sdui-parser` would report `unknown-prop` on a key that works, and no designer panel',
        'would offer it.',
      ].join('\n'),
    ).toBeDefined();

    expect(
      navModeInput()?.type,
      [
        '`mobileNavMode` is declared as something other than `enum`. Back at `string` it is the',
        'objectui#3985 defect verbatim: `checkType` would judge only `typeof value ===',
        '"string"`, every misspelling would pass, and the renderer would silently fall back to',
        'the drawer. The declaration has to name the vocabulary for the error-level',
        '`invalid-enum` to exist at all.',
      ].join('\n'),
    ).toBe('enum');
  });

  it('publishes exactly the two values the renderer implements', () => {
    expect(
      navModeInput()?.enum,
      [
        'The published vocabulary changed. The renderer has exactly two read points for this',
        'prop — the `drawer` default and the `=== "bottom_nav"` comparison that gates the bottom',
        'bar — so these two values are the whole of what it implements.',
        '',
        'ADDING a value here republishes the objectui#3985 defect in its other form: a value with',
        'no read point behaves exactly like the default while the manifest, the generated',
        '`.d.ts` and the designer all present it as a mode. That is why the third member was',
        'retired rather than documented. A new mode lands as a renderer read point FIRST, in the',
        'same change that adds it here.',
      ].join('\n'),
    ).toEqual(['drawer', 'bottom_nav']);
  });

  it("names the renderer's ACTUAL default in the description, and both modes", () => {
    // The default an author is told about must be the value the renderer really
    // falls back to, or the docs and the runtime disagree about what "leave it
    // alone" means. The fallback is read off the renderer itself —
    // `AppSchemaRenderer`'s destructuring default for the prop — because the
    // input's own `defaultValue` was a shadow copy nothing consumed
    // (`ComponentInput.defaultValue` is an ADR-0049 tombstone since
    // objectui#7493). `description` is the published channel, so that is what
    // is pinned against the read site.
    const renderer = readFileSync(resolve(__dirname, '../AppSchemaRenderer.tsx'), 'utf8');
    const fallback = /\bmobileNavMode\s*=\s*'([a-z_]+)'/.exec(renderer)?.[1];
    expect(fallback, 'AppSchemaRenderer no longer declares a destructuring default for `mobileNavMode`').toBe('drawer');

    const description = navModeInput()?.description ?? '';
    expect(description).toMatch(/"drawer" \(default\)/);
    expect(description).toMatch(/bottom_nav/);
  });
});

describe('the validator refuses an out-of-vocabulary value (objectui#3985)', () => {
  it('accepts both legal values with no diagnostics', () => {
    // Non-vacuity for everything below: if the tag or the manifest were broken,
    // the "rejected" assertions would pass for the wrong reason.
    expect(diagnose('drawer')).toEqual([]);
    expect(diagnose('bottom_nav')).toEqual([]);
  });

  it('reports an error-level `invalid-enum` for the hyphenated misspelling', () => {
    const diagnostics = diagnose('bottom-nav');

    expect(
      diagnostics.map((d) => d.code),
      [
        'The hyphenated spelling of `bottom_nav` is accepted again. This is the exact input',
        'objectui#3985 was filed about: it used to pass validation and then miss the renderer’s',
        'equality check, so the author saw drawer behaviour and no error anywhere.',
      ].join('\n'),
    ).toContain('invalid-enum');

    expect(
      diagnostics.find((d) => d.code === 'invalid-enum')?.severity,
      'the `invalid-enum` dropped below `error` — a warning is dismissible, which is how the silent fallback comes back',
    ).toBe('error');
  });

  it('refuses the retired value by name, rather than treating it as a synonym for the default', () => {
    expect(
      diagnose('hamburger').map((d) => d.code),
      [
        'The retired value validates again. It was removed in objectui#3985 (ADR-0049',
        'enforce-or-remove) because the renderer never read it: it was published as a mode and',
        'behaved as the default. Re-accepting it in the DECLARATION alone restores exactly that',
        'state. If it has since been implemented, this assertion is replaced by one about what',
        'the renderer DOES with it — never merely deleted.',
      ].join('\n'),
    ).toContain('invalid-enum');
  });

  it('the retired literal is not assignable to `MobileNavMode`', () => {
    // Type-level half of the retirement. See this file's header: it fails under
    // `type-check`, not here, and it fails as an UNUSED directive the moment
    // the union is widened back.
    // @ts-expect-error — the retired mode is no longer a member of this union.
    const retired: MobileNavMode = 'hamburger';

    // Referenced so the binding is not merely unused-variable noise; the
    // assertion that matters is the directive above.
    expect(typeof retired).toBe('string');
  });
});

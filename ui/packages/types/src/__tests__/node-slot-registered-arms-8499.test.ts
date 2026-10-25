/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Registered, live renderers reached through a declared node slot resolve in an
 * arm of `AnyComponentSchema` (objectui#8499).
 *
 * ## The defect these pin
 *
 * Nine `type` spellings sat at DECLARED node slots in this repository's own
 * corpora and resolved in no arm of the union. Eight of them were registered
 * renderers; the ninth (`my-component`) is the reader's own plugin component and
 * carries a written exemption at `scripts/check-doc-component-types.mjs`.
 *
 * The damage ran the expensive direction: a reader following
 * `content/docs/utilities/runner.mdx`'s own instruction — "copy one, wrap it in
 * a page document … and save it as `src/app-data/pages/index.json`" — got a
 * document that RENDERS CORRECTLY in the browser and is REFUSED by `objectui
 * check`. The likely reaction to that is to stop trusting `check`, not to fix
 * the document.
 *
 * ## Why nothing caught it
 *
 * `check:doc-types` judges a `type` literal against the RENDERER REGISTRY (656
 * keys, measured at the time of writing); `AnyComponentSchema` declares 107 arm
 * literals. The two faces disagree BY CONSTRUCTION and nothing compared them at
 * a node slot. So the repair is paired with the comparison this file's third
 * `describe` performs — not the full `registry ⊆ arms` containment (552 of the
 * 656 registered keys have no arm, so that instrument needs a ledger this card
 * is not authorised to mint), but the two FAMILY arms compared against the very
 * arrays their registration sites loop over. A tag added to either array without
 * an arm here goes red instead of diverging silently.
 *
 * ## `line-chart` is deliberately NOT armed — the card's premise fails for it
 *
 * The card lists `line-chart` among the eight as a "REGISTERED, LIVE renderer".
 * Measured here, it is not. objectui#8499's triage admits arms only for things
 * that "运行时已经正确渲染" — already render correctly at runtime — so an arm
 * for `line-chart` would invent a capability rather than name one.
 *
 * ⚠️ THE REASON MOVED, and the fourth `describe` moved with it (objectui#8760).
 * When this file was written, `apps/console/src/register-plugins.ts` registered
 * `line-chart` as a LAZY STUB pointing at `@object-ui/plugin-charts` while that
 * package never registered the key, so the key was KNOWN to `check:doc-types`
 * and resolved to nothing at render. objectui#8760 retired the stub — together
 * with `area-chart` and `advanced-chart`, the other two of the same shape — so
 * today the key is absent from BOTH sides rather than half-present on one. The
 * arm is still owed the day a renderer registers it for real, so the fourth
 * `describe` now pins the retirement from both sources and fails if either
 * half comes back.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AnyComponentSchema } from '../zod/index.zod.js';
import { SemanticElementSchema, HtmlElementSchema } from '../zod/layout.zod.js';
import { InputShorthandSchema, UiCalendarSchema } from '../zod/form.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

const SEMANTIC_RENDERER = 'packages/components/src/renderers/layout/semantic.tsx';
const HTML_RENDERER = 'packages/components/src/renderers/basic/html-elements.tsx';
const CHARTS_PLUGIN = 'packages/plugin-charts/src/index.tsx';
const CONSOLE_PLUGINS = 'apps/console/src/register-plugins.ts';

/** The seven spellings this card armed, and where each renders from. */
const ARMED = [
  { type: 'footer', renderer: SEMANTIC_RENDERER },
  { type: 'header', renderer: SEMANTIC_RENDERER },
  { type: 'main', renderer: SEMANTIC_RENDERER },
  { type: 'nav', renderer: SEMANTIC_RENDERER },
  { type: 'h1', renderer: HTML_RENDERER },
  { type: 'password', renderer: 'packages/components/src/renderers/form/input.tsx' },
  { type: 'ui:calendar', renderer: 'packages/components/src/renderers/form/calendar.tsx' },
] as const;

/**
 * The firing controls. Each is a `type` NOTHING registers, so each must stay
 * refused — an assertion set that only ever says ACCEPT would pass against a
 * union that accepted everything, which is the failure mode a widening card is
 * most exposed to.
 */
const UNREGISTERED = [
  'h1ZZ',
  'stat-card',
  'my-component',
  'area-chart',
] as const;

/** The `type` literals a schema declares to Zod's discriminator dispatch. */
function literalsOf(schema: unknown): string[] {
  const values = (schema as { _zod?: { propValues?: { type?: Set<string> } } })._zod?.propValues
    ?.type;
  return values === undefined ? [] : [...values];
}

/** The string array a `const NAME = [ … ] as const;` declaration holds. */
function sourceArray(source: string, declaration: string): string[] {
  const start = source.indexOf(declaration);
  if (start === -1) throw new Error(`declaration not found: ${declaration}`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) throw new Error(`array literal not found: ${declaration}`);
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('objectui#8499 — the seven armed spellings resolve, at the root and at a node slot', () => {
  it.each(ARMED)('accepts `$type` as a document root', ({ type }) => {
    const result = AnyComponentSchema.safeParse({ type });
    expect(result.success, JSON.stringify(result.success ? {} : result.error.issues)).toBe(true);
  });

  it.each(ARMED)('accepts `$type` nested at a declared node slot', ({ type }) => {
    // The slot that matters: objectui#8344 pointed the node recursion point at
    // this union, so a nested node is judged by its own component schema. Before
    // this card every one of these was refused HERE as well as at the root.
    const result = AnyComponentSchema.safeParse({ type: 'div', children: [{ type }] });
    expect(result.success, JSON.stringify(result.success ? {} : result.error.issues)).toBe(true);
  });

  it('accepts the catalog fixtures the card names as its live evidence', () => {
    // These render — `examples/schema-catalog/test/catalog-gallery-render.test.tsx`
    // fails if any catalog entry paints the registry's OBJUI-001 "Unknown
    // component type" panel — and every one of them was refused by this union.
    const fixtures = [
      ...['article', 'aside', 'blog-article', 'complete-layout', 'footer', 'header',
        'main-element', 'navigation', 'section']
        .map((n) => `components-layout-semantic/${n}`),
      ...['custom-style', 'date-range', 'form-integration', 'multiple-dates',
        'simple-calendar', 'single-date']
        .map((n) => `components-form-calendar/${n}`),
    ];
    expect(fixtures).toHaveLength(15);
    const refused = fixtures.filter((name) => {
      const doc: unknown = JSON.parse(
        read(`examples/schema-catalog/src/schemas/${name}.json`),
      );
      return !AnyComponentSchema.safeParse(doc).success;
    });
    expect(refused, 'a fixture the renderer draws is still refused by the validator').toEqual([]);
  });
});

describe('objectui#8499 — the controls that keep the acceptances honest', () => {
  it.each(UNREGISTERED)('still refuses `%s`, which nothing registers', (type) => {
    expect(AnyComponentSchema.safeParse({ type }).success).toBe(false);
    expect(AnyComponentSchema.safeParse({ type: 'div', children: [{ type }] }).success).toBe(false);
  });

  it('the new arms judge VALUES, not just the discriminator', () => {
    // An arm that accepted its literal and nothing else would satisfy every
    // assertion above while validating nothing. Each pair is one green reading
    // and one red reading on the SAME key of the SAME arm.
    expect(AnyComponentSchema.safeParse({ type: 'img', src: 'a.png', width: 100 }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type: 'img', src: 'a.png', width: true }).success).toBe(false);
    expect(AnyComponentSchema.safeParse({ type: 'password', required: true }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type: 'password', required: 'yes' }).success).toBe(false);
    expect(AnyComponentSchema.safeParse({ type: 'ui:calendar', mode: 'single' }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type: 'ui:calendar', mode: 'agenda' }).success).toBe(false);
    expect(AnyComponentSchema.safeParse({ type: 'main', hidden: true }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type: 'main', hidden: 42 }).success).toBe(false);
  });

  it('adds no discriminator collision', () => {
    // `AnyComponentSchema` can only stay a discriminated union while every
    // literal is claimed once — `any-component-union-fanout.test.ts` states the
    // invariant; this leg says these four arms are not where it breaks.
    const added = [
      ...literalsOf(SemanticElementSchema),
      ...literalsOf(HtmlElementSchema),
      ...literalsOf(InputShorthandSchema),
      ...literalsOf(UiCalendarSchema),
    ];
    // 38 flow/inline tags: the 37 this card armed plus `code` (objectui#10756).
    expect(added.length).toBe(7 + 38 + 2 + 1);
    expect(new Set(added).size).toBe(added.length);
    const all = literalsOf(AnyComponentSchema);
    expect(new Set(all).size).toBe(all.length);
    for (const literal of added) expect(all).toContain(literal);
  });
});

describe('objectui#8499 — the family arms are compared against their registration sites', () => {
  // ⭐ THE COMPARISON INSTRUMENT. The two faces diverged by construction because
  // nothing compared them. This does, for the two families this card armed: the
  // arm's literal set must EQUAL the array the registration site loops over.
  //
  // ⚠️ WHAT THESE THREE LEGS ARE NOT, stated so the count is not overclaimed:
  // they are NOT controls for union membership. They read `SemanticElementSchema`
  // and `HtmlElementSchema` directly, so removing those arms from
  // `AnyComponentSchema` leaves them green — they survive that ablation by
  // design, because the property they hold is declaration-vs-registration parity,
  // a different one from "the union accepts this spelling". The union's own
  // firing controls are the `UNREGISTERED` refusals above.
  it('`SemanticElementSchema` names exactly the tags `semantic.tsx` registers', () => {
    const tags = sourceArray(read(SEMANTIC_RENDERER), 'const tags = ');
    expect(tags.length, 'the source read went vacuous — check the declaration name').toBe(7);
    expect([...literalsOf(SemanticElementSchema)].sort()).toEqual([...tags].sort());
  });

  it('`HtmlElementSchema` names exactly the tags `html-elements.tsx` registers', () => {
    const tags = sourceArray(read(HTML_RENDERER), 'const TAGS = ');
    expect(tags.length, 'the source read went vacuous — check the declaration name').toBe(38);
    expect([...literalsOf(HtmlElementSchema)].sort()).toEqual([...tags].sort());
  });

  it('detects a registered-but-unarmed tag, and fails closed on an unreadable source', () => {
    // ⚠️ What this control must NOT be, and was: comparing `[...armed]` against
    // `[...armed, 'hgroup']`. That is set algebra — an array differs from itself
    // plus an element whatever the schema says, so it passed without ever
    // touching a registration. Both halves below run the REAL instrument.
    //
    // A real mismatch, from a real registration site: `html-elements.tsx`
    // registers 38 tags and `SemanticElementSchema` arms none of them, so the
    // equality the two legs above perform must come out false here.
    const htmlTags = sourceArray(read(HTML_RENDERER), 'const TAGS = ');
    const semanticArmed = [...literalsOf(SemanticElementSchema)].sort();
    expect(htmlTags.length, 'the registration read went vacuous').toBe(38);
    expect(semanticArmed.length, 'the arm read went vacuous').toBe(7);
    expect(semanticArmed).not.toEqual([...htmlTags].sort());

    // And the reader must be able to come back EMPTY rather than fabricate a
    // pass — which is what makes the `toBe(7)` / `toBe(38)` guards above real
    // guards. A declaration name that is not in the file throws rather than
    // quietly yielding [], so the non-vacuity checks cannot be satisfied by a
    // reader that has stopped reading. (The `toBe(38)` guards read 37 when this
    // card landed; `code` joined `TAGS` and this arm together in objectui#10756.)
    expect(() => sourceArray(read(SEMANTIC_RENDERER), 'const notADeclaration = ')).toThrow(
      /declaration not found/,
    );
  });
});

describe('objectui#8499 — `line-chart` stays unarmed, and the reason stays checked', () => {
  /**
   * The three spellings objectui#8760 retired. Each was a console `registerLazy`
   * stub that `@object-ui/plugin-charts` never fulfilled; `area-chart` is also
   * one of this file's `UNREGISTERED` firing controls above, which is the same
   * reading taken from the union's side.
   */
  const RETIRED_8760 = ['line-chart', 'area-chart', 'advanced-chart'] as const;

  it.each(RETIRED_8760)('`%s` resolves in no arm', (type) => {
    expect(AnyComponentSchema.safeParse({ type }).success).toBe(false);
    expect(AnyComponentSchema.safeParse({ type: 'div', children: [{ type }] }).success).toBe(false);
  });

  it('is registered by neither the console nor `@object-ui/plugin-charts`', () => {
    // Both halves are read from source so the day someone registers the key for
    // real — in EITHER place — this goes red and the arm becomes owed.
    //
    // The console half reads the stub list rather than the whole file, because
    // the file still NAMES all three: objectui#8760 left a ⛔ comment saying
    // they are retired, and a substring search over the source would match that
    // comment and pass on a re-registration.
    const consoleSource = read(CONSOLE_PLUGINS);
    const stubbed = [
      ...consoleSource.matchAll(/registerLazy\(\s*'([^']+)'/g),
      ...[...consoleSource.matchAll(/for \(const variant of \[([^\]]*)\]\)/g)].flatMap((m) => [
        ...m[1].matchAll(/'([^']+)'/g),
      ]),
    ].map((m) => m[1]);
    // Non-vacuity: the reader must actually find the console's registrations.
    expect(stubbed.length, 'the console stub read went vacuous').toBeGreaterThanOrEqual(20);
    // `chart:bar` since objectui#10859 batch 8 retired the `pie-chart` stub.
    expect(stubbed, 'the reader is looking at the chart stubs').toContain('chart:bar');

    const pluginSource = read(CHARTS_PLUGIN);
    const registered = [...pluginSource.matchAll(/register\(\s*\n?\s*'([^']+)'/g)].map((m) => m[1]);
    // Non-vacuity: the reader must actually find this module's registrations.
    // Four since objectui#10859 batch 8 retired four chart-family keys.
    expect(registered.length, 'the registration read went vacuous').toBeGreaterThanOrEqual(4);
    expect(registered).toContain('chart:bar');

    for (const type of RETIRED_8760) {
      expect(stubbed, `${type} is stubbed in the console again`).not.toContain(type);
      expect(registered, `${type} is registered by the charts plugin again`).not.toContain(type);
    }
  });
});

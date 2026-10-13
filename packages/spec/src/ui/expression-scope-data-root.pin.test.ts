// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23036] A page component's `visibleWhen` has no `data` root, and neither of
 * its two prose faces may say the shipping renderer mounts one.
 *
 * ## The fact being pinned
 *
 * objectui#9308 ruling B (2026-09-13) removed `data` as a runtime expression
 * root: `SchemaRenderer` no longer publishes its injected data source as
 * `data`, and the one scope channel left (`PredicateScopeProvider`) is fed in
 * the shipping console only by app-shell's `ExpressionProvider`, which
 * publishes `current_user`, `user`, `ctx.user`, `os.user` and `features`. So a
 * `data.*` read in this predicate faults, and this surface answers a faulting
 * predicate by rendering the component: `data.total > 0` and `data.total == 0`
 * both show it. The `.describe()` said the renderer "binds `data` to the
 * data-source ADAPTER here" — a gate written from it never gates, and nothing
 * refuses it. #17203 corrected the same sentence for `app`
 * (`expression-scope-app-root.pin.test.ts`); this file holds the `data` half.
 *
 * ## What is pinned: the claim, not the wording
 *
 * 1. The mounted-roots sentence names exactly `features` and `os.user`, on both
 *    faces (the published `.describe()` and the TSDoc an AI author reads).
 * 2. On the published face, every sentence that names `data` says it is NOT
 *    mounted here, ties it to the PLANNED API binding, or is about the
 *    `page:tabs` item evaluator — the three readings that are true today.
 * 3. The two texts in this file agree. The `visibleWhen` face names the
 *    PLANNED API binding as the only `data` carrier, which holds exactly while
 *    `ElementApiDataSourceSchema`'s own describe still carries
 *    `[PLANNED — not yet rendered]`. When that binding's renderer ships and its
 *    describe drops the marker, this pin goes red so the `visibleWhen` face is
 *    rewritten in the same change, not left behind.
 *
 * Rewording any of these sentences is free; a sentence that tells an author
 * the renderer binds `data` on this surface is not.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, it, expect } from 'vitest';

import { ElementApiDataSourceSchema, PageComponentSchema } from './page.zod';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const pageSource = fs.readFileSync(path.resolve(HERE, 'page.zod.ts'), 'utf8');
const componentSource = fs.readFileSync(path.resolve(HERE, 'component.zod.ts'), 'utf8');

/**
 * The published description of `PageComponentSchema.visibleWhen`.
 *
 * ⚠️ NOT `.shape` — ADR-0089 D3a made this schema a `.strict().transform(…)`
 * pipe, so the object carrying the property descriptions is its INPUT side.
 */
const visibleWhenDescription = (): string => {
  const shape = (PageComponentSchema as unknown as {
    def: { in: { shape: Record<string, { description?: string }> } };
  }).def.in.shape;
  const d = shape.visibleWhen.description;
  expect(d, 'the describe() must exist — this pin is about its content').toBeTruthy();
  return d!;
};

/**
 * The TSDoc block directly above the `visibleWhen:` property, with the comment
 * gutter stripped and its paragraphs (headings included) kept apart by a blank
 * line. Anchored on its first line and on the property itself, so a block that
 * moves or loses either fails here instead of asserting over nothing.
 */
const visibleWhenDocblock = (): string => {
  const start = pageSource.indexOf('Conditional-visibility predicate (CEL) — the component is rendered only when');
  const end = pageSource.indexOf('visibleWhen: EvaluatedExpressionInputSchema', start);
  expect(start, 'docblock anchor not found — the pin has drifted off its site').toBeGreaterThan(-1);
  expect(end, 'property anchor not found after the docblock').toBeGreaterThan(start);
  return pageSource.slice(start, end)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\/?\s?/, '').trimEnd())
    .join('\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
};

/**
 * Sentences of a prose face. A paragraph break ends one; a period, `!` or `?`
 * ends one only when white space and a capital, a backtick or `⚠` follow — so
 * dotted tokens (`os.user`, `page.<var>`, `data.*`) and "e.g." stay inside
 * their sentence.
 */
const sentences = (text: string): string[] =>
  text.split(/\n\n|(?<=[.!?])\s+(?=[A-Z`⚠])/).map((s) => s.trim()).filter(Boolean);

/** The sentence a mounted-roots claim lives in, located by its anchor. */
const sentenceAt = (text: string, anchor: string): string => {
  const hit = sentences(text).find((s) => s.includes(anchor));
  expect(hit, `anchor not found — the pin has drifted off its site: ${anchor}`).toBeTruthy();
  return hit!;
};

/** Every backticked token in a sentence: the roots it names. */
const backticked = (s: string): string[] => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/**
 * The published-face rule (2): sentences naming `data` that are none of the
 * three true readings. Returned rather than asserted, so the controls below can
 * run it on a text that MUST fail.
 */
const dataClaimsOutsideTheTrueReadings = (text: string): string[] =>
  sentences(text)
    .filter((s) => s.includes('`data`'))
    .filter((s) => !/\bNO `data`/.test(s) && !s.includes('PLANNED') && !s.includes('`page:tabs`'));

/** The sentence shapes the retired claim was written in, on either face. */
const RETIRED_CLAIM_SHAPES = [/binds `data` to the data-source/i, /`data` is the data-source/i] as const;

const MOUNTED_ROOTS = ['features', 'os.user'];

describe('a page component `visibleWhen` names no `data` root — the shipping renderer mounts none', () => {
  describe('published face — `PageComponentSchema.visibleWhen`.describe()', () => {
    it('the mounted-roots sentence names exactly `features` and `os.user`', () => {
      const s = sentenceAt(visibleWhenDescription(), 'additionally mounts');
      expect(backticked(s)).toEqual(MOUNTED_ROOTS);
      expect(s).toContain('NOT contract-guaranteed');
    });

    it('states the absence, and no sentence claims `data` is bound here', () => {
      const d = visibleWhenDescription();
      expect(d).toContain('mounts NO `data` root');
      expect(dataClaimsOutsideTheTrueReadings(d)).toEqual([]);
      for (const shape of RETIRED_CLAIM_SHAPES) expect(d).not.toMatch(shape);
    });

    it('keeps the `page:tabs` item reading, which is still true: that evaluator binds `data` to the row', () => {
      const s = sentenceAt(visibleWhenDescription(), '`page:tabs`');
      expect(s).toContain('`data`');
      expect(s).toContain('ROW');
    });

    it('keeps the contract-bound roots, a different clause this card does not touch', () => {
      const s = sentenceAt(visibleWhenDescription(), 'Contract-bound roots');
      for (const root of ['record', 'current_user', 'user', 'ctx.user']) expect(backticked(s)).toContain(root);
    });
  });

  describe('TSDoc face — the docblock above `visibleWhen` (no generator reads it; an AI author opening the file does)', () => {
    it('the "Ambient roots" sentence names exactly `features` and `os.user`', () => {
      const s = sentenceAt(visibleWhenDocblock(), 'The shipping renderer additionally mounts');
      expect(backticked(s)).toEqual([...MOUNTED_ROOTS, 'ExpressionProvider']);
    });

    it('states the absence, and carries neither shape the retired claim was written in', () => {
      const doc = visibleWhenDocblock();
      expect(doc).toContain('mounts NO `data` root');
      for (const shape of RETIRED_CLAIM_SHAPES) expect(doc).not.toMatch(shape);
    });
  });

  describe('the `page:tabs` item twin — the TSDoc above its `visibleWhen` in `component.zod.ts`', () => {
    it('says the component-node evaluator mounts no `data` root, in neither shape the retired claim was written in', () => {
      const start = componentSource.indexOf('Conditional tab (CEL, #2606)');
      const end = componentSource.indexOf('visibleWhen: EvaluatedExpressionInputSchema.optional()', start);
      expect(start, 'docblock anchor not found — the pin has drifted off its site').toBeGreaterThan(-1);
      expect(end, 'property anchor not found after the docblock').toBeGreaterThan(start);
      const doc = componentSource.slice(start, end).replace(/\s*\n\s*\*\s*/g, ' ');
      expect(doc).toContain('the component-node evaluator mounts no `data` root');
      expect(doc).not.toMatch(/binds it to the data-source ADAPTER/i);
      for (const shape of RETIRED_CLAIM_SHAPES) expect(doc).not.toMatch(shape);
    });
  });

  describe('the two texts in this file agree — the PLANNED API binding is the only `data` carrier', () => {
    it('`visibleWhen` names the PLANNED API binding as where `data` is declared', () => {
      const s = sentences(visibleWhenDescription()).find((x) => x.includes('PLANNED'));
      expect(s, 'the describe no longer names the planned binding').toBeTruthy();
      expect(s).toContain('`data`');
      expect(s).toContain("provider: 'api'");
    });

    it('…which holds only while the API binding is still PLANNED and still declares a `data` read in `visibleWhen`', () => {
      const api = ElementApiDataSourceSchema.description ?? '';
      expect(
        api.startsWith('[PLANNED — not yet rendered]'),
        'The API binding is no longer marked PLANNED, so its renderer has shipped: on an element carrying '
          + 'that binding `data` is now mounted. Rewrite `PageComponentSchema.visibleWhen`\'s `data` sentence '
          + '(describe and docblock) in the same change, then this assertion.',
      ).toBe(true);
      expect(api).toContain('`data`');
      expect(api).toContain('`visibleWhen`');
    });
  });

  describe('probe controls — a pass above is only a reading if these hold', () => {
    /**
     * DARK. The describe sentence this card replaced, verbatim. Rule (2) and
     * the retired-shape list must both catch it, or their `toEqual([])` /
     * `not.toMatch` arms above could be passing on a matcher that matches
     * nothing.
     */
    it('DARK: the replaced describe sentence fails rule (2) and the retired-shape list', () => {
      const replaced = 'Contract-bound roots: `record`, `current_user`, and page state as `page.<var>`. '
        + 'The shipping renderer additionally mounts `features`, `os.user` and binds `data` to the data-source '
        + 'ADAPTER here — renderer behaviour, NOT contract-guaranteed (ADR-0068 rules the user object only). '
        + '⚠️ `data` is surface-dependent: on a `page:tabs` item `visibleWhen` it is the record ROW instead.';
      expect(dataClaimsOutsideTheTrueReadings(replaced)).toHaveLength(1);
      expect(backticked(sentenceAt(replaced, 'additionally mounts'))).toContain('data');
      expect(RETIRED_CLAIM_SHAPES.some((shape) => shape.test(replaced))).toBe(true);
    });

    /** DARK. The sentence splitter keeps dotted tokens and "e.g." inside one sentence. */
    it('DARK: dotted tokens do not split a sentence', () => {
      expect(sentences('Mounts `os.user` and `page.<var>`; e.g. "page.x != \'\'". Next one.')).toHaveLength(2);
    });

    /** DARK. A site renamed out from under this pin fails loudly, never vacuously. */
    it('DARK: a missing anchor fails the pin rather than passing over nothing', () => {
      expect(() => sentenceAt(visibleWhenDescription(), 'no such anchor exists in this describe')).toThrow();
    });
  });
});

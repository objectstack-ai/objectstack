// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15184] The `columns` x `hiddenFields` x `fieldOrder` composition is a
 * DECLARED part of the list-view contract, and every authoring door accepts
 * all three keys together.
 *
 * ## Why this pin exists
 *
 * `fieldOrder` was proposed for retirement (ruling of 2026-09-04) on the
 * premise that it is a second spelling of `columns` with no contract deciding
 * who wins. The premise was measured false: the two keys never compete,
 * because one projects and the other sorts, and objectui applies all three in
 * one memo. Ruling B (2026-09-11, decision batch #115) therefore KEPT the key
 * and ruled the composition into the contract instead:
 *
 *   `columns` is the projection, `hiddenFields` subtracts from it,
 *   `fieldOrder` orders what survives (entries absent from `fieldOrder`
 *   sort last).
 *
 * A composition stated only in prose rots the way the retired citation rotted
 * — so this file holds the two halves that make it a contract rather than a
 * comment:
 *
 * - **The declaration half** reads the three `.describe()` strings off the
 *   LIVE schema, not off the source text. Those strings are the published
 *   authoring surface: they ship into `json-schema/`, into the generated
 *   `content/docs/references/ui/view.mdx`, and into the TSDoc an author (often
 *   an AI author, ADR-0033) hovers. Dropping the composition from any one of
 *   them reds here, naming the key that lost it.
 * - **The door half** parses documents carrying all three keys through the
 *   four doors a list view really arrives by, and asserts the values survive
 *   VERBATIM. The spec declares the composition; it does not perform it. A
 *   door that started reordering, deduplicating or cross-validating these
 *   arrays would be silently doing the renderer's job at parse time, and the
 *   renderer would then compose over an input it did not receive.
 *
 * ⛔ Scope: the RELATION, not the wording. Rewording any of the three
 * descriptions is fine — what they may not do is stop naming the other two
 * keys, stop stating their own role in the composition, or start claiming that
 * `fieldOrder` selects fields or that `hiddenFields` orders them.
 *
 * ⛔ This pin deliberately asserts nothing about HOW a renderer sorts. That
 * behaviour is objectui's, measured in the liveness ledger row
 * (`packages/spec/liveness/view.json`, `/props/list/children/fieldOrder`).
 * Restating it as a spec test would be a claim this package cannot falsify.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

import {
  ListViewSchema,
  ObjectListViewSchema,
  defineView,
} from './view.zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW_SOURCE = join(HERE, 'view.zod.ts');

/** The three composing keys, in the order they are applied. */
const COMPOSITION = ['columns', 'hiddenFields', 'fieldOrder'] as const;

type Shape = Record<string, { description?: string } | undefined>;

const listShape = (): Shape =>
  (ListViewSchema as unknown as { shape: Shape }).shape;

/** The `.describe()` text the published surface carries for `key`, lowercased. */
function description(key: string): string {
  const entry = listShape()[key];
  expect(entry, `\`${key}\` is no longer a member of ListViewSchema — re-anchor this pin`).toBeTruthy();
  const text = entry?.description;
  expect(text, `\`${key}\` carries no .describe() text`).toBeTruthy();
  return String(text).toLowerCase();
}

/**
 * The JSDoc block attached to the `hiddenFields` declaration — the one that
 * states the composition once for the whole block.
 */
function compositionDocblock(): string {
  const source = readFileSync(VIEW_SOURCE, 'utf8');
  const key = source.indexOf('hiddenFields: z.array(z.string()).optional().describe(');
  expect(key, 'the `hiddenFields` declaration moved — re-anchor this pin').toBeGreaterThan(-1);
  const open = source.lastIndexOf('/**', key);
  const close = source.indexOf('*/', open);
  expect(open, 'no JSDoc block precedes `hiddenFields`').toBeGreaterThan(-1);
  expect(close, 'unterminated JSDoc block').toBeLessThan(key);
  return source
    .slice(open, close + 2)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
    .toLowerCase();
}

/** A list view exercising all three keys at once. */
const COMPOSED_LIST = {
  type: 'grid' as const,
  columns: ['name', 'stage', 'amount', 'owner'],
  hiddenFields: ['owner'],
  // Deliberately partial and deliberately out of `columns` order: `amount`
  // moves to the front, `name` and `stage` are unlisted survivors, and
  // `owner` is a subtracted name this list still mentions.
  fieldOrder: ['amount', 'owner'],
};

describe('[#15184] the list-view field composition is declared, not implied', () => {
  describe('declaration — the published `.describe()` of each composing key', () => {
    it.each(COMPOSITION)('`%s` names all three keys of the composition', (key) => {
      const text = description(key);
      for (const sibling of COMPOSITION) {
        expect(text, `\`${key}\` no longer names \`${sibling}\``).toContain(sibling.toLowerCase());
      }
    });

    it('`columns` declares itself the PROJECTION, and that nothing re-adds what it omits', () => {
      const text = description('columns');
      expect(text).toContain('projection');
      // The half that makes it a contract rather than a label: the other two
      // keys cannot widen the set.
      expect(text).toMatch(/cannot add|not add|never add/);
    });

    it('`hiddenFields` declares itself the SUBTRACTION, applied before the ordering', () => {
      const text = description('hiddenFields');
      expect(text).toMatch(/subtract|removed from/);
      expect(text).toContain('before');
      expect(text).toContain('fieldorder');
    });

    it('`fieldOrder` declares itself the ORDERING, additive of nothing', () => {
      const text = description('fieldOrder');
      expect(text).toMatch(/orders|ordering/);
      expect(text).toMatch(/never adds|does not add|adds no/);
    });

    it('`fieldOrder` states where an unlisted survivor lands — LAST', () => {
      // The one rule an author cannot guess and the renderer really applies
      // (`?? Infinity` in objectui's effective-fields memo). Without it the
      // description would describe a partial `fieldOrder` as undefined
      // behaviour, which is exactly what it is not.
      const text = description('fieldOrder');
      expect(text).toContain('last');
    });

    it('the block docblock states the composition once, in application order', () => {
      const doc = compositionDocblock();
      expect(doc).toContain('projection');
      expect(doc).toContain('subtract');
      expect(doc).toContain('orders what survives');
      // Application order, read positionally: projection, then subtraction,
      // then ordering.
      const iColumns = doc.indexOf('`columns` is the **projection**');
      const iHidden = doc.indexOf('`hiddenfields` **subtracts**');
      const iOrder = doc.indexOf('`fieldorder` **orders what survives**');
      expect(iColumns, 'the docblock no longer states the projection step').toBeGreaterThan(-1);
      expect(iHidden, 'the docblock no longer states the subtraction step').toBeGreaterThan(-1);
      expect(iOrder, 'the docblock no longer states the ordering step').toBeGreaterThan(-1);
      expect(iColumns).toBeLessThan(iHidden);
      expect(iHidden).toBeLessThan(iOrder);
    });
  });

  describe('doors — all three keys are accepted together, and survive verbatim', () => {
    it('ListViewSchema (the page list door)', () => {
      const parsed = ListViewSchema.parse({ ...COMPOSED_LIST } as never) as typeof COMPOSED_LIST;
      expect(parsed.columns).toEqual(COMPOSED_LIST.columns);
      expect(parsed.hiddenFields).toEqual(COMPOSED_LIST.hiddenFields);
      expect(parsed.fieldOrder).toEqual(COMPOSED_LIST.fieldOrder);
    });

    it('ObjectListViewSchema (the ADR-0047 "views" mode door)', () => {
      const parsed = ObjectListViewSchema.parse({ ...COMPOSED_LIST } as never) as typeof COMPOSED_LIST;
      expect(parsed.columns).toEqual(COMPOSED_LIST.columns);
      expect(parsed.hiddenFields).toEqual(COMPOSED_LIST.hiddenFields);
      expect(parsed.fieldOrder).toEqual(COMPOSED_LIST.fieldOrder);
    });

    it('defineView (the authoring door)', () => {
      const view = defineView({ name: 'crm_lead', list: { ...COMPOSED_LIST } } as never);
      const list = (view as { list?: typeof COMPOSED_LIST }).list;
      expect(list?.columns).toEqual(COMPOSED_LIST.columns);
      expect(list?.hiddenFields).toEqual(COMPOSED_LIST.hiddenFields);
      expect(list?.fieldOrder).toEqual(COMPOSED_LIST.fieldOrder);
    });

    it('the registered `view` metadata door (Studio, the API, an agent)', () => {
      const schema = getMetadataTypeSchema('view');
      expect(schema, 'the `view` metadata type is no longer registered').toBeTruthy();
      const parsed = schema!.parse({
        name: 'crm_lead',
        list: { ...COMPOSED_LIST },
      } as never) as { list?: typeof COMPOSED_LIST };
      expect(parsed.list?.columns).toEqual(COMPOSED_LIST.columns);
      expect(parsed.list?.hiddenFields).toEqual(COMPOSED_LIST.hiddenFields);
      expect(parsed.list?.fieldOrder).toEqual(COMPOSED_LIST.fieldOrder);
    });

    it('accepts all three keys with NO unrecognized-key report — they are real authorable slots', () => {
      // The strict door's own verdict, not an inference from `success`: a key
      // the shape did not declare would surface here by name.
      const r = ListViewSchema.safeParse({ ...COMPOSED_LIST } as never);
      expect(r.success).toBe(true);
      expect(JSON.stringify(r.error?.issues ?? [])).not.toContain('unrecognized_keys');
    });
  });

  describe('doors — the spec DECLARES the composition, it does not perform it', () => {
    it('does not cross-validate `fieldOrder` against `columns`', () => {
      // `fieldOrder` may name a field `columns` never projected. The renderer
      // orders nothing by it; reference integrity is `@objectstack/lint`'s
      // job (`validate-list-view-field-refs.ts`), against the object's real
      // field map — a door that guessed here would reject documents the
      // platform itself writes.
      const r = ListViewSchema.safeParse({
        type: 'grid',
        columns: ['name'],
        fieldOrder: ['not_projected', 'name'],
      } as never);
      expect(r.success).toBe(true);
    });

    it('does not cross-validate `hiddenFields` against `columns`', () => {
      const r = ListViewSchema.safeParse({
        type: 'grid',
        columns: ['name'],
        hiddenFields: ['never_projected'],
      } as never);
      expect(r.success).toBe(true);
    });

    it('does not apply the composition at parse time — `columns` comes back whole', () => {
      // The failure this forbids is a door that "helpfully" subtracts or
      // reorders: the renderer would then compose over an already-composed
      // input, and `hiddenFields` would subtract twice from nothing.
      const parsed = ListViewSchema.parse({ ...COMPOSED_LIST } as never) as typeof COMPOSED_LIST;
      expect(parsed.columns).toHaveLength(COMPOSED_LIST.columns.length);
      expect(parsed.columns).toContain('owner');
      expect(parsed.columns[0]).toBe('name');
    });
  });

  describe('shape — the three keys are siblings on one schema', () => {
    it('all three are declared on ListViewSchema itself', () => {
      const shape = listShape();
      for (const key of COMPOSITION) {
        expect(Object.keys(shape), `\`${key}\` left ListViewSchema`).toContain(key);
      }
    });

    it('`columns` is required and the other two are optional', () => {
      // The projection is the only one an author must write: a list view with
      // no candidate set has nothing to subtract from or order.
      const r = ListViewSchema.safeParse({ type: 'grid', hiddenFields: ['a'], fieldOrder: ['a'] } as never);
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues ?? [])).toContain('columns');

      const ok = ListViewSchema.safeParse({ type: 'grid', columns: ['a'] } as never);
      expect(ok.success).toBe(true);
    });
  });
});

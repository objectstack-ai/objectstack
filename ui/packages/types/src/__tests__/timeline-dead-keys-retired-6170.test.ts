/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `TimelineSchema`'s `events`, `orientation` and `position`
 * are REFUSED by name, not silently kept (objectui#6170, ADR-0049 stage 2).
 *
 * ## The failure this pin exists to prevent
 *
 * Until objectui#6170 these three were the ONLY keys `TimelineSchema` declared,
 * and no renderer ever read any of them: a timeline authored with `events`
 * drew an EMPTY rail, `orientation: 'horizontal'` drew the default vertical
 * rail (the layout key is `variant`), and `position` did nothing at all. Every
 * one of those documents type-checked and parsed green, and nothing said a
 * word. The maintainer ruling (2026-08-25, 「同意」) sends the three down the
 * ADR-0049 enforce-or-remove route; with no producer that expects them to
 * render, the route is REMOVE.
 *
 * So the deliverable is not "the keys are gone". It is: **a document that
 * still carries one of them is refused loudly at the authoring boundary, and
 * the refusal says what to write instead.**
 *
 * ## Why tombstones, and not simply deleting the members
 *
 * `BaseSchema` is `.passthrough()` on the Zod side and carried a
 * `[key: string]: any` index signature on the TS side until objectui#8347
 * (objectui#5155 / objectui#6269 owned that ceiling). An UNDECLARED key is
 * therefore accepted, unvalidated, by the Zod half (and was by the TS half;
 * since objectui#8347 only through a widened value) — deleting the members would hand the retired
 * keys exactly the silent no-op this pin exists to prevent. `?: never` /
 * `retirementTombstone()` on both halves, in lockstep, is this package's
 * convention (`timeline-timescale-retired.test.ts` pins the same shape for
 * `timeScale`, objectui#6355).
 *
 * ## What each assertion measures
 *
 * The refusal is asserted by ENVELOPE — the issue's path names the key, its
 * `code` is `invalid_type`, it `expected` `never` — never by `success: false`
 * alone, which an unrelated rejection would satisfy. Each refusal is paired
 * with a counter-probe (the same document, migrated) that must parse green, so
 * a schema that refused everything could not pass for this one. The old
 * vocabularies' WELL-TYPED values are the probes on purpose: before this
 * change `orientation: 'horizontal'` and `position: 'left'` parsed green, so
 * these assertions are red on the pre-retirement tree for the retirement's
 * reason, not for a bad value's.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { TimelineSchema } from '../zod/data-display.zod.js';
import { safeValidateSchema, StrictSchemaNodeSchema } from '../zod/index.zod.js';
import type { TimelineSchema as TimelineSchemaTS } from '../data-display.js';

const FEED = [{ time: '2024-01-15', title: 'Kickoff', description: 'Initial meeting' }];

/**
 * One row per retired key: the document class that key produced, the same
 * document migrated to what the renderer reads, and the key the refusal must
 * name as its replacement (`null` where nothing replaces it).
 */
const RETIRED: ReadonlyArray<{
  key: 'events' | 'orientation' | 'position';
  retired: Record<string, unknown>;
  migrated: Record<string, unknown>;
  replacement: string | null;
}> = [
  {
    key: 'events',
    // The pre-#6170 authoring form, as `packages/types/examples/` wrote it.
    retired: { type: 'timeline', events: [{ id: 'e1', title: 'Kickoff', date: '2024-01-15' }] },
    migrated: { type: 'timeline', items: [{ time: '2024-01-15', title: 'Kickoff' }] },
    replacement: 'items',
  },
  {
    key: 'orientation',
    retired: { type: 'timeline', orientation: 'horizontal', items: FEED },
    migrated: { type: 'timeline', variant: 'horizontal', items: FEED },
    replacement: 'variant',
  },
  {
    key: 'position',
    retired: { type: 'timeline', position: 'left', items: FEED },
    migrated: { type: 'timeline', items: FEED },
    replacement: null,
  },
];

type Issue = z.core.$ZodIssue;

/** Every issue in the tree, nested union-arm `errors` included. */
const allIssues = (issues: readonly Issue[]): Issue[] => {
  const out: Issue[] = [];
  const walk = (list: readonly Issue[]) => {
    for (const issue of list) {
      out.push(issue);
      const nested = (issue as { errors?: readonly (readonly Issue[])[] }).errors;
      if (nested) for (const arm of nested) walk(arm);
    }
  };
  walk(issues);
  return out;
};

describe('events / orientation / position are RETIRED — refused by name on the tolerant face (objectui#6170)', () => {
  for (const { key, retired, migrated, replacement } of RETIRED) {
    it(`REFUSES a document carrying \`${key}\`, on the \`${key}\` path, as a tombstone`, () => {
      const result = TimelineSchema.safeParse(retired);
      expect(result.success, `a document authoring \`${key}\` was ACCEPTED — it renders as if the key were absent`).toBe(false);
      if (result.success) return;

      const issue = result.error.issues.find((i) => i.path[0] === key);
      expect(issue, `parse failed, but not on the \`${key}\` path`).toBeTruthy();
      expect(issue?.code).toBe('invalid_type');
      expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
    });

    it(`the \`${key}\` refusal carries its guidance, in both channels, and names ${replacement ? `\`${replacement}\`` : 'no replacement'}`, () => {
      const result = TimelineSchema.safeParse(retired);
      expect(result.success).toBe(false);
      if (result.success) return;

      const message = result.error.issues.find((i) => i.path[0] === key)?.message ?? '';
      // Not zod's generic `never` message — the author is told what to write.
      expect(message).not.toContain('Invalid input: expected never, received ');
      // ONE string, BOTH channels (`retirementTombstone()`): the parse message
      // and the `.describe()` metadata that feeds generated JSON-Schema.
      expect(message).toBe((TimelineSchema.shape[key] as { description?: string }).description);
      if (replacement) {
        expect(message, `the \`${key}\` refusal does not name \`${replacement}\``).toMatch(new RegExp(`\\b${replacement}\\b`));
      } else {
        // `position` has no successor, and a message that pointed at one
        // would send the author to a key that does not do the job.
        expect(message).toContain('nothing replaces it');
      }
    });

    it(`ACCEPTS the same document migrated off \`${key}\` (counter-probe)`, () => {
      // Without it the refusal above is satisfied by any schema that refuses
      // everything, and the pin would prove nothing about the KEY.
      const result = TimelineSchema.safeParse(migrated);
      expect(result.success ? null : result.error.issues).toBe(null);
    });
  }

  it('refuses the key, not a bad value — the docs\' own `events: []` is refused too', () => {
    // `content/docs/api/schema-reference.md` authored `{ type: 'timeline',
    // events: [] }` before this change. An EMPTY array was always well typed;
    // a tombstone refuses every value, which is the retirement.
    const result = TimelineSchema.safeParse({ type: 'timeline', events: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('events');
  });

  it('leaves a document that never wrote the three untouched', () => {
    // `.optional()` on each tombstone: the retirement narrows exactly the three
    // keys and nothing else.
    expect(TimelineSchema.safeParse({ type: 'timeline' }).success).toBe(true);
    expect(TimelineSchema.safeParse({ type: 'timeline', variant: 'gantt', scale: 'quarter' }).success).toBe(true);
  });

  it('keeps all three DECLARED — tombstones, not deletions', () => {
    // The route guard. Under `.passthrough()` a key removed from the mirror
    // would parse green again and do nothing.
    const shape = Object.keys(TimelineSchema.shape);
    for (const { key } of RETIRED) {
      expect(shape, `${key} left the mirror — under .passthrough() the retired key becomes a SILENT no-op`).toContain(key);
    }
  });
});

describe('the same refusal through the doors an author actually meets (objectui#6170)', () => {
  // `TimelineSchema.safeParse` above is the declaration. `safeValidateSchema`
  // is the component union the tolerant face runs, and `StrictSchemaNodeSchema`
  // is the strict authoring face `objectui validate` and the doc-snippet gates
  // run (objectui#8345). Another arm of a union could re-admit the document,
  // so each door is measured rather than assumed.
  for (const { key, retired, migrated } of RETIRED) {
    it(`\`${key}\` is refused through the component union, on its own path`, () => {
      const result = safeValidateSchema(retired);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(allIssues(result.error.issues).map((i) => i.path.join('.'))).toContain(key);
      expect(safeValidateSchema(migrated).success, `the migrated \`${key}\` document is refused by the union`).toBe(true);
    });

    it(`\`${key}\` is refused through the strict face BY THE TOMBSTONE, not as an unknown key`, () => {
      const result = StrictSchemaNodeSchema.safeParse(retired);
      expect(result.success).toBe(false);
      if (result.success) return;
      const issues = allIssues(result.error.issues);
      const named = issues.find((i) => i.path[i.path.length - 1] === key && i.code === 'invalid_type');
      expect(named, `the strict face did not refuse \`${key}\` by its tombstone`).toBeTruthy();
      // The key is DECLARED, so it must never read as an unrecognised one.
      const unknown = issues.filter(
        (i) => i.code === 'unrecognized_keys' && (i as { keys?: string[] }).keys?.includes(key),
      );
      expect(unknown).toEqual([]);
      expect(StrictSchemaNodeSchema.safeParse(migrated).success, `the migrated \`${key}\` document is refused by the strict face`).toBe(true);
    });
  }
});

describe('events / orientation / position are RETIRED — the TS half of the tombstones (objectui#6170)', () => {
  it('refuses each retired member at compile time', () => {
    // On the pre-retirement tree every value below was a LEGAL assignment (each
    // is well typed under the old declaration), so every directive was unused
    // and `tsc` failed the build with TS2578 naming the key. This leg is judged
    // by `type-check` (`tsc -p tsconfig.test.json` compiles this file), not by
    // vitest, which strips types (objectui#3009).

    // @ts-expect-error — `events` is RETIRED (objectui#6170): declared `?: never`, so no value is authorable.
    const events: TimelineSchemaTS['events'] = [];
    // @ts-expect-error — `orientation` is RETIRED (objectui#6170): declared `?: never`.
    const orientation: TimelineSchemaTS['orientation'] = 'horizontal';
    // @ts-expect-error — `position` is RETIRED (objectui#6170): declared `?: never`.
    const position: TimelineSchemaTS['position'] = 'left';

    // Counter-probes on the same surface: the keys an author writes instead
    // still accept their vocabularies, so the directives above pin the three
    // KEYS' retirement and not a blanket narrowing of the node.
    const items: TimelineSchemaTS['items'] = [{ time: '2024-01-15', title: 'Kickoff' }];
    const variant: TimelineSchemaTS['variant'] = 'horizontal';

    expect([events, orientation, position, items, variant]).toHaveLength(5);
  });

  it('refuses them in the form authors actually write — by name, as `never` tombstones on a fresh literal', () => {
    // The member reads above could pass through a mapped or indexed type; this
    // leg writes a DOCUMENT, the shape an author (or an AI generating metadata)
    // produces. If `BaseSchema`'s `[key: string]: any` had won (it stood until
    // objectui#8347), the key would have widened back to `any` here and the
    // directive would have gone unused (TS2578).
    // The directive sits on the PROPERTY: excess-property checking reports the
    // error at the member, so a directive on the `const` would suppress nothing.
    const retiredDocument: TimelineSchemaTS = {
      type: 'timeline',
      // @ts-expect-error — `events` is RETIRED (objectui#6170); the document must name `items`.
      events: [{ title: 'Kickoff', date: '2024-01-15' }],
      // @ts-expect-error — `orientation` is RETIRED (objectui#6170); the document must name `variant`.
      orientation: 'horizontal',
      // @ts-expect-error — `position` is RETIRED (objectui#6170); nothing replaces it.
      position: 'left',
    };

    // The migrated document — same node, the keys the renderer reads — still type-checks.
    const migratedDocument: TimelineSchemaTS = {
      type: 'timeline',
      variant: 'horizontal',
      items: [{ time: '2024-01-15', title: 'Kickoff' }],
    };

    expect([retiredDocument, migratedDocument]).toHaveLength(2);
  });
});

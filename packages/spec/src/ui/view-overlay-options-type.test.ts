// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19920] The flattened list overlay's legacy `options` bag carries each kind's own block, with
 * every key optional, not a string-keyed record of `unknown`.
 *
 * `listViewKindBlocks()` returned `Record<string, z.ZodTypeAny>`, so the bag's static type was
 * `{ [x: string]: unknown }` on the list overlay member, and so on `ViewMetadata`,
 * `ViewMetadataParsed`, `AssembledViewArtifact` and `AssembledViewArtifactParsed`:
 * `options: { foo: 1, kanban: 42 }` type-checked while that member refuses both keys. Its return
 * type is now derived by the same rule the loop runs (a value of the list shape's `type` enum that
 * also names a block on the shape), with zod's own `.partial()` type per block.
 *
 * Two halves, judged by two programs (the `view-overlay-viewkind-type.test.ts` shape):
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile. While the bag was a record of `unknown` every one of them compiled, so each
 *   directive was unused: TS2578 in a file with no `test-typecheck-debt.json` entry.
 * - The RUNTIME half ties it to the doors: the runtime key set is the type's key set, each body
 *   the type refuses is refused by every door that judges it, and the partial underlay parses.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  VIEW_METADATA_MEMBERS,
  ViewMetadataSchema,
  type ViewMetadata,
  type ViewMetadataParsed,
} from './view.zod';
import {
  AssembledViewArtifactSchema,
  type AssembledViewArtifact,
  type AssembledViewArtifactParsed,
} from './assembled-views.zod';

type ListOverlayIn = z.input<typeof VIEW_METADATA_MEMBERS.listOverlay>;
type ListOverlayOut = z.output<typeof VIEW_METADATA_MEMBERS.listOverlay>;
type OptionsIn = NonNullable<ListOverlayIn['options']>;
type OptionsOut = NonNullable<ListOverlayOut['options']>;

/** The kinds that name a block on the list shape: its `type` enum minus `grid`. */
const KIND_BLOCKS = ['calendar', 'chart', 'gallery', 'gantt', 'kanban', 'map', 'timeline', 'tree'] as const;
type KindBlock = (typeof KIND_BLOCKS)[number];

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type NeverEntries<T> = { [K in keyof T]-?: [NonNullable<T[K]>] extends [never] ? K : never }[keyof T];

// ── The bag's key set is the kind set, and no entry collapsed to `never` ─────────────────────

const keySetIsTheKindSet: [Equal<keyof OptionsIn, KindBlock>, Equal<keyof OptionsOut, KindBlock>] = [true, true];
const noEntryIsNever: [[NeverEntries<OptionsIn>] extends [never] ? true : false] = [true];
void [keySetIsTheKindSet, noEntryIsNever];

// ── Each entry is the kind's own block with every key optional ───────────────────────────────

// `groupByField` is required on the kanban block itself; the underlay may leave it out.
const partialUnderlay: OptionsIn = { kanban: { summarizeField: 'amount' } };
// @ts-expect-error -- `options.foo` is no kind.
const unknownKind: OptionsIn = { foo: 1 };
// @ts-expect-error -- `grid` names no block.
const gridBlock: OptionsIn = { grid: {} };
// @ts-expect-error -- a kind's entry is an object, not a number.
const numericBlock: OptionsIn = { kanban: 42 };
// @ts-expect-error -- and each key has the block's own type.
const wrongKeyType: OptionsIn = { kanban: { groupByField: 42 } };
// @ts-expect-error -- and the block is strict: a key it does not declare is refused.
const undeclaredKey: OptionsIn = { kanban: { nope: 1 } };
void [partialUnderlay, unknownKind, gridBlock, numericBlock, wrongKeyType, undeclaredKey];

// ── The body the member refuses no longer type-checks as any union type ──────────────────────

const typedBag: ViewMetadata = { object: 'crm_lead', viewKind: 'list', options: { kanban: { summarizeField: 'amount' } } };
// @ts-expect-error -- a list overlay whose bag holds a number is no view body.
const numericBagMetadata: ViewMetadata = { object: 'crm_lead', viewKind: 'list', options: { kanban: 42 } };
// @ts-expect-error -- nor a parsed one.
const numericBagParsedMetadata: ViewMetadataParsed = { object: 'crm_lead', viewKind: 'list', options: { kanban: 42 } };
// @ts-expect-error -- nor a view artifact.
const numericBagArtifact: AssembledViewArtifact = { object: 'crm_lead', viewKind: 'list', options: { kanban: 42 } };
// @ts-expect-error -- nor a parsed one.
const numericBagParsedArtifact: AssembledViewArtifactParsed = { object: 'crm_lead', viewKind: 'list', options: { kanban: 42 } };
void [typedBag, numericBagMetadata, numericBagParsedMetadata, numericBagArtifact, numericBagParsedArtifact];

describe('the list overlay options bag carries each kind block', () => {
  it('the runtime key set is the kind set the type names', () => {
    const bag = VIEW_METADATA_MEMBERS.listOverlay.shape.options.unwrap();
    expect(Object.keys(bag.shape).sort()).toEqual([...KIND_BLOCKS]);
  });

  it('a bag the type refuses is refused by every door that judges it', () => {
    for (const options of [{ kanban: 42 }, { foo: 1 }, { kanban: { groupByField: 42 } }, { kanban: { nope: 1 } }]) {
      const body = { object: 'crm_lead', viewKind: 'list', options };
      for (const door of [VIEW_METADATA_MEMBERS.listOverlay, ViewMetadataSchema, AssembledViewArtifactSchema]) {
        expect(door.safeParse(body).success, JSON.stringify(options)).toBe(false);
      }
    }
  });

  it('the partial underlay the type admits parses at every door', () => {
    const body = { object: 'crm_lead', viewKind: 'list', options: { kanban: { summarizeField: 'amount' } } };
    for (const door of [VIEW_METADATA_MEMBERS.listOverlay, ViewMetadataSchema, AssembledViewArtifactSchema]) {
      expect(door.safeParse(body).success).toBe(true);
    }
  });
});

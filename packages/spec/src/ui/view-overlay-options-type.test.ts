// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25923] The flattened list overlay carries no `options` bag: its member is the retired-key
 * tombstone (`retiredKey`), so no view type admits a bag on a list overlay, whatever it holds.
 *
 * Until #25923 the bag carried each kind's own block with every key optional (#19920). The door
 * now refuses the bag by name and a stored bag is folded onto the top-level blocks by the
 * `list-view-options-bag-folded` conversion (`view-overlay-options-bag.test.ts`).
 *
 * Two halves, judged by two programs (the `view-overlay-viewkind-type.test.ts` shape):
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile: while the bag was declared, the first five compiled.
 * - The RUNTIME half ties it to the doors: each body the type refuses is refused by every door
 *   that judges it, and the same block written top-level parses.
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
import type { retiredKey } from '../shared/retired-key';

type RetiredKeySchema = ReturnType<typeof retiredKey>;

type ListOverlayIn = z.input<typeof VIEW_METADATA_MEMBERS.listOverlay>;
type ListOverlayOut = z.output<typeof VIEW_METADATA_MEMBERS.listOverlay>;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// ── The member is the retired-key tombstone on both sides ────────────────────────────────────

const optionsIsTombstone: [
  Equal<ListOverlayIn['options'], z.input<RetiredKeySchema>>,
  Equal<ListOverlayOut['options'], z.output<RetiredKeySchema>>,
] = [true, true];
void optionsIsTombstone;

// ── A bag no longer type-checks as any union type, even the once-legal partial underlay ──────

const topLevelBlock: ViewMetadata = { object: 'crm_lead', viewKind: 'list', kanban: { groupByField: 'status', columns: ['name'] } };
// @ts-expect-error -- a list overlay carries no bag.
const bagMetadata: ViewMetadata = { object: 'crm_lead', viewKind: 'list', options: { kanban: { summarizeField: 'amount' } } };
// @ts-expect-error -- nor a parsed one.
const bagParsedMetadata: ViewMetadataParsed = { object: 'crm_lead', viewKind: 'list', options: { kanban: { summarizeField: 'amount' } } };
// @ts-expect-error -- nor a view artifact.
const bagArtifact: AssembledViewArtifact = { object: 'crm_lead', viewKind: 'list', options: { kanban: { summarizeField: 'amount' } } };
// @ts-expect-error -- nor a parsed one.
const bagParsedArtifact: AssembledViewArtifactParsed = { object: 'crm_lead', viewKind: 'list', options: { kanban: { summarizeField: 'amount' } } };
// @ts-expect-error -- nor an empty bag.
const emptyBag: ViewMetadata = { object: 'crm_lead', viewKind: 'list', options: {} };
void [topLevelBlock, bagMetadata, bagParsedMetadata, bagArtifact, bagParsedArtifact, emptyBag];

describe('the list overlay carries no options bag', () => {
  it('a bag the type refuses is refused by every door that judges it', () => {
    for (const options of [{ kanban: { summarizeField: 'amount' } }, {}, { kanban: 42 }, { foo: 1 }]) {
      const body = { object: 'crm_lead', viewKind: 'list', options };
      for (const door of [VIEW_METADATA_MEMBERS.listOverlay, ViewMetadataSchema, AssembledViewArtifactSchema]) {
        expect(door.safeParse(body).success, JSON.stringify(options)).toBe(false);
      }
    }
  });

  it('CONTROL: the same block written top-level parses at every door', () => {
    const body = { object: 'crm_lead', viewKind: 'list', kanban: { groupByField: 'status', columns: ['name'] } };
    for (const door of [VIEW_METADATA_MEMBERS.listOverlay, ViewMetadataSchema, AssembledViewArtifactSchema]) {
      expect(door.safeParse(body).success).toBe(true);
    }
  });
});

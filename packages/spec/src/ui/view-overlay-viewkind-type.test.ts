// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19920] Each flattened overlay member's static `viewKind` is its own arm's literal: `'list'` on
 * the list overlay, `'form'` on the form overlay. The list overlay's `type` and `columns` carry the
 * list shape's own types, not `unknown`. And the list overlay's `type` default, which the parse
 * applies and the output type does not carry, is what the `ViewMetadataParsed` /
 * `AssembledViewArtifactParsed` TSDoc says it is.
 *
 * `flattenedViewOverlayFields(kind)` took `kind: 'list' | 'form'`, so `z.enum([kind])` widened to
 * that union on BOTH members: a list-shaped body naming `viewKind: 'form'` type-checked, through
 * the list member, as `ViewMetadata`, `ViewMetadataParsed`, `AssembledViewArtifact` and
 * `AssembledViewArtifactParsed`, while both doors refuse it (the list member: the arm mismatch; the
 * form member: `type` and `columns`). The function is now generic, so each member keeps its literal.
 *
 * `listOverlayPatchFields()` read the list overlay's `type` and `columns` off the list shape
 * through a cast to a record of `z.ZodTypeAny`, which typed both `unknown` on that member:
 * `{ object, viewKind: 'list', columns: 42 }` type-checked as the same four union types while the
 * list member refuses it. It now reads the shape as typed.
 *
 * Two halves, judged by two programs (the `view-metadata-type.test.ts` shape):
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile. While `viewKind` was `'list' | 'form'` on both members every one of them
 *   compiled, so each directive was unused: TS2578 in a file with no `test-typecheck-debt.json`
 *   entry, which reds the gate.
 * - The RUNTIME half ties it to the doors: the refused body is refused by every door that
 *   judges it, and a column-less list patch comes back from the parse with `type: 'grid'`.
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
type FormOverlayIn = z.input<typeof VIEW_METADATA_MEMBERS.formOverlay>;
type FormOverlayOut = z.output<typeof VIEW_METADATA_MEMBERS.formOverlay>;

// ── Each member's `viewKind` is its own arm's literal ────────────────────────────────────────

const listKindIn: ListOverlayIn['viewKind'] = 'list';
const listKindOut: ListOverlayOut['viewKind'] = 'list';
const formKindIn: FormOverlayIn['viewKind'] = 'form';
const formKindOut: FormOverlayOut['viewKind'] = 'form';
// @ts-expect-error -- the list overlay member judges `viewKind: 'list'` only.
const listKindInForm: ListOverlayIn['viewKind'] = 'form';
// @ts-expect-error -- on its output too.
const listKindOutForm: ListOverlayOut['viewKind'] = 'form';
// @ts-expect-error -- the form overlay member judges `viewKind: 'form'` only.
const formKindInList: FormOverlayIn['viewKind'] = 'list';
// @ts-expect-error -- on its output too.
const formKindOutList: FormOverlayOut['viewKind'] = 'list';

// ── The body both doors refuse no longer type-checks as any union type ───────────────────────

// @ts-expect-error -- a list-shaped body naming `viewKind: 'form'` is no view artifact.
const artifact: AssembledViewArtifact = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'form' };
// @ts-expect-error -- nor a parsed one.
const parsedArtifact: AssembledViewArtifactParsed = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'form' };
// @ts-expect-error -- nor a view body.
const metadata: ViewMetadata = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'form' };
// @ts-expect-error -- nor a parsed one.
const parsedMetadata: ViewMetadataParsed = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'form' };
void [listKindIn, listKindOut, formKindIn, formKindOut, listKindInForm, listKindOutForm, formKindInList, formKindOutList];
void [artifact, parsedArtifact, metadata, parsedMetadata];

// ── The list overlay's `type` and `columns` carry the list shape's types ─────────────────────

type IsUnknown<T> = unknown extends T ? true : false;
const typeAndColumnsAreTypedThere: [
  IsUnknown<ListOverlayIn['type']>, IsUnknown<ListOverlayIn['columns']>,
  IsUnknown<ListOverlayOut['type']>, IsUnknown<ListOverlayOut['columns']>,
] = [false, false, false, false];
const listOverlayPatchWithType: ListOverlayIn = { object: 'crm_lead', viewKind: 'list', type: 'kanban', columns: ['name'] };
// @ts-expect-error -- the list overlay's `columns` is a field list, not a number.
const listOverlayColumnsNumber: ListOverlayIn['columns'] = 42;
// @ts-expect-error -- its `type` is the list shape's enum.
const listOverlayTypeUnknown: ListOverlayIn['type'] = 'spreadsheet';
// @ts-expect-error -- a list overlay whose `columns` is a number is no view artifact.
const numericColumnsArtifact: AssembledViewArtifact = { object: 'crm_lead', viewKind: 'list', columns: 42 };
// @ts-expect-error -- nor a parsed one.
const numericColumnsParsedArtifact: AssembledViewArtifactParsed = { object: 'crm_lead', viewKind: 'list', columns: 42 };
// @ts-expect-error -- nor a view body.
const numericColumnsMetadata: ViewMetadata = { object: 'crm_lead', viewKind: 'list', columns: 42 };
// @ts-expect-error -- nor a parsed one.
const numericColumnsParsedMetadata: ViewMetadataParsed = { object: 'crm_lead', viewKind: 'list', columns: 42 };
void [typeAndColumnsAreTypedThere, listOverlayPatchWithType, listOverlayColumnsNumber, listOverlayTypeUnknown];
void [numericColumnsArtifact, numericColumnsParsedArtifact, numericColumnsMetadata, numericColumnsParsedMetadata];

// ── The list overlay's `type` default: applied by the parse, absent from the output type ─────
//
// The TSDoc on `ViewMetadataParsed` / `AssembledViewArtifactParsed` says this in words, and this
// line compiles only while it holds. The day a change carries the `.overwrite()` default into the
// output type, the line stops compiling and the TSDoc sentences are then false: correct them with
// it.
type IsOptionalKey<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;
const typeIsOptionalOnListOverlayOutput: IsOptionalKey<ListOverlayOut, 'type'> = true;
void [typeIsOptionalOnListOverlayOutput];

describe('the flattened overlay members keep their own viewKind literal', () => {
  it('the list-shaped `viewKind: "form"` body is refused by every door that judges it', () => {
    const body = { type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'form' };
    expect(VIEW_METADATA_MEMBERS.listOverlay.safeParse(body).success).toBe(false);
    expect(VIEW_METADATA_MEMBERS.formOverlay.safeParse(body).success).toBe(false);
    expect(ViewMetadataSchema.safeParse(body).success).toBe(false);
    expect(AssembledViewArtifactSchema.safeParse(body).success).toBe(false);
  });

  it('a list overlay whose `columns` is a number is refused by every door that judges it', () => {
    const body = { object: 'crm_lead', viewKind: 'list', columns: 42 };
    expect(VIEW_METADATA_MEMBERS.listOverlay.safeParse(body).success).toBe(false);
    expect(ViewMetadataSchema.safeParse(body).success).toBe(false);
    expect(AssembledViewArtifactSchema.safeParse(body).success).toBe(false);
  });

  it("a column-less list patch parses with `type: 'grid'`, which its output type leaves optional", () => {
    const patch = { object: 'crm_lead', viewKind: 'list', sort: [{ field: 'name', order: 'asc' }] };
    for (const door of [VIEW_METADATA_MEMBERS.listOverlay, ViewMetadataSchema, AssembledViewArtifactSchema]) {
      const result = door.safeParse(patch);
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ type: 'grid', viewKind: 'list' });
    }
  });
});

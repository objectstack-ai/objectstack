/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `DataTableSchema.toolbar` is REFUSED, not silently ignored
 * (objectui#6881, maintainer ruling 2026-08-31: retire, do NOT wire).
 *
 * ## The failure this pin exists to prevent
 *
 * `toolbar` was declared on both published faces — `data-display.ts` and the
 * Zod mirror — documented, mirrored, and read by NOTHING: `data-table.tsx`
 * never mounts it (the word appears there only in two prose comments), while
 * the sibling `emptyAction` slot on the SAME interface is mounted through
 * `SchemaRenderer`, so the census zero is a reading, not a blind query. An
 * author who wrote a toolbar got a green document and a blank result, with no
 * signal anywhere that said so — the declared-vs-enforced failure mode, worst
 * for AI-authored metadata, which has nothing but the declaration to go on.
 *
 * So the deliverable is not "toolbar renders". It is: **an authored `toolbar`
 * is refused loudly at the authoring boundary**, with the remediation in the
 * refusal (the built-in chrome: `searchable` / `exportable`). The ruling
 * records that a real toolbar slot must arrive as a redesigned proposal WITH
 * its enforcing reader — not by reviving this key.
 *
 * ## Why the tombstone, and not simply deleting the key
 *
 * `BaseSchema` is `.passthrough()` on the Zod side and carried a
 * `[key: string]: any` index signature on the TS side until objectui#8347. An
 * UNDECLARED key is accepted by the Zod half, unvalidated (and was by the TS
 * half; since objectui#8347 only through a widened value) — deleting `toolbar` outright would
 * hand the authored spelling exactly the silent no-op this card exists to
 * close. `?: never` / `retirementTombstone()` is this package's convention —
 * {@link StaticTableColumn} (objectui#5474), `crud.ts` `confirm`
 * (objectui#4314), `TimelineSchema.timeScale` (objectui#6355) — and it is
 * lockstep: both halves or neither.
 *
 * ## The rider the retirement settles by construction
 *
 * Before this card the two faces disagreed on the SHAPE: TS said
 * `SchemaNode[]`, the mirror admitted `SchemaNode | SchemaNode[]` — a
 * mirror-wider-than-declared drift no parity ledger watches. Retiring both
 * faces in the same stroke makes them agree by refusing BOTH spellings, so
 * this file pins the single-node spelling refused too — the half only the
 * mirror ever accepted.
 */

import { describe, it, expect } from 'vitest';
import { DataTableSchema } from '../zod/data-display.zod.js';
import type { DataTableSchema as DataTableSchemaTS, TableColumn } from '../data-display.js';

const GUIDANCE =
  'RETIRED (objectui#6881) — never mounted by the data-table renderer; use the built-in toolbar chrome (searchable / exportable), or compose nodes beside the table';

/** A minimal document that is valid TODAY and stays valid — the inside of the boundary. */
const VALID_TABLE = {
  type: 'data-table',
  columns: [{ header: 'Name', accessorKey: 'name' }],
  data: [],
} as const;

describe('DataTableSchema.toolbar is RETIRED — the Zod half of the tombstone (objectui#6881)', () => {
  it('REFUSES the array spelling, naming the retired key', () => {
    // The pin. Before the retirement this document parsed GREEN (`toolbar` was
    // `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional()`),
    // measured ACCEPTED on the retiring PR's base. Asserting the ENVELOPE —
    // not merely `success:false` — so the pin cannot be satisfied by an
    // unrelated rejection.
    const result = DataTableSchema.safeParse({
      ...VALID_TABLE,
      toolbar: [{ type: 'button', label: 'Refresh' }],
    });
    expect(result.success, 'an authored toolbar was ACCEPTED — it will render as a blank result with no signal').toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'toolbar');
    expect(issue, 'parse failed, but not on the `toolbar` path').toBeTruthy();
    expect(issue?.code).toBe('invalid_type');
    expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
  });

  it('REFUSES the single-node spelling — the half only the mirror ever accepted', () => {
    // Pre-retirement, TS refused this spelling while the mirror admitted it
    // (the drift recorded on objectui#6881 as the secondary observation). The
    // two faces now agree by refusing both.
    const result = DataTableSchema.safeParse({
      ...VALID_TABLE,
      toolbar: { type: 'button', label: 'Refresh' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === 'toolbar');
    expect(issue?.code).toBe('invalid_type');
  });

  it('the refusal CARRIES the remediation text, not zod\'s generic message', () => {
    // `retirementTombstone()` writes the guidance once into the parse message
    // and `.describe()` both (objectui#6931) — the author is told what to
    // write instead: the built-in chrome.
    const result = DataTableSchema.safeParse({
      ...VALID_TABLE,
      toolbar: [{ type: 'button', label: 'Refresh' }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'toolbar');
    expect(issue?.message).not.toContain('Invalid input: expected never, received ');
    expect(issue?.message).toBe(GUIDANCE);
    // ONE string, BOTH channels — asserted derived, so parse message and
    // generated-docs metadata cannot drift apart.
    expect(issue?.message).toBe(
      (DataTableSchema.shape.toolbar as { description?: string }).description,
    );
  });

  it('leaves a document that never wrote the key untouched — the inside of the boundary', () => {
    // `absent` stays valid — `.optional()` on the tombstone. The retirement
    // narrows exactly one key and nothing else.
    expect(DataTableSchema.safeParse(VALID_TABLE).success).toBe(true);
  });

  it('still ACCEPTS the sibling `emptyAction` SchemaNode slot — the counter-probe', () => {
    // `emptyAction` is the slot the census used as its positive control: same
    // interface, same SchemaNode shape, actually mounted (data-table.tsx, via
    // SchemaRenderer). Without this leg the refusals above would be satisfied
    // by a schema that refuses every SchemaNode slot — a narrowing that
    // refuses too much would pass a refusal-only test.
    const result = DataTableSchema.safeParse({
      ...VALID_TABLE,
      emptyAction: { type: 'button', label: 'New' },
    });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('keeps `toolbar` DECLARED — a tombstone, not a deletion', () => {
    // The route guard. `BaseSchema` is `.passthrough()`, so removing the key
    // from the mirror would make the authored spelling parse green again and
    // do nothing — the silent no-op reintroduced by the very edit meant to
    // remove it.
    expect(
      Object.keys(DataTableSchema.shape),
      'toolbar left the mirror — under .passthrough() the retired key becomes a SILENT no-op again',
    ).toContain('toolbar');
  });
});

describe('DataTableSchema.toolbar is RETIRED — the TS half of the tombstone (objectui#6881)', () => {
  it('refuses the retired key at compile time', () => {
    // On the pre-fix tree `toolbar` is `SchemaNode[] | undefined`, so the
    // assignment is LEGAL, the directive below is unused, and `tsc` fails the
    // build with TS2578 naming the key — this leg is red before the fix in
    // `type-check`, not in vitest, which strips types.

    // @ts-expect-error — `toolbar` is RETIRED (objectui#6881): declared `?: never`, so no value is authorable.
    const retired: DataTableSchemaTS['toolbar'] = [{ type: 'button' }];

    // Counter-probe on the same surface: the sibling SchemaNode slot still
    // accepts a node, so the directive above pins the KEY's retirement and not
    // a blanket narrowing of the interface.
    const sibling: DataTableSchemaTS['emptyAction'] = { type: 'button' };

    expect([retired, sibling]).toHaveLength(2);
  });

  it('refuses the retired key in the form authors actually write', () => {
    // The leg that proved the tombstone survives `BaseSchema`'s
    // `[key: string]: any` while it stood (objectui#8347 removed it): if the
    // index signature had won, `toolbar` would have widened back to `any`
    // here and the directive would have gone unused (TS2578).
    const columns: TableColumn[] = [{ header: 'Name', accessorKey: 'name' }];

    const retiredDocument: DataTableSchemaTS = {
      type: 'data-table',
      columns,
      data: [],
      // @ts-expect-error — `toolbar` is RETIRED (objectui#6881); use the built-in chrome (`searchable` / `exportable`).
      toolbar: [{ type: 'button', label: 'Refresh' }],
    };

    // The migrated document — built-in chrome instead — still type-checks.
    const migratedDocument: DataTableSchemaTS = {
      type: 'data-table',
      columns,
      data: [],
      searchable: true,
      exportable: true,
    };

    expect([retiredDocument, migratedDocument]).toHaveLength(2);
  });
});

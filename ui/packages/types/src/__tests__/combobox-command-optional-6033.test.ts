/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6033, ruling C7 / C8 — `ComboboxSchema.options` and
 * `CommandSchema.groups` are OPTIONAL on the zod mirror, as they already were
 * on the TypeScript declaration.
 *
 * The mirror used to REQUIRE both keys, so `{ "type": "combobox" }` and
 * `{ "type": "command" }` type-checked against `@object-ui/types`, rendered,
 * and were then refused by `safeValidateSchema` at parse time. The ruling's
 * ground — "the renderer tolerates absence" — was re-measured before the
 * mirror moved: the registered `combobox` renderer reads
 * `schema.options || []` and the registered `command` renderer reads
 * `schema.groups?.map(...)`, and both drew a node with the key absent without
 * throwing (through `SchemaRenderer` and through the registered component
 * called directly), while a wrong-typed value made both instruments fail. The
 * spec declares no props schema for either node, so there is no third end to
 * disagree with.
 *
 * The two `KnownDrift` rows in `zod-mirror-parity.test.ts` left in the same
 * change; the last block below reads that ledger so a row that comes back is
 * red here by name, not only there by count.
 *
 * The type-level half reddens under `tsc -p tsconfig.test.json` (this
 * package's `type-check`), not under vitest; the runtime half reddens here.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import { ComboboxSchema, CommandSchema } from '../zod/form.zod';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod';
import type { ComboboxSchema as TsComboboxSchema, CommandSchema as TsCommandSchema } from '../form';

type ComboboxInput = z.input< typeof ComboboxSchema >;
type CommandInput = z.input< typeof CommandSchema >;

/** The issues a refused parse reports, reduced to what a caller branches on. */
const issuesOf = (result: { success: boolean; error?: { issues: ReadonlyArray< { code: string; path: PropertyKey[] } > } }) =>
  (result.error?.issues ?? []).map((issue) => ({ code: issue.code, path: issue.path.map(String).join('.') }));

describe('ComboboxSchema.options / CommandSchema.groups are optional on both faces (objectui#6033)', () => {
  it('type level: the mirror input and the declaration both admit an absent key', () => {
    expectTypeOf< Extract< ComboboxInput['options'], undefined > >().toEqualTypeOf< undefined >();
    expectTypeOf< Extract< CommandInput['groups'], undefined > >().toEqualTypeOf< undefined >();
    expectTypeOf< Extract< TsComboboxSchema['options'], undefined > >().toEqualTypeOf< undefined >();
    expectTypeOf< Extract< TsCommandSchema['groups'], undefined > >().toEqualTypeOf< undefined >();

    // What a TypeScript author can already write is what the mirror now accepts.
    const combobox: TsComboboxSchema = { type: 'combobox' };
    const command: TsCommandSchema = { type: 'command' };
    expect(ComboboxSchema.safeParse(combobox).success).toBe(true);
    expect(CommandSchema.safeParse(command).success).toBe(true);
  });

  it('the mirror accepts a combobox without `options` and a command without `groups`', () => {
    const combobox = ComboboxSchema.safeParse({ type: 'combobox', placeholder: 'Pick one' });
    expect(issuesOf(combobox)).toEqual([]);
    expect(combobox.success).toBe(true);
    // Absent stays absent: the mirror does not invent a default the renderer supplies.
    expect(combobox.data && 'options' in combobox.data).toBe(false);

    const command = CommandSchema.safeParse({ type: 'command', emptyText: 'Nothing' });
    expect(issuesOf(command)).toEqual([]);
    expect(command.success).toBe(true);
    expect(command.data && 'groups' in command.data).toBe(false);
  });

  it('the published validators accept both nodes without the key — root and strict face', () => {
    for (const node of [{ type: 'combobox' }, { type: 'command' }]) {
      expect(issuesOf(safeValidateSchema(node)), node.type).toEqual([]);
      expect(issuesOf(StrictAnyComponentSchema.safeParse(node)), node.type).toEqual([]);
    }
  });

  it('control: both nodes still parse with the key present, empty or populated', () => {
    const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', disabled: true }];
    const groups = [{ heading: 'Files', items: [{ value: 'open', label: 'Open', icon: 'folder-open' }] }];
    for (const value of [[], options]) {
      expect(ComboboxSchema.safeParse({ type: 'combobox', options: value }).success).toBe(true);
    }
    for (const value of [[], groups]) {
      expect(CommandSchema.safeParse({ type: 'command', groups: value }).success).toBe(true);
    }
    expect(ComboboxSchema.parse({ type: 'combobox', options }).options).toEqual(options);
    expect(CommandSchema.parse({ type: 'command', groups }).groups).toEqual(groups);
  });

  it('control: a wrong-typed value is still refused, on the key, as `invalid_type`', () => {
    expect(issuesOf(ComboboxSchema.safeParse({ type: 'combobox', options: 'x' })))
      .toEqual([{ code: 'invalid_type', path: 'options' }]);
    expect(issuesOf(CommandSchema.safeParse({ type: 'command', groups: 'x' })))
      .toEqual([{ code: 'invalid_type', path: 'groups' }]);
    // …and through the published root validator, which selects the same arm.
    expect(issuesOf(safeValidateSchema({ type: 'combobox', options: 'x' })))
      .toEqual([{ code: 'invalid_type', path: 'options' }]);
    expect(issuesOf(safeValidateSchema({ type: 'command', groups: 'x' })))
      .toEqual([{ code: 'invalid_type', path: 'groups' }]);
  });

  it('control: `.optional()` did not loosen the elements — a malformed element is still refused', () => {
    expect(issuesOf(ComboboxSchema.safeParse({ type: 'combobox', options: [{ label: 'Alpha' }] })))
      .toEqual([{ code: 'invalid_type', path: 'options.0.value' }]);
    expect(issuesOf(CommandSchema.safeParse({ type: 'command', groups: [{ heading: 'Files' }] })))
      .toEqual([{ code: 'invalid_type', path: 'groups.0.items' }]);
  });

  it('ledger: the two `KnownDrift` rows are gone, and only those rows', () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const parity = readFileSync(join(HERE, 'zod-mirror-parity.test.ts'), 'utf8');

    const start = parity.indexOf('interface KnownDrift {');
    expect(start, 'the reader cannot see the KnownDrift ledger').toBeGreaterThan(-1);
    const end = parity.indexOf('\n}\n', start);
    expect(end, 'the reader cannot find the end of the KnownDrift ledger').toBeGreaterThan(start);
    const ledger = parity.slice(start, end);

    // Control: the reader sees a populated ledger, including a neighbouring
    // `form.zod.ts` row, not an empty or mis-cut slice.
    expect(ledger).toContain("'form.zod.ts#CodeEditorSchema': 'onChange';");
    // The rows themselves: absent from the KnownDrift block.
    expect(ledger).not.toMatch(/^\s*'form\.zod\.ts#ComboboxSchema':/m);
    expect(ledger).not.toMatch(/^\s*'form\.zod\.ts#CommandSchema':/m);
    // Control: both pairs are still registered, so the drift census still covers
    // them and a future re-narrowing reddens the parity file by name.
    expect(parity).toContain("'form.zod.ts#ComboboxSchema': ComboboxSchema,");
    expect(parity).toContain("'form.zod.ts#CommandSchema': CommandSchema,");
  });
});

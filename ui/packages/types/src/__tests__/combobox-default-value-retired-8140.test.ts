/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ComboboxSchema.defaultValue` is an ADR-0049 RETIREMENT TOMBSTONE on both
 * faces, the refusal is LOUD and BY NAME, and the remedy it carries is `value`
 * (objectui#8140).
 *
 * ## What was measured, and why the sibling `select` is not a precedent
 *
 * The card that named this key listed `select.tsx`'s `defaultValue` read as the
 * sibling the combobox renderer should match. It is not, and the difference is
 * mechanical rather than stylistic:
 *
 *  - `combobox` is a STANDALONE node type only. It is absent from
 *    `renderFieldComponent`'s `BUILTIN_FIELD_TYPES`, and no `field:combobox`
 *    widget is registered in the tree, so a form field authored
 *    `type: 'combobox'` / `field:combobox` / `ui:combobox` renders a plain text
 *    `<input>` from that switch's `default:` arm. All three spellings measured.
 *  - On the node path the selection is FROZEN: the renderer passes no
 *    `onValueChange` and `toFormControlDomProps` forwards neither `onChange`
 *    nor `onValueChange`, so no host can make one arrive. `select`'s renderer
 *    DOES pass a change handler, which is what makes an initial-then-edited
 *    value a distinct concept there.
 *
 * On a control whose selection cannot change, honouring the key would have made
 * it a second spelling of `value` — the consumer-side alias AGENTS.md #0.1
 * forbids. The behavioural half of the measurement lives with the renderer, in
 * `@object-ui/components`' `combobox-schema-members-8140.test.tsx`; this file
 * pins the CONTRACT.
 *
 * ## Why a tombstone and not a deletion
 *
 * `ComboboxSchema`'s mirror extends the passthrough `BaseSchema`, so a DELETED
 * member is not refused — it rides through unvalidated and is ignored, which is
 * the same silent no-op the retirement exists to end. The controls below prove
 * that directly rather than asserting it: an undeclared key on the very same
 * fixture parses GREEN, while `defaultValue` is refused by name.
 */

import { describe, it, expect } from 'vitest';
import type { ComboboxSchema as TsComboboxSchema } from '../form';
import { ComboboxSchema } from '../zod/form.zod';

/** The fixture every case below varies — valid on its own, so a red is the key. */
const BASE = {
  type: 'combobox' as const,
  options: [
    { value: 'cn', label: 'China' },
    { value: 'us', label: 'United States' },
  ],
};

const shapeOf = (schema: unknown): Record<string, unknown> =>
  (schema as { shape: Record<string, unknown> }).shape;

describe('the TypeScript face refuses `defaultValue` (objectui#8140)', () => {
  it('makes authoring it a `tsc` error at a real node shape', () => {
    const node: TsComboboxSchema = {
      ...BASE,
      // @ts-expect-error `defaultValue` is a retirement tombstone (objectui#8140) — write `value`
      defaultValue: 'us',
    };
    // The directive above is the assertion; this keeps the binding used and
    // proves the object still constructs with everything else on it.
    expect(node.type).toBe('combobox');
  });

  it('CONTROL — `value` and `description` are still writable', () => {
    const node: TsComboboxSchema = { ...BASE, value: 'us', description: 'Where you live', name: 'country' };
    expect([node.value, node.description, node.name]).toEqual(['us', 'Where you live', 'country']);
  });
});

describe('the Zod twin refuses `defaultValue` BY NAME (objectui#8140)', () => {
  it('rejects an authored value', () => {
    const result = ComboboxSchema.safeParse({ ...BASE, defaultValue: 'us' });
    expect(result.success).toBe(false);
  });

  it('names the key in the issue path, so the refusal is addressed', () => {
    const result = ComboboxSchema.safeParse({ ...BASE, defaultValue: 'us' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('defaultValue');
  });

  it('carries the remedy in the message an author actually reads', () => {
    const result = ComboboxSchema.safeParse({ ...BASE, defaultValue: 'us' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.find((i) => i.path.join('.') === 'defaultValue')?.message ?? '';
    // Not a substring of the generic zod text — the remedy and the reason.
    expect(message).toMatch(/Write `value` instead/);
    expect(message).toMatch(/RETIRED \(objectui#8140, ADR-0049\)/);
  });

  it('publishes the same one string as schema metadata, so docs cannot drift', () => {
    const described = (shapeOf(ComboboxSchema).defaultValue as { description?: string }).description ?? '';
    const result = ComboboxSchema.safeParse({ ...BASE, defaultValue: 'us' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.find((i) => i.path.join('.') === 'defaultValue')?.message ?? '';
    expect(described).toBe(message);
  });

  it('CONTROL — the fixture itself parses green, so the red above is the key', () => {
    expect(ComboboxSchema.safeParse(BASE).success).toBe(true);
    expect(ComboboxSchema.safeParse({ ...BASE, value: 'us' }).success).toBe(true);
    expect(ComboboxSchema.safeParse({ ...BASE, description: 'Where you live' }).success).toBe(true);
    expect(ComboboxSchema.safeParse({ ...BASE, name: 'country' }).success).toBe(true);
  });

  it('CONTROL — an UNDECLARED key on the same fixture parses green, which is why deleting the member would not refuse anything', () => {
    expect(ComboboxSchema.safeParse({ ...BASE, notAKeyAnyoneDeclared: 'us' }).success).toBe(true);
  });
});

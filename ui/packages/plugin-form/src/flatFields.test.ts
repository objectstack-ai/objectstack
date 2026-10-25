/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The FLAT (no-sections) field builder — objectui#4755.
 *
 * `ModalForm` and `DrawerForm` used to carry one hand-copied copy of this
 * mapping each, and they drifted: the drawer's copy stopped at `multiple`,
 * dropping `visibleWhen` / `readonlyWhen` / `requiredWhen` / `group`. These
 * tests pin the two facts that keep them from drifting again:
 *
 *   1. the flat builder carries every ADR-0036 field-level rule, and
 *   2. it agrees KEY BY KEY with the sectioned producer
 *      (`normalizeSectionField`) over the same object field — which is what a
 *      shared mapping buys, and what a re-forked copy would break first.
 *
 * The container-level behavioural half (a rule actually firing inside a
 * no-sections drawer) lives in `flatFieldRules.test.tsx`.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildFlatFields } from './flatFields';
import { normalizeSectionField } from './sectionFields';

const fieldLabel = (_o: string, _f: string, fallback: string) => fallback;

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    status: { type: 'select', label: 'Status', options: [{ label: 'Draft', value: 'draft' }] },
    sent_at: {
      type: 'datetime',
      label: 'Sent at',
      group: 'delivery',
      visibleWhen: "record.status == 'sent'",
      readonlyWhen: "record.status == 'paid'",
      requiredWhen: "record.status == 'sent'",
    },
    note: { type: 'textarea', label: 'Note' },
  },
} as any;

const ctx = {
  objectSchema: OBJECT_SCHEMA,
  objectName: 'invoice',
  mode: 'create' as const,
  fieldLabel,
};

describe('buildFlatFields — ADR-0036 rules reach the runtime FormField (#4755)', () => {
  it('carries visibleWhen / readonlyWhen / requiredWhen off the object field', () => {
    const built = buildFlatFields(ctx);
    const sentAt = built.find((f) => f.name === 'sent_at')!;

    expect(sentAt.visibleWhen).toBe("record.status == 'sent'");
    expect(sentAt.readonlyWhen).toBe("record.status == 'paid'");
    expect(sentAt.requiredWhen).toBe("record.status == 'sent'");
  });

  it('carries `group` (the fieldGroups fallback has nothing to group on without it)', () => {
    const built = buildFlatFields(ctx);
    expect((built.find((f) => f.name === 'sent_at') as any).group).toBe('delivery');
  });

  it('honours an explicit `fields` whitelist, in the order given', () => {
    const built = buildFlatFields({ ...ctx, fields: ['note', 'status'] });
    expect(built.map((f) => f.name)).toEqual(['note', 'status']);
  });

  it('defaults to every declared field, in object-schema order', () => {
    expect(buildFlatFields(ctx).map((f) => f.name)).toEqual(['status', 'sent_at', 'note']);
  });

  it('skips a whitelisted field the object schema does not declare', () => {
    const built = buildFlatFields({ ...ctx, fields: ['status', 'not_a_field'] });
    expect(built.map((f) => f.name)).toEqual(['status']);
  });
});

/**
 * objectui#8738 route 1 — same shared read-site defect as `ObjectForm.tsx`'s
 * `SimpleObjectForm` (pinned in `__tests__/objectFormFieldsMembers-8071.test.tsx`),
 * measured directly here since `buildFlatFields` is the drawer/modal path with
 * the identical shape: a member resolving to no name used to be dropped in
 * total silence. `warnUnresolvedTopLevelField` (`sectionFields.ts`) now names
 * the skipped shape and the vocabulary difference — same voice/dedupe
 * discipline as `warnOnMixedVocabulary`. Both legs pinned: fires for the
 * unresolvable case, and (the firing control) does NOT fire for a legal bare
 * name — without the second leg the first would still pass on a warning that
 * fires unconditionally.
 */
describe('buildFlatFields WARNS on an unresolvable top-level member (route 1, objectui#8738)', () => {
  it('fires once for a member that resolves to no name — the spec FormFieldSchema object', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const built = buildFlatFields({ ...ctx, fields: [{ field: 'note' } as any] });
      expect(built).toEqual([]); // still dropped from render — route 1 warns, it does not resolve
      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0];
      expect(String(message)).toContain("{ field: 'note' }");
      expect(String(message)).toContain('sections[].fields');
      expect(String(message)).toContain('FormFieldSchema');
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT fire for a legal bare field name — the firing control', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const built = buildFlatFields({ ...ctx, fields: ['status'] });
      expect(built.map((f) => f.name)).toEqual(['status']);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * PARITY PIN. The flat and sectioned producers now resolve every field through
 * the same `fromObjectSchema`, so their output must agree on every key the
 * sectioned one produces. `group` is the one deliberate flat-only addition (its
 * only reader, `deriveFieldGroupSections`, runs on the flat path alone) — so it
 * is asserted as an addition rather than treated as drift.
 *
 * A future edit that re-forks either builder fails HERE, before it can ship a
 * container that quietly ignores half the object's declarations.
 */
describe('buildFlatFields ↔ normalizeSectionField parity (#4755)', () => {
  it('agrees key-by-key with the sectioned producer, adding only `group`', () => {
    for (const name of Object.keys(OBJECT_SCHEMA.fields)) {
      const flat = buildFlatFields({ ...ctx, fields: [name] })[0] as Record<string, unknown>;
      const sectioned = normalizeSectionField(name, ctx) as Record<string, unknown>;

      expect(new Set(Object.keys(flat))).toEqual(new Set([...Object.keys(sectioned), 'group']));
      for (const key of Object.keys(sectioned)) {
        expect({ key, value: flat[key] }).toEqual({ key, value: sectioned[key] });
      }
    }
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7561] THE CLASS PIN — every platform-stamped field, through `FieldSchema`.
 *
 * ## Why this file exists rather than a third one-key patch
 *
 * The platform writes fields the author never wrote: `applySystemFields` adds
 * the tenant/audit/owner columns, `provisionPrimary` designates and may add the
 * title column, `provisionSearchCompanion` adds `__search`. All three run at
 * `registerObject` time — BEFORE the document is stored — and `/meta` re-parses
 * the served body through `FieldSchema`, which is a `strictObject`. So a
 * stamper that writes ONE key `FieldSchema` does not admit does not produce one
 * bad field: it stamps `_diagnostics: { valid: false }` on every object that
 * stamper touches, on a document no author wrote and none can fix.
 *
 * That has now happened twice, one key and one field apart:
 *
 *   - #6810 — `applySystemFields` spread `indexed: opts.multiTenant` onto
 *     `organization_id`. Every registry-backed object read answered invalid.
 *   - #7561 — `provisionSearchCompanion` stamped `index: true` on `__search`.
 *     `GET /api/v1/meta/diagnostics` answered 94 of 94 entries INVALID, and
 *     the baseline stayed that way until a human read it by hand.
 *
 * Both keys are the SAME retired key: field-level `index`/`indexed`, removed in
 * the 16.x line (#2377, ADR-0049) because a field-level index flag built no
 * index. Patching one stamper at a time is what produced the second card, so
 * this test asserts the property for ALL of them at once: whatever the stampers
 * write, `FieldSchema` accepts. A future stamper that reaches for a retired or
 * misspelled key turns this suite red instead of poisoning the diagnostics
 * surface for everyone.
 *
 * The matrix is deliberately the union of every branch each stamper has, so a
 * key stamped only under one condition (`multiTenant`, an ownership mode, a
 * CJK-eligible name field) cannot slip through on an unexercised path.
 */

import { FieldSchema } from '@objectstack/spec/data';
import { describe, it, expect } from 'vitest';

import { applySystemFields } from './registry.js';
import { provisionSearchCompanion, SEARCH_COMPANION_FIELD } from './search-companion.js';

/** A title-eligible name field, so `provisionSearchCompanion` has a source. */
const nameFields = () => ({ name: { type: 'text' }, amount: { type: 'number' } });

/**
 * Every branch of the injection/provisioning passes. Same spirit as the #5378
 * parity matrix in `injected-system-columns-parity.test.ts` — that one pins
 * WHICH columns get added, this one pins that WHAT gets added parses.
 */
const CASES: Array<[string, Record<string, unknown>]> = [
  ['default business object', { name: 'crm_contact', fields: nameFields() }],
  ["ownership: 'user'", { name: 'crm_contact', ownership: 'user', fields: nameFields() }],
  ["ownership: 'org'", { name: 'crm_contact', ownership: 'org', fields: nameFields() }],
  ["ownership: 'none'", { name: 'crm_contact', ownership: 'none', fields: nameFields() }],
  ["ownership: 'business_unit'", { name: 'crm_contact', ownership: 'business_unit', fields: nameFields() }],
  ['sys_* namespace', { name: 'sys_thing', fields: nameFields() }],
  ["managedBy: 'platform'", { name: 'crm_contact', managedBy: 'platform', fields: nameFields() }],
  ["managedBy: 'better-auth'", { name: 'crm_contact', managedBy: 'better-auth', fields: nameFields() }],
  ['systemFields.tenant: false', { name: 'crm_contact', systemFields: { tenant: false }, fields: nameFields() }],
  ['systemFields.audit: false', { name: 'crm_contact', systemFields: { audit: false }, fields: nameFields() }],
  ['tenancy.enabled: false', { name: 'crm_contact', tenancy: { enabled: false }, fields: nameFields() }],
];

/** Run both stampers over `def` and return only what they ADDED. */
function stampedFields(
  def: Record<string, unknown>,
  multiTenant: boolean,
): Record<string, Record<string, unknown>> {
  const before = new Set(Object.keys((def.fields ?? {}) as Record<string, unknown>));
  const after = provisionSearchCompanion(
    applySystemFields(structuredClone(def) as any, { multiTenant }) as any,
  );
  const added: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries((after.fields ?? {}) as Record<string, any>)) {
    if (!before.has(key)) added[key] = value;
  }
  return added;
}

describe('[#7561] platform-stamped system fields conform to FieldSchema', () => {
  describe.each([true, false])('multiTenant: %s', (multiTenant) => {
    it.each(CASES)('%s', (label, def) => {
      const added = stampedFields(def, multiTenant);
      // Guard the guard: a matrix row that stamps nothing would pass vacuously.
      expect(Object.keys(added).length, `${label}: stamped no fields`).toBeGreaterThan(0);

      for (const [fieldName, fieldDef] of Object.entries(added)) {
        const parsed = FieldSchema.safeParse(fieldDef);
        // Assert the SUBSTANCE — which key, on which field — not just a boolean,
        // so a regression names itself in the failure output.
        expect(
          parsed.success
            ? []
            : parsed.error.issues.map((i) => `${[fieldName, ...i.path].join('.')}: ${i.message}`),
          `${label}: stamped field \`${fieldName}\``,
        ).toEqual([]);
      }
    });
  });

  it('the retired field-level index key appears on NO stamped field (#2377, ADR-0049)', () => {
    // The specific key both #6810 and #7561 reached for, named so a
    // reintroduction under either spelling fails on the key rather than on a
    // generic parse error — and so this stays true on paths a future
    // `FieldSchema` edit might quietly re-admit.
    for (const [label, def] of CASES) {
      for (const multiTenant of [true, false]) {
        for (const [fieldName, fieldDef] of Object.entries(stampedFields(def, multiTenant))) {
          expect(Object.keys(fieldDef), `${label}/${fieldName} (multiTenant: ${multiTenant})`)
            .not.toContain('index');
          expect(Object.keys(fieldDef), `${label}/${fieldName} (multiTenant: ${multiTenant})`)
            .not.toContain('indexed');
        }
      }
    }
  });

  it('the `__search` companion is stamped, parses, and declares no index', () => {
    // The #7561 instance specifically: the companion IS added (so the pin above
    // is not passing because the column vanished), it parses clean, and no
    // `indexes[]` entry was declared in place of the removed flag — the column's
    // only reader is a `$contains`, which no B-tree can serve.
    const provisioned = provisionSearchCompanion({
      name: 'showcase_account',
      fields: nameFields(),
    } as any);
    const companion = (provisioned.fields as any)[SEARCH_COMPANION_FIELD];
    expect(companion, 'companion column not provisioned').toBeDefined();

    const parsed = FieldSchema.safeParse(companion);
    expect(
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);

    expect((provisioned as any).indexes).toBeUndefined();
  });
});

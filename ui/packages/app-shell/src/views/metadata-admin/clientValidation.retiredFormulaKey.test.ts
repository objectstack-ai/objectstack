// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The retired `formula` alias diagnostic (objectui#6526, adjudicated option B).
 *
 * A stored object can carry a legacy `formula` key inside a formula field —
 * the Field Designer's textarea wrote it until objectui#6043 retired the
 * control. `FieldSchema` refuses the key by name, and that hard 422 blocks
 * every later save of the object. The ruling keeps the migration path (never
 * strip; see `object-fields-io`'s `RETIRED_FIELD_KEYS` note) and makes the
 * diagnostic actionable instead: it must NAME the field carrying the key and
 * POINT at the "Formula (CEL)" editor in the field inspector, where one edit
 * commits `expression` and clears the alias.
 *
 * The pins here assert the message names BOTH. A pin that only asserts "a
 * rejection occurred" passes on the pre-objectui#6526 behaviour — the bare
 * spec message with no destination — and proves nothing.
 */

import { describe, it, expect } from 'vitest';
import { validateMetadataDraft } from './clientValidation';

const draftWith = (fields: unknown) => ({ name: 'invoice', label: 'Invoice', fields });

/** The destination the pointer must name — the inspector's editor label. */
const POINTER = /Formula \(CEL\)/;

describe('validateMetadataDraft — retired `formula` alias on an object draft (objectui#6526)', () => {
  it('names the field and points at the Formula (CEL) editor', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({
        amount: { type: 'formula', label: 'Amount', formula: 'record.price * 2' },
        price: { type: 'number', label: 'Price' },
      }),
    );
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path === 'fields.amount');
    expect(issue).toBeTruthy();
    // Names the FIELD in the message itself, not only in the path.
    expect(issue!.message).toMatch(/Field `amount` carries the retired `formula` key/);
    // Names the DESTINATION: the field inspector's Formula (CEL) editor.
    expect(issue!.message).toMatch(POINTER);
    // Says what the one edit does — commits `expression`, clears the alias.
    expect(issue!.message).toMatch(/commits the value to `expression`/);
  });

  it('gives the same pointer on the edit door, where a stored body arrives', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({ amount: { type: 'formula', label: 'Amount', formula: '1 + 1' } }),
      undefined,
      { mode: 'edit' },
    );
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path === 'fields.amount');
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/Field `amount`/);
    expect(issue!.message).toMatch(POINTER);
  });

  it('appends to the spec message — the contract voice survives (AGENTS.md #0.1)', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({ amount: { type: 'formula', label: 'Amount', formula: '1 + 1' } }),
    );
    const issue = res.issues.find((i) => i.path === 'fields.amount');
    expect(issue).toBeTruthy();
    // The spec's own rejection text still opens the message.
    expect(issue!.message).toMatch(/^Unrecognized key\(s\) on this field: `formula`/);
    expect(issue!.message).toMatch(POINTER);
  });

  it('keeps the disclosure for other retired keys riding the same issue', async () => {
    // A pre-objectui#6041 stored body can carry `referenceTo` alongside
    // `formula` in ONE `keys` array; its rename prescription must survive.
    const res = await validateMetadataDraft(
      'object',
      draftWith({
        amount: { type: 'formula', label: 'Amount', formula: '1 + 1', referenceTo: 'account' },
      }),
    );
    const issue = res.issues.find((i) => i.path === 'fields.amount');
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/referenceTo/);
    expect(issue!.message).toMatch(POINTER);
  });

  it('does not point a non-formula field at an editor that will not render', async () => {
    // The inspector renders the Formula (CEL) editor only while the field IS
    // a formula (objectui#4306 ruling) — a pointer here would name a
    // destination that does not exist. The spec's rejection stands alone.
    const res = await validateMetadataDraft(
      'object',
      draftWith({ note: { type: 'text', label: 'Note', formula: 'record.x' } }),
    );
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path === 'fields.note');
    // Positive control in the same query shape: the rejection is still there…
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/Unrecognized key\(s\) on this field: `formula`/);
    // …and it is the bare spec message, no pointer.
    expect(issue!.message).not.toMatch(POINTER);
  });

  it('does not fire on an unrecognized key that is not `formula`', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({ amount: { type: 'formula', label: 'Amount', expression: '1 + 1', bogusKey: true } }),
    );
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path === 'fields.amount');
    // Positive control in the same query shape: the rejection is still there…
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/Unrecognized key\(s\) on this field: `bogusKey`/);
    // …and no formula pointer rides on it.
    expect(issue!.message).not.toMatch(POINTER);
  });

  it('is presentation only: same verdict, same paths as the raw spec parse', async () => {
    const draft = draftWith({
      amount: { type: 'formula', label: 'Amount', formula: '1 + 1' },
      price: { type: 'number', label: 'Price', bogusKey: true },
    });
    const { ObjectSchema } = await import('@objectstack/spec/data');
    const raw = (ObjectSchema as { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: Array<string | number> }> } } }).safeParse(draft);
    expect(raw.success).toBe(false);
    const rawPaths = raw.error!.issues.map((i) => i.path.join('.')).sort();
    expect(rawPaths.length).toBeGreaterThan(0);
    const res = await validateMetadataDraft('object', draft);
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path).sort()).toEqual(rawPaths);
  });

  it('stays green once the field is migrated (expression, no alias)', async () => {
    const res = await validateMetadataDraft(
      'object',
      draftWith({ amount: { type: 'formula', label: 'Amount', expression: '1 + 1' } }),
    );
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });
});

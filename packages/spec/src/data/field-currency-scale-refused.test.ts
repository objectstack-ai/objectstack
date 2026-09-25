// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19629 — `scale` is RETIRED from the `currency` field type (maintainer ruling
 * 5791803339, batch #215 item 1, letter B): a currency field carrying `scale`
 * is refused at parse. The remedy is worded by ruling 5805782503 (batch #218
 * item 2, letter 乙 — a currency's decimal places are the currency's, not a
 * setting): delete the key; the currency's ISO 4217 minor unit decides its
 * display, and its write allowance stays unconstrained. It names no other key
 * to carry the value, and the remedy pins below hold both halves: the ruled
 * wording is present, and the retired pointer is absent.
 *
 * On a currency field the key was offered by the field designer, never read by
 * the amount's cell, and still enforced on writes by `packages/objectql`'s
 * `max_scale` branch — a narrower write contract bought with no visible
 * change. The write seam drops `currency` from its enforced set in the same
 * change (pinned in that package's `record-validator.test.ts`); this file pins
 * the authoring half: the parse door, and the OFFER beside it. The object
 * designer's quick-add grid (`object.form.ts`, the registered `object` form)
 * showed its `scale` input on currency rows until the at-tier review of this
 * change caught it; a door that refuses a key a registered form still offers is
 * the offer-vs-door shape the retirement exists to remove, so the last block
 * reads every registered form's `scale` rows against a currency field.
 *
 * Key-vs-value note: the rule judges the KEY on one type, whatever its value,
 * so the refusal is asserted as a full `safeParse` failure located at
 * `['scale']`, and every control is a full `safeParse` success — never mere
 * absence of `unrecognized_keys`.
 */

import { describe, expect, it } from 'vitest';
import { Field, FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { objectForm } from './object.form';
import { METADATA_FORM_REGISTRY } from '../system/metadata-form-registry';

type Issue = { code: string; path: PropertyKey[]; message: string };

/** The issues located at the field's `scale` key, or [] when the parse passed. */
function scaleIssues(result: { success: boolean; error?: { issues: Issue[] } }): Issue[] {
  return result.success ? [] : result.error!.issues.filter((i) => i.path[i.path.length - 1] === 'scale');
}

/**
 * The ruled remedy, held on the message itself: the wording is the contract
 * here (ruling 乙 rules the prescription, not only the refusal), so the pin
 * reads the first sentence verbatim, the two ruled clauses, and the ABSENCE of
 * any key the author could be sent to instead.
 */
function expectRuledRemedy(message: string): void {
  expect(message.startsWith('`scale` is not valid on a `currency` field — delete the key.')).toBe(true);
  expect(message).toContain('the currency\'s ISO 4217 minor unit (2 for USD, 0 for JPY, 3 for KWD) decides how the amount displays');
  expect(message).toContain('the field\'s write allowance stays unconstrained');
  expect(message).not.toMatch(/currencyConfig|precision/);
}

describe('#19629 — `scale` on a `currency` field is refused at parse', () => {
  it('refuses the designer-produced shape, located at `scale`, with the ruled remedy: delete the key, and no other key named', () => {
    const result = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency', scale: 3 });
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['scale']);
    expectRuledRemedy(issues[0].message);
  });

  it('refuses every declared value, `scale: 0` and `scale: 2` included — it is the key that is retired', () => {
    for (const scale of [0, 2, 10]) {
      const result = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency', scale });
      expect(result.success, `scale: ${scale}`).toBe(false);
      expect(scaleIssues(result), `scale: ${scale}`).toHaveLength(1);
    }
  });

  it('refuses it beside a `currencyConfig` too, with the same remedy — the block neither licenses the key nor receives its value', () => {
    const result = FieldSchema.safeParse({
      name: 'amount',
      label: 'Amount',
      type: 'currency',
      scale: 2,
      currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' },
    });
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    // The field that most invites a "move it into the block" remedy gets the
    // same prescription as every other: delete the key.
    expectRuledRemedy(issues[0].message);
  });

  it('fires through the `Field.currency()` helper and `ObjectSchema` — the path an object document crosses', () => {
    const result = ObjectSchema.safeParse({
      name: 'invoice',
      label: 'Invoice',
      fields: { amount: Field.currency({ label: 'Amount', scale: 2, min: 0 }) },
    });
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['fields', 'amount', 'scale']);
    expectRuledRemedy(issues[0].message);
  });
});

describe('#19629 — CONTROLS: what the refusal must leave alone', () => {
  it('a currency field without `scale` parses, and its parse output re-parses unchanged', () => {
    const once = FieldSchema.parse({ name: 'amount', label: 'Amount', type: 'currency', min: 0 });
    expect('scale' in once).toBe(false);
    expect(FieldSchema.parse(once)).toEqual(once);
  });

  it('following the remedy parses: each refused shape, with `scale` deleted and nothing added, is accepted', () => {
    const refused: Record<string, unknown>[] = [
      { name: 'amount', label: 'Amount', type: 'currency', scale: 3 },
      { name: 'amount', label: 'Amount', type: 'currency', scale: 2, min: 0, currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'KWD' } },
    ];
    for (const shape of refused) {
      expect(FieldSchema.safeParse(shape).success).toBe(false);
      const remedied = { ...shape };
      delete remedied.scale;
      expect(Object.keys(remedied)).toEqual(Object.keys(shape).filter((k) => k !== 'scale'));
      const result = FieldSchema.safeParse(remedied);
      expect(result.success, JSON.stringify(remedied)).toBe(true);
      if (result.success) expect('scale' in result.data).toBe(false);
    }
  });

  it('every type the key still applies to keeps it — number, percent, rating, slider', () => {
    for (const type of ['number', 'percent', 'rating', 'slider'] as const) {
      const result = FieldSchema.safeParse({ name: 'n', label: 'N', type, scale: 2 });
      expect(result.success, type).toBe(true);
      if (result.success) expect(result.data.scale, type).toBe(2);
    }
  });

  it('the describe names the type set the key still applies to, and the currency refusal with the ruled remedy', () => {
    const description = (FieldSchema.shape as Record<string, { description?: string }>).scale?.description ?? '';
    expect(description).toContain('Applies to `number`, `percent`, `rating` and `slider`');
    expect(description).toContain('REFUSED on a `currency` field — delete it there');
    expect(description).toContain('the currency\'s ISO 4217 minor unit decides how the amount displays');
    expect(description).not.toContain('currencyConfig');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// The offer half: no registered metadata form shows `scale` on a currency field.
//
// The predicate reader below is the fail-closed mirror of the metadata-admin
// predicate subset that `form-delete-behavior-options.test.ts` uses: it knows
// only the `data.type` spellings these forms write (`==`, `in [...]`, joined by
// `||`) and THROWS on anything else, so a row whose predicate it cannot read
// fails here instead of being assumed visible or hidden.
// ────────────────────────────────────────────────────────────────────────────

type FormRow = Record<string, unknown>;

/** `defineForm` stores a predicate as `{ dialect, source }`; accept the bare string too. */
function predicateSource(row: FormRow): string | undefined {
  const raw = row.visibleWhen;
  if (raw == null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && typeof (raw as { source?: unknown }).source === 'string') {
    return (raw as { source: string }).source;
  }
  throw new Error(`unreadable visibleWhen on '${String(row.field)}': ${JSON.stringify(raw)}`);
}

/** Whether the row renders for a field of `type`. Throws on an unrecognised clause. */
function isOfferedForType(row: FormRow, type: string): boolean {
  const src = predicateSource(row);
  if (src === undefined) return true;
  return src.split('||').some((part) => {
    const clause = part.trim();
    const eq = /^data\.type\s*==\s*'([^']*)'$/.exec(clause);
    if (eq) return eq[1] === type;
    const inList = /^data\.type\s+in\s+\[([^\]]*)\]$/.exec(clause);
    if (inList) {
      return inList[1].split(',').map((m) => {
        const lit = /^'([^']*)'$/.exec(m.trim());
        if (!lit) throw new Error(`non-literal member in \`in\` list: ${m}`);
        return lit[1];
      }).includes(type);
    }
    throw new Error(`predicate spelling not covered by this reader: ${JSON.stringify(clause)}`);
  });
}

/** Every row named `key` in a form, at any depth (sections, repeater rows), by dotted path. */
function rowsNamed(form: unknown, key: string): Array<{ path: string; row: FormRow }> {
  const out: Array<{ path: string; row: FormRow }> = [];
  const walk = (rows: unknown, prefix: string) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows as FormRow[]) {
      if (typeof row?.field !== 'string') continue;
      const path = prefix ? `${prefix}.${row.field}` : row.field;
      if (row.field === key) out.push({ path, row });
      walk(row.fields, path);
    }
  };
  for (const section of ((form as { sections?: Array<{ fields?: unknown }> })?.sections ?? [])) {
    walk(section.fields, '');
  }
  return out;
}

describe('#19629 — no registered metadata form OFFERS `scale` on a currency field', () => {
  it('CONTROLS: the walk reaches exactly the two `scale` rows the registered forms declare, and the object form is the registered one', () => {
    // A lit roster, so an empty result below is a measured zero rather than a
    // walk that found nothing to judge; a new `scale` row anywhere turns this
    // red and gets read against the ruling before it ships.
    const roster = Object.entries(METADATA_FORM_REGISTRY)
      .flatMap(([type, form]) => rowsNamed(form, 'scale').map((r) => `${type}:${r.path}`))
      .sort();
    expect(roster).toEqual(['field:scale', 'object:fields.scale']);
    expect(METADATA_FORM_REGISTRY.object).toBe(objectForm);
    // The reader is capable of saying "offered": a known row it must light up.
    expect(isOfferedForType({ field: 'x', visibleWhen: "data.type in ['currency']" }, 'currency')).toBe(true);
  });

  it('the object designer\'s quick-add grid does not offer `scale` on a currency row — the door refuses it at parse', () => {
    const rows = rowsNamed(objectForm, 'scale');
    expect(rows.map((r) => r.path)).toEqual(['fields.scale']);
    expect(isOfferedForType(rows[0].row, 'currency')).toBe(false);
  });

  it('the object designer still offers `scale` where the key applies — number and percent', () => {
    const [{ row }] = rowsNamed(objectForm, 'scale');
    for (const type of ['number', 'percent']) {
      expect(isOfferedForType(row, type), type).toBe(true);
      // And the door agrees: the offered key parses on that type.
      expect(FieldSchema.safeParse({ name: 'n', label: 'N', type, scale: 2 }).success, type).toBe(true);
    }
  });

  it('no registered form offers `scale` on a currency field', () => {
    const offered = Object.entries(METADATA_FORM_REGISTRY).flatMap(([type, form]) =>
      rowsNamed(form, 'scale')
        .filter((r) => isOfferedForType(r.row, 'currency'))
        .map((r) => `${type}:${r.path}`),
    );
    expect(offered).toEqual([]);
  });
});

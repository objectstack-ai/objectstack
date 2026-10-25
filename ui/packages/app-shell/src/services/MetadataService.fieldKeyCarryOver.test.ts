/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6488 — `saveFields` carries the server's per-FIELD keys through a
 * field save instead of rebuilding every entry from the designer model.
 *
 * `saveFields` preserves unknown keys of the DOCUMENT by spreading it
 * (`...existingObject`, pinned in `MetadataService.objectPayloadFieldsMap.test.ts`).
 * That spread is object-level and says nothing about keys INSIDE a field, and
 * the entries were rebuilt wholesale by `toFieldPayload`, so every key the
 * SERVER sent inside a field that the designer does not model was dropped on
 * every field save: `expression` (a formula authored in metadata-admin),
 * `precision`, `scale`, `system`, `sortable`, and anything a plugin registered.
 *
 * ## Why it lands now
 *
 * The loss is not new but was UNREACHABLE. While `fields` went out as an array
 * the whole body was refused `422 INVALID_METADATA` before persistence
 * (objectui#6240), so nothing `saveFields` dropped ever reached storage.
 * objectui#6240 made the body parse; from that fix onward a PUT is an upsert
 * and the drop lands.
 *
 * ## The two directions, and why the second one is here at all
 *
 * Adding carry-over opens the MIRROR of the defect: `{...prev, ...next}` can
 * resurrect a value the author deliberately CLEARED, and a deletion that fails
 * to persist is the same silent data loss pointing the other way. Every
 * describe below therefore comes in a pair — a server key the designer does not
 * model must SURVIVE, and a modelled property the designer cleared must stay
 * ABSENT. Both are asserted on the captured request BYTES rather than on an
 * in-memory object, because `undefined` is the whole mechanism of the second
 * one: an explicitly-`undefined` modelled key overrides the carried value and
 * is then dropped by `JSON.stringify`, which on an upsert IS the deletion.
 *
 * ## The neighbour
 *
 * objectui#6480 landed `MetadataService.readDecorationStrip.test.ts` on the
 * neighbouring expression of this same function, running the OPPOSITE way: it
 * drops framework read decorations the schema REFUSES, this one keeps author
 * and plugin keys that should SURVIVE. The last describe asserts both hold at
 * once, so a later edit cannot quietly undo one in service of the other.
 */

import { describe, expect, it, vi } from 'vitest';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';
import { MetadataService } from './MetadataService';

/**
 * Captures the bodies of every PUT the SDK issued, exactly as they went over
 * the wire, and serves a caller-supplied document to the GET `saveFields` does.
 *
 * Deliberately the same harness as `MetadataService.readDecorationStrip.test.ts`
 * and `MetadataService.objectPayloadFieldsMap.test.ts`: assertions read
 * `JSON.parse` of a captured request body, so what is measured is the bytes
 * rather than an in-memory object that never had to serialise.
 */
function makeCapturingAdapter(served?: Record<string, unknown>) {
  const puts: Array<Record<string, unknown>> = [];
  const gets: string[] = [];
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      }
      if (method === 'GET') {
        gets.push(String(input));
        if (served) {
          return new Response(JSON.stringify({ item: served }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { adapter, puts, gets };
}

const designerField = (name: string, over: Partial<DesignerFieldDefinition> = {}): DesignerFieldDefinition => ({
  id: name,
  name,
  label: name,
  type: 'text',
  ...over,
});

const fieldsOf = (put: Record<string, unknown>): Record<string, Record<string, unknown>> =>
  put.fields as Record<string, Record<string, unknown>>;

/** Every `unrecognized_keys` key the schema named, flattened. */
const refusedKeys = (doc: unknown): string[] => {
  const r = ObjectSchema.safeParse(doc);
  if (r.success) return [];
  return r.error.issues.flatMap((i) =>
    i.code === 'unrecognized_keys' ? ((i as unknown as { keys: string[] }).keys ?? []) : [],
  );
};

const issuesOf = (doc: unknown): string[] => {
  const r = ObjectSchema.safeParse(doc);
  return r.success ? [] : r.error.issues.map((i) => `${i.code} @ ${i.path.join('.')}`);
};

/**
 * The keys this card is about: sent by the server INSIDE a field, accepted by
 * `FieldSchema`, and named nowhere in `toFieldPayload`.
 */
const UNMODELLED_SERVER_KEYS = {
  expression: 'price * quantity',
  precision: 18,
  scale: 2,
  system: true,
  sortable: true,
} as const;

/** Keys a designer once wrote that `FieldSchema` refuses BY NAME. */
const RETIRED_KEYS = {
  indexed: true,
  referenceTo: 'account',
  formula: 'price * quantity',
  isSystem: true,
  sortOrder: 3,
} as const;

// ---------------------------------------------------------------------------

describe('the instrument', () => {
  const base = { name: 'amount', type: 'number', label: 'Amount' };

  it('ACCEPTS every key this card preserves — the reason the drop is a loss', () => {
    // Control first, so what follows is a result about these keys rather than a
    // schema that accepts everything.
    expect(FieldSchema.safeParse(base).success).toBe(true);
    for (const [key, value] of Object.entries(UNMODELLED_SERVER_KEYS)) {
      expect(FieldSchema.safeParse({ ...base, [key]: value }).success).toBe(true);
    }
    // Together, and nested where they actually live.
    expect(issuesOf({ name: 'account', label: 'Account', fields: { amount: { ...base, ...UNMODELLED_SERVER_KEYS } } })).toEqual([]);
  });

  it('REFUSES each retired designer key BY NAME — the reason carry-over is not verbatim', () => {
    for (const [key, value] of Object.entries(RETIRED_KEYS)) {
      const r = FieldSchema.safeParse({ ...base, [key]: value });
      expect(r.success).toBe(false);
      expect(r.success ? [] : r.error.issues.map((i) => i.code)).toContain('unrecognized_keys');
    }
    // Nested, this is the hard 422 that blocks EVERY later save of the object.
    expect(refusedKeys({ name: 'account', label: 'Account', fields: { amount: { ...base, ...RETIRED_KEYS } } }).sort()).toEqual(
      ['formula', 'indexed', 'isSystem', 'referenceTo', 'sortOrder'],
    );
  });

  it('refuses a plugin-registered key too — why the carry-over is NOT filtered by this schema', () => {
    // The honest limit, stated on the instrument rather than in prose. The
    // SERVER that sent such a key accepts it; the client's INSTALLED spec does
    // not know it. Filtering the carry-over through `FieldSchema` here would
    // therefore drop precisely the keys this card exists to preserve, which is
    // why the strip is keyed to the retired-key tombstones instead.
    expect(refusedKeys({ name: 'account', label: 'Account', fields: { amount: { ...base, x_plugin_thing: { a: 1 } } } })).toEqual([
      'x_plugin_thing',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('objectui#6488 · a server key the designer does not model SURVIVES a field save', () => {
  const SERVED = {
    name: 'account',
    label: 'Account',
    fields: {
      amount: { type: 'number', label: 'Amount', ...UNMODELLED_SERVER_KEYS, x_plugin_thing: { a: 1 } },
    },
  } satisfies Record<string, unknown>;

  it('carries every one of them onto the PUT body — asserted on the request bytes', async () => {
    const { adapter, puts } = makeCapturingAdapter(SERVED);

    await new MetadataService(adapter).saveFields('account', [
      designerField('amount', { type: 'number', label: 'Amount' }),
    ]);

    // Falsification: the save really happened and really described this object,
    // so what follows is a statement about a body that exists.
    expect(puts).toHaveLength(1);
    expect(puts[0].name).toBe('account');
    expect(Object.keys(fieldsOf(puts[0]))).toEqual(['amount']);

    // Before this fix each of these was ABSENT — the entry was rebuilt from the
    // designer model, which names none of them.
    expect(fieldsOf(puts[0]).amount).toMatchObject({ ...UNMODELLED_SERVER_KEYS, x_plugin_thing: { a: 1 } });
  });

  it('and the designer model still wins on every key it DOES model', async () => {
    const { adapter, puts } = makeCapturingAdapter(SERVED);

    await new MetadataService(adapter).saveFields('account', [
      designerField('amount', { type: 'currency', label: 'Deal amount', description: 'What it is worth' }),
    ]);

    expect(fieldsOf(puts[0]).amount).toMatchObject({
      name: 'amount',
      type: 'currency',
      label: 'Deal amount',
      description: 'What it is worth',
      // …while the unmodelled keys rode along untouched.
      expression: 'price * quantity',
      precision: 18,
    });
  });

  it('carries onto the field of the SAME NAME only — a rename starts clean', async () => {
    const { adapter, puts } = makeCapturingAdapter(SERVED);

    await new MetadataService(adapter).saveFields('account', [
      designerField('amount_v2', { type: 'number', label: 'Amount' }),
    ]);

    // No previous entry under this name, so nothing to carry: the payload is
    // exactly what the designer stated.
    expect(fieldsOf(puts[0])).toEqual({ amount_v2: { name: 'amount_v2', type: 'number', label: 'Amount' } });
    // And the designer's list is still authoritative — the server's `amount` is
    // gone because the designer no longer lists it (objectui#6240's property).
    expect('amount' in fieldsOf(puts[0])).toBe(false);
  });

  it('adds NO request — the previous entries ride in on the document already fetched', async () => {
    const { adapter, puts, gets } = makeCapturingAdapter(SERVED);

    await new MetadataService(adapter).saveFields('account', [designerField('amount', { type: 'number' })]);

    expect(gets).toHaveLength(1);
    expect(puts).toHaveLength(1);
  });

  it('is a no-op when the served document has no usable `fields`', async () => {
    // `undefined`, and the ARRAY shape a stored document cannot have
    // (`ObjectSchema` answers `fields: []` with `invalid_type`, objectui#6240):
    // both read as "no previous entries" rather than being guessed at.
    for (const served of [
      { name: 'account', label: 'Account' },
      { name: 'account', label: 'Account', fields: [{ name: 'amount', type: 'number' }] },
    ]) {
      const { adapter, puts } = makeCapturingAdapter(served as Record<string, unknown>);
      await new MetadataService(adapter).saveFields('account', [designerField('amount', { type: 'number', label: 'Amount' })]);
      expect(fieldsOf(puts[0])).toEqual({ amount: { name: 'amount', type: 'number', label: 'Amount' } });
      expect(issuesOf(puts[0])).toEqual([]);
    }
  });

  it('does not read `Object.prototype` as a previous entry for a field named `__proto__`', async () => {
    // `__proto__` matches the record's key rule (`/^[a-z_][a-z0-9_]*$/`), and a
    // plain `previous['__proto__']` lookup returns the inherited
    // `Object.prototype` — an object that is not a previous field entry at all.
    // The other end of this same map already documents the hazard in
    // `toFieldsMap`. Through `@objectstack/spec` 17.4.0 the name was also
    // spec-legal; 17.5.0 refuses it BY NAME (`z.record()` would silently drop
    // it), and that refusal can only name the field if the body still carries
    // it — so keeping the key is now what makes the server's answer legible.
    const { adapter, puts } = makeCapturingAdapter({ name: 'account', label: 'Account', fields: {} });

    await new MetadataService(adapter).saveFields('account', [designerField('__proto__', { label: 'P' })]);

    // Read through a descriptor rather than a literal: `{ __proto__: … }` as an
    // EXPECTED value sets the prototype instead of declaring a key, so the
    // obvious spelling of this assertion compares against `{}` and passes on a
    // body that dropped the field. (Measured — it did, on the first run.)
    expect(Object.keys(fieldsOf(puts[0]))).toEqual(['__proto__']);
    const entry = Object.getOwnPropertyDescriptor(fieldsOf(puts[0]), '__proto__')?.value as Record<string, unknown>;
    expect(entry).toEqual({ name: '__proto__', type: 'text', label: 'P' });
    // Nothing inherited rode in: `Object.prototype`'s members are all
    // non-enumerable, so a spread of it is empty — the guard is what keeps this
    // a statement about the designer's field rather than a lucky no-op.
    expect(Object.keys(entry).sort()).toEqual(['label', 'name', 'type']);
    // The spec's by-name refusal, and nothing else (objectui#11073 re-pin).
    expect(issuesOf(puts[0])).toEqual(['custom @ fields.__proto__']);
  });
});

// ---------------------------------------------------------------------------

describe('objectui#6488 · the mirror — carry-over must NOT resurrect what the author cleared', () => {
  /** A served entry with every modelled property populated. */
  const POPULATED = {
    name: 'account',
    label: 'Account',
    fields: {
      amount: {
        name: 'amount',
        type: 'number',
        label: 'Amount',
        group: 'financials',
        description: 'The old help text',
        required: true,
        unique: true,
        readonly: true,
        hidden: true,
        defaultValue: '0',
        placeholder: 'Old placeholder',
        options: [{ label: 'One', value: '1' }],
        externalId: true,
        trackHistory: true,
        reference: 'opportunity',
        // …and one key the designer does not model, as the positive control.
        expression: 'price * quantity',
      },
    },
  } satisfies Record<string, unknown>;

  /** Every key `toFieldPayload` names, other than the two it always fills. */
  const CLEARABLE = [
    'group',
    'description',
    'required',
    'unique',
    'readonly',
    'hidden',
    'defaultValue',
    'placeholder',
    'options',
    'externalId',
    'trackHistory',
    'reference',
  ] as const;

  it('drops every modelled property the designer cleared — asserted on the request bytes', async () => {
    const { adapter, puts } = makeCapturingAdapter(POPULATED);

    // The designer states the field with all of those properties removed. This
    // is what a user clearing them in the FieldDesigner produces.
    await new MetadataService(adapter).saveFields('account', [
      designerField('amount', { type: 'number', label: 'Amount' }),
    ]);

    const entry = fieldsOf(puts[0]).amount;
    // A PUT is an upsert, so ABSENT from the body is the deletion. Present with
    // the server's old value would be the author's deletion silently failing —
    // this card's own defect, pointing the other way.
    for (const key of CLEARABLE) {
      expect({ key, present: key in entry }).toEqual({ key, present: false });
    }
    // The positive control in the same body: the fix is doing its job on the
    // key the designer does NOT model, so the absences above are about clearing
    // rather than about a carry-over that never ran.
    expect(entry.expression).toBe('price * quantity');
    expect(entry).toEqual({ name: 'amount', type: 'number', label: 'Amount', expression: 'price * quantity' });
  });

  it('clears them one at a time too — not only when the whole entry is emptied', async () => {
    // A merge keyed on "the designer supplied nothing" would pass the case
    // above and still resurrect a single cleared property.
    for (const key of CLEARABLE) {
      const { adapter, puts } = makeCapturingAdapter({
        name: 'account',
        label: 'Account',
        fields: { amount: { name: 'amount', type: 'number', label: 'Amount', [key]: (POPULATED.fields.amount as Record<string, unknown>)[key] } },
      });

      await new MetadataService(adapter).saveFields('account', [
        // Everything the designer still holds, with exactly this key cleared.
        designerField('amount', { type: 'number', label: 'Amount', description: 'kept' }),
      ]);

      const entry = fieldsOf(puts[0]).amount;
      expect({ key, present: key in entry }).toEqual({ key, present: key === 'description' });
    }
  });

  it('overwrites rather than merges a modelled property the designer CHANGED', async () => {
    const { adapter, puts } = makeCapturingAdapter(POPULATED);

    await new MetadataService(adapter).saveFields('account', [
      designerField('amount', {
        type: 'number',
        label: 'Amount',
        description: 'The new help text',
        options: [{ label: 'Two', value: '2' }],
        required: false,
      }),
    ]);

    const entry = fieldsOf(puts[0]).amount;
    expect(entry.description).toBe('The new help text');
    expect(entry.options).toEqual([{ label: 'Two', value: '2' }]);
    // `false` is a VALUE, not a clearing — it must reach the wire as `false`
    // rather than fall through to the server's `true`.
    expect(entry.required).toBe(false);
  });

  it('clears a relationship target the author removed — `reference` does not come back', async () => {
    // Called out on its own because it is the one modelled key whose designer
    // spelling differs (`referenceTo` -> `reference`), so a carry-over that
    // matched on the DESIGNER's key name would leave the server's `reference`
    // standing and silently keep the lookup pointing at the old object.
    const { adapter, puts } = makeCapturingAdapter(POPULATED);

    await new MetadataService(adapter).saveFields('account', [
      designerField('amount', { type: 'number', label: 'Amount', referenceTo: undefined }),
    ]);

    expect('reference' in fieldsOf(puts[0]).amount).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('objectui#6488 · the carry-over is bounded — retired keys do not ride back out', () => {
  it('drops each retired key, and the whole body parses green', async () => {
    // Without this the fix would be a regression rather than one: a stored
    // document carrying any of these would produce a hard 422 on every field
    // save, and with the controls retired an author has no way to clear it.
    const { adapter, puts } = makeCapturingAdapter({
      name: 'account',
      label: 'Account',
      fields: { amount: { name: 'amount', type: 'number', label: 'Amount', ...RETIRED_KEYS, ...UNMODELLED_SERVER_KEYS } },
    });

    await new MetadataService(adapter).saveFields('account', [designerField('amount', { type: 'number', label: 'Amount' })]);

    for (const key of Object.keys(RETIRED_KEYS)) {
      expect({ key, present: key in fieldsOf(puts[0]).amount }).toEqual({ key, present: false });
    }
    // Positive control: the keys that SHOULD survive did, in the same body.
    expect(fieldsOf(puts[0]).amount).toMatchObject(UNMODELLED_SERVER_KEYS);
    expect(issuesOf(puts[0])).toEqual([]);
  });

  it('strips each one on its own, not only when all five are present', async () => {
    for (const [key, value] of Object.entries(RETIRED_KEYS)) {
      const { adapter, puts } = makeCapturingAdapter({
        name: 'account',
        label: 'Account',
        fields: { amount: { name: 'amount', type: 'number', label: 'Amount', [key]: value } },
      });
      await new MetadataService(adapter).saveFields('account', [designerField('amount', { type: 'number', label: 'Amount' })]);

      expect({ key, present: key in fieldsOf(puts[0]).amount }).toEqual({ key, present: false });
      expect(issuesOf(puts[0])).toEqual([]);
    }
  });

  it('is NOT a lenient "drop whatever the schema refuses" pass (AGENTS.md #0.1)', async () => {
    // A blanket purge would swallow this key and hide the producer's bug. The
    // strip is bounded to the retired-key tombstones, so an off-spec key the
    // AUTHOR owns still goes out and is still refused — loudly, where someone
    // can see it. Same bounding assertion objectui#6480 makes one level up.
    const { adapter, puts } = makeCapturingAdapter({
      name: 'account',
      label: 'Account',
      fields: { amount: { name: 'amount', type: 'number', label: 'Amount', indexed: true, notASpecKey: 'authored, wrong, and it must stay visible' } },
    });

    await new MetadataService(adapter).saveFields('account', [designerField('amount', { type: 'number', label: 'Amount' })]);

    expect(fieldsOf(puts[0]).amount.notASpecKey).toBe('authored, wrong, and it must stay visible');
    expect('indexed' in fieldsOf(puts[0]).amount).toBe(false);
    expect(refusedKeys(puts[0])).toEqual(['notASpecKey']);
  });
});

// ---------------------------------------------------------------------------

describe('objectui#6488 · the neighbour — objectui#6480’s strip still holds', () => {
  it('strips the object-level read decorations while carrying the field keys', async () => {
    // The two edits sit on neighbouring expressions of one function and run in
    // OPPOSITE directions. Asserted in one body so neither can be quietly
    // undone in service of the other; `MetadataService.readDecorationStrip.test.ts`
    // is the other half of this pin and must stay green beside it.
    const { adapter, puts } = makeCapturingAdapter({
      name: 'account',
      label: 'Account',
      pluralLabel: 'Accounts',
      fields: { amount: { name: 'amount', type: 'number', label: 'Amount', ...UNMODELLED_SERVER_KEYS } },
      _diagnostics: { valid: false, errors: [{ path: 'fields.amount', message: 'stale' }] },
      _draft: true,
    });

    await new MetadataService(adapter).saveFields('account', [designerField('amount', { type: 'number', label: 'Amount' })]);

    expect('_diagnostics' in puts[0]).toBe(false);
    expect('_draft' in puts[0]).toBe(false);
    expect(fieldsOf(puts[0]).amount).toMatchObject(UNMODELLED_SERVER_KEYS);
    expect(puts[0].pluralLabel).toBe('Accounts');
    expect(issuesOf(puts[0])).toEqual([]);
  });

  it('does not carry a read decoration INSIDE a field, because none is served there', async () => {
    // Measured upstream rather than assumed: `decorateMetadataItem`
    // (`metadata-protocol/src/metadata-diagnostics.ts`) attaches `_diagnostics`
    // to the ITEM, never to a nested field entry, which is why the object-level
    // strip is sufficient and this carry-over needs no strip of its own. If the
    // framework ever decorated per-field, `FieldSchema` refuses both keys by
    // name and this case turns red rather than shipping a 422 to an author.
    const { adapter, puts } = makeCapturingAdapter({
      name: 'account',
      label: 'Account',
      fields: { amount: { name: 'amount', type: 'number', label: 'Amount' } },
    });

    await new MetadataService(adapter).saveFields('account', [designerField('amount', { type: 'number', label: 'Amount' })]);

    expect('_diagnostics' in fieldsOf(puts[0]).amount).toBe(false);
    expect('_draft' in fieldsOf(puts[0]).amount).toBe(false);
  });
});

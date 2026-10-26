/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6240 — the object payload `MetadataService` PUTs carries `fields` as
 * the name-keyed MAP `ObjectSchema` requires, from BOTH of its object writers.
 *
 * This is the VALUE-level half of the objectui#5761 parity family, and it is
 * the half that family's gate cannot see. `scripts/check-designer-field-key-parity.mjs`
 * compares KEY NAMES against the installed spec's accept sets; `fields` is in
 * `ObjectSchema`'s accept set under either shape, so the gate was green for the
 * whole time an array sat on the wire — its own coverage note 4 says so. A
 * declaration-reading gate and a runtime assertion on the request BYTES cover
 * different halves; this file is the second half, and every assertion below
 * reads `JSON.parse` of a captured request body rather than an in-memory
 * object.
 *
 * ## What the route does with the array — measured, not argued
 *
 * The card filed this as an unmeasured premise ("whether the route is lenient
 * about this today is unmeasured"). It is not lenient, and there is no third
 * outcome here:
 *
 *   - `metadata-protocol`'s `saveMetaItem` resolves metadata type `object` to
 *     this very `ObjectSchema` (`spec/kernel/metadata-type-schemas.ts` binds
 *     `object: ObjectSchema`, and `resolveOverlaySchema` reads that registry);
 *   - it `safeParse`s the WHOLE item and, on failure, throws
 *     `422 INVALID_METADATA` with the zod issues attached — **before** any
 *     persistence;
 *   - so the array was REFUSED. Not stripped (nothing strips it), not stored
 *     (the throw precedes the write). The "stored verbatim" outcome objectui#6238
 *     measured applies to types whose schema is tolerant or unregistered, and
 *     `object` is neither.
 *
 * Every designer object save and every designer field save that went through
 * this service was therefore a 422 that persisted nothing.
 *
 * ## The `{ undefined: … }` trap, and why WE have to be the one that fails
 *
 * Measured on the installed 17.2.0 and asserted in `the instrument` below:
 * `fields: { undefined: { … } }` PARSES GREEN. The spec cannot catch a
 * nameless field once it has been keyed, so a conversion that keyed blindly
 * would have traded a loud, harmless 422 for a silently corrupt STORED
 * document. `toFieldsMap` throws instead, and the pins below assert both that
 * it throws and that NO request was issued.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition, ObjectDefinition } from '@object-ui/types';
import { MetadataService } from './MetadataService';

/**
 * Captures the bodies of every PUT the SDK issued, exactly as they went over
 * the wire, and serves a caller-supplied document to the GET `saveFields` does.
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

const issuesOf = (result: ReturnType<typeof ObjectSchema.safeParse>): string[] =>
  result.success ? [] : result.error.issues.map((i) => `${i.code} @ ${i.path.join('.')}`);

/** The `fields` value of the last PUT, as it was serialised. */
const fieldsOf = (puts: Array<Record<string, unknown>>): Record<string, Record<string, unknown>> =>
  puts[puts.length - 1].fields as Record<string, Record<string, unknown>>;

const ACCOUNT: ObjectDefinition = {
  id: 'account',
  name: 'account',
  label: 'Account',
  pluralLabel: 'Accounts',
  isSystem: false,
  fieldCount: 2,
};

const designerField = (name: string, over: Partial<DesignerFieldDefinition> = {}): DesignerFieldDefinition => ({
  id: name,
  name,
  label: name,
  type: 'text',
  ...over,
});

// ---------------------------------------------------------------------------

describe('the instrument', () => {
  it('is the installed spec schema, and it refuses an ARRAY at the VALUE level', () => {
    // The defect, stated on the schema before any claim about the fix.
    expect(issuesOf(ObjectSchema.safeParse({ name: 'account', label: 'Account', fields: [{ name: 'n', type: 'text', label: 'N' }] }))).toEqual([
      'invalid_type @ fields',
    ]);
    // An EMPTY array too — the refusal is the container's type, not its contents.
    expect(issuesOf(ObjectSchema.safeParse({ name: 'account', label: 'Account', fields: [] }))).toEqual([
      'invalid_type @ fields',
    ]);
  });

  it('accepts the MAP — the control that makes the line above a shape result, not a schema refusing everything', () => {
    expect(ObjectSchema.safeParse({ name: 'account', label: 'Account', fields: { n: { type: 'text', label: 'N' } } }).success).toBe(true);
    expect(ObjectSchema.safeParse({ name: 'account', label: 'Account', fields: {} }).success).toBe(true);
    // …and it accepts an entry that still carries its own `name`, which is what
    // `toFieldPayload` produces. The conversion keys the entries; it does not
    // have to strip them.
    expect(ObjectSchema.safeParse({ name: 'account', label: 'Account', fields: { n: { name: 'n', type: 'text', label: 'N' } } }).success).toBe(true);
  });

  it('requires `fields` — omitting the key is refused with the same issue an array is', () => {
    // Why `toObjectPayload` may not spell "the caller did not say" as `{}`:
    // both of these are refusals, and only one of them is safe.
    expect(issuesOf(ObjectSchema.safeParse({ name: 'account', label: 'Account' }))).toEqual([
      'invalid_type @ fields',
    ]);
  });

  it('does NOT catch a nameless field once keyed — `{ undefined: … }` parses GREEN', () => {
    // The measured reason `toFieldsMap` throws. If this ever goes false the
    // guard is still right, but its justification changed and should be re-read.
    expect(ObjectSchema.safeParse({ name: 'account', label: 'Account', fields: { undefined: { type: 'text', label: 'N' } } }).success).toBe(true);
  });

  it('keys the record with a snake_case rule — `__proto__` matches it, and the spec refuses it BY NAME', () => {
    // Which is why `toFieldsMap` builds through `Object.fromEntries`: plain
    // assignment would invoke the prototype setter and drop the field silently.
    // Through `@objectstack/spec` 17.4.0 the name was LEGAL; 17.5.0 refuses it
    // by name, because `z.record()` drops the key from its output while
    // reporting success. That refusal names the field only if the body still
    // carries it, so `Object.fromEntries` still earns its place (objectui#11073).
    //
    // The fixture below spells the key `['__proto__']` DELIBERATELY, and the
    // two controls are why (objectui#6524). Per Annex B.3.1 a PLAIN
    // `{ __proto__: v }` inside an object literal SETS THE PROTOTYPE and adds
    // no own key, so the plainly-spelled fixture this test used to carry handed
    // `fields: {}` to the schema: green, and green forever, even if the spec
    // began refusing the name. Only the computed form reaches the key rule this
    // test claims to pin.
    expect(Object.keys({ __proto__: { type: 'text', label: 'P' } })).toEqual([]);
    expect(Object.keys({ ['__proto__']: { type: 'text', label: 'P' } })).toEqual(['__proto__']);
    expect(issuesOf(ObjectSchema.safeParse({ name: 'account', label: 'Account', fields: { ['__proto__']: { type: 'text', label: 'P' } } }))).toEqual([
      'custom @ fields.__proto__',
    ]);
    expect(issuesOf(ObjectSchema.safeParse({ name: 'account', label: 'Account', fields: { firstName: { type: 'text', label: 'F' } } }))).toEqual([
      'invalid_key @ fields.firstName',
    ]);
  });
});

describe('objectui#6240 · saveObject PUTs `fields` as a name-keyed map', () => {
  it('writes a map, not an array — asserted on the request bytes', async () => {
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveObject(ACCOUNT, [
      { name: 'name', type: 'text', label: 'Name' },
      { name: 'amount', type: 'number', label: 'Amount' },
    ]);

    // Falsification: the save really happened and really described this object.
    expect(puts).toHaveLength(1);
    expect(puts[0].name).toBe('account');
    expect(puts[0].label).toBe('Account');

    expect(Array.isArray(puts[0].fields)).toBe(false);
    expect(fieldsOf(puts)).toEqual({
      name: { name: 'name', type: 'text', label: 'Name' },
      amount: { name: 'amount', type: 'number', label: 'Amount' },
    });
  });

  it('and the whole body now parses green — the red-to-green witness of this card', async () => {
    const { adapter, puts } = makeCapturingAdapter();
    await new MetadataService(adapter).saveObject(ACCOUNT, [{ name: 'name', type: 'text', label: 'Name' }]);
    // Before this change: ['invalid_type @ fields'].
    expect(issuesOf(ObjectSchema.safeParse(puts[0]))).toEqual([]);
    expect(ObjectSchema.safeParse(puts[0]).success).toBe(true);
  });

  it('preserves declaration order, which is the only field order the spec has', async () => {
    // objectui#6045 removed the field-level `sortOrder` precisely because order
    // IS the record's insertion order. A conversion that sorted or grouped keys
    // would silently reorder every object's fields.
    const { adapter, puts } = makeCapturingAdapter();
    await new MetadataService(adapter).saveObject(ACCOUNT, [
      { name: 'zeta', type: 'text', label: 'Z' },
      { name: 'alpha', type: 'text', label: 'A' },
      { name: 'mid', type: 'text', label: 'M' },
    ]);
    expect(Object.keys(fieldsOf(puts))).toEqual(['zeta', 'alpha', 'mid']);
  });

  it('omits `fields` entirely when the caller supplied none — it does NOT write `{}`', async () => {
    // The anti-wipe control, and the cell where the two readings of "no fields"
    // disagree. `{}` parses green and a PUT is an upsert, so emitting it for a
    // caller that simply did not pass `existingFields` would delete every field
    // of the object. The body stays refused instead — unchanged from before
    // this card, and deliberately so.
    //
    // objectui#6490 made `existingFields` REQUIRED, and this control MOVED with
    // the signature rather than being deleted as newly-unreachable. Both halves
    // of it are still live, and they measure different things:
    //
    //   1. The `@ts-expect-error` below is the COMPILE-TIME half of #6490. This
    //      project (`tsconfig.test.json`) compiles this file, and an unused
    //      `@ts-expect-error` is itself an error — so the line reds if the
    //      argument ever goes back to optional. That is the only direction the
    //      narrowing can regress in, and this is what pins it.
    //   2. The RUNTIME half is unchanged and still reachable. `MetadataService`
    //      is public API (app-shell exports `useMetadataService`), so a
    //      JavaScript consumer — or a TypeScript one that casts past the types —
    //      can still arrive here with no field list. What it must get is the
    //      loud, harmless 422 below, never the silent wipe.
    const { adapter, puts } = makeCapturingAdapter();
    // @ts-expect-error objectui#6490 — `existingFields` is required. This call is
    // exactly what the new signature refuses, and it is compiled to prove it does.
    await new MetadataService(adapter).saveObject(ACCOUNT);

    expect(puts).toHaveLength(1);
    expect('fields' in puts[0]).toBe(false);
    expect(issuesOf(ObjectSchema.safeParse(puts[0]))).toEqual(['invalid_type @ fields']);
    // Positive control: the rest of the object still went out.
    expect(puts[0]).toMatchObject({ name: 'account', label: 'Account', pluralLabel: 'Accounts' });
  });

  it('objectui#6490 · an EMPTY list is a STATEMENT, not a missing argument — it writes `{}`', async () => {
    // The cell the required parameter makes canonical: with the argument no
    // longer omittable, `[]` is the only spelling left for "no fields", and it
    // means what it says. Unchanged behaviour — `[]` is truthy, so it has always
    // converted to `{}` — pinned now because the signature change is what routes
    // callers to it. The two readings must stay distinguishable: the control
    // above is about a MISSING argument and never about an empty one, and
    // `saveFields` reads its own empty list the same authoritative way.
    const { adapter, puts } = makeCapturingAdapter();
    await new MetadataService(adapter).saveObject(ACCOUNT, []);

    expect(puts).toHaveLength(1);
    expect(puts[0].fields).toEqual({});
    // And unlike the missing-argument body, this one is one the server ACCEPTS —
    // which is the whole hazard, and why it may only ever happen on request.
    expect(issuesOf(ObjectSchema.safeParse(puts[0]))).toEqual([]);
  });
});

describe('objectui#6240 · saveFields no longer converts the server’s map INTO an array', () => {
  it('writes a name-keyed map built from the designer fields', async () => {
    const { adapter, puts } = makeCapturingAdapter({
      name: 'account',
      label: 'Account',
      fields: { legacy: { type: 'text', label: 'Legacy' } },
    });

    await new MetadataService(adapter).saveFields('account', [
      designerField('first_name', { label: 'First name' }),
      designerField('amount', { type: 'number', label: 'Amount' }),
    ]);

    expect(puts).toHaveLength(1);
    expect(Array.isArray(puts[0].fields)).toBe(false);
    expect(Object.keys(fieldsOf(puts))).toEqual(['first_name', 'amount']);
    expect(fieldsOf(puts).first_name).toMatchObject({ name: 'first_name', type: 'text', label: 'First name' });
    // The designer's list is authoritative: the server's `legacy` field is gone
    // because the designer no longer lists it, which is what a field save means.
    expect('legacy' in fieldsOf(puts)).toBe(false);
  });

  it('and that body parses green, where the array made it a 422', async () => {
    const { adapter, puts } = makeCapturingAdapter({ name: 'account', label: 'Account' });
    await new MetadataService(adapter).saveFields('account', [designerField('first_name', { label: 'First name' })]);
    expect(issuesOf(ObjectSchema.safeParse(puts[0]))).toEqual([]);
  });

  it('STILL preserves unknown server keys through the conversion — the property the spread carries', async () => {
    // The reshape must not cost what `...existingObject` was already buying.
    // It matters more now than it did, not less: while the body was refused,
    // nothing it preserved ever reached storage.
    const { adapter, puts } = makeCapturingAdapter({
      name: 'account',
      label: 'Account',
      pluralLabel: 'Accounts',
      icon: 'Building',
      fieldGroups: { contact: { label: 'Contact' } },
      fields: { legacy: { type: 'text', label: 'Legacy' } },
    });

    await new MetadataService(adapter).saveFields('account', [designerField('first_name', { label: 'First name' })]);

    expect(puts[0]).toMatchObject({
      name: 'account',
      label: 'Account',
      pluralLabel: 'Accounts',
      icon: 'Building',
      fieldGroups: { contact: { label: 'Contact' } },
    });
    // Positive control in the same output: `fields` really WAS replaced, so the
    // assertion above is about preservation and not about a body that was
    // echoed back whole.
    expect(Object.keys(fieldsOf(puts))).toEqual(['first_name']);
  });

  it('treats an empty field list as authoritative and writes `{}` — the asymmetry with saveObject', async () => {
    // Here the designer IS stating the object's complete field set, so "no
    // fields" is something it can mean. `saveObject`'s optional parameter is
    // the opposite case and is pinned above.
    const { adapter, puts } = makeCapturingAdapter({ name: 'account', label: 'Account' });
    await new MetadataService(adapter).saveFields('account', []);
    expect(puts[0].fields).toEqual({});
    expect(ObjectSchema.safeParse(puts[0]).success).toBe(true);
  });

  it('agrees with saveObject on the container shape — the two writers no longer disagree', async () => {
    // The card's headline: "the designer's two write paths disagree with each
    // other". Measured on both bodies at once so a fix to one alone reds this.
    const a = makeCapturingAdapter();
    await new MetadataService(a.adapter).saveObject(ACCOUNT, [{ name: 'first_name', type: 'text', label: 'First name' }]);
    const b = makeCapturingAdapter({ name: 'account', label: 'Account' });
    await new MetadataService(b.adapter).saveFields('account', [designerField('first_name', { label: 'First name' })]);

    expect(Object.keys(fieldsOf(a.puts))).toEqual(Object.keys(fieldsOf(b.puts)));
    expect(Array.isArray(a.puts[0].fields)).toBe(Array.isArray(b.puts[0].fields));
    expect(Array.isArray(a.puts[0].fields)).toBe(false);
  });
});

describe('objectui#6240 · a field with no name FAILS LOUDLY, and nothing is sent', () => {
  const nameless = { type: 'text', label: 'Nameless' } as unknown as { name: string; type: string; label: string };

  it('throws rather than writing a `{ undefined: … }` entry — saveObject', async () => {
    const { adapter, puts } = makeCapturingAdapter();
    await expect(new MetadataService(adapter).saveObject(ACCOUNT, [nameless])).rejects.toThrow(/has no `name`/);
    // The half a "it threw" assertion cannot see: no request was issued, so
    // there is no half-written document behind the throw.
    expect(puts).toHaveLength(0);
  });

  it('throws rather than writing a `{ undefined: … }` entry — saveFields', async () => {
    const { adapter, puts } = makeCapturingAdapter({ name: 'account', label: 'Account' });
    await expect(
      new MetadataService(adapter).saveFields('account', [
        designerField('ok'),
        { id: 'x', label: 'Nameless', type: 'text' } as unknown as DesignerFieldDefinition,
      ]),
    ).rejects.toThrow(/has no `name`/);
    expect(puts).toHaveLength(0);
  });

  it('names the offending position, so the message is actionable', async () => {
    const { adapter } = makeCapturingAdapter();
    await expect(
      new MetadataService(adapter).saveObject(ACCOUNT, [{ name: 'ok', type: 'text', label: 'OK' }, nameless]),
    ).rejects.toThrow(/index 1/);
  });

  it('counts a blank name as no name — `""` would key as the empty string', async () => {
    const { adapter, puts } = makeCapturingAdapter();
    await expect(
      new MetadataService(adapter).saveObject(ACCOUNT, [{ name: '   ', type: 'text', label: 'Blank' }]),
    ).rejects.toThrow(/has no `name`/);
    expect(puts).toHaveLength(0);
  });

  it('refuses duplicate names — the hazard the ARRAY did not have', async () => {
    // An array carries two entries called `n`; a map cannot, so the second
    // would silently swallow the first. That loss is introduced BY the
    // conversion, so the conversion is what has to refuse it.
    const { adapter, puts } = makeCapturingAdapter();
    await expect(
      new MetadataService(adapter).saveObject(ACCOUNT, [
        { name: 'amount', type: 'number', label: 'Amount' },
        { name: 'amount', type: 'text', label: 'Amount again' },
      ]),
    ).rejects.toThrow(/duplicate field name `amount`/);
    expect(puts).toHaveLength(0);
  });

  it('keys a field literally named `__proto__` instead of silently dropping it', async () => {
    // `__proto__` matches the record's key rule, so a designer can type it.
    // Built by assignment it would set the prototype and vanish from the
    // serialised body; built by `Object.fromEntries` it is an own property —
    // which is what lets the spec's by-name refusal (17.5.0) reach the author.
    const { adapter, puts } = makeCapturingAdapter();
    await new MetadataService(adapter).saveObject(ACCOUNT, [
      { name: '__proto__', type: 'text', label: 'Proto' },
      { name: 'amount', type: 'number', label: 'Amount' },
    ]);
    expect(Object.keys(fieldsOf(puts))).toEqual(['__proto__', 'amount']);
    // Honest ONLY because `fieldsOf` reads `JSON.parse` of the captured bytes,
    // where `__proto__` is an own property: a refactor that built this object
    // from a literal instead would turn the read below into a prototype read.
    expect(fieldsOf(puts).__proto__).toMatchObject({ type: 'text', label: 'Proto' });
  });
});

describe('objectui#6240 · the honest limit of this fix', () => {
  it('does not make every designer field name spec-legal — the key rule is still the server’s', async () => {
    // A camelCase field name is refused at the KEY level now instead of the
    // container level. Both are 422s; the difference is that the author is told
    // which field, which is what the framework's own container-issue descent
    // exists to surface. Fixing the designer's naming is not this card.
    const { adapter, puts } = makeCapturingAdapter();
    await new MetadataService(adapter).saveObject(ACCOUNT, [{ name: 'firstName', type: 'text', label: 'First' }]);
    expect(issuesOf(ObjectSchema.safeParse(puts[0]))).toEqual(['invalid_key @ fields.firstName']);
  });
});

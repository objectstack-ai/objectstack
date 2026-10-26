/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6223 — the object payload `MetadataService` PUTs carries no key
 * `ObjectSchema` refuses BY NAME.
 *
 * Surfaced by the key-level parity gate built for objectui#5761
 * (`scripts/check-designer-field-key-parity.mjs`), once objectui#6223 gave it a
 * SECOND ORACLE. Until then the gate compared field shapes against
 * `FieldSchema` and nothing at all checked the parent document those fields are
 * nested in, so three object-level keys sat on the wire while the gate was
 * green. `ObjectMetadataPayload` is now one of that gate's object-level `wire`
 * shapes: `toObjectPayload` builds it and `saveObject` PUTs it whole to
 * `PUT /api/v1/meta/object/:name`.
 *
 * Measured against the installed `@objectstack/spec` (ESM build), whose
 * `ObjectSchema` accept set is 43 keys at 17.3.0 (42 at 17.2.0, when this file
 * was written; the one gained key is `editMode`, unrelated to the three below):
 *
 *   ObjectSchema.safeParse({ ...base, group: 'Sales' })  => unrecognized_keys ["group"]
 *   ObjectSchema.safeParse({ ...base, sortOrder: 3 })    => unrecognized_keys ["sortOrder"]
 *   ObjectSchema.safeParse({ ...base, relationships: … }) => unrecognized_keys ["relationships"]
 *
 * The controls are what make that a KEY-BY-KEY result rather than a schema that
 * refuses everything: `isSystem` and `pluralLabel` parse green on the same base
 * document. Both are asserted below, first, before any claim about the fix.
 *
 * ## What this file does NOT claim
 *
 * It does not claim a reproduced HTTP 422. The card was explicit that whether
 * the deployed route rejects these today depends on what that route parses
 * with; the schema fact is the ground for the fix and is all that is asserted.
 *
 * ## Why the assertions are on bytes
 *
 * `undefined` is a key zod's strict object COUNTS and `JSON.stringify` DROPS.
 * An in-memory assertion on the object handed to the client and a wire
 * assertion therefore disagree exactly on the half-filled case, so every
 * assertion here reads `JSON.parse` of the captured request body.
 *
 * ## One `it` per key, deliberately
 *
 * Three keys were resolved. A suite that exercised them together would stay
 * green on a fix that landed two of three, so each key is pinned by name in its
 * own case: reverting one resolution reds only that case.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { ObjectDefinition } from '@object-ui/types';
import { MetadataService } from './MetadataService';

/** The bodies of every PUT the SDK issued, exactly as they went over the wire. */
function makeCapturingAdapter() {
  const puts: Array<Record<string, unknown>> = [];
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { adapter, puts };
}

const unrecognizedKeys = (result: ReturnType<typeof ObjectSchema.safeParse>): string[] =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => (i as unknown as { keys: string[] }).keys);

/** A base document `ObjectSchema` accepts, for probing one key at a time. */
const BASE = { name: 'account', label: 'Account', fields: { n: { type: 'text', label: 'N' } } };

/**
 * An object as the Object Manager holds it, with both UI-only keys populated —
 * the state a designer save actually starts from. The third key objectui#6223
 * kept off the wire, `relationships`, is no longer an `ObjectDefinition` member
 * at all (objectui#11434 retired it, a `?: never` tombstone); {@link LEGACY}
 * below hands one in from outside the type system.
 */
const MANAGED: ObjectDefinition = {
  id: 'account',
  name: 'account',
  label: 'Account',
  pluralLabel: 'Accounts',
  description: 'Customer accounts',
  icon: 'Building',
  group: 'Custom Objects',
  sortOrder: 3,
  isSystem: false,
  fieldCount: 1,
};

/**
 * {@link MANAGED} plus an object-level `relationships` array, the way a caller
 * outside the type system (a JavaScript host, state saved before objectui#11434
 * retired the member) can still hand one to `saveObject`. The cast is the point:
 * `tsc` now refuses the key on `ObjectDefinition`, and this value is what proves
 * the converter's explicit field list, not the type, keeps it off the wire.
 */
const LEGACY = {
  ...MANAGED,
  relationships: [{ relatedObject: 'contact', type: 'one-to-many', label: 'Contacts', foreignKey: 'account_id' }],
} as unknown as ObjectDefinition;

async function putFor(obj: ObjectDefinition = MANAGED): Promise<Record<string, unknown>> {
  const { adapter, puts } = makeCapturingAdapter();
  await new MetadataService(adapter).saveObject(obj, [{ name: 'name', type: 'text', label: 'Name' }]);
  expect(puts).toHaveLength(1);
  return puts[0];
}

describe('the instrument', () => {
  it('is the installed spec schema and it is STRICT — unknown keys are refused, not stripped', () => {
    // objectstack#4001 closed the silent-drop shape. Every parity assertion
    // below depends on it: a stripping schema would make them all trivially
    // green while the 422 still happened server-side.
    const result = ObjectSchema.safeParse({ ...BASE, zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });

  it('accepts the controls — this is a key-by-key result, not a schema refusing everything', () => {
    // Without these two, "ObjectSchema refuses `group`" would be worthless: a
    // schema that refused every object would produce the same evidence.
    expect(ObjectSchema.safeParse(BASE).success).toBe(true);
    expect(ObjectSchema.safeParse({ ...BASE, isSystem: true }).success).toBe(true);
    expect(ObjectSchema.safeParse({ ...BASE, pluralLabel: 'Accounts' }).success).toBe(true);
  });

  it('refuses each of the three keys BY NAME, one at a time', () => {
    expect(unrecognizedKeys(ObjectSchema.safeParse({ ...BASE, group: 'Sales' }))).toEqual(['group']);
    expect(unrecognizedKeys(ObjectSchema.safeParse({ ...BASE, sortOrder: 3 }))).toEqual(['sortOrder']);
    expect(
      unrecognizedKeys(
        ObjectSchema.safeParse({ ...BASE, relationships: [{ relatedObject: 'contact', type: 'one-to-many' }] }),
      ),
    ).toEqual(['relationships']);
  });

  it('has no near-spelling for any of them — unlike objectui#6041, nothing here is a rename', () => {
    // 43 at `@objectstack/spec` 17.3.0, which adopted `editMode` (measured —
    // gained set exactly `['editMode']`, lost set empty). The count is this
    // file's corpus guard, not its subject; every claim it guards is below and
    // unchanged.
    // 44 at `@objectstack/spec` 17.6.0, which adopted `imageField` (measured against
    // a 17.5.0 control: gained set exactly `['imageField']`, lost set empty;
    // objectui#11438). Re-pointed as the 17.3.0 adoption was, not weakened.
    // 45 at `@objectstack/spec` 18.0.0-next.0, which adopted `attachedOnRead`
    // (measured against a 17.7.0 control: gained set exactly `['attachedOnRead']`,
    // lost set empty; objectui#12030). Re-pointed the same way.
    // 46 on the objectstack `main` pin after 18.0.0-next.3, which adopted
    // `defaultRowScope` (objectstack#24398; measured against the next.3 pin: the
    // one top-level key `ObjectSchema` gains between the two commits, none lost;
    // objectui#12971). Re-pointed the same way.
    // 47 at `@objectstack/spec` 18.1.0, which adopted `membershipKeys`
    // (objectstack#25513; measured against the 915e9404 pin: the spec's own
    // `authorable-surface/data.json` gains exactly `data/Object:membershipKeys`
    // between the two commits, none lost; objectui#13440). Re-pointed the same way.
    const accept = new Set(Object.keys(ObjectSchema.shape as Record<string, unknown>));
    expect(accept.size).toBe(47);
    // `fieldGroups` is the only grouping key on the object, and it groups the
    // FIELDS INSIDE one object — it is not a category for objects themselves,
    // so `group` has no mapping target here.
    expect(accept.has('fieldGroups')).toBe(true);
    for (const key of ['group', 'sortOrder', 'relationships', 'order', 'category', 'sortField']) {
      expect(accept.has(key), `ObjectSchema unexpectedly accepts \`${key}\``).toBe(false);
    }
  });
});

describe('objectui#6223 · `group` — the manager’s display category, never the payload', () => {
  it('does not put `group` on the wire even when the object carries one', async () => {
    const put = await putFor();
    expect('group' in put).toBe(false);
    // Falsification: the save really happened and really described this object.
    expect(put.name).toBe('account');
    expect(put.label).toBe('Account');
  });

  it('and `ObjectSchema` reports no `group` among the refused keys of that body', async () => {
    expect(unrecognizedKeys(ObjectSchema.safeParse(await putFor()))).not.toContain('group');
  });
});

describe('objectui#6223 · `sortOrder` — list order, not object metadata', () => {
  it('does not put `sortOrder` on the wire even when the object carries one', async () => {
    const put = await putFor();
    expect('sortOrder' in put).toBe(false);
    expect(put.name).toBe('account');
  });

  it('and `ObjectSchema` reports no `sortOrder` among the refused keys of that body', async () => {
    expect(unrecognizedKeys(ObjectSchema.safeParse(await putFor()))).not.toContain('sortOrder');
  });

  it('is measured on the OBJECT document only — the field-level key is objectui#6045', async () => {
    // The two keys share a spelling and nothing else, and this case is what
    // keeps the two cards independently measurable.
    //
    // It used to assert the OPPOSITE — that `saveFields` still put a
    // field-level `sortOrder` on the wire — because when objectui#6223 landed,
    // objectui#6045 was still open and the object-level fix had to be provable
    // WITHOUT quietly resolving the field-level one. objectui#6045 has since
    // removed that key from `FieldMetadataPayload`, from `toFieldPayload` and
    // from `DesignerFieldDefinition`, so the old assertion is a fixture that
    // pinned exactly the branch that card deleted: it is replaced rather than
    // respelled. What survives is the claim it was really making — the object
    // half is judged on the object document, and a field's absence of the key
    // is not evidence about it either way.
    const put = await putFor();
    expect('sortOrder' in put).toBe(false);
    // The object-level resolution is still visible on the UI model it kept:
    // reverting objectui#6045 cannot make this case green or red.
    expect(MANAGED.sortOrder).toBe(3);
    // Field-level coverage lives in `MetadataService.retiredFieldSortOrder.test.ts`.
  });
});

describe('objectui#6223 · `relationships` — the spec models these on the FIELD', () => {
  it('does not put `relationships` on the wire even when the object carries them', async () => {
    // Non-vacuity: the input really carries the key, through the cast LEGACY documents.
    expect('relationships' in LEGACY).toBe(true);
    const put = await putFor(LEGACY);
    expect('relationships' in put).toBe(false);
    expect(put.name).toBe('account');
  });

  it('and `ObjectSchema` reports no `relationships` among the refused keys of that body', async () => {
    expect(unrecognizedKeys(ObjectSchema.safeParse(await putFor(LEGACY)))).not.toContain('relationships');
  });
});

describe('objectui#6223 · the whole body, and the honest limit of this fix', () => {
  it('carries NO key `ObjectSchema` refuses by name', async () => {
    // The claim of this card, stated once over the whole document rather than
    // key by key. Before the fix this was ["group", "sortOrder", "relationships"];
    // LEGACY carries all three.
    expect(unrecognizedKeys(ObjectSchema.safeParse(await putFor(LEGACY)))).toEqual([]);
  });

  it('still carries everything the spec DOES accept — the fix removed keys, it did not empty the payload', async () => {
    // Falsification for the assertion above: a payload of `{}` would also carry
    // no refused key, and that is not the fix.
    const put = await putFor();
    expect(put).toMatchObject({
      name: 'account',
      label: 'Account',
      pluralLabel: 'Accounts',
      description: 'Customer accounts',
      icon: 'Building',
    });
  });

  it('parses green as a whole — the VALUE-level half closed too (objectui#6240)', async () => {
    // ⭐ THIS CASE IS THE RED-TO-GREEN WITNESS OF objectui#6240, and it used to
    // assert the OPPOSITE:
    //
    //     expect(result.success).toBe(false);
    //     expect(issues).toEqual(['invalid_type @ fields']);
    //
    // That was correct and load-bearing while objectui#6240 was open. This file
    // closed the KEY-NAME class (objectui#6223) and deliberately pinned the
    // remaining VALUE-level rejection — the parity gate's coverage note 4 — so
    // that it could not silently change. It has now changed, on purpose:
    // `toObjectPayload` emits `fields` as the name-keyed MAP `ObjectSchema`
    // requires instead of an array, so the whole document parses.
    //
    // The pin is REPLACED rather than deleted, because the claim it was really
    // making — "judge the whole body, not just its key names" — is still the
    // claim, and it is stronger green than red. The container shape itself,
    // both writers, and the failure modes the conversion introduces are pinned
    // in `MetadataService.objectPayloadFieldsMap.test.ts`.
    const put = await putFor();
    const result = ObjectSchema.safeParse(put);
    expect(unrecognizedKeys(result)).toEqual([]);
    expect(result.error?.issues.map((i) => `${i.code} @ ${i.path.join('.')}`)).toBeUndefined();
    expect(result.success).toBe(true);
    // Falsification: green over a body that really carries the field, rather
    // than over an emptied one.
    expect(put.fields).toEqual({ name: { name: 'name', type: 'text', label: 'Name' } });
  });

  it('a half-filled object — no group, no sortOrder, no relationships — puts identical bytes, as it always did', async () => {
    // ⚠ This case would still pass on a revert, deliberately. `undefined` is
    // dropped by `JSON.stringify`, so an object that never had these keys
    // populated produced byte-identical output before and after this fix. It is
    // here to prove the fix did not newly break the untouched half, which is a
    // claim about what did NOT change.
    const put = await putFor({ id: 'lead', name: 'lead', label: 'Lead' });
    expect(Object.keys(put).sort()).toEqual(['fields', 'label', 'name']);
    expect(unrecognizedKeys(ObjectSchema.safeParse(put))).toEqual([]);
  });
});

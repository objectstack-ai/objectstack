/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6041 — `MetadataService` writes the relationship target under the
 * spec's spelling `reference`, never `referenceTo`.
 *
 * Surfaced by the key-level parity gate built for objectui#5761
 * (`scripts/check-designer-field-key-parity.mjs`). `FieldMetadataPayload` is
 * one of that gate's two `wire` shapes: `toFieldPayload` builds it and
 * `saveFields` PUTs `fields.map(toFieldPayload)` to
 * `PUT /api/v1/meta/object/:name`.
 *
 * `referenceTo` is not in `FieldSchema`'s accept set. Measured on the installed
 * artifact, both at field level and through the whole object document — this
 * file states the pin ONCE, in the `objectui#7714` docblock below, so a pin
 * bump has one place to rot instead of three:
 *
 *   ObjectSchema.safeParse({ …, fields: { rel: { type: 'lookup', label: 'Owner',
 *                                               referenceTo: 'user' } } })
 *     => success = false
 *     => unrecognized_keys at ["fields","rel"] keys=["referenceTo"]
 *        "Did you mean `referenceTo` -> `reference`?"
 *
 * which the route returns as a hard 422 `INVALID_METADATA`. Because the key is
 * then STORED, every later save of that object fails the same way until it is
 * cleared by hand.
 *
 * ## Why the negative controls are the deliverable
 *
 * A green parity assertion proves nothing on its own: `FieldSchema` could be
 * resolved to a look-alike or loosened to a passthrough and every positive
 * assertion here would stay green while the 422 still happened server-side. So
 * the instrument is asserted first, and each positive claim is paired with a
 * control that must fail.
 *
 * Assertions are made on the bytes the SDK actually PUT — `JSON.parse` of the
 * captured request body — not on the object handed to the client. That
 * distinction is load-bearing for this key: a property whose value is
 * `undefined` is a key that zod's strict object COUNTS but that
 * `JSON.stringify` DROPS, so an in-memory assertion and a wire assertion
 * disagree exactly on the half-filled draft this card had to measure.
 *
 * ## objectui#7714 — a half-filled lookup is HELD CLIENT-SIDE and never PUT
 *
 * The half-filled case below used to pin the opposite ("still saves, exactly as
 * before"). That was accurate for objectui#6041's question and is no longer the
 * truth: `@objectstack/spec` 17.3.0 made `reference` a hard requirement on
 * `lookup` / `master_detail`, and objectui#7714 drove the consequence in a
 * running designer against a 17.3.0 backend — the target-less draft PUT the
 * whole object, got `422 INVALID_METADATA` at `fields.<name>.reference`, and
 * then blocked the NEXT edit too, to an entirely different field, because the
 * draft rides along in the same document.
 *
 * So the fix is a client behaviour, and this file states it: the writer refuses
 * the list and issues **no PUT at all**. That claim is about THE PUT BODY, not
 * about the spec's verdict, which is why it never depended on the pin in either
 * direction: it was pinnable while the spec still accepted a target-less draft,
 * and it is pinnable now that the spec refuses one. ⛔ Its truth is not a
 * reading of any installed artifact, so ⛔ do not re-stamp it with a version
 * when the pin next moves (objectui#8897).
 *
 * ⛔ The refusal is not "strip the incomplete field and save the rest": that
 * would show the author a field the server never received, the silent-drop
 * shape objectstack#4001 closed and the ruling excluded by name. `puts` being
 * EMPTY is the assertion that tells the two apart.
 */

import { describe, expect, it, vi } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';
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

/**
 * The field defs of the last PUT, in wire order.
 *
 * `fields` is a name-keyed MAP on the wire (objectui#6240 — `ObjectSchema`
 * refuses an array at the value level), and this file's subject is what is
 * INSIDE one field def, so it reads the map's values in insertion order, which
 * is the only field order the spec has. The CONTAINER shape is pinned by
 * `MetadataService.objectPayloadFieldsMap.test.ts`, deliberately not here.
 */
function savedFields(puts: Array<Record<string, unknown>>): Record<string, unknown>[] {
  const fields = puts[puts.length - 1].fields as Record<string, Record<string, unknown>>;
  return Object.values(fields);
}

const unrecognizedKeys = (result: ReturnType<typeof FieldSchema.safeParse>): string[] =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => (i as unknown as { keys: string[] }).keys);

const LOOKUP: DesignerFieldDefinition = {
  id: 'owner_id',
  name: 'owner_id',
  label: 'Owner',
  type: 'lookup',
  referenceTo: 'account',
};

describe('the instrument', () => {
  it('is the installed spec schema and it is STRICT — unknown keys are refused, not stripped', () => {
    // objectstack#4001 closed the silent-drop shape. Every parity assertion
    // below depends on it: a stripping schema would make them all trivially
    // green while the 422 still happened server-side.
    const result = FieldSchema.safeParse({ type: 'text', label: 'L', zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });

  it('refuses `referenceTo` by name and accepts `reference` — the two states this file distinguishes', () => {
    expect(unrecognizedKeys(FieldSchema.safeParse({ type: 'lookup', label: 'Owner', referenceTo: 'account' })))
      .toEqual(['referenceTo']);
    expect(FieldSchema.safeParse({ type: 'lookup', label: 'Owner', reference: 'account' }).success).toBe(true);
  });
});

describe('objectui#6041 · saveFields PUTs the relationship target as `reference`', () => {
  it('carries `reference` and no `referenceTo` on the wire', async () => {
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveFields('account', [LOOKUP]);

    const [def] = savedFields(puts);
    expect(def.reference).toBe('account');
    expect('referenceTo' in def).toBe(false);
  });

  it('the PUT body parses through the real FieldSchema', async () => {
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveFields('account', [LOOKUP]);

    const [def] = savedFields(puts);
    const result = FieldSchema.safeParse(def);
    expect(unrecognizedKeys(result)).toEqual([]);
    expect(result.success).toBe(true);
    // Falsification: the target actually made the trip. A payload that simply
    // dropped the key would also parse green, and that is not the fix.
    expect(def.reference).toBe('account');
  });

  it('a HALF-FILLED draft — type `lookup`, target left empty — is REFUSED, and issues NO PUT', async () => {
    // objectui#7714. This case used to assert the opposite ("still saves,
    // exactly as before"), and that assertion is not respelled here — it is
    // REPLACED, because the branch it pinned is the branch this card removes.
    //
    // Two assertions, and the second is the card: the save is refused, AND the
    // client made no request at all. "Refused" alone would also describe option
    // B — strip the incomplete field, PUT the rest, report success — which is
    // the silent-drop shape objectstack#4001 closed and which the ruling
    // excluded by name. `puts` being empty is what distinguishes them.
    const { adapter, puts } = makeCapturingAdapter();

    await expect(
      new MetadataService(adapter).saveFields('account', [{ ...LOOKUP, referenceTo: undefined }]),
    ).rejects.toThrow(/needs a `reference` naming the object it links to/);

    expect(puts).toEqual([]);
  });

  it('the refusal names the field, the type and the consequence', async () => {
    // The author reads this string in the designer's error banner, so its
    // content is the deliverable rather than incidental. Asserted by content,
    // not by exact bytes: the docblocks are free to change and the four
    // load-bearing facts are not.
    const { adapter } = makeCapturingAdapter();

    await expect(
      new MetadataService(adapter).saveFields('account', [{ ...LOOKUP, referenceTo: undefined }]),
    ).rejects.toThrow(/`owner_id`/);
    await expect(
      new MetadataService(adapter).saveFields('account', [{ ...LOOKUP, referenceTo: undefined }]),
    ).rejects.toThrow(/`lookup` field/);
    await expect(
      new MetadataService(adapter).saveFields('account', [{ ...LOOKUP, referenceTo: undefined }]),
    ).rejects.toThrow(/blocks EVERY later save of this object/);
  });

  it('a COMPLETE lookup still saves — the guard refuses drafts, not relationships', async () => {
    // Falsification for the whole block above. A guard that refused every
    // `lookup` would make every assertion in it pass while deleting the
    // feature, so the accepting half is asserted in the same file.
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveFields('account', [LOOKUP]);

    expect(puts).toHaveLength(1);
    expect(savedFields(puts)[0].reference).toBe('account');
  });

  it('a NON-relationship field with no `reference` is untouched by the guard', async () => {
    // The guard is keyed to the two relationship types, not to the absence of a
    // key: 47 of the spec's 49 field types carry no `reference` at all and must
    // keep saving. Measured on the 17.3.0 artifact for objectui#7714 — exactly
    // `lookup` and `master_detail` are refused at `reference` on
    // `{ type, label }`, and no other type is refused at all.
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveFields('account', [
      { id: 'note', name: 'note', label: 'Note', type: 'text' },
    ]);

    expect(puts).toHaveLength(1);
    expect(savedFields(puts)[0].type).toBe('text');
  });

  it('`master_detail` is guarded too, through `saveObject` — the invariant is relationship targets, not one key', async () => {
    // Driven through `saveObject`'s `existingFields` rather than `saveFields`,
    // and that is the accurate reachability rather than a convenience:
    // `DesignerFieldDefinition['type']` does NOT include `master_detail`, so
    // the designer cannot author one, while `FieldMetadataPayload['type']` is
    // an unconstrained `string` and this path is where a stored master-detail
    // field actually arrives. It also exercises the second writer sharing this
    // door — `toObjectPayload` converts through the same `toFieldsMap`, so one
    // guard covers both, and nothing else in this file asserts that.
    const { adapter, puts } = makeCapturingAdapter();

    await expect(
      new MetadataService(adapter).saveObject({ id: 'account', name: 'account', label: 'Account' }, [
        { name: 'parent_id', label: 'Parent', type: 'master_detail' },
      ]),
    ).rejects.toThrow(/`master_detail` field/);

    expect(puts).toEqual([]);
  });

  it('`saveObject` still saves when the master-detail target IS present', async () => {
    // Falsification for the case above: it must be the missing target that was
    // refused, not the `saveObject` path or the type.
    const { adapter, puts } = makeCapturingAdapter();

    await new MetadataService(adapter).saveObject({ id: 'account', name: 'account', label: 'Account' }, [
      { name: 'parent_id', label: 'Parent', type: 'master_detail', reference: 'invoice' },
    ]);

    expect(puts).toHaveLength(1);
    expect(savedFields(puts)[0].reference).toBe('invoice');
  });

});

/**
 * objectui#7714 — the four states of an unusable target, and the one that used
 * to be a declared divergence.
 *
 * ⚠️ Read the instrument note before adding a spec assertion here. This repo's
 * pin is `@objectstack/spec` **17.4.0** (`pnpm-lock.yaml`; 17.3.0 before
 * objectui#8772, 17.2.0 before objectui#7122).
 *
 * ⭐ THE SKEW IS CLOSED, AND THE TRIPWIRE THAT SAID SO HAS FIRED. Until 17.3.0
 * the #13632 refinement refused an absent and an EMPTY `reference` but spelled
 * its emptiness test as an equality against `''`, so `'   '` parsed green while
 * this writer refused it — a real divergence, declared rather than hidden.
 * objectstack#16920 (reported as objectstack#16126, retired here under
 * objectui#8621) applies that test to the TRIMMED value, and it shipped in
 * 17.4.0. Measured at this pin: `'   '`, `''` and an absent target are all
 * refused upstream under the same `custom` issue at the same `reference` path
 * the writer names, so the writer's predicate now MIRRORS the contract rather
 * than exceeding it.
 *
 * The row below was written as a tripwire against exactly this event and said
 * what to do when it fired — "the reading becomes `false` and nothing else here
 * moves". That prescription is scoped to THIS FILE, and it was honoured here.
 *
 * ⚠️ It was read too widely once, and objectui#8897 is the repair. `MetadataService.ts`
 * was left untouched on the reasoning that the writer's REFUSAL does not depend
 * on the installed spec — true of the predicate, false of the PROSE. Its guard
 * docblock still said "this repo's pin is 17.3.0", and its refusal MESSAGE still
 * told authors the spec ACCEPTS a blank target and the PUT would succeed. That
 * message is user-visible, and against the installed artifact it was false. The
 * writer carried its own prescription for this — "it retires with the pin bump,
 * not with this note" — and objectui#8897 is that retirement, in both writers.
 *
 * ⭐ The lesson the pair leaves behind: a tripwire closes the reading it guards,
 * NOT every statement that depended on the same fact. A version-qualified claim
 * about WHAT IS INSTALLED goes false wherever it lives, and the prose sites are
 * the ones no assertion re-parses.
 */
describe('objectui#7714 · the target states, and the retired divergence', () => {
  const puttable = async (reference: unknown) => {
    const { adapter, puts } = makeCapturingAdapter();
    const field = { ...LOOKUP, referenceTo: reference } as DesignerFieldDefinition;
    try {
      await new MetadataService(adapter).saveFields('account', [field]);
      return { refused: false, puts };
    } catch {
      return { refused: true, puts };
    }
  };

  it('refuses all four unusable states, and PUTs none of them', async () => {
    for (const reference of [undefined, '', '   ', 42, null]) {
      const { refused, puts } = await puttable(reference);
      expect(refused, `reference=${JSON.stringify(reference)} should be refused`).toBe(true);
      expect(puts, `reference=${JSON.stringify(reference)} must issue no PUT`).toEqual([]);
    }
  });

  it('accepts a real target, and one that merely needs no trimming', async () => {
    // Falsification for the row above: a guard that refused everything would
    // satisfy it. `'account'` is the ordinary case; the guard trims only to
    // TEST, never to rewrite, so the value on the wire is what the author gave.
    const { refused, puts } = await puttable('account');
    expect(refused).toBe(false);
    expect(savedFields(puts)[0].reference).toBe('account');
  });

  it('does not rewrite a target that has surrounding whitespace but a real name', async () => {
    // `' account '` trims to a non-empty name, so the guard passes it — and
    // passes it THROUGH, unchanged. This writer's job is to refuse a draft, not
    // to normalise author input; silently trimming would be a WRITE the author
    // never made. The contract agrees, and says so in the same words:
    // objectstack#16920 trims for the TEST only, so a target with surrounding
    // whitespace is still accepted and still stored as written.
    const { refused, puts } = await puttable(' account ');
    expect(refused).toBe(false);
    expect(savedFields(puts)[0].reference).toBe(' account ');
  });

  it('the VERSION SKEW is CLOSED at THIS pin: 17.4.0 refuses `\'   \'` too, exactly as this writer does', async () => {
    // The writer half — true regardless of which spec is installed, and
    // unchanged by objectstack#16920. This is the row that must never move.
    const { refused } = await puttable('   ');
    expect(refused).toBe(true);

    // The spec half. This line read `.toBe(true)` while the pin was 17.3.0,
    // where #13632's emptiness test was an equality against `''`; it was written
    // as a TRIPWIRE for the day objectstack#16920 reached the pin, and
    // objectui#8772 is that day. Asserted as an ENVELOPE rather than a bare
    // `success === false`, because the two halves of the claim are separable: a
    // blank target must be refused, and refused AS a blank target — the same
    // `custom` issue at the same `reference` path the absent case draws, not an
    // `invalid_type` or some unrelated failure that would satisfy a bare false.
    const blank = FieldSchema.safeParse({ type: 'lookup', label: 'L', reference: '   ' });
    expect(blank.success).toBe(false);
    expect(blank.error!.issues.map((i) => i.code)).toContain('custom');
    expect(blank.error!.issues.map((i) => i.path.join('.'))).toContain('reference');

    // Non-vacuity for the refusal above: the schema has NOT simply become
    // hostile to every `reference`. A real name still parses green, and a name
    // that merely carries surrounding whitespace still does too — the trim is
    // for the TEST only, which is the same reading the writer's own
    // pass-it-through row above depends on.
    expect(FieldSchema.safeParse({ type: 'lookup', label: 'L', reference: 'account' }).success).toBe(true);
    expect(FieldSchema.safeParse({ type: 'lookup', label: 'L', reference: ' account ' }).success).toBe(true);

    // The absent case, which the blank case above now matches exactly — the
    // convergence stated as a measurement rather than asserted in prose.
    const absent = FieldSchema.safeParse({ type: 'lookup', label: 'L' });
    expect(absent.success).toBe(false);
    expect(absent.error!.issues.map((i) => i.code)).toContain('custom');

    // Value level rather than presence level: a non-string is refused as
    // `invalid_type` by the base schema before the refinement runs — a
    // different issue code from the blank case above, which is what makes
    // "refused as a blank target" a distinguishable verdict at all. Blankness
    // was simply not among the things the 17.3.0 test covered — the gap
    // objectstack#16126 reported and objectstack#16920 closed.
    const nonString = FieldSchema.safeParse({ type: 'lookup', label: 'L', reference: 42 });
    expect(nonString.success).toBe(false);
    expect(nonString.error!.issues.map((i) => i.code)).toContain('invalid_type');
  });
});

/**
 * objectui#7714 — the refusal DIAGNOSES the state it found.
 *
 * Split out because the single sentence this message used to carry ("…and this
 * one has none") is wrong for two of the four states, and a message that
 * prescribes the wrong repair is worse than a terse one: "pick the target
 * object" is not what fixes `reference: 42`.
 *
 * ⭐ The blank row is the one that MOVED, under objectui#8897. While the pin was
 * 17.3.0 the message said the spec ACCEPTS a whitespace-only target and so
 * withheld the 422 the other rows promise — a refusal that was honest then and
 * false the moment the pin reached objectstack#16920. The message now names the
 * TRIM instead, which is what still tells a blank target apart from an empty one
 * now that both are refused, and this row pins the corrected text. ⛔ The old
 * assertions (`/ACCEPTS this value/` and `not.toMatch(/422/)`) were not kept
 * green by keeping the false sentence: keeping a pin green is never a reason to
 * keep user-visible text that the artifact contradicts.
 */
describe('objectui#7714 · the refusal message distinguishes the four states', () => {
  const refusalFor = async (reference: unknown): Promise<string> => {
    const { adapter } = makeCapturingAdapter();
    try {
      await new MetadataService(adapter).saveFields('account', [
        { ...LOOKUP, referenceTo: reference } as DesignerFieldDefinition,
      ]);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    throw new Error(`expected a refusal for reference=${JSON.stringify(reference)}`);
  };

  it('absent → "has none", and names the 422 consequence', async () => {
    const m = await refusalFor(undefined);
    expect(m).toMatch(/has none/);
    expect(m).toMatch(/blocks EVERY later save of this object/);
  });

  it('empty string → "is empty", not "has none"', async () => {
    const m = await refusalFor('');
    expect(m).toMatch(/is empty/);
    expect(m).not.toMatch(/has none/);
  });

  it('non-string → names the KIND and `invalid_type`, and does not prescribe "supply a target"', async () => {
    const m = await refusalFor(42);
    expect(m).toMatch(/holds a number instead of an object name/);
    expect(m).toMatch(/invalid_type/);
    expect(m).not.toMatch(/has none/);
    // `null` is typeof 'object'; spelling it as "null" is the accurate word.
    expect(await refusalFor(null)).toMatch(/holds null instead of an object name/);
  });

  it('whitespace-only → names the TRIM the contract applies, and is not the "is empty" sentence', async () => {
    const m = await refusalFor('   ');
    expect(m).toMatch(/is blank/);
    // What replaced "the spec ACCEPTS this value": since 17.4.0 the contract
    // applies its non-empty test to the trimmed value, so this writer can now
    // promise the 422 it used to have to withhold here.
    expect(m).toMatch(/TRIMMED value/);
    expect(m).toMatch(/422/);
    expect(m).toMatch(/objectstack#16920/);
    // Falsification, and the reason the four-state split survives the merge of
    // the two refusals: blank must still not be rendered as either of the
    // states that carry a different repair.
    expect(m).not.toMatch(/is empty/);
    expect(m).not.toMatch(/has none/);
    // The retired claim must be GONE, not merely out-ranked by a new match.
    expect(m).not.toMatch(/ACCEPTS this value/);
    expect(m).not.toMatch(/would succeed/);
  });
});

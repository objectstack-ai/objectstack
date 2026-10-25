/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ THE RETIRED-DIALECT ARM — objectui#7650.
 *
 * The card measured that the object-schema SERVE path never parses, so
 * `FieldSchema` strictness is evidence about the WRITE door only: a document
 * stored before a key was tightened is served back verbatim, forever. Three
 * retirement cards (#7155, #7166, #7435) had already narrowed the consumer
 * reads to the camelCase spelling. This arm supplies the half that makes that
 * narrowing safe — the legacy spelling is canonicalised ONCE, at ingestion.
 *
 * ## What is pinned, and why each half is here
 *
 * The maintainer route ruling (comment 5605081157) chose the DERIVED fold — the
 * spec's own alias probe (lowercase, strip `_` `-` space) matched exactly
 * against `FieldSchema`'s declared key set — over a hand-written table, and
 * required the negative pins by name. The negatives are the load-bearing half:
 * an implementation that folded everything it could not recognise would pass
 * every positive assertion below.
 *
 *   - `id_field` is NOT folded. It has no declared successor (`FieldSchema` has
 *     no `idField`; the spec's only `idField` sits on `InlineGridColumnSchema`),
 *     and the spec's own `FIELD_KEY_GUIDANCE.id_field` row says so: a `why`, no
 *     `to`. The point of the derived rule is that the no-fold falls out of it
 *     for free rather than being written as a special case. The row reaches the
 *     DIAGNOSTIC only — pinned by the describe `the id_field diagnostic carries
 *     the PUBLISHED spec reason (objectui#7650)`.
 *   - `sortible`, a pure TYPO, is NOT folded. The refused alternative was to
 *     call the spec's `lintAuthoredRecordKeys` and fold on its `suggestion`:
 *     that function falls through to a Levenshtein matcher when no `to` row
 *     exists, so it answers "did you mean `sortable`?" for this very input. A
 *     serve path that silently corrects a typo is worse than the defect it fixes.
 *   - `title_format` is NOT folded. It is explicitly out of this card's scope
 *     (it needs an eight-key maintainer ruling), and it too lands there by the
 *     rule rather than by an exclusion.
 *
 * ## ⭐ THE THREE INVERTED PINS — objectui#8938
 *
 * Three assertions in this file used to read `expect(warn).not.toHaveBeenCalled()`,
 * which pinned the ABSENCE of maintainer ruling item 3's diagnostic (objectui#7650,
 * comment 5572018999: a loud diagnostic, not a silent drop, for a spelling the
 * choke point cannot fold). Each is now inverted in place and tightened rather
 * than removed — the negative behaviour each one guards (no fold, no typo
 * correction, no overwrite) is asserted exactly as before, and the refusal is
 * additionally required to be audible. The diagnostic's own surface — its three
 * refusals, its two deliberate silences and its memo — is pinned in the sibling
 * file named by the describe `the ruling’s diagnostic for a spelling the choke
 * point CANNOT fold (objectui#8938)`, together with the width measurement that
 * card asked for.
 *
 * ## The contract-derivation pins
 *
 * `describe('derives the fold from the contract, not from a table')` asserts the
 * rule against `FieldSchema` itself rather than against a copy of its key list:
 * every folded pair must be one the spec REFUSES in the legacy spelling and
 * ACCEPTS in the canonical one, with lit controls in the same read. Without
 * that, this file would be pinning the implementation's opinion of the contract
 * instead of the contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FIELD_KEY_GUIDANCE, FieldSchema } from '@objectstack/spec/data';
import {
  normalizeFieldReferenceKeys,
  normalizeSchemaReferenceKeys,
  resetReferenceKeyWarnings,
} from '../reference-keys';

/** The probe rule, restated here so the test does not import the implementation's copy. */
const probe = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetReferenceKeyWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

/** A field def with NO relationship target — the shape the reference arm skips. */
const plainField = (extra: Record<string, unknown>) => ({ type: 'text', ...extra });

describe('retired-dialect canonicalization — the three unblocked keys (objectui#7650)', () => {
  it('folds `display_field` onto `displayField`', () => {
    const f: Record<string, unknown> = plainField({ display_field: 'name' });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.displayField).toBe('name');
    // The legacy key is LEFT, not removed: dropping it would lose the value for
    // anything still reading it, and dropping was refused on this card.
    expect(f.display_field).toBe('name');
  });

  it('folds `description_field` onto `descriptionField`', () => {
    const f: Record<string, unknown> = plainField({ description_field: 'summary' });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.descriptionField).toBe('summary');
  });

  it('folds `lookup_filters` onto `lookupFilters`', () => {
    const filters = [{ field: 'is_active', operator: 'eq', value: true }];
    const f: Record<string, unknown> = plainField({ lookup_filters: filters });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    // The VALUE is carried across by reference, not cloned or reshaped.
    expect(f.lookupFilters).toBe(filters);
  });

  it('folds a twin the card never named — `lookup_columns` — because the rule is general', () => {
    // Not a widening chosen key by key: `lookupColumns` is a declared
    // `FieldSchema` key whose snake twin is in the same retired dialect, so the
    // one derived rule covers it. Pinned so the generality is a measured fact.
    const f: Record<string, unknown> = plainField({ lookup_columns: ['name'] });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.lookupColumns).toEqual(['name']);
  });

  it('runs on a def with NO relationship target', () => {
    // The regression this guards: the reference arm early-returns when there is
    // no `reference` / `reference_to` / `referenceTo`, and the retired dialect
    // lives mostly on fields that have none. Gating the new arm behind that
    // return would have covered almost nothing while passing a lookup-shaped
    // test.
    const f: Record<string, unknown> = plainField({ display_field: 'name' });
    expect(f.reference).toBeUndefined();
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.displayField).toBe('name');
  });

  it('reaches every field of a schema, in both container shapes', () => {
    const asMap = { name: 'account', fields: { owner: plainField({ display_field: 'a' }) } };
    const asArray = { name: 'lead', fields: [plainField({ name: 'owner', display_field: 'b' })] };
    normalizeSchemaReferenceKeys(asMap);
    normalizeSchemaReferenceKeys(asArray);
    expect((asMap.fields.owner as Record<string, unknown>).displayField).toBe('a');
    expect((asArray.fields[0] as Record<string, unknown>).displayField).toBe('b');
  });
});

describe('the NEGATIVE pins the ruling required (objectui#7650)', () => {
  it('does NOT fold `id_field` — no declared successor', () => {
    const f: Record<string, unknown> = plainField({ id_field: 'code' });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.idField).toBeUndefined();
    expect(f.id_field).toBe('code');
    // objectui#8938: this asserted `warn` was NOT called, and that silence was
    // the defect — maintainer ruling item 3 (objectui#7650, comment 5572018999)
    // asked for a loud diagnostic on exactly the spelling the choke point
    // cannot fold, and `id_field` is its type case. The pin is not dropped, it
    // is INVERTED and tightened: the fold must still not happen (the two
    // assertions above) and the refusal must now be audible.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('CANNOT');
    expect(String(warn.mock.calls[0]?.[0])).toContain('id_field');
  });

  it('does NOT fold a TYPO — `sortible` never becomes `sortable`', () => {
    const f: Record<string, unknown> = plainField({ sortible: true });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.sortable).toBeUndefined();
    expect(f.sortible).toBe(true);
    // objectui#8938: was `not.toHaveBeenCalled()`. A typo is a spelling the
    // choke point cannot fold, so the ruling's diagnostic covers it too — and
    // the assertion below is the load-bearing half of this test's own point:
    // the message says it cannot fold `sortible` and ⛔ never names `sortable`,
    // because a serve path that suggests a correction is one revision away from
    // applying it.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('sortible');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('sortable');
  });

  it('does NOT fold `title_format` — out of this card, and out of the rule', () => {
    const f: Record<string, unknown> = plainField({ title_format: '{name}' });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.titleFormat).toBeUndefined();
    expect(f.title_format).toBe('{name}');
  });

  it('never OVERWRITES a canonical key the producer already set', () => {
    const f: Record<string, unknown> = plainField({
      display_field: 'legacy_name',
      displayField: 'canonical_name',
    });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.displayField).toBe('canonical_name');
    expect(f.display_field).toBe('legacy_name');
    // objectui#8938: was `not.toHaveBeenCalled()`. The producer's value still
    // stands — that is what the two assertions above pin, and it is unchanged —
    // but the retired spelling beside it reaches no consumer of the declared
    // spelling (a kept snake read can still see it — objectui#7650), and that
    // was the third silent refusal. The diagnostic names the occupied canonical key;
    // the behaviour here is untouched.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('CANNOT');
    expect(String(warn.mock.calls[0]?.[0])).toContain('displayField');
  });

  it('is idempotent — a second pass changes nothing and does not warn twice', () => {
    const f: Record<string, unknown> = plainField({ display_field: 'name' });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    const afterFirst = JSON.stringify(f);
    const warnsAfterFirst = warn.mock.calls.length;
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(JSON.stringify(f)).toBe(afterFirst);
    expect(warn.mock.calls.length).toBe(warnsAfterFirst);
  });

  it('leaves a DECLARED key alone — it is never itself a fold source', () => {
    // objectui#8938: the title used to say "even when a snake twin of it exists
    // on the def", and no twin is on this def — the same declared-versus-measured
    // drift the card is about, one file down. The fixture is what it always was.
    // `displayField` is declared, so it is never itself a fold SOURCE. Without
    // this the pass could re-enter on its own output.
    const f: Record<string, unknown> = plainField({ displayField: 'name' });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(Object.keys(f).sort()).toEqual(['displayField', 'type']);
  });
});

describe('the dev-mode warning (objectui#7650)', () => {
  it('names the object, the field, the retired spelling and the canonical one', () => {
    const f: Record<string, unknown> = plainField({ display_field: 'name' });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('account');
    expect(message).toContain('owner');
    expect(message).toContain('display_field');
    expect(message).toContain('displayField');
    expect(message).toContain('objectui#7650');
  });

  it('warns once per (object, field, spelling) and separately for a second object', () => {
    const a: Record<string, unknown> = plainField({ display_field: 'name' });
    normalizeFieldReferenceKeys(a, 'owner', 'account');
    normalizeFieldReferenceKeys(plainField({ display_field: 'name' }), 'owner', 'account');
    expect(warn).toHaveBeenCalledTimes(1);
    normalizeFieldReferenceKeys(plainField({ display_field: 'name' }), 'owner', 'contact');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('the id_field diagnostic carries the PUBLISHED spec reason (objectui#7650)', () => {
  // Every read of the row below is unconditional — no `?.` — and ⛔ no copy of
  // its prose lives in this file: each pin reads the installed spec at run time.

  it('the installed row is a retirement — a `why`, and no `to`', () => {
    const { why, to } = FIELD_KEY_GUIDANCE.id_field;
    expect(typeof why).toBe('string');
    expect((why as string).trim().length).toBeGreaterThan(0);
    // No `to`: the spec names no successor, which is why the fold leaves the key
    // alone. A `to` appearing here reopens the route, not just this diagnostic.
    expect(to).toBeUndefined();
  });

  it('the `no-declared-twin` line for `id_field` carries that `why`, and the key is still not folded', () => {
    const why = FIELD_KEY_GUIDANCE.id_field.why as string;
    const f: Record<string, unknown> = plainField({ id_field: 'code' });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.idField).toBeUndefined();
    expect(f.id_field).toBe('code');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('CANNOT');
    expect(message).toContain(why);
  });

  it('the reason is read off the spec module when the line is built — not from a copy', async () => {
    // A local copy of the prose would pass the pin above verbatim. Substituting
    // the row is what tells the two apart: the line must carry whatever the spec
    // module publishes, and none of the installed sentence.
    const installed = FIELD_KEY_GUIDANCE.id_field.why as string;
    const substituted = 'SUBSTITUTED reason, published by a stand-in spec module.';
    vi.resetModules();
    vi.doMock('@objectstack/spec/data', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@objectstack/spec/data')>()),
      FIELD_KEY_GUIDANCE: { id_field: { why: substituted } },
    }));
    try {
      const fresh = await import('../reference-keys');
      fresh.normalizeFieldReferenceKeys(plainField({ id_field: 'code' }), 'owner', 'account');
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain(substituted);
      expect(message).not.toContain(installed);
    } finally {
      vi.doUnmock('@objectstack/spec/data');
      vi.resetModules();
    }
  });

  it('a spec WITHOUT the row fails loudly in dev instead of warning with less, and production never reads it', async () => {
    vi.resetModules();
    vi.doMock('@objectstack/spec/data', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@objectstack/spec/data')>()),
      FIELD_KEY_GUIDANCE: {},
    }));
    try {
      const fresh = await import('../reference-keys');
      // ⛔ No optional read and no fallback sentence: what objectui#7650 refused
      // is exactly a diagnostic that quietly degrades on an older spec.
      const call = () =>
        fresh.normalizeFieldReferenceKeys(plainField({ id_field: 'code' }), 'owner', 'account');
      expect(call).toThrow(TypeError);
      // The throw comes before the memo is taken, so it does not go quiet on
      // the second read of the same def.
      expect(call).toThrow(TypeError);
      expect(warn).not.toHaveBeenCalled();
      // CONTROL for the two throws above, on the same stand-in module: the read
      // sits on the dev-only emitting path, so production never reaches it.
      vi.stubEnv('NODE_ENV', 'production');
      const f: Record<string, unknown> = plainField({ id_field: 'code' });
      expect(() => fresh.normalizeFieldReferenceKeys(f, 'owner', 'account')).not.toThrow();
      expect(f.id_field).toBe('code');
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('@objectstack/spec/data');
      vi.resetModules();
    }
  });

  it('the `id_field` line never claims NO reader sees the value — kept snake reads do', () => {
    // `resolveActionParam` (fields) reads `id_field` on purpose — objectui#7435
    // kept it — and `resolveGroupByLabels` (plugin-charts) reads it too. So the
    // line may only speak for the consumers of the declared spellings.
    normalizeFieldReferenceKeys(plainField({ id_field: 'code' }), 'owner', 'account');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).not.toContain('reaches no reader');
    // LIT, same line: it still closes on a claim about readers, so the negative
    // above is not satisfied by a line that merely lost its closing clause.
    expect(message).toContain('a consumer that reads only the spellings');
    expect(message).toContain('will not see this value');
  });

  it('CONTROL — the scoped claim is kept where it is true, beside the fact it states', () => {
    // Occupied canonical: the declared spelling carries the PRODUCER's value, so
    // a consumer of the declared spelling really does not see the retired one.
    const occupied: Record<string, unknown> = plainField({
      display_field: 'legacy_name',
      displayField: 'canonical_name',
    });
    normalizeFieldReferenceKeys(occupied, 'owner', 'account');
    expect(occupied.displayField).toBe('canonical_name');
    // A typo: no declared spelling carries it at all.
    const typo: Record<string, unknown> = plainField({ sortible: true });
    normalizeFieldReferenceKeys(typo, 'owner', 'account');
    expect(typo.sortable).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    for (const call of warn.mock.calls) {
      expect(String(call[0])).toContain('will not see this value');
    }
  });

  it('a TYPO still gets no suggestion — and not the `id_field` reason either', () => {
    const why = FIELD_KEY_GUIDANCE.id_field.why as string;
    const f: Record<string, unknown> = plainField({ sortible: true });
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.sortable).toBeUndefined();
    expect(f.sortible).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('sortible');
    expect(message).not.toContain('sortable');
    expect(message).not.toContain(why);
  });
});

describe('derives the fold from the contract, not from a table (objectui#7650)', () => {
  const declared = Object.keys(FieldSchema.shape as Record<string, unknown>);

  it('reads a non-trivial declared key set — the instrument is not dark', () => {
    expect(declared.length).toBeGreaterThan(50);
    expect(declared).toContain('displayField');
    expect(declared).toContain('descriptionField');
    expect(declared).toContain('lookupFilters');
  });

  it('has NO probe collision among declared keys — the precondition of the guard', () => {
    // The implementation folds nothing onto an ambiguous probe. That branch is
    // unreachable while this holds; when it stops holding, this pin says so
    // before the guard has to.
    const byProbe = new Map<string, string[]>();
    for (const key of declared) {
      const p = probe(key);
      byProbe.set(p, [...(byProbe.get(p) ?? []), key]);
    }
    const collisions = [...byProbe.entries()].filter(([, keys]) => keys.length > 1);
    expect(collisions).toEqual([]);
  });

  it.each([
    ['display_field', 'displayField', 'name'],
    ['description_field', 'descriptionField', 'summary'],
    ['lookup_filters', 'lookupFilters', []],
    ['lookup_columns', 'lookupColumns', []],
  ])('the spec REFUSES %s and ACCEPTS %s', (legacy, canonical, value) => {
    const base = { type: 'lookup', reference: 'user' };
    const refused = FieldSchema.safeParse({ ...base, [legacy]: value });
    const accepted = FieldSchema.safeParse({ ...base, [canonical]: value });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    expect(accepted.success).toBe(true);
  });

  it('LIT CONTROLS for the pair above — a bare def parses, a nonsense key does not', () => {
    // Without these, the "REFUSES" half above is satisfied by a schema that
    // refuses everything and the "ACCEPTS" half by one that accepts everything.
    expect(FieldSchema.safeParse({ type: 'lookup', reference: 'user' }).success).toBe(true);
    expect(
      FieldSchema.safeParse({ type: 'lookup', reference: 'user', zzz_not_a_real_key: 1 }).success,
    ).toBe(false);
  });

  it.each(['id_field', 'title_format', 'sortible'])(
    'the LEAVE arm is contract-derived too — %s probes onto no declared key',
    (key) => {
      expect(declared.map(probe)).not.toContain(probe(key));
    },
  );

  it('the reference pair stays OUT of the derived arm — it has its own', () => {
    // `referenceTo` is not a declared key, so `reference_to` probes onto
    // nothing and the derived arm ignores it. The reference fold below is the
    // separate, older mechanism, and this pin keeps the two from double-handling.
    expect(declared.map(probe)).not.toContain(probe('reference_to'));
    const f: Record<string, unknown> = { type: 'lookup', reference_to: 'user' };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.reference).toBe('user');
    expect(f.reference_to).toBe('user');
  });
});

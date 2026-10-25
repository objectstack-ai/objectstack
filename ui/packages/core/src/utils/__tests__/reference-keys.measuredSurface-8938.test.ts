/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ THE MEASURED SURFACE OF THE RETIRED-DIALECT FOLD — objectui#8938.
 *
 * objectui#8873 landed the fold at the ingestion choke point per the route
 * ruling, losslessly. What it declared was not what it measured: the changeset,
 * the pull request body and the acceptance all presented a handful of keys as
 * the accepted set, while the fold derives its width at RUN TIME from
 * `FieldSchema.shape` and folds the snake twin of every declared key that has
 * one — the gate keys (`visible_when` / `readonly_when` / `required_when`),
 * `default_value`, `required_permissions`, `delete_behavior`, `external_id`,
 * `depends_on`, and the managed-by lock keys `_lock_*` / `_package_id` /
 * `_package_version` among them.
 *
 * ## Why this file does not write the number down
 *
 * A count in prose is derived once and derived never again (AGENTS.md #9), and
 * this card exists because exactly that happened. So the correction states the
 * RULE and points at this file, and the pins below re-derive the surface from
 * the linked spec on every run:
 *
 *   - the width pin is UNIVERSALLY QUANTIFIED over `FieldSchema`'s declared key
 *     set. Add a camel key to the spec and this file demands its snake twin
 *     fold, with no edit here; replace the derivation with a hand table and it
 *     goes red on the first key the table forgets.
 *   - the enumerated keys of the original declaration are asserted to be a
 *     STRICT SUBSET, so "these four are the accepted set" can never read true
 *     again.
 *
 * ⛔ This file records the width; it does not rule on it. Whether the full
 * width — lock and gate keys included — is intended is the open decision on
 * objectui#8938 (c), which belongs to the director seat on objectui#7650.
 * Narrowing the fold means editing the class pins below on purpose, which is
 * the point of having them.
 *
 * ## The diagnostic — maintainer ruling item 3 (objectui#7650, comment 5572018999)
 *
 * "A loud diagnostic (not a silent drop) for a spelling the choke point cannot
 * fold." The fold's own warning covers the spelling it CAN fold; the three
 * refusals — no declared twin, an ambiguous probe, an occupied canonical key —
 * were silent, and each of them ends with a value no consumer reads. The pins
 * below measure all three, plus the two silences that must stay silent: a
 * spelling that folded (that is the other warning's case) and the reference
 * arm's own keys (that is objectui#6837's).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import {
  normalizeFieldReferenceKeys,
  normalizeSchemaReferenceKeys,
  resetReferenceKeyWarnings,
} from '../reference-keys';

/** The spec's alias probe, restated so this file does not import the implementation's copy. */
const probe = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');

/** The snake spelling of a declared camel key — a SPELLING rule, never a key list. */
const snakeTwin = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

const declared = Object.keys(FieldSchema.shape as Record<string, unknown>);

/**
 * Every declared key whose snake spelling is a DIFFERENT key the spec does not
 * declare — i.e. every snake twin this choke point folds. Derived from the
 * linked spec on every run; this is the width.
 */
const foldingTwins: ReadonlyArray<readonly [string, string]> = declared
  .map((key) => [key, snakeTwin(key)] as const)
  .filter(([key, twin]) => twin !== key && !declared.includes(twin));

/**
 * The keys the original changeset enumerated when it presented the accepted set.
 * A historical fact about that text, not a measurement — it is here only so the
 * pins can assert the measured set is strictly WIDER than it.
 */
const ENUMERATED_BY_THE_ORIGINAL_DECLARATION = [
  'display_field',
  'description_field',
  'lookup_filters',
  'lookup_columns',
] as const;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetReferenceKeyWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  resetReferenceKeyWarnings();
});

const messages = (): string[] => warn.mock.calls.map((c: unknown[]) => String(c[0]));

describe('the fold WIDTH is measured against the linked spec (objectui#8938)', () => {
  it('the instrument is not dark — the spec is read, and it implies twins to fold', () => {
    // Without this, every universally quantified pin below is satisfied by an
    // empty key set: a vacuous green that reads exactly like a passing measurement.
    expect(declared.length).toBeGreaterThan(50);
    expect(foldingTwins.length).toBeGreaterThan(0);
    // The twin spelling must land on its key's probe, or the derivation here is
    // measuring something the implementation never looks up.
    for (const [key, twin] of foldingTwins) expect(probe(twin)).toBe(probe(key));
  });

  it('the width IS the spec’s declared key set, not a list anyone typed', () => {
    // One def carrying every twin the live spec implies, driven through the
    // public choke point. A hand-written table passes this only for as long as
    // nobody adds a key to `FieldSchema`.
    const def: Record<string, unknown> = { type: 'text' };
    for (const [, twin] of foldingTwins) def[twin] = `v:${twin}`;
    normalizeSchemaReferenceKeys({ name: 'measured', fields: { probe_field: def } });
    for (const [canonical, twin] of foldingTwins) expect(def[canonical]).toBe(`v:${twin}`);
    // Lossless: the retired spelling is still on the def, every one of them.
    for (const [, twin] of foldingTwins) expect(def[twin]).toBe(`v:${twin}`);
  });

  it('NEGATIVE CONTROL — an undeclared key with no declared twin is still not folded', () => {
    // Without this, an implementation that stamped every key it saw would pass
    // the width pin above.
    const def: Record<string, unknown> = { type: 'text', zzz_not_a_real_key: 1 };
    normalizeFieldReferenceKeys(def, 'owner', 'account');
    expect(Object.keys(def).sort()).toEqual(['type', 'zzz_not_a_real_key']);
  });

  it('the keys the original declaration enumerated are a STRICT SUBSET of the measured width', () => {
    const twins = foldingTwins.map(([, twin]) => twin);
    for (const key of ENUMERATED_BY_THE_ORIGINAL_DECLARATION) expect(twins).toContain(key);
    expect(twins.length).toBeGreaterThan(ENUMERATED_BY_THE_ORIGINAL_DECLARATION.length);
  });

  it('the classes that declaration never named are inside the measured width', () => {
    // ⛔ Not a ruling that they SHOULD be — objectui#8938 (c) is the open
    // decision on that, and it is the director seat's. This pin makes the
    // subject of that decision a measured fact instead of a sentence, and makes
    // any later narrowing a deliberate edit here rather than a quiet drift.
    const twins = foldingTwins.map(([, twin]) => twin);
    for (const key of [
      'visible_when',
      'readonly_when',
      'required_when',
      'default_value',
      'required_permissions',
      'delete_behavior',
      'external_id',
      'depends_on',
      '_lock_reason',
      '_package_id',
      '_package_version',
    ]) {
      expect(twins).toContain(key);
    }
  });

  it('a gate key and a lock key really do arrive canonical through the choke point', () => {
    // The membership pin above reads the spec; this one reads the BEHAVIOUR, so
    // the two cannot drift apart.
    const schema = {
      name: 'crm_account',
      fields: {
        stage: { type: 'text', visible_when: '${data.stage}', _package_id: 'pkg_crm' },
      },
    };
    normalizeSchemaReferenceKeys(schema);
    const f = schema.fields.stage as Record<string, unknown>;
    expect(f.visibleWhen).toBe('${data.stage}');
    expect(f._packageId).toBe('pkg_crm');
  });
});

describe('the ruling’s diagnostic for a spelling the choke point CANNOT fold (objectui#8938)', () => {
  it('speaks up for a key with NO declared twin — `id_field`, and leaves it exactly as served', () => {
    const f: Record<string, unknown> = { type: 'text', id_field: 'code' };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.idField).toBeUndefined();
    expect(f.id_field).toBe('code');
    expect(warn).toHaveBeenCalledTimes(1);
    const m = messages()[0] as string;
    expect(m).toContain('CANNOT');
    expect(m).toContain('`account`');
    expect(m).toContain('`owner`');
    expect(m).toContain('id_field');
    expect(m).toContain('objectui#8938');
  });

  it('⛔ never offers a near match for a TYPO — it says it cannot fold `sortible`, not "did you mean"', () => {
    // The refused alternative on objectui#7650 was the spec's
    // `lintAuthoredRecordKeys`, which falls through to a Levenshtein matcher and
    // answers "did you mean `sortable`?" here. A diagnostic that names a
    // correction is one revision away from applying it on a serve path.
    const f: Record<string, unknown> = { type: 'text', sortible: true };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.sortable).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain('sortible');
    expect(messages()[0]).not.toContain('sortable');
  });

  it('speaks up when the canonical key is OCCUPIED — the retired value is inert, and that was silent', () => {
    const f: Record<string, unknown> = {
      type: 'text',
      display_field: 'legacy_name',
      displayField: 'canonical_name',
    };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    // Behaviour unchanged: the producer's value stands and nothing is dropped.
    expect(f.displayField).toBe('canonical_name');
    expect(f.display_field).toBe('legacy_name');
    expect(warn).toHaveBeenCalledTimes(1);
    const m = messages()[0] as string;
    expect(m).toContain('CANNOT');
    expect(m).toContain('display_field');
    expect(m).toContain('displayField');
    expect(m).toContain('never overwrites');
  });

  it('names the colliding declared keys when the probe is AMBIGUOUS', async () => {
    // `FieldSchema` has no probe collision today — the sibling pin
    // `has NO probe collision among declared keys — the precondition of the guard`
    // asserts that against the real spec — so this refusal is unreachable
    // without substituting a colliding shape. Unexercised, the guard could
    // report a collision as an unrecognised spelling and nobody would know.
    vi.resetModules();
    vi.doMock('@objectstack/spec/data', () => ({
      FieldSchema: { shape: { type: {}, visibleWhen: {}, visible_when: {} } },
    }));
    try {
      const fresh = await import('../reference-keys');
      const f: Record<string, unknown> = { type: 'text', 'visible-when': '${data.x}' };
      fresh.normalizeFieldReferenceKeys(f, 'owner', 'account');
      // The guard still folds NOTHING — this slice adds the sentence, not a choice.
      expect(f.visibleWhen).toBeUndefined();
      expect(f.visible_when).toBeUndefined();
      expect(f['visible-when']).toBe('${data.x}');
      expect(warn).toHaveBeenCalledTimes(1);
      const m = messages()[0] as string;
      expect(m).toContain('MORE THAN ONE');
      expect(m).toContain('visibleWhen');
      expect(m).toContain('visible_when');
    } finally {
      vi.doUnmock('@objectstack/spec/data');
      vi.resetModules();
    }
  });
});

describe('the two silences the diagnostic must KEEP (objectui#8938)', () => {
  it('⛔ does NOT fire on a spelling that DID fold — that is the other warning’s case', () => {
    // Firing here too would report a def that works exactly as loudly as one
    // that does not, which is the failure the fold's own warning already covers.
    const f: Record<string, unknown> = { type: 'text', display_field: 'name' };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.displayField).toBe('name');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain('carries the retired spelling');
    expect(messages()[0]).not.toContain('CANNOT');
  });

  it('⛔ does NOT fire for `reference_to` / `referenceTo` — the reference arm owns those', () => {
    // Both probe onto no declared key, so without the exclusion each would be
    // reported as unfoldable in the same breath as the reference arm folding it.
    const f: Record<string, unknown> = { type: 'lookup', reference_to: 'crm_account' };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(f.reference).toBe('crm_account');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain('objectui#6837');
    expect(messages()[0]).not.toContain('CANNOT');

    resetReferenceKeyWarnings();
    warn.mockClear();
    const g: Record<string, unknown> = { type: 'lookup', referenceTo: 'crm_account' };
    normalizeFieldReferenceKeys(g, 'owner', 'account');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(messages()[0]).not.toContain('CANNOT');
  });

  it('⛔ does NOT fire on the canonical THIS PASS stamped — a second run is not a producer conflict', () => {
    // The adapter re-serves a cached schema and `MetadataProvider`
    // re-normalizes on every metadata refresh, so every folded def is
    // re-examined with its canonical key already set — by this pass, carrying
    // the very same value by reference. Reporting that state would turn the
    // diagnostic into a line per folded field per refresh. The occupied-canonical
    // refusal is therefore about a DIFFERENT value, not about an occupied key.
    const f: Record<string, unknown> = { type: 'text', display_field: 'name' };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    const afterFirst = warn.mock.calls.length;
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(warn.mock.calls.length).toBe(afterFirst);
    expect(messages().join('\n')).not.toContain('CANNOT');
  });

  it('⛔ does NOT fire when both spellings carry the SAME value — nothing is being lost', () => {
    const f: Record<string, unknown> = { type: 'text', display_field: 'name', displayField: 'name' };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(warn).not.toHaveBeenCalled();
  });

  it('⛔ does NOT fire for an undeclared key carrying `undefined` — no value, no lost read', () => {
    const f: Record<string, unknown> = { type: 'text', id_field: undefined };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(warn).not.toHaveBeenCalled();
  });

  it('is silent under NODE_ENV=production, and the def comes out identical', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const f: Record<string, unknown> = { type: 'text', id_field: 'code', display_field: 'name' };
      normalizeFieldReferenceKeys(f, 'owner', 'account');
      expect(warn).not.toHaveBeenCalled();
      // The diagnostic is a dev affordance; the fold is the contract.
      expect(f.displayField).toBe('name');
      expect(f.id_field).toBe('code');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('flood control for the diagnostic — a console that scrolls is one nobody reads (objectui#8938)', () => {
  it('fires once per (object, field, spelling) and again for a SECOND object', () => {
    normalizeSchemaReferenceKeys({ name: 'crm_account', fields: { owner: { type: 'text', id_field: 'a' } } });
    normalizeSchemaReferenceKeys({ name: 'crm_account', fields: { owner: { type: 'text', id_field: 'a' } } });
    expect(warn).toHaveBeenCalledTimes(1);
    normalizeSchemaReferenceKeys({ name: 'crm_contact', fields: { owner: { type: 'text', id_field: 'a' } } });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(messages().join('\n')).toContain('`crm_contact`');
  });

  it('the REASON is in the memo — one field refused for two different reasons gets two lines', () => {
    // Collapse the reason out of the key and the second line disappears, taking
    // the occupied-canonical fix with it.
    const f: Record<string, unknown> = {
      type: 'text',
      id_field: 'code',
      display_field: 'legacy',
      displayField: 'canonical',
    };
    normalizeFieldReferenceKeys(f, 'owner', 'account');
    expect(warn).toHaveBeenCalledTimes(2);
    const all = messages().join('\n');
    expect(all).toContain('id_field');
    expect(all).toContain('display_field');
  });

  it('a def with no object in scope warns under a placeholder rather than merging into a real object', () => {
    normalizeFieldReferenceKeys({ type: 'text', id_field: 'code' }, 'owner');
    expect(messages()[0]).toContain('(unknown object)');
  });
});

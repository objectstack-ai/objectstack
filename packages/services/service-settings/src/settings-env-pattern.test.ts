// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6580 — the env door enforces `pattern`, at the ONE decision point.
 *
 * `pattern` was the last declared constraint family judged on one door only:
 * `validatePatch` refused a shape-illegal value (`invalid_format`) while
 * `effectiveEnvOverride` let the same value through an `OS_*` override and
 * pinned the key (`locked: true`) on top of it — #5204's original asymmetry,
 * one family later. Both doors now call the same helpers (`declaredPattern` /
 * `firstPatternMiss`), so the comparison cannot drift between them again.
 *
 * Every fixture here is SYNTHETIC on purpose: #6579 is retuning
 * `company.manifest.ts` (`company.country` gains `valueDomain`) in parallel,
 * so these tests must not depend on any shipped manifest's declarations
 * landing in either order.
 */

import { describe, expect, it } from 'vitest';
import { SettingsService } from './settings-service.js';
import { SettingsManifestSchema } from '@objectstack/spec/system';

const spyLogger = () => {
  const errors: string[] = [];
  return { errors, logger: { error: (m: string) => void errors.push(m) } };
};

/** One key, one declared constraint: `pattern` and nothing else. */
const patternOnlyManifest = {
  namespace: 'pattern_lab',
  version: 1,
  label: 'Pattern Lab',
  scope: 'global',
  specifiers: [
    { type: 'text', key: 'code', label: 'Code', pattern: '^[A-Za-z]{2}$', default: 'US' },
  ],
} as any;

/**
 * A pattern that does not compile (`[` is an unterminated character class).
 * The write gate has always answered this with "nothing to enforce" rather
 * than a refusal or a crash; the env door must inherit exactly that tolerance,
 * because both doors now obtain the declaration through `declaredPattern`.
 */
const invalidPatternManifest = {
  namespace: 'pattern_tolerance',
  version: 1,
  label: 'Pattern Tolerance',
  scope: 'global',
  specifiers: [
    { type: 'text', key: 'freeform', label: 'Freeform', pattern: '[', default: 'anything' },
  ],
} as any;

/**
 * Keys that declare `pattern` AND a second family, to pin the ordering
 * between doors: options (when no domain) → pattern → valueDomain → bounds.
 * A value that breaks several declarations must be rejected for the SAME
 * reason at both doors, not merely rejected at both.
 */
const orderingManifest = {
  namespace: 'pattern_order',
  version: 1,
  label: 'Pattern Ordering',
  scope: 'global',
  specifiers: [
    // pattern + length window: `^[a-z]+$` and `minLength: 5`.
    { type: 'text', key: 'slug', label: 'Slug', pattern: '^[a-z]+$', minLength: 5, default: 'validslug' },
    // pattern + standard value domain: shape says two letters, membership says
    // an ASSIGNED two letters — `ZZ` satisfies the pattern and not the domain.
    {
      type: 'text', key: 'country_like', label: 'Country-like',
      pattern: '^[A-Za-z]{2}$', valueDomain: 'iso_3166_alpha2', default: 'US',
    },
  ],
} as any;

describe('synthetic fixtures are spec-valid authoring surfaces', () => {
  it('pattern_lab / pattern_order parse under SettingsManifestSchema', () => {
    // The guard that keeps these tests honest: a fixture spelling a key the
    // schema rejects would pin behaviour no author can reach. (The
    // invalid-RegExp fixture is deliberately NOT parsed here — `pattern: '['`
    // is type-valid to Zod, which does not compile patterns; the tolerance
    // under test is the service's, not the schema's.)
    expect(() => SettingsManifestSchema.parse(patternOnlyManifest)).not.toThrow();
    expect(() => SettingsManifestSchema.parse(orderingManifest)).not.toThrow();
  });
});

describe('env door — OS_* overrides are judged against the declared pattern (#6580)', () => {
  it('ignores a pattern-illegal override loudly and resolves the next cascade layer', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_PATTERN_LAB_CODE: 'ZZZ9' }, logger });
    svc.registerManifest(patternOnlyManifest);

    const r = await svc.get('pattern_lab', 'code');
    expect(r.value).toBe('US'); // the manifest default, not the override
    expect(r.source).toBe('default');
    // Not in force, so it pins nothing either — read and write agree (#5204).
    expect(r.locked).toBe(false);
    expect(r.cascadeChain?.some((e) => e.scope === 'env')).toBe(false);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_PATTERN_LAB_CODE');
    expect(errors[0]).toContain('does not match the declared pattern');
    expect(errors[0]).toContain("Rejected value: 'ZZZ9'");
    expect(errors[0]).toContain('^[A-Za-z]{2}$'); // the declaration, for the operator
    expect(errors[0]).toContain('IGNORED');
    expect(errors[0]).toContain('does NOT take effect');
  });

  it('a pattern-legal override still wins the cascade and locks the key', async () => {
    // The regression pin for the untouched path — the check must not turn
    // into "env never applies to a pattern-bearing key".
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_PATTERN_LAB_CODE: 'CH' }, logger });
    svc.registerManifest(patternOnlyManifest);

    const r = await svc.get('pattern_lab', 'code');
    expect(r.value).toBe('CH');
    expect(r.source).toBe('env');
    expect(r.locked).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('reports the misconfiguration at registration, and says it ONCE', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_PATTERN_LAB_CODE: 'ZZZ9' }, logger });
    expect(errors).toHaveLength(0);
    svc.registerManifest(patternOnlyManifest);
    expect(errors).toHaveLength(1); // a pattern-bearing key is walked at boot
    for (let i = 0; i < 5; i++) await svc.get('pattern_lab', 'code');
    await svc.getNamespace('pattern_lab');
    expect(errors).toHaveLength(1); // said ONCE (#5204 dedupe)
  });

  it('a REJECTED override pins nothing — the key stays editable', async () => {
    // #5204's `locked` coherence rule, inherited for free BECAUSE the pattern
    // is judged at the one point: a key configurable by nothing (env ignored,
    // UI refused) would be a lockout only an env edit could clear.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: { OS_PATTERN_LAB_CODE: 'ZZZ9' }, logger });
    svc.registerManifest(patternOnlyManifest);

    expect((await svc.get('pattern_lab', 'code')).locked).toBe(false);
    await expect(svc.setMany('pattern_lab', { code: 'DE' })).resolves.toBeDefined();
    const after = await svc.get('pattern_lab', 'code');
    expect(after.value).toBe('DE');
    expect(after.source).toBe('global');
  });
});

describe('write door — the #6580 hoist changes nothing at PUT /api/settings/:ns', () => {
  it('still refuses the same value as invalid_format with constraint.pattern', async () => {
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: {}, logger });
    svc.registerManifest(patternOnlyManifest);

    let caught: any;
    try {
      await svc.setMany('pattern_lab', { code: 'ZZZ9' });
    } catch (e) {
      caught = e;
    }
    // Rejection-class case: assert the envelope, not the throw. The service
    // layer's envelope is `code` + `fields[]` (the HTTP status mapping is
    // pinned in envelope.conformance.test.ts).
    expect(caught).toBeDefined();
    expect(caught.code).toBe('SETTINGS_VALIDATION');
    expect(caught.fields).toHaveLength(1);
    expect(caught.fields[0]).toMatchObject({
      field: 'code',
      code: 'invalid_format',
      constraint: { pattern: '^[A-Za-z]{2}$' },
    });
    expect(caught.fields[0].message).toContain('does not match the expected format');
    // The pre-#6580 branch never echoed the value on invalid_format —
    // byte-for-byte means byte-for-byte.
    expect(caught.fields[0]).not.toHaveProperty('value');

    await expect(svc.setMany('pattern_lab', { code: 'FR' })).resolves.toBeDefined();
  });
});

describe('invalid-RegExp declaration — the shared tolerance, pinned on both doors', () => {
  it('registration does not crash, and the env door enforces nothing', async () => {
    const { errors, logger } = spyLogger();
    const svc = new SettingsService({
      env: { OS_PATTERN_TOLERANCE_FREEFORM: '!!not a match for anything!!' }, logger,
    });
    expect(() => svc.registerManifest(invalidPatternManifest)).not.toThrow();

    // Nothing to enforce, so the override is simply in force — unchanged
    // pre-#6580 behaviour for an uncompilable declaration.
    const r = await svc.get('pattern_tolerance', 'freeform');
    expect(r.value).toBe('!!not a match for anything!!');
    expect(r.source).toBe('env');
    expect(r.locked).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('the write door tolerates it identically — no enforcement, no crash', async () => {
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: {}, logger });
    svc.registerManifest(invalidPatternManifest);
    await expect(
      svc.setMany('pattern_tolerance', { freeform: '!!still not a match!!' }),
    ).resolves.toBeDefined();
    expect((await svc.get('pattern_tolerance', 'freeform')).value).toBe('!!still not a match!!');
  });
});

describe('family ordering agrees between doors: options → pattern → valueDomain → bounds', () => {
  it('pattern vs length window: a value breaking both is a pattern miss at BOTH doors', async () => {
    // 'A2' misses `^[a-z]+$` AND sits under `minLength: 5`. The write door has
    // always let `pattern` speak before the window; the env door must name the
    // same family for the same value.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: {}, logger });
    svc.registerManifest(orderingManifest);
    await expect(svc.setMany('pattern_order', { slug: 'A2' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'slug', code: 'invalid_format', constraint: { pattern: '^[a-z]+$' } }],
    });

    const { errors, logger: envLogger } = spyLogger();
    const env = new SettingsService({ env: { OS_PATTERN_ORDER_SLUG: 'A2' }, logger: envLogger });
    env.registerManifest(orderingManifest);
    expect((await env.get('pattern_order', 'slug')).source).toBe('default');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('does not match the declared pattern');
    expect(errors[0]).not.toContain('length');
  });

  it('…and a pattern-legal value still falls to the window family, at BOTH doors', async () => {
    // 'ab' satisfies the pattern and breaks `minLength: 5` — proof the hoist
    // did not swallow the families ordered after it.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: {}, logger });
    svc.registerManifest(orderingManifest);
    await expect(svc.setMany('pattern_order', { slug: 'ab' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'slug', code: 'min_length' }],
    });

    const { errors, logger: envLogger } = spyLogger();
    const env = new SettingsService({ env: { OS_PATTERN_ORDER_SLUG: 'ab' }, logger: envLogger });
    env.registerManifest(orderingManifest);
    expect((await env.get('pattern_order', 'slug')).source).toBe('default');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('is outside the declared length');
  });

  it('pattern vs valueDomain: a value breaking both is a pattern miss at BOTH doors', async () => {
    // 'ZZZ' misses `^[A-Za-z]{2}$` AND is no ISO 3166-1 member; shape speaks
    // first on the write door (`pattern` has always run before the #5712
    // domain branch), so it must speak first on the env door too.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: {}, logger });
    svc.registerManifest(orderingManifest);
    await expect(svc.setMany('pattern_order', { country_like: 'ZZZ' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'country_like', code: 'invalid_format' }],
    });

    const { errors, logger: envLogger } = spyLogger();
    const env = new SettingsService({
      env: { OS_PATTERN_ORDER_COUNTRY_LIKE: 'ZZZ' }, logger: envLogger,
    });
    env.registerManifest(orderingManifest);
    expect((await env.get('pattern_order', 'country_like')).source).toBe('default');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('does not match the declared pattern');
    expect(errors[0]).not.toContain('ISO 3166-1');
  });

  it('…and a shape-legal non-member still falls to the domain family, at BOTH doors', async () => {
    // 'ZZ' is the schema's own worked example: admitted by the pattern,
    // assigned to nobody. Membership must still refuse it on both doors.
    const { logger } = spyLogger();
    const svc = new SettingsService({ env: {}, logger });
    svc.registerManifest(orderingManifest);
    await expect(svc.setMany('pattern_order', { country_like: 'ZZ' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [{ field: 'country_like', code: 'invalid_value', constraint: { valueDomain: 'iso_3166_alpha2' } }],
    });

    const { errors, logger: envLogger } = spyLogger();
    const env = new SettingsService({
      env: { OS_PATTERN_ORDER_COUNTRY_LIKE: 'ZZ' }, logger: envLogger,
    });
    env.registerManifest(orderingManifest);
    expect((await env.get('pattern_order', 'country_like')).source).toBe('default');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('is not a valid ISO 3166-1');
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The default-value ratchet (#4666), pinned at the altitude where its verdicts
 * are decidable without running the whole generator.
 *
 * ## Why this file exists in the shape it does
 *
 * The gate itself lives inside `build-schemas.ts`, whose end-to-end verdict is
 * proved on every CI run by `check:authorable-surface`. What that run CANNOT
 * prove is that the comparison still MEANS anything: a diff function that
 * returned `[]` unconditionally, or a fingerprint that collapsed every value to
 * the same string, would leave the gate green on every tree — including the one
 * with the flipped default. #4642 is this repo's standing example of a pin that
 * had quietly become a no-op, and the whole point of #4666 is that a green gate
 * had been telling everyone a default was unchanged.
 *
 * So the assertions below are deliberately about DISCRIMINATION — this input
 * produces a finding, that one does not — and the first of them replays the
 * exact sabotage the issue was opened on: `maxRetries`, `0 → 3`, one character.
 *
 * The second thing pinned here is the direction-B boundary. The maintainer ruled
 * that constraints are NOT fingerprinted, and a boundary that lives only in a
 * comment erodes the first time someone "improves" the fingerprint. It is
 * asserted as a property instead: two shapes differing ONLY in their bounds and
 * prose must fingerprint identically.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_DEFAULT,
  authorableDefaultsShardTexts,
  authoriseDefaultChanges,
  collectAuthorableDefaults,
  defaultFingerprintOf,
  diffAuthorableDefaults,
  formatDefaultEntry,
  parseDefaultEntries,
  parseDefaultEntry,
  type DeclaredDefaultChange,
} from './lib/authorable-defaults';
import { DEFAULT_CHANGES_BY_MAJOR } from './lib/default-changes';

/** Authorable keys as the gate models them: `key -> isRetired`. */
const live = (...keys: string[]) => new Map(keys.map((k) => [k, false] as const));

const RETRY = 'automation/RetryPolicy:maxRetries';

describe('defaultFingerprintOf — normalisation', () => {
  it('records the value, and the value alone', () => {
    expect(defaultFingerprintOf(0)).toBe('0');
    expect(defaultFingerprintOf(3)).toBe('3');
    expect(defaultFingerprintOf(false)).toBe('false');
    expect(defaultFingerprintOf('GET')).toBe('"GET"');
    expect(defaultFingerprintOf(null)).toBe('null');
  });

  it('is insensitive to object key ORDER — a re-spelling is not a change', () => {
    // The churn this rules out: a `.default({ a, b })` literal re-typed with its
    // keys the other way round is the same default, and a ratchet that reddened
    // on it would be reworded away within a week.
    expect(defaultFingerprintOf({ mode: 'a', retries: 1 })).toBe(
      defaultFingerprintOf({ retries: 1, mode: 'a' }),
    );
    expect(defaultFingerprintOf({ z: { b: 1, a: 2 } })).toBe(defaultFingerprintOf({ z: { a: 2, b: 1 } }));
  });

  it('is SENSITIVE to array order — an array default’s order is observable', () => {
    expect(defaultFingerprintOf(['a', 'b'])).not.toBe(defaultFingerprintOf(['b', 'a']));
  });

  it('carries no whitespace, so re-formatting cannot move it', () => {
    expect(defaultFingerprintOf({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it('distinguishes values a loose comparison would fuse', () => {
    // `0`/`false`/`""`/`null` are the defaults whose flips are most dangerous and
    // most likely to be collapsed by a sloppy fingerprint.
    const fps = [0, false, '', null, '0'].map(defaultFingerprintOf);
    expect(new Set(fps).size).toBe(fps.length);
  });
});

describe('collectAuthorableDefaults — what the fingerprint reads', () => {
  it('reads the emitted `default` and nothing else (direction B: constraints excluded)', () => {
    // The maintainer ruling on #4666: a tightened bound REJECTS a document
    // loudly, so it is a different and self-announcing class. If this ever
    // fails, someone has widened the ratchet into direction A — which was
    // considered and declined, not overlooked.
    // Typed as the collector's own parameter, not `as const`: a `readonly`
    // tuple is not an `Iterable<[string, unknown]>`, so these two fixtures did
    // not type-check at all — invisible until #5475 put `scripts/` in a tsc
    // program. Naming the producer's type also keeps the fixture honest if that
    // signature ever changes.
    const loose: Array<[string, unknown]> = [
      ['system/Job', { properties: { maxRetries: { type: 'integer', minimum: 0, default: 0 } } }],
    ];
    const tightened: Array<[string, unknown]> = [
      [
        'system/Job',
        {
          properties: {
            maxRetries: {
              type: 'integer',
              minimum: 1,
              maximum: 10,
              default: 0,
              description: 'reworded prose',
            },
          },
        },
      ],
    ];
    expect([...collectAuthorableDefaults(tightened)]).toEqual([...collectAuthorableDefaults(loose)]);
  });

  it('records falsy defaults and skips keys that have none', () => {
    const collected = collectAuthorableDefaults([
      [
        'system/Job',
        {
          properties: {
            enabled: { default: false },
            name: { type: 'string' },
            retries: { default: 0 },
            // `retiredKey()` is z.never() → `{ not: {} }`, which carries no default.
            legacy: { not: {} },
          },
        },
      ],
    ]);
    expect([...collected]).toEqual([
      ['system/Job:enabled', 'false'],
      ['system/Job:retries', '0'],
    ]);
  });
});

describe('diffAuthorableDefaults — the discrimination the gate rests on', () => {
  it('catches the #4661 sabotage: one character, one finding, named', () => {
    const changes = diffAuthorableDefaults({
      baseline: new Map([[RETRY, '0']]),
      current: new Map([[RETRY, '3']]),
      baselineKeys: live(RETRY),
      currentKeys: live(RETRY),
    });
    expect(changes).toEqual([{ key: RETRY, kind: 'changed', from: '0', to: '3' }]);
  });

  it('reports nothing when nothing moved', () => {
    expect(
      diffAuthorableDefaults({
        baseline: new Map([[RETRY, '0']]),
        current: new Map([[RETRY, '0']]),
        baselineKeys: live(RETRY),
        currentKeys: live(RETRY),
      }),
    ).toEqual([]);
  });

  it('reads a gained default as `added` and a lost one as `removed`', () => {
    const gained = diffAuthorableDefaults({
      baseline: new Map(),
      current: new Map([[RETRY, '3']]),
      baselineKeys: live(RETRY),
      currentKeys: live(RETRY),
    });
    expect(gained).toEqual([{ key: RETRY, kind: 'added', from: NO_DEFAULT, to: '3' }]);

    const lost = diffAuthorableDefaults({
      baseline: new Map([[RETRY, '3']]),
      current: new Map(),
      baselineKeys: live(RETRY),
      currentKeys: live(RETRY),
    });
    expect(lost).toEqual([{ key: RETRY, kind: 'removed', from: '3', to: NO_DEFAULT }]);
  });

  it('does not charge a NEW key for having a default', () => {
    // No deployed document could have omitted a key that did not exist, so its
    // default cannot have changed anyone's behaviour. The authorable-surface
    // ratchet records the addition; this one must stay quiet or every new key
    // with a default would demand a declaration.
    expect(
      diffAuthorableDefaults({
        baseline: new Map(),
        current: new Map([['system/Job:freshKey', '5']]),
        baselineKeys: new Map(),
        currentKeys: live('system/Job:freshKey'),
      }),
    ).toEqual([]);
  });

  it('leaves a removed or tombstoned key to the surface gate', () => {
    // Both would otherwise read as "the default vanished" and demand a second
    // declaration for one retirement — checks (a)/(b)/(c) already own these.
    expect(
      diffAuthorableDefaults({
        baseline: new Map([['system/Job:gone', '1']]),
        current: new Map(),
        baselineKeys: live('system/Job:gone'),
        currentKeys: new Map(),
      }),
    ).toEqual([]);
    expect(
      diffAuthorableDefaults({
        baseline: new Map([['system/Job:tombstoned', '1']]),
        current: new Map(),
        baselineKeys: live('system/Job:tombstoned'),
        currentKeys: new Map([['system/Job:tombstoned', true]]),
      }),
    ).toEqual([]);
  });
});

describe('authoriseDefaultChanges — the acknowledged-change exit stays honest', () => {
  const change = { key: RETRY, kind: 'changed', from: '0', to: '3' } as const;
  const declare = (over: Partial<DeclaredDefaultChange> = {}): DeclaredDefaultChange => ({
    key: RETRY,
    from: '0',
    to: '3',
    reason: 'retry became opt-out; write `maxRetries: 0` to keep the old behaviour',
    ...over,
  });

  it('refuses a change nobody declared', () => {
    const out = authoriseDefaultChanges([change], {}, 17, new Map([[RETRY, '3']]), live(RETRY));
    expect(out.unauthorised).toEqual([change]);
    expect(out.authorised).toEqual([]);
  });

  it('accepts a declaration that pins BOTH endpoints, and carries its reason', () => {
    const out = authoriseDefaultChanges(
      [change],
      { 17: [declare()] },
      17,
      new Map([[RETRY, '3']]),
      live(RETRY),
    );
    expect(out.unauthorised).toEqual([]);
    expect(out.stale).toEqual([]);
    expect(out.authorised[0].declared[0].reason).toContain('opt-out');
  });

  it('refuses a declaration whose `from` is not where the baseline actually sits', () => {
    // The endpoint the declaration's author does NOT control. Without this a
    // single row would bless every future move of the same key.
    const out = authoriseDefaultChanges(
      [change],
      { 17: [declare({ from: '1', to: '3' })] },
      17,
      new Map([[RETRY, '3']]),
      live(RETRY),
    );
    expect(out.unauthorised).toEqual([change]);
  });

  it('authorises nothing from a PAST major', () => {
    const out = authoriseDefaultChanges(
      [change],
      { 16: [declare()] },
      17,
      new Map([[RETRY, '3']]),
      live(RETRY),
    );
    expect(out.unauthorised).toEqual([change]);
    expect(out.stale).toEqual([]);
  });

  it('DIES when it stops being true: the chain tip must equal what the build emits', () => {
    // The property that separates this from an allowlist. The default was moved
    // again (or reverted) and the row was left behind — it now pre-approves a
    // value nobody wrote down, so it goes red instead of covering it.
    const reverted = authoriseDefaultChanges([], { 17: [declare()] }, 17, new Map([[RETRY, '0']]), live(RETRY));
    expect(reverted.stale).toEqual([
      { key: RETRY, claims: '3', emits: '0', why: 'chain-tip-mismatch' },
    ]);

    const movedAgain = authoriseDefaultChanges([], { 17: [declare()] }, 17, new Map([[RETRY, '5']]), live(RETRY));
    expect(movedAgain.stale[0]).toMatchObject({ claims: '3', emits: '5' });
  });

  it('requires a multi-hop chain to MEET, and authorises from wherever the baseline forked', () => {
    const chain = [declare({ from: '0', to: '3' }), declare({ from: '3', to: '5' })];
    const live5 = new Map([[RETRY, '5']]);

    // A branch forked before either hop: the whole chain covers 0 → 5.
    const fromStart = authoriseDefaultChanges(
      [{ key: RETRY, kind: 'changed', from: '0', to: '5' }],
      { 17: chain },
      17,
      live5,
      live(RETRY),
    );
    expect(fromStart.unauthorised).toEqual([]);
    expect(fromStart.authorised[0].declared).toHaveLength(2);

    // A branch forked between them: only the second hop is its transition.
    const fromMiddle = authoriseDefaultChanges(
      [{ key: RETRY, kind: 'changed', from: '3', to: '5' }],
      { 17: chain },
      17,
      live5,
      live(RETRY),
    );
    expect(fromMiddle.authorised[0].declared).toHaveLength(1);

    // A gap in the chain hides a value that really shipped.
    const gapped = authoriseDefaultChanges(
      [],
      { 17: [declare({ from: '0', to: '3' }), declare({ from: '4', to: '5' })] },
      17,
      live5,
      live(RETRY),
    );
    expect(gapped.stale.map((s) => s.why)).toContain('chain-not-contiguous');
  });

  it('leaves a declaration about a key this build no longer emits alone', () => {
    // The expected end state once the key is retired — the surface gate owns
    // that verdict, exactly as check (b2) does for RETIRED_KEYS_BY_MAJOR.
    const out = authoriseDefaultChanges([], { 17: [declare()] }, 17, new Map(), new Map());
    expect(out.stale).toEqual([]);
  });
});

describe('the recorded artifact round-trips', () => {
  it('serialises and re-parses to the same fingerprints', () => {
    const defaults = new Map([
      ['system/Job:retries', '0'],
      ['ui/Theme:mode', '"light"'],
      ['ui/Theme:tokens', '{"a":1,"b":[2,3]}'],
    ]);
    const parsed = parseDefaultEntries(
      [...authorableDefaultsShardTexts(defaults).values()].flatMap(
        (text) => (JSON.parse(text) as { defaults: string[] }).defaults,
      ),
    );
    expect(parsed).toEqual(defaults);
  });

  it('splits on the FIRST separator, so a fingerprint may contain one', () => {
    // A string default really can be `" = "`. Splitting anywhere else would
    // corrupt exactly the values hardest to notice.
    const entry = formatDefaultEntry('ui/Theme:sep', '" = "');
    expect(parseDefaultEntry(entry)).toEqual({ key: 'ui/Theme:sep', fingerprint: '" = "' });
  });

  it('refuses a line it cannot parse rather than guessing', () => {
    expect(() => parseDefaultEntry('ui/Theme:sep')).toThrow(/cannot parse/);
  });
});

describe('DEFAULT_CHANGES_BY_MAJOR itself', () => {
  it('holds no row that declares a non-change or an empty reason', () => {
    // Guards the table the way the gate guards the schemas: a row with
    // `from === to` acknowledges nothing, and an empty `reason` defeats the one
    // thing a build prints when it accepts a flip.
    for (const [major, rows] of Object.entries(DEFAULT_CHANGES_BY_MAJOR)) {
      for (const row of rows) {
        expect(row.from, `${major} ${row.key}`).not.toBe(row.to);
        expect(row.reason.trim().length, `${major} ${row.key}`).toBeGreaterThan(20);
        expect(row.key, `${major} ${row.key}`).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9_]+:.+$/);
      }
    }
  });
});

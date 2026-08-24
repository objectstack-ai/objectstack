import { describe, expect, it } from 'vitest';
import Serve from '../src/commands/serve.js';

/**
 * The always-on entries that OTHER always-on entries bind into during their own
 * `kernel:ready` phase. Mount order is what makes those bindings resolve, so the
 * boundary is a ROLE — never a count.
 *
 * A literal `slice(0, 6)` prefix assertion stood here, under a comment telling
 * the next author that the list "may grow beyond them ... without churning this
 * assertion, so we pin the prefix rather than the whole array". That instruction
 * IS the defect (#10250): an entry added past index 5 lands outside everything
 * that holds its position, which is exactly how `sms` came to sit at index 6
 * held by nothing at all. Widening the slice to `slice(0, 7)` would have been
 * the same defect with a fresher number.
 *
 * Stated as the rule instead — the same derived shape #11046 landed at the two
 * other homes of this pin: `platform-capabilities.test.ts` in `@objectstack/spec`
 * (the declaration's own pin) and case 5 of `serve-settings-ordering.pin.test.ts`
 * (which additionally resolves the real plugin classes to keep the MEMBERSHIP of
 * `BIND_TARGETS` honest — this file cannot, and does not try to). What this
 * file's copy adds is the surface: it runs over `Serve.ALWAYS_ON_CAPABILITIES`,
 * the re-export `serve` actually appends to an app's `requires`.
 */
const BIND_TARGETS = ['queue', 'job', 'cache', 'settings'] as const;

/**
 * The rule itself, as one predicate: every entry that is not a bind target must
 * be mounted after all of them. Stated once so the pin below and its positive
 * controls cannot drift apart.
 */
const orderingViolations = (
  slate: readonly string[],
  targets: readonly string[] = BIND_TARGETS,
): string[] => {
  const at = (t: string) => slate.indexOf(t);
  const lastTarget = Math.max(...targets.map(at));
  return slate.filter((c) => !targets.includes(c) && at(c) < lastTarget);
};

describe('serve: ALWAYS_ON_CAPABILITIES default slate', () => {
  // ALWAYS_ON_CAPABILITIES is the fail-closed allowlist of platform services
  // that are injected into every app's `requires` at runtime.
  it('mounts every bind target — the services other entries bind into at `kernel:ready`', () => {
    // The floor for the rule below. A missing target would make that rule
    // constrain less without failing; with every target gone it would constrain
    // nothing at all, and still pass.
    for (const target of BIND_TARGETS) {
      expect(
        Serve.ALWAYS_ON_CAPABILITIES.indexOf(target),
        `${target} must be on the slate`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('mounts every other entry after ALL bind targets — derived, so tomorrow’s entry is covered on arrival', () => {
    // THE BOUNDARY, DERIVED. Not "the first six": the rule is that the services
    // other entries bind into during their own `kernel:ready` phase are mounted
    // first, and everything else grows after them. `sms`, `sharing`,
    // `messaging`, `analytics` — and an eleventh entry added tomorrow, wherever
    // it goes — are all covered by this the moment they are added.
    const tail = Serve.ALWAYS_ON_CAPABILITIES.filter(
      (c) => !(BIND_TARGETS as readonly string[]).includes(c),
    );
    // Non-vacuity: the tail is what this case is about, so an empty one would be
    // a pass over nothing.
    expect(tail.length).toBeGreaterThan(0);
    expect(orderingViolations(Serve.ALWAYS_ON_CAPABILITIES)).toEqual([]);
  });

  it('…and the rule is falsifiable — a hostile slate is named, not shrugged off', () => {
    // Control 1. The SAME predicate over a slate with `settings` mounted last
    // must name every entry that now precedes it; a predicate that reported
    // nothing here would report nothing on a real regression either.
    expect(
      orderingViolations(['queue', 'job', 'cache', 'email', 'sms', 'storage', 'settings']),
    ).toEqual(['email', 'sms', 'storage']);

    // Control 2 — the class the retired `slice(0, 6)` literal structurally could
    // not see: a slate that GROWS. A SEVENTH bind target appended past the
    // readers leaves indices 0-5 untouched, so the old literal read as correct;
    // this rule names all three readers now mounted ahead of it. Run over a
    // fixed synthetic slate so the control does not itself track the live list.
    expect(
      orderingViolations(
        ['queue', 'job', 'cache', 'settings', 'email', 'storage', 'sms', 'secrets'],
        [...BIND_TARGETS, 'secrets'],
      ),
    ).toEqual(['email', 'storage', 'sms']);
  });

  it('contains no duplicates', () => {
    expect(Serve.ALWAYS_ON_CAPABILITIES).toHaveLength(
      new Set(Serve.ALWAYS_ON_CAPABILITIES).size,
    );
  });

  it('is frozen so accidental mutation throws', () => {
    expect(Object.isFrozen(Serve.ALWAYS_ON_CAPABILITIES)).toBe(true);
  });

  it('minimal preset has none of the always-on caps in its tier list', () => {
    const minimal = Serve.TIER_PRESETS.minimal;
    for (const cap of Serve.ALWAYS_ON_CAPABILITIES) {
      expect(minimal).not.toContain(cap);
    }
    expect(minimal).toEqual(['core']);
  });

  it('default preset does not pre-include the always-on caps (they merge into `requires`, not tier)', () => {
    // ALWAYS_CAPS get injected into per-app `requires` at runtime; the
    // tier preset is the orthogonal "feature tier" axis.
    const def = Serve.TIER_PRESETS.default;
    for (const cap of Serve.ALWAYS_ON_CAPABILITIES) {
      expect(def).not.toContain(cap);
    }
  });
});

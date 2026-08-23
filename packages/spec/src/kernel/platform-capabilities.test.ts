import { describe, expect, it } from 'vitest';
import {
  PLATFORM_CAPABILITY_TOKENS,
  isKnownPlatformCapability,
  PLATFORM_CAPABILITY_PROVIDERS,
  PLATFORM_ALWAYS_ON_CAPABILITIES,
  classifyRequiredCapability,
} from './platform-capabilities';

// framework#3265 — one capability vocabulary across the standalone serve path
// and cloud's objectos-runtime loader, canonical spelling kebab-case. The
// deprecated `aiStudio`/`aiSeat` aliases were removed in #3308.

describe('PLATFORM_CAPABILITY_TOKENS', () => {
  it('is frozen and duplicate-free', () => {
    expect(Object.isFrozen(PLATFORM_CAPABILITY_TOKENS)).toBe(true);
    expect(new Set(PLATFORM_CAPABILITY_TOKENS).size).toBe(PLATFORM_CAPABILITY_TOKENS.length);
  });

  it('every token is canonical lower-case kebab-case', () => {
    for (const t of PLATFORM_CAPABILITY_TOKENS) {
      expect(t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('contains the tier-gated and headline service tokens', () => {
    for (const t of ['ai', 'ai-studio', 'automation', 'analytics', 'pinyin-search', 'hierarchy-security']) {
      expect(PLATFORM_CAPABILITY_TOKENS).toContain(t);
    }
  });

  it('contains no camelCase legacy spellings (aliases removed, #3308)', () => {
    for (const legacy of ['aiStudio', 'aiSeat']) {
      expect(PLATFORM_CAPABILITY_TOKENS).not.toContain(legacy);
    }
  });
});

describe('isKnownPlatformCapability', () => {
  it('accepts canonical tokens verbatim', () => {
    expect(isKnownPlatformCapability('ai-studio')).toBe(true);
    expect(isKnownPlatformCapability('ai-seat')).toBe(true);
    expect(isKnownPlatformCapability('governance')).toBe(true);
  });

  it('rejects the removed camelCase aliases and typos (no canonicalization, #3308)', () => {
    expect(isKnownPlatformCapability('aiStudio')).toBe(false);
    expect(isKnownPlatformCapability('aiSeat')).toBe(false);
    expect(isKnownPlatformCapability('automations')).toBe(false);
  });
});

// framework#3366 — the provider/edition registry + classifier behind the
// installable-provider preflight.
describe('PLATFORM_CAPABILITY_PROVIDERS', () => {
  it('is frozen and maps exactly the vocabulary tokens', () => {
    expect(Object.isFrozen(PLATFORM_CAPABILITY_PROVIDERS)).toBe(true);
    expect(new Set(Object.keys(PLATFORM_CAPABILITY_PROVIDERS))).toEqual(
      new Set(PLATFORM_CAPABILITY_TOKENS),
    );
  });

  it('every entry has a valid edition; cloud tiers may carry a null package', () => {
    for (const [token, p] of Object.entries(PLATFORM_CAPABILITY_PROVIDERS)) {
      expect(['open', 'enterprise', 'cloud'], `bad edition for '${token}'`).toContain(p.edition);
      if (p.package !== null) expect(p.package.startsWith('@')).toBe(true);
      // A packageless provider only makes sense for a cloud-runtime tier.
      if (p.package === null) expect(p.edition).toBe('cloud');
    }
  });
});

describe('classifyRequiredCapability (#3366)', () => {
  const allInstalled = () => true;
  const noneInstalled = () => false;

  it('installed provider ⇒ ok', () => {
    expect(classifyRequiredCapability('automation', allInstalled).status).toBe('ok');
    expect(classifyRequiredCapability('ai', allInstalled).status).toBe('ok');
  });

  it('absent open-edition provider ⇒ installable (add the dep)', () => {
    const c = classifyRequiredCapability('automation', noneInstalled);
    expect(c.status).toBe('installable');
    expect(c.provider?.package).toBe('@objectstack/service-automation');
  });

  it('absent cloud-only provider ⇒ unavailable (no version to install here)', () => {
    // The headline case: `ai` → @objectstack/service-ai, cloud-only.
    const c = classifyRequiredCapability('ai', noneInstalled);
    expect(c.status).toBe('unavailable');
    expect(c.provider?.edition).toBe('cloud');
  });

  it('a cloud tier with no package is unavailable even when "everything" resolves', () => {
    // `ai-seat`/`governance` have package:null — there is nothing to resolve, so
    // they can never be satisfied under the open edition.
    expect(classifyRequiredCapability('ai-seat', allInstalled).status).toBe('unavailable');
    expect(classifyRequiredCapability('governance', allInstalled).status).toBe('unavailable');
  });

  it('absent enterprise provider ⇒ installable (a licensed package, still addable)', () => {
    const c = classifyRequiredCapability('hierarchy-security', noneInstalled);
    expect(c.status).toBe('installable');
    expect(c.provider?.edition).toBe('enterprise');
  });

  it('an unknown token ⇒ unknown (typo), never a provider miss', () => {
    expect(classifyRequiredCapability('automations', noneInstalled).status).toBe('unknown');
  });

  it('resolution is injected — the classifier itself performs no I/O', () => {
    const seen: string[] = [];
    classifyRequiredCapability('automation', (pkg) => { seen.push(pkg); return true; });
    expect(seen).toEqual(['@objectstack/service-automation']);
  });
});

/**
 * The foundational slate (cloud#925, #3786).
 *
 * It moved here from `Serve.ALWAYS_ON_CAPABILITIES` because two runtimes mount
 * it — `objectstack serve` and cloud's per-tenant objectos-runtime — and the
 * second kept a copy under a comment that only said hosts "mirror this list".
 * They had already diverged by three entries. These assertions are what makes
 * the single declaration trustworthy for both readers.
 */
describe('PLATFORM_ALWAYS_ON_CAPABILITIES', () => {
  /**
   * The always-on entries that OTHER always-on entries bind into during their
   * own `kernel:ready` phase. Mount order is what makes those bindings resolve,
   * so the boundary is a ROLE — never a count.
   *
   * A literal `slice(0, 6)` prefix assertion stood here, under a comment telling
   * the next author to grow the slate *after those six*. That instruction is
   * what produced #10250: the six bundled these four bind targets together with
   * two of their READERS (`email`, `storage`) and stopped one short of the third
   * — `sms`, at index 6 — which was then added exactly as instructed, outside
   * the pin, with its position relative to `settings` held by nothing at all.
   *
   * Adding a seventh entry to the count would have been the same defect moved
   * one position. Derived from what the pin is FOR, the rule covers whatever is
   * added tomorrow, wherever it goes.
   *
   * ⚠️ Scope of this pin: `packages/spec` sits below every plugin package, so
   * this file cannot import the plugin classes and therefore cannot verify that
   * `BIND_TARGETS` still lists the right services — it pins slate ORDER only.
   * `serve-settings-ordering.pin.test.ts` in `@objectstack/cli` is the half that
   * keeps the membership honest: it resolves the real plugin classes and proves
   * each shipped settings reader declares the ordering edge (ADR-0116/ADR-0049).
   * The two are complementary, not duplicates — neither subsumes the other.
   */
  const BIND_TARGETS = ['queue', 'job', 'cache', 'settings'] as const;

  const slateIndex = (token: string) => PLATFORM_ALWAYS_ON_CAPABILITIES.indexOf(token);

  /**
   * The rule itself, as one predicate: every entry that is not a bind target
   * must be mounted after all of them. Stated once so the pin below and its
   * positive control cannot drift apart.
   */
  const orderingViolations = (
    slate: readonly string[],
    targets: readonly string[] = BIND_TARGETS,
  ): string[] => {
    const at = (t: string) => slate.indexOf(t);
    const lastTarget = Math.max(...targets.map(at));
    return slate.filter((c) => !targets.includes(c) && at(c) < lastTarget);
  };

  it('is frozen, non-empty and free of duplicates', () => {
    expect(Object.isFrozen(PLATFORM_ALWAYS_ON_CAPABILITIES)).toBe(true);
    expect(PLATFORM_ALWAYS_ON_CAPABILITIES.length).toBeGreaterThan(0);
    expect(PLATFORM_ALWAYS_ON_CAPABILITIES).toHaveLength(
      new Set(PLATFORM_ALWAYS_ON_CAPABILITIES).size,
    );
  });

  it('mounts every bind target — the services other entries bind into at `kernel:ready`', () => {
    // The floor for the ordering rule below. A missing target would make that
    // rule constrain less without failing; with every target gone it would
    // constrain nothing at all, and still pass.
    for (const target of BIND_TARGETS) {
      expect(slateIndex(target), `${target} must be on the slate`).toBeGreaterThanOrEqual(0);
    }
  });

  it('mounts every other entry after ALL bind targets — derived, so tomorrow’s entry is covered on arrival', () => {
    // THE BOUNDARY, DERIVED. Not "the first six": the rule is that the services
    // other entries bind into during their own `kernel:ready` phase are mounted
    // first, and everything else grows after them. `sms`, `sharing`,
    // `messaging`, `analytics` — and an eleventh entry added tomorrow, wherever
    // it goes — are all covered by this the moment they are added.
    const tail = PLATFORM_ALWAYS_ON_CAPABILITIES.filter(
      (c) => !(BIND_TARGETS as readonly string[]).includes(c),
    );
    // Non-vacuity: the tail is what this case is about, so an empty one would
    // be a pass over nothing.
    expect(tail.length).toBeGreaterThan(0);
    expect(orderingViolations(PLATFORM_ALWAYS_ON_CAPABILITIES)).toEqual([]);
  });

  it('…and the rule is falsifiable — a hostile slate is named, not shrugged off', () => {
    // The positive control for the derivation above. The SAME predicate over a
    // slate with `settings` mounted last must name every entry that now
    // precedes it; a predicate that reported nothing here would report nothing
    // on a real regression either.
    expect(
      orderingViolations(['queue', 'job', 'cache', 'email', 'sms', 'storage', 'settings']),
    ).toEqual(['email', 'sms', 'storage']);

    // …and the class the retired `slice(0, 6)` pin structurally could not see.
    // That pin constrained indices 0-5 and nothing else, so a bind target
    // arriving anywhere past the prefix read as correct at a glance — the same
    // blind spot that left `sms` at index 6 held by nothing. Model it: today's
    // slate, unchanged, plus a NEW bind target appended. `slice(0, 6)` is
    // untouched and the old pin passes; this rule names all six readers now
    // mounted ahead of it.
    expect(
      orderingViolations(
        [...PLATFORM_ALWAYS_ON_CAPABILITIES, 'secrets'],
        [...BIND_TARGETS, 'secrets'],
      ),
    ).toEqual(['email', 'storage', 'sms', 'sharing', 'messaging', 'analytics']);
  });

  it('every member is a real platform capability token', () => {
    // A slate entry outside the vocabulary could never be classified, and every
    // runtime mounting the slate would force-add a token nothing provides.
    const unknown = PLATFORM_ALWAYS_ON_CAPABILITIES.filter(
      (c) => !(PLATFORM_CAPABILITY_TOKENS as readonly string[]).includes(c),
    );
    expect(unknown).toEqual([]);
  });

  it('every member has a declared provider', () => {
    // The slate is force-mounted, so a member with no provider entry would be
    // added to every app's `requires` and then fail to resolve for all of them.
    const providerless = PLATFORM_ALWAYS_ON_CAPABILITIES.filter(
      (c) => !PLATFORM_CAPABILITY_PROVIDERS[c],
    );
    expect(providerless).toEqual([]);
  });

  it('is open-edition only — the floor must be mountable without a licence', () => {
    // A cloud/enterprise-edition entry in the FLOOR would make the open
    // distribution unable to satisfy its own defaults.
    const gated = PLATFORM_ALWAYS_ON_CAPABILITIES.filter(
      (c) => PLATFORM_CAPABILITY_PROVIDERS[c]?.edition !== 'open',
    );
    expect(gated).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  PLATFORM_CAPABILITY_TOKENS,
  PLATFORM_CAPABILITY_PROVIDERS,
  PLATFORM_PLUGIN_WIRED_RUNTIMES,
} from '@objectstack/spec/kernel';
import Serve from '../src/commands/serve.js';

// framework#3265 — drift guard: the serve path's provider registries must stay
// inside the spec-owned platform capability vocabulary, so the standalone
// runtime and cloud's objectos-runtime keep resolving the SAME token set.

describe('serve capability registries vs spec vocabulary (#3265)', () => {
  it('every CAPABILITY_PROVIDERS token is in PLATFORM_CAPABILITY_TOKENS', () => {
    for (const token of Object.keys(Serve.CAPABILITY_PROVIDERS)) {
      expect(PLATFORM_CAPABILITY_TOKENS, `provider token '${token}' missing from spec vocabulary`).toContain(token);
    }
  });

  it('every CAPABILITY_TO_TIER token is in PLATFORM_CAPABILITY_TOKENS', () => {
    for (const token of Object.keys(Serve.CAPABILITY_TO_TIER)) {
      expect(PLATFORM_CAPABILITY_TOKENS, `tier token '${token}' missing from spec vocabulary`).toContain(token);
    }
  });

  it('registries use only canonical spellings — never the removed camelCase aliases (#3308)', () => {
    const legacy = ['aiStudio', 'aiSeat'];
    for (const token of [...Object.keys(Serve.CAPABILITY_PROVIDERS), ...Object.keys(Serve.CAPABILITY_TO_TIER)]) {
      expect(legacy).not.toContain(token);
    }
  });

  it('tier-gated and provider-backed tokens do not overlap (each token has ONE resolution path)', () => {
    const providerTokens = new Set(Object.keys(Serve.CAPABILITY_PROVIDERS));
    for (const tierToken of Object.keys(Serve.CAPABILITY_TO_TIER)) {
      expect(providerTokens.has(tierToken)).toBe(false);
    }
  });

  it('ALWAYS_ON_CAPABILITIES stays inside the vocabulary too', () => {
    for (const token of Serve.ALWAYS_ON_CAPABILITIES) {
      expect(PLATFORM_CAPABILITY_TOKENS).toContain(token);
    }
  });
});

// framework#3366 — the installable-provider registry must classify EVERY
// vocabulary token, and its `open`-edition entries must name the SAME package
// the serve resolver actually loads. Otherwise the preflight and boot could
// disagree about what provides a capability (or what edition it ships in).
describe('PLATFORM_CAPABILITY_PROVIDERS vs vocabulary + serve resolver (#3366)', () => {
  it('classifies every vocabulary token, and adds none outside it (1:1)', () => {
    const providerTokens = Object.keys(PLATFORM_CAPABILITY_PROVIDERS);
    for (const token of PLATFORM_CAPABILITY_TOKENS) {
      expect(providerTokens, `vocabulary token '${token}' has no provider entry`).toContain(token);
    }
    for (const token of providerTokens) {
      expect(PLATFORM_CAPABILITY_TOKENS, `provider token '${token}' missing from vocabulary`).toContain(token);
    }
  });

  it('open-edition service tokens name the SAME package as serve CAPABILITY_PROVIDERS', () => {
    for (const [token, spec] of Object.entries(Serve.CAPABILITY_PROVIDERS)) {
      const provider = PLATFORM_CAPABILITY_PROVIDERS[token];
      expect(provider, `serve provider '${token}' has no registry entry`).toBeTruthy();
      expect(provider.package, `package mismatch for '${token}'`).toBe(spec.pkg);
      expect(provider.edition, `serve-provided '${token}' must be an open-edition provider`).toBe('open');
    }
  });

  it('tier-gated tokens carry a provider entry; ai/ai-studio are cloud-only', () => {
    for (const token of Object.keys(Serve.CAPABILITY_TO_TIER)) {
      expect(PLATFORM_CAPABILITY_PROVIDERS[token], `tier token '${token}' has no provider entry`).toBeTruthy();
    }
    // The bug the issue targets: AI runtime went cloud-only, so under the open
    // edition there is no version to install.
    expect(PLATFORM_CAPABILITY_PROVIDERS.ai.edition).toBe('cloud');
    expect(PLATFORM_CAPABILITY_PROVIDERS['ai-studio'].edition).toBe('cloud');
  });
});

// #11263 — the companion roster for `plugins[]`-wired out-of-repo runtimes.
// The token-keyed map above structurally cannot hold `@objectstack/organizations`
// (it backs no `requires` token; `serve` loads it off the resolved tenancy
// posture), so its provenance row lives in PLATFORM_PLUGIN_WIRED_RUNTIMES.
// These pins keep the two rosters from diverging on the one fact they can both
// state, and keep the new one inside its own membership rule.
describe('PLATFORM_PLUGIN_WIRED_RUNTIMES vs providers + serve resolver (#11263)', () => {
  it('declares @objectstack/organizations — the runtime serve loads off tenancy posture — as enterprise', () => {
    const row = PLATFORM_PLUGIN_WIRED_RUNTIMES['@objectstack/organizations'];
    expect(row, 'the package serve prints an install remedy for must have a provenance row').toBeTruthy();
    expect(row.edition).toBe('enterprise');
  });

  // #11614 — the other half of the pin above, and the half that was missing.
  // That one reads the roster with a literal spelled HERE, so it proves the
  // roster has a row; it says nothing about the name `serve` actually resolves.
  // Until this pin, that name was a bare literal in serve.ts under no check at
  // all: rename the roster key, or mistype the literal, and both sides stay
  // green while boot reaches for a package that does not exist and the fatal
  // message tells operators to install it.
  it('the package name serve resolves IS a roster key — not a second, unchecked copy of it (#11614)', () => {
    expect(
      Object.keys(PLATFORM_PLUGIN_WIRED_RUNTIMES),
      `serve loads '${Serve.ORGANIZATIONS_RUNTIME_PKG}', which PLATFORM_PLUGIN_WIRED_RUNTIMES does not declare. ` +
        'The roster is the single source for whether an out-of-repo @objectstack/* package is real and where ' +
        'it ships from (#10921); a runtime that prints a package name at operators must name a row in it.',
    ).toContain(Serve.ORGANIZATIONS_RUNTIME_PKG);

    // Provenance, read through serve's own spelling rather than a literal: the
    // row this command's remedy text describes is the enterprise one.
    const row = PLATFORM_PLUGIN_WIRED_RUNTIMES[Serve.ORGANIZATIONS_RUNTIME_PKG];
    expect(row.edition, `edition drift for the runtime serve loads ('${Serve.ORGANIZATIONS_RUNTIME_PKG}')`).toBe(
      'enterprise',
    );
  });

  it('every enterprise-edition provider package has a roster row — enterprise means plugins[]-wired, by definition', () => {
    // CapabilityEdition's own definition: `enterprise` = "a separately-licensed
    // enterprise package the app installs and wires in via `plugins[]`". So an
    // enterprise provider row's package IS a plugins[]-wired out-of-repo
    // runtime and must be declared in the companion roster too — this is what
    // makes @objectstack/security-enterprise's double listing checked instead
    // of divergent, and covers the next enterprise token on arrival.
    const enterprisePackages = Object.entries(PLATFORM_CAPABILITY_PROVIDERS)
      .filter(([, p]) => p.edition === 'enterprise' && p.package !== null)
      .map(([token, p]) => [token, p.package as string] as const);
    // Non-vacuity: hierarchy-security → @objectstack/security-enterprise is the
    // standing member; an empty population would pass over nothing.
    expect(enterprisePackages.length).toBeGreaterThan(0);
    for (const [token, pkg] of enterprisePackages) {
      const row = PLATFORM_PLUGIN_WIRED_RUNTIMES[pkg];
      expect(row, `enterprise provider '${token}' names '${pkg}', which has no roster row`).toBeTruthy();
      expect(row.edition, `edition drift for '${pkg}' between the two rosters`).toBe('enterprise');
    }
  });

  it('when both rosters name one package, they agree on its edition', () => {
    // The generalized no-divergence pin, both editions covered: the only fact
    // the two rosters can state twice must be stated identically.
    for (const [pkg, row] of Object.entries(PLATFORM_PLUGIN_WIRED_RUNTIMES)) {
      for (const [token, p] of Object.entries(PLATFORM_CAPABILITY_PROVIDERS)) {
        if (p.package === pkg) {
          expect(p.edition, `'${token}' and the roster disagree on '${pkg}'`).toBe(row.edition);
        }
      }
    }
  });

  it('no roster package appears in serve CAPABILITY_PROVIDERS — plugins[]-wired is not requires-resolved by serve', () => {
    const servePackages = Object.values(Serve.CAPABILITY_PROVIDERS).map((s) => s.pkg);
    for (const pkg of Object.keys(PLATFORM_PLUGIN_WIRED_RUNTIMES)) {
      expect(servePackages, `'${pkg}' is loaded by serve's open-edition resolver — it belongs in the token-keyed map`).not.toContain(pkg);
    }
  });
});

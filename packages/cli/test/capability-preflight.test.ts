import { describe, expect, it } from 'vitest';
import {
  preflightRequiredCapabilities,
  renderCapabilityMessage,
  missingProviderMessage,
  makeProviderResolver,
} from '../src/utils/capability-preflight.js';
import {
  classifyRequiredCapability,
  PLATFORM_CAPABILITY_PROVIDERS,
} from '@objectstack/spec/kernel';

// framework#3366 — the CLI-side resolution + message layer over the spec-owned
// classifier. Resolution is injected so the classification is deterministic.

describe('preflightRequiredCapabilities (#3366)', () => {
  const call = (requires: unknown[], isInstalled: (p: string) => boolean) =>
    preflightRequiredCapabilities({ requires, projectDir: '/tmp/nowhere', isInstalled });

  it('a fully-satisfied requires list yields no errors and no warnings', () => {
    const r = call(['automation', 'ui', 'auth'], () => true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('a cloud-only provider is a FATAL error (no installable version here)', () => {
    const r = call(['ai'], () => false);
    expect(r.errors.map((c) => c.token)).toEqual(['ai']);
    expect(r.warnings).toHaveLength(0);
  });

  it('an absent open-edition provider is an advisory warning, not an error', () => {
    const r = call(['automation'], () => false);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.map((c) => c.token)).toEqual(['automation']);
  });

  it('an unknown token is an advisory warning (typo), never fatal', () => {
    const r = call(['automations'], () => true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.map((c) => c.status)).toEqual(['unknown']);
  });

  it('dedupes and ignores non-string entries', () => {
    const r = call(['ai', 'ai', 42, null, 'ai'], () => false);
    expect(r.errors).toHaveLength(1);
  });

  it('only classifies what is declared — an empty list is always clean', () => {
    expect(call([], () => false)).toEqual({ errors: [], warnings: [] });
  });
});

describe('renderCapabilityMessage (#3366)', () => {
  const msgFor = (token: string, isInstalled: (p: string) => boolean) =>
    renderCapabilityMessage(classifyRequiredCapability(token, isInstalled));

  it('cloud-only message names the package, the edition, and the cloud escape', () => {
    const m = msgFor('ai', () => false);
    expect(m).toContain('@objectstack/service-ai');
    expect(m).toContain('not available in the open edition');
    expect(m).toContain('cloud runtime');
  });

  it('a packageless cloud tier states it has no open-edition provider', () => {
    const m = msgFor('ai-seat', () => false);
    expect(m).toContain('no open-edition provider');
  });

  it('open-edition absent provider gives a `pnpm add` hint', () => {
    const m = msgFor('automation', () => false);
    expect(m).toContain('pnpm add @objectstack/service-automation');
  });

  it('enterprise provider hint names plugins[] wiring AND carries the edition boundary', () => {
    const m = msgFor('hierarchy-security', () => false);
    expect(m).toContain('pnpm add @objectstack/security-enterprise');
    expect(m).toContain('plugins[]');
    // #10921 — this `pnpm add` names a package this repo does not build and that
    // is not publicly resolvable; it is followable only by a licensee. What keeps
    // it from reading as an ordinary open-edition install is the roster's edition
    // note, so assert the message carries that note VERBATIM instead of a literal
    // copied into this file — the note is spec-owned, and a copy here would let
    // the two drift apart with both still green. Strip the note from the roster
    // entry, or stop interpolating it, and this fails.
    const note = PLATFORM_CAPABILITY_PROVIDERS['hierarchy-security'].note;
    expect(note, 'the enterprise roster entry must carry an edition note').toBeTruthy();
    expect(m).toContain(note!);
  });

  it('unknown token reads as a typo hint', () => {
    expect(msgFor('automations', () => true)).toContain('not a known platform capability');
  });
});

describe('missingProviderMessage — serve reads identically to the preflight (#3366)', () => {
  it('matches what the build preflight renders for the same absent token', () => {
    for (const token of ['ai', 'ai-studio', 'automation', 'hierarchy-security']) {
      // At the serve throw site the package is confirmed absent, so the preflight
      // classifies it against a `false` resolver — the two MUST produce the same
      // string, which is the whole point of the shared classifier.
      const fromServe = missingProviderMessage(token);
      const fromBuild = renderCapabilityMessage(classifyRequiredCapability(token, () => false));
      expect(fromServe).toBe(fromBuild);
    }
  });

  it('the `ai` boot message is edition-aware, not the old "add it to your dependencies"', () => {
    const m = missingProviderMessage('ai');
    expect(m).toContain('not available in the open edition');
    expect(m).not.toContain("add it to the app's dependencies");
  });
});

describe('makeProviderResolver — real on-disk resolution', () => {
  const isInstalled = makeProviderResolver('/tmp/nowhere');

  it('resolves a package the CLI actually depends on', () => {
    // `@objectstack/spec` is a hard CLI dependency, so it resolves from the CLI
    // module graph even though the host dir is bogus.
    expect(isInstalled('@objectstack/spec')).toBe(true);
  });

  it('reports a genuinely-absent package as not installed', () => {
    expect(isInstalled('@objectstack/service-ai')).toBe(false);
    expect(isInstalled('@objectstack/this-package-does-not-exist')).toBe(false);
  });
});

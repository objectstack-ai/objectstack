// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { resolveSurfaceAgent, SURFACE_DEFAULT } from '../surfaceAgent';

const agent = (name: string): AgentDescriptor => ({ name, label: name });

/** A modern catalog serving both products under their friendly names. */
const BOTH = [agent('build'), agent('ask')];
/** A legacy catalog serving the pre-rename ids only (alias resolution path). */
const LEGACY = [agent('metadata_assistant'), agent('data_chat')];
/** An ask-only catalog (a pure end-user deployment / no authoring seat). */
const ASK_ONLY = [agent('ask')];

describe('resolveSurfaceAgent — the ADR-0063 table', () => {
  it('Studio authoring surface → build', () => {
    expect(resolveSurfaceAgent('studio-build', { agents: BOTH })).toBe('build');
  });

  it('every other surface → ask', () => {
    expect(resolveSurfaceAgent('default', { agents: BOTH })).toBe('ask');
  });

  it('AI-Studio-off downgrades a build want to ask (the folded-in ConsoleLayout case)', () => {
    expect(
      resolveSurfaceAgent('studio-build', { agents: BOTH, aiStudioEnabled: false }),
    ).toBe('ask');
    // …and an app that asked for build is downgraded too.
    expect(
      resolveSurfaceAgent('default', {
        agents: BOTH,
        appDefaultAgent: 'build',
        aiStudioEnabled: false,
      }),
    ).toBe('ask');
  });

  describe('app.defaultAgent is bounded to ask/build (no roster representable)', () => {
    it('a valid build override wins on a default surface', () => {
      expect(resolveSurfaceAgent('default', { agents: BOTH, appDefaultAgent: 'build' })).toBe(
        'build',
      );
    });

    it('a valid ask override wins on the Studio surface', () => {
      expect(
        resolveSurfaceAgent('studio-build', { agents: BOTH, appDefaultAgent: 'ask' }),
      ).toBe('ask');
    });

    it('the legacy alias of a product is accepted as an override', () => {
      expect(
        resolveSurfaceAgent('default', { agents: LEGACY, appDefaultAgent: 'metadata_assistant' }),
      ).toBe('metadata_assistant');
    });

    it('REJECTS a non-product agent (withdrawn tenant custom) → surface default applies', () => {
      // A roster entry must NOT be honoured even if the catalog somehow serves it.
      const withRoster = [...BOTH, agent('weather_bot')];
      expect(
        resolveSurfaceAgent('default', { agents: withRoster, appDefaultAgent: 'weather_bot' }),
      ).toBe('ask');
      expect(
        resolveSurfaceAgent('studio-build', { agents: withRoster, appDefaultAgent: 'weather_bot' }),
      ).toBe('build');
    });
  });

  describe('catalog resolution (alias-aware + fallback)', () => {
    it('resolves the wanted product through its legacy alias', () => {
      expect(resolveSurfaceAgent('studio-build', { agents: LEGACY })).toBe('metadata_assistant');
      expect(resolveSurfaceAgent('default', { agents: LEGACY })).toBe('data_chat');
    });

    it('falls back to the platform default when the wanted product is not served', () => {
      // Studio wants build, but only ask is served → platform default (ask).
      expect(resolveSurfaceAgent('studio-build', { agents: ASK_ONLY })).toBe('ask');
    });

    it('returns undefined on an empty catalog (ADR-0025 OSS: inert surface)', () => {
      expect(resolveSurfaceAgent('studio-build', { agents: [] })).toBeUndefined();
      expect(resolveSurfaceAgent('default', { agents: [] })).toBeUndefined();
    });
  });

  it('SURFACE_DEFAULT encodes exactly the two products', () => {
    expect(SURFACE_DEFAULT).toEqual({ 'studio-build': 'build', default: 'ask' });
  });
});

// ─── cloud#1674 maker convergence ────────────────────────────────────────────
import { makerConvergedOnBuild, makerVisibleAgents } from '../surfaceAgent';

describe('maker convergence (cloud#1674) — one composer for authoring principals', () => {
  const CUSTOM = [agent('build'), agent('ask'), agent('weather_bot')];

  it('a maker on a default surface upgrades ask → build', () => {
    expect(
      resolveSurfaceAgent('default', { agents: BOTH, canAuthorMetadata: true }),
    ).toBe('build');
  });

  it('the upgrade is alias-aware (legacy catalog)', () => {
    expect(
      resolveSurfaceAgent('default', { agents: LEGACY, canAuthorMetadata: true }),
    ).toBe('metadata_assistant');
  });

  it('a maker overrides an explicit app ask pin — the pin is for the app\'s business users', () => {
    expect(
      resolveSurfaceAgent('default', {
        agents: BOTH,
        appDefaultAgent: 'ask',
        canAuthorMetadata: true,
      }),
    ).toBe('build');
  });

  it('a NON-authoring principal keeps ask everywhere (business posture untouched)', () => {
    expect(resolveSurfaceAgent('default', { agents: BOTH })).toBe('ask');
    expect(
      resolveSurfaceAgent('default', { agents: BOTH, canAuthorMetadata: false }),
    ).toBe('ask');
  });

  it('no build in the catalog → nothing to converge on (ask stays)', () => {
    expect(
      resolveSurfaceAgent('default', { agents: ASK_ONLY, canAuthorMetadata: true }),
    ).toBe('ask');
    expect(makerConvergedOnBuild(ASK_ONLY, true)).toBe(false);
  });

  it('AI Studio off → the downgrade beats the upgrade (no build to reach)', () => {
    expect(
      resolveSurfaceAgent('default', {
        agents: BOTH,
        canAuthorMetadata: true,
        aiStudioEnabled: false,
      }),
    ).toBe('ask');
    expect(makerConvergedOnBuild(BOTH, true, false)).toBe(false);
  });

  describe('makerVisibleAgents — the launcher list', () => {
    it('drops the built-in ask for a converged maker; custom agents stay', () => {
      expect(makerVisibleAgents(CUSTOM, true).map((a) => a.name)).toEqual([
        'build',
        'weather_bot',
      ]);
    });

    it('drops the LEGACY ask alias too', () => {
      expect(makerVisibleAgents(LEGACY, true).map((a) => a.name)).toEqual([
        'metadata_assistant',
      ]);
    });

    it('non-authoring principals see the catalog as-is', () => {
      expect(makerVisibleAgents(CUSTOM, false)).toEqual(CUSTOM);
    });

    it('without a served build agent the list is untouched (nothing subsumes ask)', () => {
      expect(makerVisibleAgents(ASK_ONLY, true)).toEqual(ASK_ONLY);
    });
  });
});

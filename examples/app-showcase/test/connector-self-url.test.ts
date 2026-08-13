// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  resolveShowcaseSelfUrl,
  SHOWCASE_DEFAULT_SELF_URL,
  SHOWCASE_DEFAULT_PORT,
} from '../src/system/self-url.js';

/**
 * #7538 — the showcase's self-pointing connectors must follow the port the
 * instance actually bound.
 *
 * Before the fix, `StatusApiConnector` and `StatusOpenApiConnector` carried the
 * literal `http://127.0.0.1:3000` in `providerConfig`, so every flow that
 * dispatched through them failed with `fetch failed` on any instance not
 * listening on 3000 — CI, QA, any dev boot on an isolated port. The failure is
 * indistinguishable from a sandbox egress block, which is what made it
 * expensive to diagnose (the QA run in #7516 needed a TCP forwarder on 3000 to
 * prove the address was the whole problem).
 *
 * The guards below pin both halves of the contract the fix must hold:
 * a non-3000 environment moves the connectors' `baseUrl`, and an empty
 * environment still resolves to the historical literal.
 *
 * Reverse verification (expected direction: RED on revert). Restoring the
 * literal at src/system/connectors/index.ts:57 / :89 turns the two
 * "follows the environment" cases below red while the two "defaults" cases stay
 * green — a literal is, by construction, still correct in the default case.
 * That asymmetry is the point: the default-case assertions alone can never
 * detect the bug, so both halves are required.
 */

// Ambient `process` with `env` — types/node-shim.d.ts declares the global as
// `{ cwd(): string }` only, and this module-scoped declaration shadows it
// rather than widening the shared shim (the same idiom objectstack.config.ts
// uses for its own env reads).
declare const process: { env: Record<string, string | undefined> };

/** Load the connector metadata fresh under a given environment. */
async function connectorsUnderEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const key of ['SHOWCASE_SELF_URL', 'OS_PORT', 'PORT']) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return await import('../src/system/connectors/index.js');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function baseUrlOf(connector: { providerConfig?: Record<string, unknown> }): unknown {
  return connector.providerConfig?.baseUrl;
}

afterEach(() => {
  vi.resetModules();
});

describe('resolveShowcaseSelfUrl precedence (#7538)', () => {
  it('prefers an explicit SHOWCASE_SELF_URL over any port', () => {
    expect(resolveShowcaseSelfUrl({ SHOWCASE_SELF_URL: 'https://showcase.internal', OS_PORT: '4711' }))
      .toBe('https://showcase.internal');
  });

  it('trims a trailing slash so callers can join paths without doubling it', () => {
    expect(resolveShowcaseSelfUrl({ SHOWCASE_SELF_URL: 'http://127.0.0.1:8080/' }))
      .toBe('http://127.0.0.1:8080');
  });

  it("follows the CLI's own OS_PORT when no explicit URL is set", () => {
    expect(resolveShowcaseSelfUrl({ OS_PORT: '4711' })).toBe('http://127.0.0.1:4711');
  });

  it("follows the CLI's deprecated PORT alias when OS_PORT is absent", () => {
    expect(resolveShowcaseSelfUrl({ PORT: '5822' })).toBe('http://127.0.0.1:5822');
  });

  it('prefers OS_PORT over PORT — the same order readEnvWithDeprecation uses', () => {
    expect(resolveShowcaseSelfUrl({ OS_PORT: '4711', PORT: '5822' })).toBe('http://127.0.0.1:4711');
  });

  it('falls back to the historical literal on an empty environment', () => {
    expect(resolveShowcaseSelfUrl({})).toBe('http://127.0.0.1:3000');
    expect(SHOWCASE_DEFAULT_SELF_URL).toBe('http://127.0.0.1:3000');
    expect(SHOWCASE_DEFAULT_PORT).toBe('3000');
  });

  it('ignores a blank value rather than resolving to a broken URL', () => {
    expect(resolveShowcaseSelfUrl({ SHOWCASE_SELF_URL: '   ', OS_PORT: '  ' }))
      .toBe('http://127.0.0.1:3000');
  });
});

describe('self-pointing connector instances follow the environment (#7538)', () => {
  it('StatusApiConnector resolves against a non-3000 port', async () => {
    const mod = await connectorsUnderEnv({ OS_PORT: '4711' });
    expect(baseUrlOf(mod.StatusApiConnector)).toBe('http://127.0.0.1:4711');
  });

  it('StatusOpenApiConnector resolves against a non-3000 port', async () => {
    const mod = await connectorsUnderEnv({ OS_PORT: '4711' });
    expect(baseUrlOf(mod.StatusOpenApiConnector)).toBe('http://127.0.0.1:4711');
  });

  it('both instances honour an explicit SHOWCASE_SELF_URL', async () => {
    const mod = await connectorsUnderEnv({ SHOWCASE_SELF_URL: 'http://127.0.0.1:8123' });
    expect(baseUrlOf(mod.StatusApiConnector)).toBe('http://127.0.0.1:8123');
    expect(baseUrlOf(mod.StatusOpenApiConnector)).toBe('http://127.0.0.1:8123');
  });

  it('both instances still default to 127.0.0.1:3000 with nothing set', async () => {
    const mod = await connectorsUnderEnv({});
    expect(baseUrlOf(mod.StatusApiConnector)).toBe('http://127.0.0.1:3000');
    expect(baseUrlOf(mod.StatusOpenApiConnector)).toBe('http://127.0.0.1:3000');
  });

  it('no connector carries a hard-wired self URL any more', async () => {
    const mod = await connectorsUnderEnv({ OS_PORT: '4711' });
    const hardWired = (mod.allConnectors as Array<{ name: string; providerConfig?: Record<string, unknown> }>)
      .filter((c) => c.providerConfig?.baseUrl === 'http://127.0.0.1:3000')
      .map((c) => c.name);
    expect(hardWired).toEqual([]);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#10646 — the banner's external base URL, end to end.
//
// `format.server-ready-base-url.test.ts` pins what the banner PRINTS for a
// given origin. This file pins the other half: that the origin comes from the
// runtime's OWN precedence chain and not from a banner-local copy of it. It
// drives `resolveAuthBaseUrl` from a real environment — the same call serve's
// banner site makes — and feeds its `baseOrigin` straight into
// `printServerReady`, so a drift in either half fails here.
//
// The chain is deliberately NOT restated as a literal in this file. It is
// `resolveAuthBaseUrl`'s, whose `baseOrigin` is also what gets pushed onto the
// CSRF allow-list: if the banner and the deployment's trusted origin could
// disagree, one of the two would be wrong, and the banner is the one nobody
// checks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAuthBaseUrl } from './serve.js';
import { printServerReady, type ServerReadyOptions } from '../utils/format.js';

const TOUCHED = ['OS_AUTH_URL', 'BETTER_AUTH_URL', 'OS_BASE_URL'] as const;

describe('server-ready banner external base URL (#10646)', () => {
  const saved: Partial<Record<(typeof TOUCHED)[number], string | undefined>> = {};

  const bannerOpts: Omit<ServerReadyOptions, 'externalBaseOrigin'> = {
    configFile: 'objectstack.config.ts',
    isDev: false,
    pluginCount: 1,
    uiEnabled: true,
    consolePath: '/_console',
    mcpEnabled: true,
  };

  let lines: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const n of TOUCHED) {
      saved[n] = process.env[n];
      delete process.env[n];
    }
    lines = [];
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' ').replace(/\u001b\[[0-9;]*m/g, ''));
    });
  });

  afterEach(() => {
    spy.mockRestore();
    for (const n of TOUCHED) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });

  /**
   * Exactly what serve's banner call site does: resolve through the runtime
   * chain, print what came back. `port` is the port the server actually bound.
   */
  const bootBanner = (port: number, extra: Partial<ServerReadyOptions> = {}) => {
    printServerReady({
      ...bannerOpts,
      ...extra,
      externalBaseOrigin: resolveAuthBaseUrl(port).baseOrigin,
    });
    return lines.join('\n');
  };

  it('prints the EE compose stack published origin, not the exposed-only port', () => {
    // The measured repro (moved from cloud#1507): compose resolves
    // OS_AUTH_URL to the Caddy entry point while the app binds :3000 behind it
    // with no `ports:` mapping.
    process.env.OS_AUTH_URL = 'http://localhost';

    const banner = bootBanner(3000);

    expect(banner).toContain('http://localhost/_console/');
    expect(banner).toContain('http://localhost/api/v1/mcp');
    expect(banner).not.toContain('localhost:3000');
  });

  it('follows the deployment onto its domain once OS_AUTH_URL is an https origin', () => {
    process.env.OS_AUTH_URL = 'https://app.example.com';

    const banner = bootBanner(3000);

    expect(banner).toContain('https://app.example.com/api/v1/mcp');
    expect(banner).not.toContain('localhost');
  });

  it('honours the rest of the chain — the legacy name, then OS_BASE_URL', () => {
    process.env.BETTER_AUTH_URL = 'https://legacy.example.com';
    process.env.OS_BASE_URL = 'https://base.example.com';
    expect(bootBanner(3000)).toContain('https://legacy.example.com/api/v1/mcp');

    lines.length = 0;
    delete process.env.BETTER_AUTH_URL;
    expect(bootBanner(3000)).toContain('https://base.example.com/api/v1/mcp');
  });

  it('keeps the local dev loop on the bound port when nothing is set', () => {
    // The tail of the chain. Includes the dev auto-shift: 3000 busy -> 3001,
    // and the banner must name the port that was actually bound.
    expect(bootBanner(3001)).toContain('http://localhost:3001/_console/');
  });

  it('prints paths only when a set-but-empty OS_AUTH_URL breaks the chain', () => {
    // An empty value is NOT an unset one: the chain stops there, so neither
    // OS_BASE_URL nor the localhost tail is consulted and nothing parses. The
    // old banner printed http://localhost:3000 here with total confidence.
    process.env.OS_AUTH_URL = '';
    process.env.OS_BASE_URL = 'https://never-consulted.example.com';

    const banner = bootBanner(3000);

    expect(banner).toContain('/api/v1/mcp');
    expect(banner).not.toContain('http://localhost:3000');
    expect(banner).not.toContain('never-consulted');
    expect(banner).toContain('OS_AUTH_URL');
  });

  it('prints paths only when the configured base URL has no scheme', () => {
    process.env.OS_AUTH_URL = 'app.example.com';

    const banner = bootBanner(3000);

    expect(banner).toContain('/api/v1/mcp');
    expect(banner).not.toContain('http://localhost:3000');
    // The bare hostname must not be smuggled in as an origin either.
    expect(banner).not.toContain('app.example.com/api/v1/mcp');
  });
});

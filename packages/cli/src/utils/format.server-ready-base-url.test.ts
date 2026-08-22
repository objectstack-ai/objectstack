// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printServerReady, type ServerReadyOptions } from './format.js';

/**
 * framework#10646 — the ready banner's API / Console / MCP links.
 *
 * The banner used to take a `port` and build `http://localhost:${port}` itself.
 * That is where the process LISTENS, which stops being where a human can reach
 * it the moment anything sits in front of it. Measured on the EE 4.1.0 compose
 * stack (moved from cloud#1507): the app container `expose`s `:3000` with no
 * `ports:` mapping — unreachable from the host, and less so still under
 * `--scale app=N` — while the published entry point is Caddy on `:80` and
 * `OS_AUTH_URL` is already resolved to `http://localhost`. The banner printed
 *
 *     API:       http://localhost:3000/
 *     Console:   http://localhost:3000/_console/
 *     MCP:       http://localhost:3000/api/v1/mcp
 *
 * so the Console link failed outright, and the `MCP:` line — the one customers
 * paste into an AI client — named an address that can never connect and never
 * says so.
 *
 * The property under test is therefore not "the URL looks right", it is
 * **every absolute URL in the banner is the origin the caller resolved, and
 * when no origin could be resolved the banner prints no absolute URL at all**.
 * The second half is the interesting one: a missing address sends the operator
 * to look one up, a confident wrong one gets copied.
 */
describe('printServerReady links (#10646)', () => {
  const base: Omit<ServerReadyOptions, 'externalBaseOrigin'> = {
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
    lines = [];
    // stderr, not stdout (#7915) — the whole banner is a diagnostic. SGR
    // escapes stripped so the assertions hold whether or not chalk colors.
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' ').replace(/\u001b\[[0-9;]*m/g, ''));
    });
  });

  afterEach(() => spy.mockRestore());

  /** The one banner line whose label matches, ANSI already stripped. */
  const row = (label: string): string =>
    lines.find((l) => l.includes(`${label}:`)) ?? '';

  /** The dim MCP hint — the line customers copy the skill URL out of. */
  const skillRow = (): string => lines.find((l) => l.includes('skill:')) ?? '';

  describe('a resolved external base is what gets printed', () => {
    it('prints the EE compose stack published origin, not the bound port', () => {
      // The #10646 repro verbatim: Caddy on :80, app bound to :3000 inside.
      printServerReady({ ...base, externalBaseOrigin: 'http://localhost' });

      expect(row('API')).toContain('http://localhost/');
      expect(row('Console')).toContain('http://localhost/_console/');
      expect(row('MCP')).toContain('http://localhost/api/v1/mcp');
      expect(skillRow()).toContain('http://localhost/api/v1/mcp/skill');
      // The whole defect in one assertion: the internal port must not appear.
      expect(lines.join('\n')).not.toContain(':3000');
    });

    it('follows the deployment onto a real domain (the README HTTPS step)', () => {
      printServerReady({ ...base, externalBaseOrigin: 'https://app.example.com' });

      expect(row('API')).toContain('https://app.example.com/');
      expect(row('Console')).toContain('https://app.example.com/_console/');
      expect(row('MCP')).toContain('https://app.example.com/api/v1/mcp');
      expect(skillRow()).toContain('https://app.example.com/api/v1/mcp/skill');
      expect(lines.join('\n')).not.toContain('localhost');
    });

    it('keeps a non-default port when the reachable origin carries one', () => {
      printServerReady({ ...base, externalBaseOrigin: 'https://app.example.com:8443' });
      expect(row('MCP')).toContain('https://app.example.com:8443/api/v1/mcp');
    });

    it('leaves the local dev loop exactly as it was', () => {
      // The tail of the runtime's chain is still `http://localhost:<port>`, and
      // on a laptop that IS the reachable address. Guards the fix against
      // over-reach: `os dev` must keep its clickable Console link.
      printServerReady({ ...base, isDev: true, externalBaseOrigin: 'http://localhost:3001' });

      expect(row('API')).toContain('http://localhost:3001/');
      expect(row('Console')).toContain('http://localhost:3001/_console/');
      expect(row('MCP')).toContain('http://localhost:3001/api/v1/mcp');
    });
  });

  describe('an unresolvable base prints NO absolute URL', () => {
    /** Any absolute URL that is not the one this file's own hint text cites. */
    const guessedUrl = /https?:\/\/(?!app\.example\.com\b)/;

    it('prints paths only — never a fabricated origin', () => {
      printServerReady({ ...base, externalBaseOrigin: null });

      const banner = lines.join('\n');
      // The load-bearing assertion. Not "does not contain localhost" — ANY
      // absolute URL here would be a guess, and the guess is the defect. The
      // one exemption is the hint's own `https://app.example.com` placeholder,
      // which is explicitly an example and not a link to this deployment.
      expect(banner).not.toMatch(guessedUrl);
      expect(banner).not.toContain('localhost');
    });

    it('still names the paths, so the operator keeps the information', () => {
      // "No absolute URL" is not "no line". The operator must still learn that
      // MCP is mounted and where — they supply the origin they actually use.
      printServerReady({ ...base, externalBaseOrigin: null });

      expect(row('API').trim()).toMatch(/API:\s+\/$/);
      expect(row('Console').trim()).toMatch(/Console:\s+\/_console\/$/);
      expect(row('MCP').trim()).toMatch(/MCP:\s+\/api\/v1\/mcp$/);
      expect(skillRow()).toContain('skill: /api/v1/mcp/skill');
    });

    it('says why the origin is missing and names the variable that fixes it', () => {
      printServerReady({ ...base, externalBaseOrigin: null });

      const banner = lines.join('\n');
      expect(banner).toContain('external base URL could not be resolved');
      expect(banner).toContain('OS_AUTH_URL');
    });

    it('does not print the hint when the base IS resolved', () => {
      printServerReady({ ...base, externalBaseOrigin: 'https://app.example.com' });
      expect(lines.join('\n')).not.toContain('could not be resolved');
    });

    it('drops the origin from the MCP lines even when the Console is off', () => {
      // The MCP line is the paste target; it must not keep an origin of its own
      // on any boot shape.
      printServerReady({ ...base, uiEnabled: false, consolePath: undefined, externalBaseOrigin: null });

      expect(row('Console')).toBe('');
      expect(row('MCP').trim()).toMatch(/MCP:\s+\/api\/v1\/mcp$/);
      expect(skillRow()).toContain('skill: /api/v1/mcp/skill');
      expect(lines.join('\n')).not.toMatch(guessedUrl);
    });
  });

  it('cannot compose an address from a port at COMPILE time', () => {
    // The structural half of the fix, checked by `pnpm typecheck` (tests are
    // type-checked — AGENTS.md) rather than by the assertion below: `port` is
    // gone from the options, so re-deriving `http://localhost:<port>` inside
    // the banner is no longer expressible, and a caller that forgets to resolve
    // an origin fails to compile instead of silently getting localhost back.
    // @ts-expect-error — `port` was removed with #10646; nothing reads it.
    printServerReady({ ...base, externalBaseOrigin: null, port: 3000 });
    expect(lines.some((l) => l.includes('Server is ready'))).toBe(true);
  });
});

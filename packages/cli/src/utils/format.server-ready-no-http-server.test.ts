// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printServerReady, type ServerReadyOptions } from './format.js';

/**
 * #23623 — the ready banner's address rows rest on an HTTP server being
 * composed.
 *
 * `os serve --no-server` printed, measured in production on a fixture with
 * one object:
 *
 *     ➜  API:       http://localhost:33117/
 *     ➜  MCP:       http://localhost:33117/api/v1/mcp
 *         connect an AI client (Claude Code, Cursor, …) · skill: …
 *
 * and a `GET` to that port failed with `fetch failed`: nothing listened. So the
 * banner sent an operator, or an AI client configured from it, to a server the
 * flag had deliberately not started.
 *
 * The two shapes pinned here:
 *
 *   - composed: the address rows print exactly as before;
 *   - not composed: none of them (`API:`, `Console:`, `MCP:` and its connect
 *     hint, the paths-only note) and ONE line saying no HTTP server is served,
 *     which names `--no-server` only when that flag is the cause.
 *
 * Every row that names no address is the same in both, the ready line
 * included.
 */

/** Every banner line that names an address, or is about an address's origin. */
const ADDRESS_ROW = /\b(?:API|Console|MCP):|connect an AI client|paths only|set OS_AUTH_URL/;
/** The banner's own no-server row, anchored so a plugin's "No HTTP server available" diagnostic is not it. */
const NO_SERVER_LINE = /➜\s+No HTTP server:/;

/** A banner with every address row switched on, and rows that name no address. */
const FULL: ServerReadyOptions = {
  externalBaseOrigin: 'http://localhost:3000',
  httpServer: 'composed',
  configFile: 'objectstack.config.ts',
  isDev: true,
  pluginCount: 2,
  pluginNames: ['ObjectQL', 'HonoServer'],
  uiEnabled: true,
  consolePath: '/_console',
  mcpEnabled: true,
  driverLabel: 'SqlDriver(better-sqlite3)',
  tenancyPosture: 'single',
  seededAdmin: { email: 'admin@objectos.ai', password: 'admin123' },
  devHint: 'run pnpm seed:demo first',
};

let lines: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  lines = [];
  // stderr, not stdout (#7915). SGR stripped so the pins hold with or without colour.
  spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' ').replace(/\u001b\[[0-9;]*m/g, ''));
  });
});

afterEach(() => spy.mockRestore());

function render(opts: ServerReadyOptions): string[] {
  lines = [];
  printServerReady(opts);
  return lines;
}

describe('printServerReady — an HTTP server is composed (#23623)', () => {
  it('prints every address row as before, and no no-server line', () => {
    const out = render(FULL);
    expect(out.find((l) => l.includes('API:'))).toContain('http://localhost:3000/');
    expect(out.find((l) => l.includes('Console:'))).toContain('http://localhost:3000/_console/');
    expect(out.find((l) => l.includes('MCP:'))).toContain('http://localhost:3000/api/v1/mcp');
    expect(out.find((l) => l.includes('skill:'))).toContain('http://localhost:3000/api/v1/mcp/skill');
    expect(out.filter((l) => NO_SERVER_LINE.test(l))).toEqual([]);
  });

  it('still prints the paths-only note when the origin is unknown', () => {
    const out = render({ ...FULL, externalBaseOrigin: null });
    expect(out.some((l) => l.includes('paths only'))).toBe(true);
    expect(out.find((l) => l.includes('API:'))).toMatch(/API:\s+\/$/);
  });
});

describe('printServerReady — no HTTP server is composed (#23623)', () => {
  it('under --no-server: no address row, even with MCP on, and one line naming the flag', () => {
    const out = render({ ...FULL, httpServer: 'skipped-by-no-server' });
    const seen = `\n--- banner ---\n${out.join('\n')}`;

    expect(out.filter((l) => ADDRESS_ROW.test(l)), `an address row printed${seen}`).toEqual([]);
    // No address at all: the only origin this banner knows is the one it was handed.
    expect(out.join('\n'), `an address printed${seen}`).not.toContain('http://');

    const said = out.filter((l) => NO_SERVER_LINE.test(l));
    expect(said, `not exactly one no-server line${seen}`).toHaveLength(1);
    expect(said[0], `the line does not name the flag that caused it${seen}`).toContain('--no-server');
  });

  it('with the flag on but no transport composed: the one line, and it does not blame --no-server', () => {
    const out = render({ ...FULL, httpServer: 'not-composed' });
    const seen = `\n--- banner ---\n${out.join('\n')}`;

    expect(out.filter((l) => ADDRESS_ROW.test(l)), `an address row printed${seen}`).toEqual([]);
    const said = out.filter((l) => NO_SERVER_LINE.test(l));
    expect(said, `not exactly one no-server line${seen}`).toHaveLength(1);
    expect(said[0], `the line names a flag that was not given${seen}`).not.toContain('--no-server');
  });

  it('drops the paths-only note with the rows it is about', () => {
    const out = render({ ...FULL, httpServer: 'skipped-by-no-server', externalBaseOrigin: null });
    expect(out.filter((l) => ADDRESS_ROW.test(l))).toEqual([]);
    expect(out.filter((l) => NO_SERVER_LINE.test(l))).toHaveLength(1);
  });

  // ⭐ The other half of the ruling: only the address rows move. Each banner,
  // minus the lines that differ by design, must be the same banner.
  for (const httpServer of ['skipped-by-no-server', 'not-composed'] as const) {
    for (const missingCoreServices of [[], ['auth', 'job']]) {
      it(`leaves every row that names no address unchanged (${httpServer}, missing core: ${missingCoreServices.length})`, () => {
        const composed = render({ ...FULL, missingCoreServices });
        const without = render({ ...FULL, missingCoreServices, httpServer });

        const composedRest = composed.filter((l) => !ADDRESS_ROW.test(l));
        const withoutRest = without.filter((l) => !NO_SERVER_LINE.test(l));
        // Something was actually removed and something kept, or the equality is vacuous.
        expect(composed.length - composedRest.length).toBeGreaterThanOrEqual(4);
        expect(withoutRest.length).toBeGreaterThan(10);
        expect(withoutRest).toEqual(composedRest);
        // The ready line, `✓` or DEGRADED, is the same line in both.
        expect(without.find((l) => l.includes('Server is ready'))).toBe(composed.find((l) => l.includes('Server is ready')));
      });
    }
  }
});

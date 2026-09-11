// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#16734 — `os dev`'s MCP connect hint names the origin an MCP client
// can REACH, and the ready banner printed in the same boot agrees with it.
//
// ## Why both printers are driven into ONE buffer
//
// The defect was never visible inside either printer. `os dev` prints two MCP
// addresses from two processes: the serve child's ready banner (`➜  MCP:`,
// `printServerReady`, resolved through `resolveAuthBaseUrl`) and the parent's
// `🤖 MCP server — connect a coding agent` block, which used to be built from
// the child's `objectstack:listening` `url` — the socket it BOUND. Each was
// self-consistent; the bug was that one boot output carried both, saying
// `https://localhost:4443/…` on one row and `http://localhost:4001/…` on the
// next. A pin that reads only the block cannot see that, so every case below
// captures BOTH printers into one ordered buffer and asserts on the whole
// thing — `console.error` (the banner) and `console.log` (the hint) in call
// order, exactly as a terminal renders them.
//
// ## The chain is not restated here
//
// No case below writes the precedence order down as a literal. Both printers
// go through `resolveAuthBaseUrl`, whose own pins live in
// `serve-auth-base-url-diagnostic.test.ts`; what this file asserts is that the
// two printers consult THAT function and therefore cannot disagree.
//
// The parent resolves in its own process, which is sound because it hands the
// child its own `process.env` (plus internal keys) and both run
// `dotenvFlow.config({ node_env: 'development' })` over the same files before
// any lookup. The last case pins the half of that a runtime assertion cannot:
// that dev's child-env literal never sets a chain variable.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printMcpConnectHint } from './dev.js';
import { AUTH_BASE_URL_ENV_NAMES, resolveAuthBaseUrl } from './serve.js';
import { printServerReady, type ServerReadyOptions } from '../utils/format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV_SOURCE = readFileSync(resolve(HERE, 'dev.ts'), 'utf8');

const bannerOpts: Omit<ServerReadyOptions, 'externalBaseOrigin'> = {
  configFile: 'objectstack.config.ts',
  isDev: true,
  pluginCount: 1,
  uiEnabled: true,
  consolePath: '/_console',
  mcpEnabled: true,
};

/** Every absolute MCP address anywhere in the captured output, deduplicated. */
const mcpOrigins = (output: string): string[] =>
  [...new Set([...output.matchAll(/(https?:\/\/[^\s]+?)\/api\/v1\/mcp/g)].map((m) => m[1]))];

describe('os dev MCP connect hint — origin (#16734)', () => {
  const saved: Partial<Record<(typeof AUTH_BASE_URL_ENV_NAMES)[number], string | undefined>> = {};

  let lines: string[];
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const record = (...args: unknown[]) => {
    lines.push(args.join(' ').replace(/\u001b\[[0-9;]*m/g, ''));
  };

  beforeEach(() => {
    for (const n of AUTH_BASE_URL_ENV_NAMES) {
      saved[n] = process.env[n];
      delete process.env[n];
    }
    lines = [];
    errSpy = vi.spyOn(console, 'error').mockImplementation(record);
    logSpy = vi.spyOn(console, 'log').mockImplementation(record);
  });

  afterEach(() => {
    errSpy.mockRestore();
    logSpy.mockRestore();
    for (const n of AUTH_BASE_URL_ENV_NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });

  /**
   * One `os dev` boot, both printers, in the order a reader sees them: the
   * child's banner (its own call site's expression, verbatim) and then the
   * parent's connect hint, both told the port the server ACTUALLY bound.
   */
  const boot = (boundPort: number, name = 'hotcrm', boundProtocol: 'http' | 'https' = 'http') => {
    printServerReady({
      ...bannerOpts,
      externalBaseOrigin: resolveAuthBaseUrl(boundPort, boundProtocol).baseOrigin,
    });
    printMcpConnectHint({ boundPort, name, boundProtocol });
    return lines.join('\n');
  };

  /**
   * The same boot with the protocol argument WITHHELD from both printers — the
   * expression this file carried before `--cert`/`--key` existed, character for
   * character.
   *
   * ⭐ This is the ABLATION LEG for acceptance 2 (「无 flag 时逐字节等于今天」,
   * #16804). The pins below drive it beside {@link boot}'s no-flag case and
   * require the two to be byte-identical, so the claim "nothing changes without
   * the flags" is measured rather than asserted: it would go red the day the
   * derived protocol leaked into the default, and it cannot pass by both legs
   * being broken in the same direction.
   */
  const bootWithoutProtocolArg = (boundPort: number, name = 'hotcrm') => {
    printServerReady({ ...bannerOpts, externalBaseOrigin: resolveAuthBaseUrl(boundPort).baseOrigin });
    printMcpConnectHint({ boundPort, name });
    return lines.join('\n');
  };

  // ── Acceptance 1 ────────────────────────────────────────────────────────
  describe('with OS_AUTH_URL set, all three hint lines and the banner row agree', () => {
    it('reproduces #16530: dev -p 4001 behind OS_AUTH_URL=https://localhost:4443', () => {
      process.env.OS_AUTH_URL = 'https://localhost:4443';

      const output = boot(4001);

      // The banner row and each of the three block lines, from ONE capture.
      expect(output).toContain('MCP:       https://localhost:4443/api/v1/mcp');
      expect(output).toContain('Endpoint  https://localhost:4443/api/v1/mcp');
      expect(output).toContain('Skill     https://localhost:4443/api/v1/mcp/skill');
      expect(output).toContain(
        'Connect   claude mcp add --transport http hotcrm https://localhost:4443/api/v1/mcp',
      );

      // The reported symptom, stated as the absence it is: the bound socket
      // must not appear anywhere in the boot output that advertises MCP.
      expect(output).not.toContain('localhost:4001');
      // And the agreement itself, independent of which rows were named above.
      expect(mcpOrigins(output)).toEqual(['https://localhost:4443']);
    });

    it('follows the deployment onto its public origin, port and all', () => {
      process.env.OS_AUTH_URL = 'https://app.example.com';
      expect(mcpOrigins(boot(3000))).toEqual(['https://app.example.com']);

      lines.length = 0;
      process.env.OS_AUTH_URL = 'https://app.example.com:8443';
      expect(mcpOrigins(boot(3000))).toEqual(['https://app.example.com:8443']);
    });

    it('honours the rest of the chain — the legacy name, then OS_BASE_URL', () => {
      process.env.BETTER_AUTH_URL = 'https://legacy.example.com';
      process.env.OS_BASE_URL = 'https://base.example.com';
      expect(mcpOrigins(boot(3000))).toEqual(['https://legacy.example.com']);

      lines.length = 0;
      delete process.env.BETTER_AUTH_URL;
      expect(mcpOrigins(boot(3000))).toEqual(['https://base.example.com']);
    });
  });

  // ── Acceptance 2 — the negative control ─────────────────────────────────
  describe('with OS_AUTH_URL unset, the hint still prints the LISTEN origin', () => {
    it('names the bound port on an ordinary local boot', () => {
      const output = boot(3000, 'my-app');

      expect(output).toContain('MCP:       http://localhost:3000/api/v1/mcp');
      expect(output).toContain('Endpoint  http://localhost:3000/api/v1/mcp');
      expect(output).toContain('Skill     http://localhost:3000/api/v1/mcp/skill');
      expect(output).toContain(
        'Connect   claude mcp add --transport http my-app http://localhost:3000/api/v1/mcp',
      );
      expect(mcpOrigins(output)).toEqual(['http://localhost:3000']);
    });

    it("follows dev's auto-shifted port — 3000 busy, bound 3001", () => {
      // The case the surrounding code exists to handle. A fix that reached for
      // a canonical origin instead of the resolver would print :3000 here, or
      // nothing at all; both are worse than the behaviour being repaired.
      const output = boot(3001, 'my-app');

      expect(output).toContain('Endpoint  http://localhost:3001/api/v1/mcp');
      expect(output).toContain(
        'Connect   claude mcp add --transport http my-app http://localhost:3001/api/v1/mcp',
      );
      expect(output).not.toContain('3000');
      expect(mcpOrigins(output)).toEqual(['http://localhost:3001']);
    });

    it('names an ephemeral bound port, never the 0 that was requested', () => {
      expect(mcpOrigins(boot(45064))).toEqual(['http://localhost:45064']);
    });
  });

  // ── Acceptance 3 — the unusable-value cases stay the resolver's, unchanged ─
  describe('an unusable base URL prints no connect command, and no guess', () => {
    it('set-but-empty OS_AUTH_URL: banner prints paths only, the hint prints nothing', () => {
      // Empty is not unset — the chain stops there, so neither OS_BASE_URL nor
      // the localhost tail is consulted. `resolveAuthBaseUrl` reports that as
      // `baseOrigin: null` (its own pins own that behaviour); what this asserts
      // is that BOTH printers obey it. A `claude mcp add` line has no
      // paths-only form, so the block is omitted rather than fabricated.
      process.env.OS_AUTH_URL = '';
      process.env.OS_BASE_URL = 'https://never-consulted.example.com';

      const output = boot(3000);

      expect(output).toContain('/api/v1/mcp');
      expect(mcpOrigins(output)).toEqual([]);
      expect(output).not.toContain('http://localhost:3000');
      expect(output).not.toContain('never-consulted');
      expect(output).not.toContain('claude mcp add');
      expect(output).toContain('OS_AUTH_URL');
    });

    it('a value with no scheme is not smuggled in as an origin either', () => {
      process.env.OS_AUTH_URL = 'app.example.com';

      const output = boot(3000);

      expect(mcpOrigins(output)).toEqual([]);
      expect(output).not.toContain('claude mcp add');
      expect(output).not.toContain('http://localhost:3000');
      expect(output).not.toContain('app.example.com/api/v1/mcp');
    });
  });

  // ── #16804 ─ a TLS listener, and the three surfaces that follow it ──────
  describe('under --cert/--key the derived origin is https, and everything follows', () => {
    it('acceptance 1: with OS_AUTH_URL UNSET, banner and hint both give https', () => {
      // Every chain variable is deleted by `beforeEach`, so the only thing
      // that can produce `https` here is the listener protocol reaching the
      // resolver's built-in tail.
      const output = boot(3000, 'hotcrm', 'https');

      expect(output).toContain('MCP:       https://localhost:3000/api/v1/mcp');
      expect(output).toContain('Endpoint  https://localhost:3000/api/v1/mcp');
      expect(output).toContain('Skill     https://localhost:3000/api/v1/mcp/skill');
      expect(output).toContain(
        'Connect   claude mcp add --transport http hotcrm https://localhost:3000/api/v1/mcp',
      );
      // The plain-http address must not appear anywhere in a TLS boot's output:
      // it is the one address a client on this port cannot reach.
      expect(output).not.toContain('http://localhost:3000');
      expect(mcpOrigins(output)).toEqual(['https://localhost:3000']);
    });

    it("follows dev's auto-shifted port under TLS too", () => {
      expect(mcpOrigins(boot(3001, 'hotcrm', 'https'))).toEqual(['https://localhost:3001']);
    });

    it('acceptance 3: `OS_AUTH_URL` still WINS over the derived https origin', () => {
      // The override direction that matters in practice: a developer
      // terminating TLS locally but reached through a tunnel on another host.
      process.env.OS_AUTH_URL = 'https://tunnel.example.com';
      expect(mcpOrigins(boot(3000, 'hotcrm', 'https'))).toEqual(['https://tunnel.example.com']);
    });

    it('acceptance 3, the awkward direction: an http OS_AUTH_URL wins as well', () => {
      // ⛔ Deliberately NOT "upgraded" to https. `OS_AUTH_URL` names where the
      // deployment is REACHED — behind a TLS-terminating proxy that forwards
      // plain http, or in a test harness, that is a deliberate statement about
      // a different hop, and a default has no standing to overrule it.
      process.env.OS_AUTH_URL = 'http://proxied.example.com';
      expect(mcpOrigins(boot(3000, 'hotcrm', 'https'))).toEqual(['http://proxied.example.com']);
    });

    it('the rest of the configured chain keeps its precedence under TLS', () => {
      process.env.OS_BASE_URL = 'https://base.example.com';
      expect(mcpOrigins(boot(3000, 'hotcrm', 'https'))).toEqual(['https://base.example.com']);
    });

    it('an unusable value stays unusable — TLS does not manufacture an origin', () => {
      process.env.OS_AUTH_URL = '';
      const output = boot(3000, 'hotcrm', 'https');
      expect(mcpOrigins(output)).toEqual([]);
      expect(output).not.toContain('claude mcp add');
      expect(output).not.toContain('https://localhost:3000');
    });
  });

  // ── #16804 ─ acceptance 2, as an ABLATION rather than a claim ──────────
  describe('without the flags the output is byte-for-byte what it was', () => {
    it('the no-flag boot equals the boot that never passes a protocol at all', () => {
      // Leg A: the call shape this file used before `--cert`/`--key` existed.
      const before = bootWithoutProtocolArg(3000, 'my-app');
      lines.length = 0;
      // Leg B: the same boot through today's call shape, no flags given.
      const after = boot(3000, 'my-app', 'http');

      expect(after).toBe(before);
      // And the byte the two legs are about: still plain http, on the bound port.
      expect(mcpOrigins(after)).toEqual(['http://localhost:3000']);
    });

    it('the two legs also agree on an auto-shifted port and an ephemeral one', () => {
      for (const port of [3001, 45064]) {
        lines.length = 0;
        const before = bootWithoutProtocolArg(port, 'my-app');
        lines.length = 0;
        expect(boot(port, 'my-app', 'http')).toBe(before);
      }
    });

    it('and the legs DISCRIMINATE — the https leg differs from both', () => {
      // Without this, two legs that both silently produced nothing would pass.
      const plain = bootWithoutProtocolArg(3000, 'my-app');
      lines.length = 0;
      const tls = boot(3000, 'my-app', 'https');

      expect(tls).not.toBe(plain);
      expect(mcpOrigins(plain)).toEqual(['http://localhost:3000']);
      expect(mcpOrigins(tls)).toEqual(['https://localhost:3000']);
    });
  });

  // ── What only the source can say ────────────────────────────────────────
  describe('the call site feeds the printer the bound port, and nothing else', () => {
    it('hands `printMcpConnectHint` the ACTUALLY BOUND port', () => {
      expect(DEV_SOURCE).toContain('printMcpConnectHint({');
      expect(DEV_SOURCE).toContain('boundPort: actual,');
    });

    it('hands it the protocol it FORWARDED, not one derived a second time (#16804)', () => {
      // The parent's `boundProtocol` comes from the same `tlsIntent` that built
      // the child's argv, so the scheme the hint prints and the scheme the
      // child bound cannot part company. A second `resolveDevTlsIntent` call
      // here would be a second reader, free to disagree.
      expect(DEV_SOURCE).toContain('boundProtocol,');
      expect(DEV_SOURCE).toContain('const boundProtocol: ListenerProtocol = listenerProtocol(tlsIntent);');
      expect(DEV_SOURCE.match(/resolveDevTlsIntent\(/g) ?? []).toHaveLength(1);
    });

    it('forwards the cert/key PATHS to the serve child through the shared contract', () => {
      expect(DEV_SOURCE).toContain('...devTlsChildArgs(tlsIntent),');
      // ⛔ and never the bytes: one reader of the file, one owner of the refusal.
      expect(DEV_SOURCE).not.toContain('readDevTlsMaterial');
      expect(DEV_SOURCE).not.toContain('readFileSync(flags.cert');
    });

    it('builds no address out of the listening message any more', () => {
      // The defect in one line: `base` came from `msg.url`, the bound socket.
      expect(DEV_SOURCE).not.toMatch(/msg\.url/);
    });

    it('never sets a base-URL chain variable in the child env it spawns', () => {
      // The parent resolves the chain in ITS process and the child resolves it
      // again in its own; the two answers are the same value only while dev
      // passes these variables through untouched.
      const start = DEV_SOURCE.indexOf('const localEnv: NodeJS.ProcessEnv = {');
      expect(start).toBeGreaterThan(-1);
      const childEnvLiteral = DEV_SOURCE.slice(start, DEV_SOURCE.indexOf('\n      };', start));
      for (const name of AUTH_BASE_URL_ENV_NAMES) {
        expect(childEnvLiteral).not.toContain(name);
      }
    });
  });
});

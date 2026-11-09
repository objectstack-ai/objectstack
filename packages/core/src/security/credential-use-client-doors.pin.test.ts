// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31898] The door census of the `credential_use` row's client facts: every
 * door that can admit an API key hands the key-admission seam what it holds
 * about where the request came from, so no door writes the row's address as
 * `not_supplied`.
 *
 * ## How a door is found, mechanically
 *
 * A key's use is recorded by the key-admission seam (`resolveApiKeyAdmission`,
 * `./api-key.ts`), and a door reaches it through one of four exported
 * functions: the composition `resolveRequestExecutionContext`, the resolver
 * `resolveAuthzContext`, the seam itself, or `resolveApiKeyPrincipal`. Every
 * CALL of one of them in a non-test `.ts` source under `packages/` must be
 * classified in {@link CALLERS} with its exact count per function. An
 * unclassified file, a count that moved, or a classified file that no longer
 * calls turns this red: a new door is classified before it lands.
 *
 * ## What a door owes, per call
 *
 *  - `resolveRequestExecutionContext`: `transport: { remoteAddress }`, unless
 *    the call is `credentials: 'session-only'` (it reads no key, so no row is
 *    written), which states `transport: undefined`.
 *  - `resolveAuthzContext`: a `client:` (from `credentialUseClientFor`, or the
 *    stdio literal).
 *  - `resolveApiKeyAdmission`: its trailing `client` argument (the seventh).
 *  - `resolveApiKeyPrincipal`: no door may call it, since it takes no client.
 *
 * The facts' VALUE is held by each door's own behaviour pin, named in
 * {@link CALLERS}; this file holds that every call hands some.
 *
 * The scan surface and its prefilter follow `row-serving-door-exposure.pin.test.ts`
 * in this directory: git's authored-file list, `.ts` only, the radius this
 * package declares in the cross-package test-inputs table, which is also why
 * this file is listed in this package's `repo` vitest project.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

// The one code/prose separator, typed by its `.d.mts` sibling.
import { maskComments, maskCommentsAndLiterals } from '../../../../scripts/js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/core/src/security → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');

const SEAMS = ['resolveRequestExecutionContext', 'resolveAuthzContext', 'resolveApiKeyAdmission', 'resolveApiKeyPrincipal'] as const;
type Seam = (typeof SEAMS)[number];

type Classification =
  | {
      kind: 'door';
      /** The door, in words. */
      door: string;
      calls: Partial<Record<Seam, number>>;
      /** The behaviour pin that holds the door's facts to the row. */
      pin: string;
    }
  | {
      kind: 'session-only';
      door: string;
      calls: Partial<Record<Seam, number>>;
    }
  | {
      kind: 'seam';
      /** Why the call relays facts rather than holding a request. */
      reason: string;
      calls: Partial<Record<Seam, number>>;
    };

const AUDIT_PIN = 'packages/plugins/plugin-audit/src/credential-use-audit.integration.test.ts';

/** Every non-test caller of the four functions, classified. */
const CALLERS: Record<string, Classification> = {
  // ── The seam and the composition: they relay what the door handed. ──
  'packages/core/src/security/api-key.ts': {
    kind: 'seam',
    reason:
      '`resolveApiKeyPrincipal` calls the seam without a client; it has no production caller, and the census refuses one '
      + '(it takes no client to hand on)',
    calls: { resolveApiKeyAdmission: 1 },
  },
  'packages/core/src/security/resolve-authz-context.ts': {
    kind: 'seam',
    reason: 'the resolver relays its own `client` input to the seam',
    calls: { resolveApiKeyAdmission: 1 },
  },
  'packages/core/src/security/request-execution-context.ts': {
    kind: 'seam',
    reason: 'the composition turns its required `transport` into the resolver\'s `client` through `credentialUseClientFor`',
    calls: { resolveAuthzContext: 1 },
  },
  'packages/qa/dogfood/test/armed.ts': {
    kind: 'seam',
    reason: 'the dogfood suite\'s armed-kernel helper, not a door: it resolves a context for its own tests and serves no request',
    calls: { resolveAuthzContext: 1 },
  },
  'packages/plugins/plugin-sharing/src/exec-context-seam.testkit.ts': {
    kind: 'seam',
    reason: 'a test kit, not a door: it drives the resolver for plugin-sharing\'s own tests and serves no request',
    calls: { resolveAuthzContext: 1 },
  },

  // ── Doors wired by #31821: the CONTROL. ──
  'packages/rest/src/rest-server.ts': {
    kind: 'door',
    door: 'REST (the data and package routes)',
    calls: { resolveRequestExecutionContext: 1 },
    pin: 'packages/rest/src/rest-api-key-lifecycle.pin.test.ts',
  },
  'packages/runtime/src/security/resolve-execution-context.ts': {
    kind: 'door',
    door: 'the runtime dispatcher, `/mcp` included',
    calls: { resolveRequestExecutionContext: 1 },
    pin: 'packages/runtime/src/security/resolve-execution-context.test.ts',
  },
  'packages/mcp/src/plugin.ts': {
    kind: 'door',
    door: 'the MCP stdio transport (`client: { transport: \'stdio\' }`)',
    calls: { resolveAuthzContext: 1 },
    pin: 'packages/mcp/src/__tests__/plugin-execution-context.test.ts',
  },

  // ── Doors wired by #31898. ──
  'packages/core/src/security/own-row-delete-routes.ts': {
    kind: 'door',
    door: 'the own-row delete doors',
    calls: { resolveRequestExecutionContext: 1 },
    pin: 'packages/core/src/security/own-row-delete-routes.test.ts',
  },
  'packages/services/service-storage/src/storage-service-plugin.ts': {
    kind: 'door',
    door: 'storage: the family gate reader, the parent-governed download and the upload attacher',
    calls: { resolveApiKeyAdmission: 1, resolveRequestExecutionContext: 2 },
    pin: 'packages/services/service-storage/src/storage-credential-use-client.test.ts',
  },
  'packages/services/service-settings/src/settings-service-plugin.ts': {
    kind: 'door',
    door: 'the settings routes',
    calls: { resolveRequestExecutionContext: 1 },
    pin: 'packages/services/service-settings/src/settings-routes.api-key-account-posture.pin.test.ts',
  },
  'packages/plugins/plugin-sharing/src/shareable-objects-routes.ts': {
    kind: 'door',
    door: 'the shareable-objects route',
    calls: { resolveRequestExecutionContext: 1 },
    pin: 'packages/plugins/plugin-sharing/src/shareable-objects.test.ts',
  },
  'packages/plugins/plugin-sharing/src/sharing-plugin.ts': {
    kind: 'door',
    door: 'the sharing routes',
    calls: { resolveAuthzContext: 1 },
    pin: 'packages/plugins/plugin-sharing/src/share-link-routes.api-key-account-posture.pin.test.ts',
  },
  'packages/services/service-messaging/src/preference-options-routes.ts': {
    kind: 'door',
    door: 'the notification preference options route',
    calls: { resolveRequestExecutionContext: 1 },
    pin: 'packages/services/service-messaging/src/preference-options-routes.integration.test.ts',
  },
  'packages/plugins/plugin-auth/src/auth-plugin.ts': {
    kind: 'door',
    door: 'the organization settings door (the second call is the session-only org-scope read, below)',
    calls: { resolveRequestExecutionContext: 2 },
    pin: 'packages/plugins/plugin-auth/src/allowed-ip-ranges.pin.test.ts',
  },
  'packages/cloud-connection/src/cloud-connection-plugin.ts': {
    kind: 'door',
    door: 'the cloud-connection platform-settings check',
    calls: { resolveAuthzContext: 1 },
    pin: 'packages/cloud-connection/src/cloud-connection-setup-access.pin.test.ts',
  },
  'packages/cloud-connection/src/marketplace-install-local-plugin.ts': {
    kind: 'door',
    door: 'the local marketplace install doors',
    calls: { resolveAuthzContext: 1 },
    pin: 'packages/cloud-connection/src/marketplace-install-local-api-key-account-posture.pin.test.ts',
  },
  'packages/services/service-datasource/src/admin-routes.ts': {
    kind: 'door',
    door: 'the datasource admin routes',
    calls: { resolveAuthzContext: 1 },
    pin: 'packages/services/service-datasource/src/__tests__/admin-routes-api-key-account-posture.pin.test.ts',
  },
  'packages/services/service-print/src/print-routes.ts': {
    kind: 'door',
    door: 'the print route',
    calls: { resolveAuthzContext: 1 },
    pin: 'packages/services/service-print/src/print-routes.test.ts',
  },

  // ── Session-only doors: they read no API key and write no `credential_use` row. ──
  'packages/plugins/plugin-hono-server/src/current-user-endpoints.ts': {
    kind: 'session-only',
    door: 'the `/auth/me` endpoints',
    calls: { resolveRequestExecutionContext: 1 },
  },
  'packages/plugins/plugin-webhooks/src/redeliver-entitlement.ts': {
    kind: 'session-only',
    door: 'the webhook redelivery entitlement',
    calls: { resolveRequestExecutionContext: 1 },
  },
  'packages/cloud-connection/src/runtime-config-plugin.ts': {
    kind: 'session-only',
    door: 'the runtime-config timing gate',
    calls: { resolveRequestExecutionContext: 1 },
  },
};

const SCAN_TIMEOUT_MS = 60_000;

function git(args: string[]): string[] {
  let stdout: string;
  try {
    stdout = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    // `git grep` exits 1 for "found nothing", which is data. Anything else is a
    // broken scan and must not read as "no callers".
    if (failure.status === 1) return [];
    throw new Error(`git ${args.join(' ')} failed with status ${String(failure.status)}: ${failure.stderr ?? ''}`);
  }
  return stdout.split('\0').filter((line) => line.length > 0);
}

const isScannedSource = (path: string) =>
  path.endsWith('.ts') && !path.endsWith('.d.ts') && !/\.(test|spec)\.ts$/.test(path);

/**
 * The two projections of a source the scan reads, from the repo's one
 * code/prose separator (`scripts/js-comment-mask.mjs`), never a regex here: a
 * `/*` inside a template (`${basePath}/*`) opens no comment. `code` blanks
 * comments AND literal contents, so a docblock or a string that names a seam
 * is not a call and a quoted paren never unbalances one; `text` blanks only
 * comments, so a call's argument text still reads `credentials: 'session-only'`.
 * Both keep every offset, so a call located on `code` indexes `text` alike.
 */
interface Projections {
  code: string;
  text: string;
}
function codeOf(source: string): Projections {
  return { code: maskCommentsAndLiterals(source), text: maskComments(source) };
}

/** The text between a call's opening parenthesis (at `open`) and its matching close. */
function argumentsAt(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced call');
}

/** Top-level comma-separated arguments of a call's argument text. */
function topLevelArguments(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out.map((a) => a.trim()).filter((a) => a.length > 0);
}

interface SeamCall {
  seam: Seam;
  /** The argument text with comments blanked: literals read as written. */
  args: string;
  /** The same span with literal contents blanked too: where the commas that split arguments are. */
  argsCode: string;
}

/** Every CALL of the four functions in `code` (a definition is not a call). */
function seamCallsOf({ code, text }: Projections): SeamCall[] {
  const calls: SeamCall[] = [];
  const re = new RegExp(`\\b(${SEAMS.join('|')})\\s*\\(`, 'g');
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (/\bfunction\s+$/.test(code.slice(Math.max(0, m.index - 16), m.index))) continue;
    const open = m.index + m[0].length - 1;
    const argsCode = argumentsAt(code, open);
    calls.push({ seam: m[1] as Seam, args: text.slice(open + 1, open + 1 + argsCode.length), argsCode });
  }
  return calls;
}

/** Whether a call hands its client facts, or why not, per the rules in the module docblock. */
function handsFacts(call: SeamCall): true | string {
  switch (call.seam) {
    case 'resolveRequestExecutionContext':
      if (/\bcredentials\s*:\s*'session-only'/.test(call.args)) {
        return /\btransport\s*:\s*undefined\b/.test(call.args) ? true : 'a session-only call states `transport: undefined`';
      }
      return /\btransport\s*:\s*\{/.test(call.args) ? true : 'hands no `transport: { remoteAddress }`';
    case 'resolveAuthzContext':
      return /\bclient\s*:\s*(?!undefined\b)\S/.test(call.args) ? true : 'hands no `client`';
    case 'resolveApiKeyAdmission':
      return topLevelArguments(call.argsCode).length >= 7 ? true : 'hands no trailing `client` argument';
    case 'resolveApiKeyPrincipal':
      return '`resolveApiKeyPrincipal` takes no client; call `resolveApiKeyAdmission` with one';
  }
}

interface ScannedFile {
  file: string;
  calls: SeamCall[];
}

let scanned: ScannedFile[];

function scanTree(): ScannedFile[] {
  const prefiltered = new Set<string>();
  for (const seam of SEAMS) {
    for (const file of git(['grep', '--files-with-matches', '-z', '--untracked', '--fixed-strings', '-e', seam, '--', ':(glob)packages/**/*.ts'])) {
      if (isScannedSource(file)) prefiltered.add(file);
    }
  }
  return [...prefiltered]
    .sort()
    .map((file) => ({ file, calls: seamCallsOf(codeOf(readFileSync(join(REPO_ROOT, file), 'utf8'))) }))
    .filter((f) => f.calls.length > 0);
}

const countsOf = (calls: SeamCall[]): Partial<Record<Seam, number>> => {
  const out: Partial<Record<Seam, number>> = {};
  for (const c of calls) out[c.seam] = (out[c.seam] ?? 0) + 1;
  return out;
};

describe('[#31898] every door that can admit an API key hands its client facts to the credential_use row', () => {
  beforeAll(() => {
    scanned = scanTree();
  }, SCAN_TIMEOUT_MS);

  it(
    'every caller of the four functions is classified, at its exact count, and every classified file still calls',
    () => {
      const found = scanned.map((f) => f.file);
      const unclassified = found.filter((file) => !(file in CALLERS));
      const stale = Object.keys(CALLERS).filter((file) => !found.includes(file));
      expect(
        unclassified,
        [
          'These sources call a key-admitting function, which is how a door that admits an API key looks, and this',
          'census does not know them:',
          ...unclassified.map((f) => `  - ${f}`),
          '',
          'Classify each in CALLERS. A door hands its client facts: `transport: { remoteAddress }` to',
          '`resolveRequestExecutionContext`, or `client: credentialUseClientFor(authService, { headers, remoteAddress })`',
          'to `resolveAuthzContext` / `resolveApiKeyAdmission`, and carries a behaviour pin in its own package.',
        ].join('\n'),
      ).toEqual([]);
      expect(stale, 'These classified files no longer call a key-admitting function; re-classify or remove them.').toEqual([]);
      for (const { file, calls } of scanned) {
        expect(countsOf(calls), `${file}: the calls moved; re-classify each new call`).toEqual(CALLERS[file].calls);
      }
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'every door call hands its client facts, and every session-only call reads no key',
    () => {
      const missing: string[] = [];
      for (const { file, calls } of scanned) {
        const entry = CALLERS[file];
        if (!entry || entry.kind === 'seam') continue;
        for (const call of calls) {
          const verdict = handsFacts(call);
          if (verdict !== true) missing.push(`${file} (${call.seam}): ${verdict}`);
          const sessionOnly = /\bcredentials\s*:\s*'session-only'/.test(call.args);
          if (entry.kind === 'session-only' && !sessionOnly) missing.push(`${file}: classified session-only, but opens the API-key door`);
        }
      }
      expect(missing, 'These doors admit an API key without handing where the request came from; the row would say `not_supplied`.').toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'each door\'s behaviour pin exists',
    () => {
      for (const [file, entry] of Object.entries(CALLERS)) {
        if (entry.kind !== 'door') continue;
        expect(existsSync(join(REPO_ROOT, entry.pin)), `the behaviour pin of ${file} is missing: ${entry.pin}`).toBe(true);
        expect(
          readFileSync(join(REPO_ROOT, entry.pin), 'utf8'),
          `${entry.pin} pins no door's client facts (no [#31821] / [#31898] case)`,
        ).toMatch(/\[#3(?:1821|1898)\]/);
      }
      expect(existsSync(join(REPO_ROOT, AUDIT_PIN)), 'the row\'s own pin').toBe(true);
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    'the scan cannot pass vacuously: the matcher reads a red and a green of each rule, and reaches every classified file',
    () => {
      expect(Object.keys(CALLERS).every((f) => scanned.some((s) => s.file === f))).toBe(true);
      const one = (src: string) => seamCallsOf(codeOf(src));
      // A docblock or a line comment naming a call is not one; a definition is not one.
      expect(one('/** resolveAuthzContext({ }) */\n// resolveAuthzContext({})\nexport async function resolveAuthzContext(input) {}')).toEqual([]);
      // A `/*` inside a template or a string opens no comment, and a seam named in a string is not a call.
      expect(one('const a = `${base}/*`;\nresolveAuthzContext({ client: x });\nconst b = "*/ resolveAuthzContext(";').map((c) => c.seam)).toEqual(['resolveAuthzContext']);
      const reec = (body: string) => handsFacts(one(`resolveRequestExecutionContext({ headers, ${body} })`)[0]);
      expect(reec("credentials: 'api-key-and-session', transport: { remoteAddress: req.remoteAddress }")).toBe(true);
      expect(reec("credentials: 'api-key-and-session', transport: undefined")).not.toBe(true);
      expect(reec("credentials: 'api-key-and-session'")).not.toBe(true);
      expect(reec("credentials: 'session-only', transport: undefined")).toBe(true);
      expect(reec("credentials: 'session-only'")).not.toBe(true);
      const rac = (body: string) => handsFacts(one(`resolveAuthzContext({ ql, headers, ${body} })`)[0]);
      expect(rac('client: credentialUseClientFor(auth, { headers, remoteAddress })')).toBe(true);
      expect(rac('client: undefined')).not.toBe(true);
      expect(rac('apiKeyLifecycle: x')).not.toBe(true);
      const raka = (args: string) => handsFacts(one(`resolveApiKeyAdmission(${args})`)[0]);
      expect(raka('ql, h, now, posture, gates, lifecycle, credentialUseClientFor(auth, { headers: h, remoteAddress })')).toBe(true);
      expect(raka('ql, h, now, posture, gates, f(a, b)')).not.toBe(true);
      expect(handsFacts(one('resolveApiKeyPrincipal(ql, h)')[0])).not.toBe(true);
    },
    SCAN_TIMEOUT_MS,
  );
});

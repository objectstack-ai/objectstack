// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22238 / #22189 — the CLI readers that judged only a multi-package
 * artifact's TOP LEVEL, measured through the real commands.
 *
 * `composeStacks([a, b], { manifest: 'preserve' })` emits each definition once,
 * inside the body of the package that owns it (ADR-0130 D4, 2026-09-22
 * addendum): the top level keeps `manifest`, `packages` and `i18n`, and nothing
 * a package owns. Every reader below looked at that top level alone, so on a
 * two-package app it judged nothing and answered clean. The same app shipped
 * as ONE `defineStack` was judged in full. Measured before the fix, on these
 * fixtures:
 *
 *     two packages                         one package (control)
 *     os validate / os build  exit 0       exit 1  Capability provider check failed
 *     hierarchy-security advisory absent   printed
 *     os lint --strict        exit 0       exit 1  i18n/missing-object
 *     os i18n check           0 keys       8 keys, 1 missing
 *     os i18n extract         0 app keys   6 app keys per locale
 *     undeclared-key warning  absent       in `--json` warnings
 *
 * Each case pairs the two-package shape with the one-package control, which is
 * what makes it a pin rather than a smoke test: a reader that refused every
 * `packages[]` stack would satisfy a lone failing case. The controls also hold
 * single-package output unchanged.
 *
 * Spawned because the exit code and the `--json` payload are the contract a CI
 * pipeline reads, and the readers sit inside oclif command bodies. That puts
 * this file in the integration tier (`packages/cli/vitest-tiers.ts`). The
 * enumeration of every such reader is pinned at the source level in
 * `test/normalized-call-sites.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLI, TSX, childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

interface Run { code: number; stdout: string; stderr: string }

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        resolvePromise({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** The `--json` payload: the first `{` on stdout to the end. */
function payloadOf(run: Run): Record<string, any> {
  const at = run.stdout.indexOf('{');
  if (at < 0) throw new Error(`no JSON payload on stdout (exit ${run.code}):\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(run.stdout.slice(at)) as Record<string, any>;
}

const SVC_ID = 'com.example.union.svc';
const APP_ID = 'com.example.union.app';

/** The `where` prefix a finding a PACKAGE declared carries (`package '<id>' — `). */
const PER_PACKAGE = /^package '[^']+' — /;

/**
 * The definitions both shapes share, as module source. The service package
 * owns `unr_note`; the app package owns `unr_ticket` and the app. The zh-CN
 * bundle for `unr_note` omits its `pluralLabel`: that is the ONE missing
 * translation the coverage cases look for, and the fixture is otherwise clean
 * under `os lint --strict`, so the exit code isolates it.
 */
const PIECES = `
import { defineStack, composeStacks } from '@objectstack/spec';
const I18N = { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' };
const engines = { protocol: '^17' };
const svcManifest = { id: '${SVC_ID}', name: 'Union Service', namespace: 'unr', version: '1.0.0', type: 'module', engines };
const appManifest = { id: '${APP_ID}', name: 'Union App', namespace: 'unr', version: '1.0.0', type: 'app', engines };
const ticket = { name: 'unr_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'private',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } } };
const note = { name: 'unr_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'private',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } } };
const app = { name: 'unr_app', label: 'Union', navigation: [{ id: 'nav_tickets', type: 'object', objectName: 'unr_ticket', label: 'Tickets' }] };
const ticketZh = { 'zh-CN': { objects: { unr_ticket: { label: '工单', pluralLabel: '工单', fields: { title: { label: '标题' } } } },
  apps: { unr_app: { label: '联合', navigation: { nav_tickets: { label: '工单' } } } } } };
const noteZh = { 'zh-CN': { objects: { unr_note: { label: '笔记', fields: { name: { label: '名称' } } } } } };
const conn = { name: 'unr_conn', label: 'Conn', type: 'api', zzzUnionProbeKey: 1 };
`;

const CONFIGS: Record<string, string> = {
  // #22189: the service package requires a capability with no open-edition
  // provider; the app package requires one whose provider is installable but
  // absent, which is the hierarchy-security advisory.
  capTwo: `${PIECES}
const svc = defineStack({ manifest: svcManifest, objects: [note], requires: ['ai'] } as any);
const appStack = defineStack({ manifest: appManifest, objects: [ticket], apps: [app], requires: ['hierarchy-security'] } as any);
export default composeStacks([svc, appStack], { manifest: 'preserve' });
`,
  capOne: `${PIECES}
export default defineStack({ manifest: appManifest, objects: [ticket, note], apps: [app], requires: ['ai', 'hierarchy-security'] } as any);
`,
  // #22238: one translation missing, in the service package.
  i18nTwo: `${PIECES}
const svc = defineStack({ manifest: svcManifest, objects: [note], i18n: I18N, translations: [noteZh] } as any);
const appStack = defineStack({ manifest: appManifest, objects: [ticket], apps: [app], i18n: I18N, translations: [ticketZh] } as any);
export default composeStacks([svc, appStack], { manifest: 'preserve' });
`,
  i18nOne: `${PIECES}
export default defineStack({ manifest: appManifest, objects: [ticket, note], apps: [app], i18n: I18N, translations: [ticketZh, noteZh] } as any);
`,
  // An undeclared connector key. \`strict: false\` keeps it past the producer's
  // parse, so the doors' own pre-parse walk is the only carrier into \`--json\`.
  keyTwo: `${PIECES}
const svc = defineStack({ manifest: svcManifest, objects: [note], connectors: [conn] } as any, { strict: false });
const appStack = defineStack({ manifest: appManifest, objects: [ticket], apps: [app] } as any);
export default composeStacks([svc, appStack], { manifest: 'preserve' });
`,
  keyOne: `${PIECES}
export default defineStack({ manifest: appManifest, objects: [ticket, note], apps: [app], connectors: [conn] } as any, { strict: false });
`,
};

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-package-union-readers-'));
  for (const [name, source] of Object.entries(CONFIGS)) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), source);
    linkSpec(dir);
    dirs[name] = dir;
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Run `jobs` with at most two CLI children alive at once. */
async function runAll(jobs: ReadonlyArray<readonly [string, string, string[]]>): Promise<Record<string, Run>> {
  const out: Record<string, Run> = {};
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [key, dir, args] = job;
      out[key] = await runCli(args, dirs[dir]);
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

describe('#22189 — the capability preflight reads each package body, naming the package', () => {
  let r: Record<string, Run> = {};
  beforeAll(async () => {
    r = await runAll([
      ['validateTwo', 'capTwo', ['validate']],
      ['buildTwo', 'capTwo', ['build']],
      ['validateTwoJson', 'capTwo', ['validate', '--json']],
      ['validateOneJson', 'capOne', ['validate', '--json']],
      ['buildOne', 'capOne', ['build']],
    ]);
  }, 300_000);

  it.each([['validateTwo'], ['buildTwo']])('two packages: `%s` refuses, naming the declaring package', (key) => {
    const run = r[key];
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    expect(run.stdout).toContain('Capability provider check failed (1 issue)');
    expect(run.stdout).toContain(`package '${SVC_ID}' — Capability "ai"`);
  });

  it('two packages, --json: the fatal token and the advisory each name their own package', () => {
    const run = r.validateTwoJson;
    expect(run.code, run.stderr).toBe(1);
    const payload = payloadOf(run);
    expect(payload.errors.map((e: { token: string }) => e.token)).toEqual(['ai']);
    expect(payload.errors[0].message.startsWith(`package '${SVC_ID}' — `)).toBe(true);
    // The hierarchy-security advisory came back with the same reader.
    const advisory = (payload.warnings as Array<{ token?: string; message?: string }>)
      .filter((w) => w.token === 'hierarchy-security');
    expect(advisory).toHaveLength(1);
    expect(advisory[0].message!.startsWith(`package '${APP_ID}' — `)).toBe(true);
  });

  it('control, one package: the same tokens refuse and advise, unattributed', () => {
    const json = r.validateOneJson;
    expect(json.code, json.stderr).toBe(1);
    const payload = payloadOf(json);
    expect(payload.errors.map((e: { token: string }) => e.token)).toEqual(['ai']);
    expect(payload.errors[0].message).not.toMatch(PER_PACKAGE);
    const advisory = (payload.warnings as Array<{ token?: string; message?: string }>)
      .filter((w) => w.token === 'hierarchy-security');
    expect(advisory).toHaveLength(1);
    expect(advisory[0].message).not.toMatch(PER_PACKAGE);

    const build = r.buildOne;
    expect(build.code, build.stderr).toBe(1);
    expect(build.stdout).toContain('Capability provider check failed (1 issue)');
    expect(build.stdout).toContain('  • Capability "ai"');
  });
});

describe('#22238 — translation coverage and extraction read the package union', () => {
  let r: Record<string, Run> = {};
  beforeAll(async () => {
    r = await runAll([
      ['lintTwo', 'i18nTwo', ['lint', '--strict', '--json']],
      ['lintOne', 'i18nOne', ['lint', '--strict', '--json']],
      ['checkTwo', 'i18nTwo', ['i18n', 'check', '--json']],
      ['checkOne', 'i18nOne', ['i18n', 'check', '--json']],
      ['extractTwo', 'i18nTwo', ['i18n', 'extract', '--json']],
      ['extractOne', 'i18nOne', ['i18n', 'extract', '--json']],
    ]);
  }, 300_000);

  const MISSING = { rule: 'i18n/missing-object', path: 'translations.zh-CN.objects.unr_note.pluralLabel' };

  it('`os lint --strict` fails on the missing translation in both shapes', () => {
    for (const key of ['lintTwo', 'lintOne']) {
      const run = r[key];
      expect(run.code, `${key}\n${run.stdout}\n${run.stderr}`).toBe(1);
      const issues = payloadOf(run).issues as Array<{ rule: string; path: string; severity: string }>;
      expect(issues.map(({ rule, path }) => ({ rule, path })), key).toEqual([MISSING]);
    }
  });

  it('`os i18n check` expects the same keys and reports the same gap in both shapes', () => {
    const two = payloadOf(r.checkTwo);
    const one = payloadOf(r.checkOne);
    expect(r.checkTwo.code).toBe(r.checkOne.code);
    expect(two.totals.expectedKeys).toBeGreaterThan(0);
    expect(two.totals).toEqual(one.totals);
    const gaps = (report: Record<string, any>) =>
      (report.issues as Array<{ locale: string; key: string }>).map(({ locale, key }) => `${locale} ${key}`);
    expect(gaps(two)).toEqual(['zh-CN objects.unr_note.pluralLabel']);
    expect(gaps(two)).toEqual(gaps(one));
  });

  it('`os i18n extract` extracts both packages\' objects', () => {
    for (const key of ['extractTwo', 'extractOne']) {
      const run = r[key];
      expect(run.code, `${key}\n${run.stderr}`).toBe(0);
      expect(Object.keys(payloadOf(run).bundles.en).sort(), key).toEqual(['unr_note', 'unr_ticket']);
    }
    expect(payloadOf(r.extractTwo).counts).toEqual(payloadOf(r.extractOne).counts);
  });
});

describe('#22238 — the undeclared-authoring-key walk reads the package union', () => {
  let r: Record<string, Run> = {};
  beforeAll(async () => {
    r = await runAll([
      ['validateTwo', 'keyTwo', ['validate', '--json']],
      ['buildTwo', 'keyTwo', ['build', '--json']],
      ['validateOne', 'keyOne', ['validate', '--json']],
    ]);
  }, 300_000);

  const named = (run: Run) =>
    (payloadOf(run).warnings as unknown[]).filter((w) => typeof w === 'string' && w.includes('zzzUnionProbeKey'));

  it('both doors carry the finding in `--json` warnings for two packages, as for one', () => {
    for (const key of ['validateTwo', 'buildTwo', 'validateOne']) {
      const run = r[key];
      expect(run.code, `${key}\n${run.stdout}\n${run.stderr}`).toBe(0);
      expect(named(run), key).toHaveLength(1);
    }
    expect(named(r.validateTwo)).toEqual(named(r.validateOne));
  });
});

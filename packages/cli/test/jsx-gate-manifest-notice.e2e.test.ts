// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20113 — the JSX page gate of `os validate` / `os build` / `os lint` used to
 * check `kind:'html'` pages at parse level only whenever no SDUI component
 * manifest resolved, and say nothing: measured on `examples/app-showcase`,
 * `os validate` exited 0 with 106 output lines matching `manifest`,
 * `parse-level`, `jsx` and `sdui` zero times. A verifier that silently
 * degrades reports success (AGENTS.md "Route & surface ownership" rule 3).
 *
 * What each command does now, pinned on BOTH faces and on the exit status:
 *
 *   - no manifest, `kind:'html'` pages → the notice, on the text face and in
 *     the payload's EXISTING advisory channel (`warnings` for validate/build,
 *     `issues` as a `suggestion` for lint), exit status UNCHANGED — `--strict`
 *     included, measured on a fixture whose only advisory is the notice;
 *   - a resolvable project manifest → no notice (control), and a lit control
 *     that the fixture manifest really arms full validation;
 *   - no `kind:'html'` pages → no notice (control);
 *   - a project manifest that exists but is not valid JSON → refused, exit 1,
 *     the file named on stderr and in the `--json` envelope's `error`; and with
 *     no page to check, NOT refused (it is read by nothing);
 *   - [round 1] the PACKAGE-CARRIED layout — a top-level `pages` key (`[]`, or
 *     a `kind: 'full'` page) beside html pages that live only in `packages[]`:
 *     the union fold keeps the top-level key, but the per-package pass still
 *     hands those pages to the gate, so the notice (counting them) and the
 *     refusal both fire there too, on all three commands.
 *
 * The notice is found by its rule id — an anchor — never by its prose.
 *
 * ⭐ NIGHTLY by name (`.e2e`): it spawns the CLI, like its conversion-notice
 * siblings, and `vitest.config.ts`'s nightly-tiers section moves that class
 * out of the per-PR run. Every rule pinned here is ALSO pinned at unit level in
 * `src/utils/sdui-manifest.test.ts`, which is the per-PR guard.
 *
 * Runs the CLI through `bin/run-dev.js`, the SOURCE entry, as the sibling
 * conversion-notice pins do, so the three command files and
 * `utils/sdui-manifest.ts` are measured from `src/` without a rebuild. Every
 * spawn is started once in `beforeAll`, a few at a time, and each `it` reads
 * the runs it needs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';
import { consoleSduiManifestPath } from '../src/utils/sdui-manifest.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/**
 * Whether the manifest-less path is reachable in THIS checkout (#19922). With
 * no project manifest the CLI falls back to the copy its own
 * `@objectstack/console` dependency ships, located from the same module the
 * spawned CLI runs (`src/`, through `bin/run-dev.js`). In the workspace that is
 * `packages/console/dist/sdui.manifest.json`, which exists only where the
 * console has been built — never in the CI job that runs this file, often on a
 * developer's machine. Where it exists, a project without a manifest is fully
 * validated against it and the notice has nothing to report, so the cases that
 * need "no manifest anywhere" are SKIPPED, by name, rather than asserting a
 * state this checkout cannot produce. Every rule they pin is also pinned,
 * hermetically, in `src/utils/sdui-manifest.test.ts`.
 */
const CONSOLE_COPY = consoleSduiManifestPath();
const NO_MANIFEST_UNREACHABLE = CONSOLE_COPY !== undefined && existsSync(CONSOLE_COPY);

/** `JSX_PARSE_LEVEL_ONLY_RULE` in `src/utils/sdui-manifest.ts`, spelled out as the published anchor. */
const RULE = 'sdui/jsx-parse-level-only';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: readonly string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

function payloadOf(run: Run, label: string): Record<string, unknown> {
  try {
    return JSON.parse(run.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/**
 * The notice records a payload carries, from BOTH existing channels — `warnings`
 * (validate/build records) and `issues` (lint) — so a payload carrying the two
 * would be read whole, not half. (`os lint`'s `warnings` is a count, not a list.)
 */
function noticesIn(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const channel = [
    ...(Array.isArray(payload.warnings) ? payload.warnings : []),
    ...(Array.isArray(payload.issues) ? payload.issues : []),
  ];
  return (channel as unknown[]).filter(
    (x): x is Record<string, unknown> => typeof x === 'object' && x !== null && (x as { rule?: unknown }).rule === RULE,
  );
}

/**
 * A stack with no advisory of its own on any of the three commands — an app,
 * an engines range, a private object — so under `--strict` the ONLY thing that
 * could move the exit status is the notice. `body` is the page source, or
 * `null` for a stack with no pages at all.
 */
function stack(body: string | null): string {
  const pages = body === null ? '' : `pages: [{ name: 'jxg_landing', label: 'Landing', kind: 'html', source: '${body}' }],`;
  const nav =
    body === null
      ? `{ id: 'nav_ticket', type: 'object', label: 'Tickets', objectName: 'jxg_ticket' }`
      : `{ id: 'nav_landing', type: 'page', label: 'Landing', pageName: 'jxg_landing' }`;
  return `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.jxg', name: 'jxg', version: '1.0.0', type: 'app', namespace: 'jxg', engines: { protocol: '^17' } },
  ${pages}
  apps: [{ name: 'jxg_app', label: 'JXG', navigation: [${nav}] }],
  objects: [
    { name: 'jxg_ticket', label: 'Ticket', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } },
  ],
}, { strict: false });
`;
}

/**
 * The round-1 layout: `top` is the top-level `pages` value the union fold KEEPS
 * (so it folds nothing in), and the one html page lives only inside the
 * package body the per-package pass judges.
 */
function packageCarried(top: string): string {
  return `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.jxg', name: 'jxg', version: '1.0.0', type: 'app', namespace: 'jxg', engines: { protocol: '^17' } },
  pages: ${top},
  packages: [
    {
      manifest: {
        id: 'com.example.jxg.site', name: 'jxg_site', version: '1.0.0', type: 'app', namespace: 'jxg',
        pages: [{ name: 'jxg_site_landing', label: 'Landing', kind: 'html', source: '<div>hi</div>' }],
      },
    },
  ],
  apps: [{ name: 'jxg_app', label: 'JXG', navigation: [{ id: 'nav_ticket', type: 'object', label: 'Tickets', objectName: 'jxg_ticket' }] }],
  objects: [
    { name: 'jxg_ticket', label: 'Ticket', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } },
  ],
}, { strict: false });
`;
}
const TOP_EMPTY = '[]';
const TOP_FULL = "[{ name: 'jxg_home', label: 'Home', kind: 'full', regions: [] }]";

/** Declares exactly the one component the fixture page uses. */
const MANIFEST = JSON.stringify({ components: { div: { type: 'div', inputs: [{ name: 'children', type: 'slot' }] } } });
const MALFORMED = '{ "components": [ oops';

type Fixture =
  | 'noManifest'
  | 'withManifest'
  | 'litControl'
  | 'noPages'
  | 'malformed'
  | 'noPagesMalformed'
  | 'pkgTopEmpty'
  | 'pkgTopFull'
  | 'pkgTopEmptyMalformed'
  | 'pkgTopFullMalformed';

/** The package-carried fixtures, by layout, as the `it.each` rows below read them. */
const PACKAGE_LAYOUTS = [
  ['top-level `pages: []`', 'pkgTopEmpty', 'pkgTopEmptyMalformed'],
  ['a top-level kind:full page', 'pkgTopFull', 'pkgTopFullMalformed'],
] as const;
const COMMANDS = ['validate', 'build', 'lint'] as const;

const FIXTURES: Record<Fixture, { config: string; manifest?: string }> = {
  noManifest: { config: stack('<div>hi</div>') },
  withManifest: { config: stack('<div>hi</div>'), manifest: MANIFEST },
  // The same manifest, a tag it does not declare: fails ⇒ the manifest reached the gate.
  litControl: { config: stack('<span>hi</span>'), manifest: MANIFEST },
  noPages: { config: stack(null) },
  malformed: { config: stack('<div>hi</div>'), manifest: MALFORMED },
  noPagesMalformed: { config: stack(null), manifest: MALFORMED },
  pkgTopEmpty: { config: packageCarried(TOP_EMPTY) },
  pkgTopFull: { config: packageCarried(TOP_FULL) },
  pkgTopEmptyMalformed: { config: packageCarried(TOP_EMPTY), manifest: MALFORMED },
  pkgTopFullMalformed: { config: packageCarried(TOP_FULL), manifest: MALFORMED },
};

/** Every spawn this file reads, keyed `fixture|args`. */
const PLAN: ReadonlyArray<readonly [Fixture, readonly string[]]> = [
  ['noManifest', ['validate', '--strict']],
  ['noManifest', ['validate', '--json', '--strict']],
  ['noManifest', ['build']],
  ['noManifest', ['build', '--json']],
  ['noManifest', ['lint', '--strict']],
  ['noManifest', ['lint', '--json', '--strict']],
  ['withManifest', ['validate', '--json', '--strict']],
  ['withManifest', ['build', '--json']],
  ['withManifest', ['lint', '--json', '--strict']],
  ['litControl', ['validate', '--json']],
  ['noPages', ['validate', '--json', '--strict']],
  ['noPages', ['build', '--json']],
  ['noPages', ['lint', '--json', '--strict']],
  ['malformed', ['validate']],
  ['malformed', ['validate', '--json']],
  ['malformed', ['build', '--json']],
  ['malformed', ['lint', '--json']],
  ['noPagesMalformed', ['validate', '--json']],
  ...PACKAGE_LAYOUTS.flatMap(([, notice, malformed]) =>
    COMMANDS.flatMap((command) => [
      [notice, [command, '--json']] as const,
      [malformed, [command, '--json']] as const,
    ]),
  ),
];

const key = (fixture: Fixture, args: readonly string[]) => `${fixture}|${args.join(' ')}`;
const runs = new Map<string, Run>();
const dirs = {} as Record<Fixture, string>;
let root = '';

function run(fixture: Fixture, ...args: string[]): Run {
  const r = runs.get(key(fixture, args));
  if (!r) throw new Error(`not in PLAN: ${key(fixture, args)}`);
  return r;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'os-jsx-gate-notice-'));
  for (const [name, f] of Object.entries(FIXTURES) as Array<[Fixture, (typeof FIXTURES)[Fixture]]>) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), f.config);
    linkSpec(dir);
    if (f.manifest !== undefined) writeFileSync(join(dir, 'sdui.manifest.json'), f.manifest);
    dirs[name] = dir;
  }
  // A few at a time: each spawn is a full CLI start from source.
  const queue = [...PLAN];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [fixture, args] = next;
      runs.set(key(fixture, args), await runCli(args, dirs[fixture]));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}, 600_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(NO_MANIFEST_UNREACHABLE)('no manifest, kind:html pages — the notice, exit status unchanged', () => {
  it.each([
    ['validate', '--strict'],
    ['build'],
    ['lint', '--strict'],
  ])('os %s (text face): prints the notice and exits 0', (...args) => {
    const r = run('noManifest', ...args);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain(RULE);
    // …and names where a manifest was looked for.
    expect(r.stdout).toContain(join(dirs.noManifest, 'sdui.manifest.json'));
  });

  it.each([
    ['validate', '--json', '--strict'],
    ['build', '--json'],
    ['lint', '--json', '--strict'],
  ])('os %s (json face): ONE notice record in the existing channel, exit 0', (...args) => {
    const r = run('noManifest', ...args);
    const payload = payloadOf(r, args.join(' '));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const notices = noticesIn(payload);
    expect(notices).toHaveLength(1);
    // An EXISTING severity on each face: `info` in the AuthoringFinding
    // records of `warnings`, `suggestion` in `os lint`'s `issues`.
    expect(notices[0].severity).toBe(args[0] === 'lint' ? 'suggestion' : 'info');
    expect(String(notices[0].message)).toContain(join(dirs.noManifest, 'sdui.manifest.json'));
  });

  it('the payloads grow no new top-level key (the notice rides an existing channel)', () => {
    for (const args of [['validate', '--json', '--strict'], ['build', '--json'], ['lint', '--json', '--strict']]) {
      const withNotice = Object.keys(payloadOf(run('noManifest', ...args), args.join(' '))).sort();
      const without = Object.keys(payloadOf(run('withManifest', ...args), args.join(' '))).sort();
      expect(withNotice, args.join(' ')).toEqual(without);
    }
  });

  it('os lint: the notice is a suggestion — it passes, and `failing` counts nothing', () => {
    const payload = payloadOf(run('noManifest', 'lint', '--json', '--strict'), 'lint');
    expect(payload).toMatchObject({ passed: true, failing: 0, suggestions: 1, total: 1 });
  });
});

describe('controls — no notice where nothing degraded', () => {
  it.each([
    ['validate', '--json', '--strict'],
    ['build', '--json'],
    ['lint', '--json', '--strict'],
  ])('a resolvable project manifest: os %s is silent about it, exit 0', (...args) => {
    const r = run('withManifest', ...args);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(noticesIn(payloadOf(r, args.join(' ')))).toEqual([]);
  });

  it('lit control: that manifest really arms full validation (an undeclared tag fails)', () => {
    const r = run('litControl', 'validate', '--json');
    expect(r.code).toBe(1);
    const errors = (payloadOf(r, 'lit').errors ?? []) as Array<{ rule?: string }>;
    expect(errors.some((e) => e.rule === 'jsx-forbidden-tag')).toBe(true);
  });

  it.each([
    ['validate', '--json', '--strict'],
    ['build', '--json'],
    ['lint', '--json', '--strict'],
  ])('no kind:html pages: os %s says nothing, exit 0', (...args) => {
    const r = run('noPages', ...args);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(noticesIn(payloadOf(r, args.join(' ')))).toEqual([]);
  });
});

describe('a project manifest that is present but unusable — refused, never degraded', () => {
  it.each([
    ['validate', '--json'],
    ['build', '--json'],
    ['lint', '--json'],
  ])('os %s: exit 1, the file named in the envelope and on stderr', (...args) => {
    const r = run('malformed', ...args);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const manifestPath = join(dirs.malformed, 'sdui.manifest.json');
    expect(String(payloadOf(r, args.join(' ')).error)).toContain(manifestPath);
    expect(r.stderr).toContain(manifestPath);
  });

  it('os validate (text face): exit 1, reported once — on stderr, not again on stdout', () => {
    const r = run('malformed', 'validate');
    const manifestPath = join(dirs.malformed, 'sdui.manifest.json');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(manifestPath);
    expect(r.stdout).not.toContain(manifestPath);
  });

  it('with no kind:html page the file is read by nothing, so it is not refused', () => {
    const r = run('noPagesMalformed', 'validate', '--json');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stderr).toBe('');
  });
});

describe('[round 1] html pages carried only in packages[], beside a top-level pages key', () => {
  const rows = PACKAGE_LAYOUTS.flatMap(([layout, notice, malformed]) =>
    COMMANDS.map((command) => [layout, command, notice, malformed] as const),
  );

  it.skipIf(NO_MANIFEST_UNREACHABLE).each(rows)('%s — os %s: the notice, counting the package page, exit 0', (_layout, command, notice) => {
    const r = run(notice, command, '--json');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const notices = noticesIn(payloadOf(r, `${notice} ${command}`));
    expect(notices).toHaveLength(1);
    // The corrected count: the one page the per-package pass judges.
    expect(String(notices[0].message)).toMatch(/^(pages: )?1 /);
  });

  it.each(rows)('%s — os %s: a malformed manifest is refused, exit 1', (_layout, command, _notice, malformed) => {
    const r = run(malformed, command, '--json');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const manifestPath = join(dirs[malformed], 'sdui.manifest.json');
    expect(String(payloadOf(r, `${malformed} ${command}`).error)).toContain(manifestPath);
    expect(r.stderr).toContain(manifestPath);
  });
});

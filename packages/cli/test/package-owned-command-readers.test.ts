// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22288 — `os doctor`, `os diff` and `os migrate meta` judged a multi-package
 * config by its TOP LEVEL, measured through the commands.
 *
 * `composeStacks([a, b], { manifest: 'preserve' })` carries every object, view
 * and flow once, inside the body of the package that owns it (ADR-0130 D4,
 * 2026-09-22 addendum), and none at its top level. Each command below read the
 * top level and so judged an empty stack. Measured on `6729e107`, before the
 * fix:
 *
 *     two packages                                   one package (control)
 *     os doctor          no metadata check ran;      circular-dependency and
 *                        "Environment is healthy"    unused-object checks ran
 *     os diff --json     total 0                     prb_extra added
 *     os migrate meta    dataMigrations []           adr-0104-file-references
 *       --from 16 --json
 *
 * Each now folds its stack with `authoringRuleUnionStack` where it loads it. The
 * pairs make these pins: a fold that broke every stack would fail the control,
 * and the control holds the one-package answer unchanged. The enumeration of
 * every such read is `test/normalized-call-sites.test.ts`.
 *
 * Spawned, because the fold sits inside each command's `run()`. That puts this
 * file in the integration tier (`packages/cli/vitest-tiers.ts`), which runs on
 * every PR. ⛔ Not named `*.e2e.test.ts`, which would move it to the nightly
 * tier. Two CLI children at most are alive at once.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_REFERENCES_MIGRATION_ID } from '@objectstack/spec/system';

import { CLI, TSX, childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

interface Run { code: number; stdout: string; stderr: string }

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      // Artifact-less on purpose: the config is the only input these commands read.
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1', OS_ARTIFACT_PATH: join(cwd, 'dist', 'objectstack.json') }) },
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

const PIECES = `
import { defineStack, composeStacks } from '@objectstack/spec';
const svcManifest = { id: 'com.example.pco.svc', name: 'PCO Service', namespace: 'pco', version: '1.0.0', type: 'module' };
const appManifest = { id: 'com.example.pco.app', name: 'PCO App', namespace: 'pco', version: '1.0.0', type: 'app' };
const note = { name: 'pco_note', label: 'Note', pluralLabel: 'Notes', sharingModel: 'private',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } } };
const ticket = { name: 'pco_ticket', label: 'Ticket', pluralLabel: 'Tickets', sharingModel: 'private',
  fields: { title: { name: 'title', type: 'text', label: 'Title', required: true } } };
const scan = { name: 'pco_scan', label: 'Scan', pluralLabel: 'Scans', sharingModel: 'private',
  fields: { name: { name: 'name', type: 'text', label: 'Name' }, file: { name: 'file', type: 'file', label: 'File' } } };
`;

/** Service objects first, app objects second, in both shapes. */
const two = (svcObjects: string) => `${PIECES}
const svc = defineStack({ manifest: svcManifest, objects: [${svcObjects}] } as any);
const appStack = defineStack({ manifest: appManifest, objects: [ticket] } as any);
export default composeStacks([svc, appStack], { manifest: 'preserve' });
`;
const one = (svcObjects: string) => `${PIECES}
export default defineStack({ manifest: appManifest, objects: [${svcObjects}, ticket] } as any);
`;

const CONFIGS: Record<string, string> = {
  two: two('note'),
  twoAfter: two('note, scan'),
  one: one('note'),
  oneAfter: one('note, scan'),
};

const dirs: Record<string, string> = {};
let root = '';
let r: Record<string, Run> = {};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'os-package-owned-command-readers-'));
  for (const [name, source] of Object.entries(CONFIGS)) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), source);
    linkSpec(dir);
    dirs[name] = dir;
  }
  const jobs: Array<readonly [string, string, string[]]> = [];
  for (const shape of ['two', 'one'] as const) {
    jobs.push([`doctor:${shape}`, shape, ['doctor']]);
    jobs.push([`diff:${shape}`, shape, [
      'diff', join(dirs[shape], 'objectstack.config.ts'), join(dirs[`${shape}After`], 'objectstack.config.ts'), '--json',
    ]]);
    jobs.push([`meta:${shape}`, `${shape}After`, ['migrate', 'meta', '--from', '16', '--json']]);
  }
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [key, dir, args] = job;
      r[key] = await runCli(args, dirs[dir]);
    }
  };
  r = {};
  await Promise.all([worker(), worker()]);
}, 300_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#22288 — os doctor runs its metadata checks over every package', () => {
  for (const shape of ['two', 'one'] as const) {
    it(`${shape === 'two' ? 'two packages' : 'control, one package'}: both objects are judged`, () => {
      const run = r[`doctor:${shape}`];
      const out = run.stdout + run.stderr;
      // The unused-object check names each object it judged; nothing references either here.
      const unused = out.split('\n').filter((line) => /Object "pco_\w+"/.test(line));
      expect(unused.join('\n'), out).toMatch(/"pco_note"/);
      expect(unused.join('\n'), out).toMatch(/"pco_ticket"/);
    });
  }
});

describe('#22288 — os diff compares every package', () => {
  for (const shape of ['two', 'one'] as const) {
    it(`${shape === 'two' ? 'two packages' : 'control, one package'}: the object added to the service package is reported`, () => {
      const run = r[`diff:${shape}`];
      expect(run.code, run.stderr).toBe(0);
      const changes = payloadOf(run).changes as Array<{ type: string; category: string; name: string }>;
      expect(changes).toEqual([expect.objectContaining({ type: 'added', category: 'objects', name: 'pco_scan' })]);
    });
  }
});

describe('#22288 — os migrate meta lists the data migration a package\'s fields need', () => {
  for (const shape of ['two', 'one'] as const) {
    it(`${shape === 'two' ? 'two packages' : 'control, one package'}: a file field in the service package lists it`, () => {
      const run = r[`meta:${shape}`];
      expect(run.code, run.stderr).toBe(0);
      const ids = (payloadOf(run).dataMigrations as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toContain(FILE_REFERENCES_MIGRATION_ID);
    });
  }
});

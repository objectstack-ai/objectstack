// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 70 — spawns the real producer once per single-cause fixture: three `os verify` spawns, one per (flags, fixture) pair, already in one beforeAll (`--json` and `--dashboard-windows --json` on the app, `--dashboard-windows --json` on the control); slowest CI reading 50.49 s (run 40392443783) of the three scheduled CI runs after the oclif test manifest (PR #26256: 40392443783, 40424746941, 40447801748), x 1.25, rounded up

/**
 * PIN — `os verify --dashboard-windows` runs the dashboard date-window family
 * and counts what it finds in the exit status.
 *
 * ## What is pinned
 *
 *   - without the flag the run is what it was: no `dashboardWindows` key in
 *     the `--json` document, and the exit status reads CRUD only;
 *   - with the flag, the dashboard's one bound widget counts, under every
 *     preset of the picker, the fixture rows its window selects: `proven`,
 *     `hardFailures` stays 0 and the run exits 0;
 *   - with the flag, on the same metadata plus the app's own plugin that
 *     removes the window's condition from every aggregate of the object (the
 *     engine's published middleware seam), the window counts every fixture
 *     row: the widget is reported `contradicted` and inert, `hardFailures`
 *     counts it and the run exits 1.
 *
 * Spawned rather than run in-process: the exit status is the contract a CI
 * gate reads, and only a real process has one.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';
import { defineStackSource, defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const MANIFEST = {
  id: 'com.example.verify-dashboard-windows',
  namespace: 'vdw',
  version: '1.0.0',
  name: 'Verify Dashboard Windows',
  type: 'app',
  engines: { protocol: '^18' },
};

const OBJECTS = [
  {
    name: 'vdw_case',
    label: 'Case',
    pluralLabel: 'Cases',
    sharingModel: 'private',
    fields: {
      subject: { type: 'text', label: 'Subject', required: true },
      opened_at: { type: 'datetime', label: 'Opened at' },
    },
  },
];

const DATASETS = [
  { name: 'case_metrics', label: 'Cases', object: 'vdw_case', dimensions: [], measures: [{ name: 'case_count', label: 'Cases', aggregate: 'count' }] },
];

const DASHBOARDS = [
  {
    name: 'vdw_board',
    label: 'Board',
    dateRange: { field: 'opened_at', defaultRange: 'last_30_days' },
    widgets: [{ id: 'cases', type: 'metric', dataset: 'case_metrics', values: ['case_count'] }],
  },
];

/** The same app, plus its own plugin removing the window's condition from every aggregate of `vdw_case`. */
const CONTROL_SOURCE = `{
  manifest: ${JSON.stringify({ ...MANIFEST, id: 'com.example.verify-dashboard-windows-control' })},
  objects: ${JSON.stringify(OBJECTS)},
  datasets: ${JSON.stringify(DATASETS)},
  dashboards: ${JSON.stringify(DASHBOARDS)},
  plugins: [
    {
      name: 'com.example.vdw.window-drop',
      version: '1.0.0',
      init: async () => {},
      start: async (ctx) => {
        const without = (f) => Array.isArray(f) ? f.map(without)
          : f && typeof f === 'object' ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'opened_at').map(([k, v]) => [k, without(v)]))
          : f;
        ctx.getService('objectql').registerMiddleware(async (op, next) => {
          if (op.operation === 'aggregate' && op.ast && op.ast.where) op.ast.where = without(op.ast.where);
          await next();
        }, { object: 'vdw_case' });
      },
    },
  ],
}`;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Doc {
  hardFailures?: number;
  dashboardWindows?: {
    door: string;
    results: Array<{
      dashboard: string;
      widget: string;
      status: string;
      measures: Array<{ measure: string; inert?: boolean; presets: Array<{ preset: string; outcome: string }> }>;
    }>;
    summary: { widgets: { proven: number; contradicted: number }; probes: number; held: number; inert: number; hardFailures: number };
  };
}

function runCli(dir: string, args: string[]): Run {
  // Through tsx, so the child runs this checkout's `src/`.
  const r = spawnSync(TSX, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: childEnv({ NO_COLOR: '1' }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const docOf = (run: Run): Doc => JSON.parse(run.stdout) as Doc;

describe('os verify --dashboard-windows', () => {
  let root: string;
  let plain: Run;
  let proven: Run;
  let control: Run;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'os-verify-dashboard-windows-'));
    const app = join(root, 'app');
    const controlApp = join(root, 'control');
    for (const [dir, source] of [
      [app, defineStackSource({ manifest: MANIFEST, objects: OBJECTS, datasets: DATASETS, dashboards: DASHBOARDS })],
      [controlApp, defineStackSourceFromLiteral(CONTROL_SOURCE)],
    ] as const) {
      mkdirSync(dir);
      writeFileSync(join(dir, 'objectstack.config.mjs'), source);
      linkSpec(dir);
    }
    plain = runCli(app, ['verify', '--json']);
    proven = runCli(app, ['verify', '--dashboard-windows', '--json']);
    control = runCli(controlApp, ['verify', '--dashboard-windows', '--json']);
  }, 480_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('leaves the run unchanged without the flag', () => {
    expect(plain.status, `${plain.stdout}\n${plain.stderr}`).toBe(0);
    const doc = docOf(plain);
    expect('dashboardWindows' in doc).toBe(false);
    expect(doc.hardFailures).toBe(0);
  });

  it('proves the bound widget under every preset of the picker, and exits 0', () => {
    expect(proven.status, `${proven.stdout}\n${proven.stderr}`).toBe(0);
    const report = docOf(proven).dashboardWindows!;
    expect(report.door).toBe('rest');
    expect(report.results).toEqual([expect.objectContaining({ dashboard: 'vdw_board', widget: 'cases', status: 'proven' })]);
    expect(report.summary).toMatchObject({ widgets: { proven: 1, contradicted: 0 }, probes: 13, held: 13, inert: 0, hardFailures: 0 });
    expect(docOf(proven).hardFailures).toBe(0);
  });

  it('counts a window that never narrows, and exits 1', () => {
    expect(control.status, `${control.stdout}\n${control.stderr}`).toBe(1);
    const doc = docOf(control);
    const [widget] = doc.dashboardWindows!.results;
    expect(widget).toMatchObject({ widget: 'cases', status: 'contradicted' });
    expect(widget!.measures[0]!.inert).toBe(true);
    expect(widget!.measures[0]!.presets.every((p) => p.outcome === 'contradicted')).toBe(true);
    expect(doc.dashboardWindows!.summary).toMatchObject({ widgets: { contradicted: 1 }, inert: 1, hardFailures: 1 });
    expect(doc.hardFailures).toBe(1);
  });
});

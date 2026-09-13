// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17790 — `os info`'s four DETAIL reads went through the top level alone, so
 * on an ADR-0130 D4 / option-B project (every definition inside `packages[]`,
 * none flattened up) one `--json` payload contradicted itself:
 *
 * ```json
 * { "stats": { "objects": 1, "apps": 1, "views": 1 }, "objects": [] }
 * ```
 *
 * Measured through the real binary on `origin/main` `ef474594`, on the card's
 * own repro, before the fix:
 *
 * ```
 * os info --json   exit 0   stats.objects = 1 · objects[] length = 0
 * os info          exit 0   Data: 1 Objects  2 Fields   (no `Objects:` section,
 *                                                        no `Apps:` section)
 * ```
 *
 * `stats` had already learned to resolve `packages[]` (#17527); these four had
 * not. Nothing in the payload distinguished "this project has no objects" from
 * "this reader could not see them", and `--json` is the face a machine reads.
 *
 * ## Why this pin SPAWNS the binary instead of calling a reader
 *
 * The sibling pin for the summary (`src/utils/format.metadata-stats-package-
 * fold.test.ts`) calls `collectMetadataStats` directly, because that read lives
 * in a function. These four do not: they are expressions inside the oclif
 * command body of `src/commands/info.ts`, and `stack-collections.ts`' own
 * header states the consequence as a rule — 「A pin can only attach to a
 * callable」 — which is why they sat outside the option-B acceptance probe's
 * ledger while every callable reader sat inside it. Running the command is
 * therefore the only way to measure the reads themselves rather than a second
 * copy of them, and it is also what the card's evidence is: same command, same
 * binary, two projects.
 *
 * ⛔ What this file deliberately does NOT pin: whether an option-B project's
 * detail listing should be a FLAT UNION or GROUPED BY PACKAGE. That is a
 * published-output-shape decision and it belongs to its own card. Every
 * assertion below is about AGREEMENT — the payload's two halves describing the
 * same project the same way, and the reader answering the same for a project
 * whose definitions merely live somewhere else — so a later card that groups
 * the listing changes this file's expected SHAPE without touching a single one
 * of its claims.
 *
 * ## The control is the load-bearing half
 *
 * The card's own control is reproduced here from the SAME definition literals
 * (`OBJECTS` / `VIEWS` / `APPS` below), re-homed rather than re-typed: one
 * project declares them inside `packages[]`, the other at the top level, and
 * the two runs must produce the same detail output. That equality is the proof
 * that the absence was produced by the READER and not by the stack — and it is
 * also the guard on the additive rule, since the top-level project is the shape
 * every stack the platform emits today has.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** The SOURCE entry — this suite must not depend on `packages/cli/dist`. */
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

const MANIFEST = {
  id: 'com.example.ob',
  name: 'ob',
  version: '1.0.0',
  type: 'app',
  namespace: 'ob',
} as const;

/** The card's repro object, verbatim — two fields, one of them a lookup. */
const OBJECTS = [
  {
    name: 'ob_order',
    label: 'Order',
    sharingModel: 'private',
    fields: {
      number: { type: 'text', label: 'Number' },
      ghost: { type: 'lookup', label: 'Ghost', reference: 'ob_order' },
    },
  },
];

const VIEWS = [
  {
    name: 'ob_order_views',
    object: 'ob_order',
    list: {
      label: 'Orders',
      type: 'grid',
      data: { provider: 'object', object: 'ob_order' },
      columns: [{ field: 'number' }, { field: 'ghost' }],
    },
  },
];

const APPS = [
  {
    name: 'ob_app',
    label: 'OB',
    navigation: [{ id: 'nav_orders', type: 'object', objectName: 'ob_order', label: 'Orders' }],
  },
];

const DEFINITIONS = { objects: OBJECTS, views: VIEWS, apps: APPS };

const source = (stack: unknown): string => `export default ${JSON.stringify(stack, null, 2)};\n`;

/**
 * The card's minimal repro: ONE package, nothing at the top level but the
 * envelope.
 */
const OPTION_B = source({ manifest: MANIFEST, packages: [{ manifest: { ...MANIFEST, ...DEFINITIONS } }] });

/**
 * The card's control: the SAME definition literals, authored at the top level.
 * `composeStacks` flattens every artifact the platform emits today into this
 * shape, so this project is also the additive-rule guard.
 */
const TOP_LEVEL = source({ manifest: MANIFEST, ...DEFINITIONS });

/**
 * Option B across TWO packages, the second carrying an agent.
 *
 * Two jobs in one project. It reaches the `Agents:` read, which the repro above
 * does not exercise at all; and it is the positive control for the
 * concatenation itself — a reader that stopped at the first `packages[]` entry
 * satisfies every assertion on the one-package project and fails here.
 */
const TWO_PACKAGES = source({
  manifest: MANIFEST,
  packages: [
    {
      manifest: {
        ...MANIFEST,
        id: 'com.example.ob.core',
        name: 'ob-core',
        objects: [
          { name: 'ob_order', label: 'Order', sharingModel: 'private', fields: { number: { type: 'text', label: 'Number' } } },
        ],
        apps: APPS,
      },
    },
    {
      manifest: {
        ...MANIFEST,
        id: 'com.example.ob.ai',
        name: 'ob-ai',
        objects: [
          { name: 'ob_ticket', label: 'Ticket', sharingModel: 'private', fields: { subject: { type: 'text', label: 'Subject' } } },
        ],
        agents: [{ name: 'ob_agent', label: 'Agent', role: 'assistant', instructions: 'Answer questions.' }],
      },
    },
  ],
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runInfo(cwd: string, argv: readonly string[]): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, 'info', ...argv],
      { cwd, maxBuffer: 32 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0;
        resolvePromise({ code, stdout, stderr });
      },
    );
  });
}

/**
 * The detail block of a text run: every line from the first `Objects:` /
 * `Agents:` / `Apps:` heading to the line before the timing line.
 *
 * The two lines dropped are the two that CANNOT match across projects — the
 * config's absolute path and `Loaded in Nms` — so what remains is exactly the
 * output under test.
 */
function detailBlock(stdout: string): string {
  const lines = stdout.split('\n');
  const start = lines.findIndex((line) => /^ {2}(?:Objects|Agents|Apps):$/.test(line));
  if (start === -1) return '';
  const end = lines.findIndex((line) => line.includes('Loaded in'));
  return lines.slice(start, end === -1 ? undefined : end).join('\n').trimEnd();
}

interface Payload {
  stats: Record<string, number>;
  objects: Array<{ name: string; label: string; fields: number }>;
}

let root: string;
const json: Record<string, Payload> = {};
const text: Record<string, Run> = {};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'os-info-17790-'));
  const projects: Record<string, string> = { optionB: OPTION_B, topLevel: TOP_LEVEL, twoPackages: TWO_PACKAGES };
  for (const [key, body] of Object.entries(projects)) {
    const dir = join(root, key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), body);

    const jsonRun = await runInfo(dir, ['--json']);
    expect(jsonRun.code, `os info --json (${key}) exited ${jsonRun.code}\n${jsonRun.stderr}`).toBe(0);
    json[key] = JSON.parse(jsonRun.stdout) as Payload;

    text[key] = await runInfo(dir, []);
    expect(text[key].code, `os info (${key}) exited ${text[key].code}\n${text[key].stderr}`).toBe(0);
  }
}, 180_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#17790 — `os info` reports the objects an option-B project declares, in BOTH faces', () => {
  it('the card\'s repro: one payload no longer says `stats.objects: 1` and `objects: []`', () => {
    // The whole defect in one line. `toBe(1)` on each side separately would not
    // state it: the claim is that the two halves AGREE, and they must agree at
    // the number the project actually declares.
    expect(json.optionB.objects).toHaveLength(json.optionB.stats.objects);
    expect(json.optionB.stats.objects).toBe(1);
  });

  it('and the listed entry is the object the summary counted, fields included', () => {
    expect(json.optionB.objects).toEqual([{ name: 'ob_order', label: 'Order', fields: 2 }]);
  });

  it('the text face prints the `Objects:` and `Apps:` sections it silently omitted', () => {
    expect(detailBlock(text.optionB.stdout)).toBe(
      [
        '  Objects:',
        '    ob_order (2 fields, user) — Order',
        '',
        '  Apps:',
        '    ob_app — OB',
      ].join('\n'),
    );
  });

  it('CONTROL — the SAME definitions authored at the TOP LEVEL answer identically', () => {
    // The card's control, and the proof that the absence was the reader's:
    // nothing about the definitions changed between these two projects, only
    // where they live. It is also the additive-rule guard — the top-level shape
    // is what every stack the platform emits today looks like, and its answer
    // here is the pre-fix answer unchanged.
    expect(json.topLevel.objects).toEqual(json.optionB.objects);
    expect(json.topLevel.stats).toEqual(json.optionB.stats);
    expect(detailBlock(text.topLevel.stdout)).toBe(detailBlock(text.optionB.stdout));
  });

  it('the `Agents:` read resolves `packages[]` too — the section prints instead of vanishing', () => {
    expect(detailBlock(text.twoPackages.stdout)).toContain('  Agents:');
    expect(detailBlock(text.twoPackages.stdout)).toContain('    ob_agent — assistant');
  });

  it('POSITIVE CONTROL — the listing concatenates ACROSS packages, not just the first', () => {
    // Without this row, a reader that read `packages[0]` alone would satisfy
    // every assertion above.
    expect(json.twoPackages.objects.map((o) => o.name)).toEqual(['ob_order', 'ob_ticket']);
    expect(json.twoPackages.objects).toHaveLength(json.twoPackages.stats.objects);
    expect(detailBlock(text.twoPackages.stdout)).toContain('    ob_ticket (1 fields, user) — Ticket');
  });

  it('every project measured here has a `--json` payload whose two halves agree', () => {
    // The invariant, stated once over all three: `stats.objects` is the count
    // of the SAME list `objects[]` publishes. A future detail read that regains
    // its own idea of the project reddens here even if it keeps every row above
    // green.
    for (const [key, payload] of Object.entries(json)) {
      expect(payload.objects.length, `${key}: stats.objects vs objects[].length`).toBe(payload.stats.objects);
    }
  });
});

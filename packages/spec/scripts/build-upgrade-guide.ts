// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-upgrade-guide.ts — generate the protocol upgrade guide as a pure
 * projection of the ADR-0087 registries (D4: "the upgrade guide for major N is
 * GENERATED from the change registry … it can never drift because it is a
 * projection of it").
 *
 * Everything in the emitted document comes from the D2 conversion table and
 * the D3 migration chain — the same data the loader, `objectstack migrate
 * meta`, and `spec-changes.json` run on. Hand-written narrative belongs in the
 * ADRs and release notes, not here.
 *
 * WHERE it is generated (#22449 B′): at publish, by
 * `scripts/release-spec-changes.sh`, which writes it into the package
 * (`--out packages/spec/protocol-upgrade-guide.md`), verifies the packed copy
 * against a fresh generation and attaches the same bytes to the GitHub Release.
 * The pull-request stage generates it IN MEMORY (`--check`) and compares no
 * committed copy; `render-projection-diff.ts` renders the generated diff
 * against the base on the pull request. The command-line contract of those two
 * flags is `lib/projection-cli.ts`.
 *
 * ITS PUBLIC ADDRESS (#22449 B′, condition 2) is the docs site: one page per
 * protocol major plus an index, generated at docs build into the gitignored
 * `content/docs/protocol-upgrade/` and served at
 * `https://objectstack.ai/docs/protocol-upgrade/<major>`. That is what this
 * script writes with no flag — the `@objectstack/docs` build runs it before
 * `next build` — and `lib/upgrade-guide-docs.ts` assembles the pages from the
 * same section renderers `build()` uses. `docs/protocol-upgrade-guide.md` is a
 * committed pointer stub naming that address; nothing here writes it.
 *
 *   pnpm --filter @objectstack/spec gen:upgrade-guide     # write the docs pages (content/docs/protocol-upgrade/)
 *   pnpm --filter @objectstack/spec check:upgrade-guide   # CI: generate in memory, red when generation fails
 *   tsx scripts/build-upgrade-guide.ts --out <file>       # write the single-file guide anywhere (the publish lane)
 *   tsx scripts/build-upgrade-guide.ts --docs <dir>       # write the docs pages somewhere else
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '../src/kernel/protocol-version';
import { MIGRATIONS_BY_MAJOR, MIGRATION_SUPPORT_FLOOR } from '../src/migrations/registry';
import { exitWith, runProjectionCli, type ProjectionCliResult } from './lib/projection-cli';
import { buildDocsPages, DOCS_DIR, writeDocsPages, type HopInput } from './lib/upgrade-guide-docs';

const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_DIR, '..', '..');

/**
 * `## How to upgrade`, shared by the single-file guide and every docs page. The
 * single file lists every hop below this section; a docs page holds one hop, so
 * its first command says which hops the replay covers instead.
 */
function howToUpgrade(form: 'file' | 'page'): string[] {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  out(`## How to upgrade — from protocol ${MIGRATION_SUPPORT_FLOOR} onward`);
  out();
  out('```bash');
  out(
    form === 'file'
      ? `objectstack migrate meta --from <your-major>   # replays every step below, in order`
      : `objectstack migrate meta --from <your-major>   # replays every hop from your major to ${PROTOCOL_MAJOR}, in order`,
  );
  out(
    `objectstack migrate meta --from ${MIGRATION_SUPPORT_FLOOR} --step      ` +
      '# checkpoint after each major (bisect a failure)',
  );
  out('objectstack validate && tsc --noEmit && <your tests>   # your own verify loop is the acceptance test');
  out('```');
  out();
  out(
    'Mechanical rewrites are applied for you and reported as a diff; **semantic TODOs** are printed ' +
      'with acceptance criteria and are yours to resolve — the chain never auto-applies a change that ' +
      'requires judgment.',
  );
  out();
  const supportedLateness = PROTOCOL_MAJOR - MIGRATION_SUPPORT_FLOOR;
  out(
    supportedLateness > 0
      ? `The chain's support floor is protocol **${MIGRATION_SUPPORT_FLOOR}** — ` +
          `${supportedLateness} major${supportedLateness === 1 ? '' : 's'} behind the current protocol ` +
          `**${PROTOCOL_MAJOR}**, and no earlier. A consumer further behind must reach protocol ` +
          `${MIGRATION_SUPPORT_FLOOR} by another path first (an older \`@objectstack/cli\` still carries ` +
          `the retired steps) before this command will run. From protocol ${MIGRATION_SUPPORT_FLOOR} ` +
          'forward, replaying every remaining hop in one command **is** the designed-for case — that part ' +
          'of timeliness is never load-bearing (ADR-0087); arriving from *before* the floor is not supported ' +
          'at all.'
      : `The chain's support floor is protocol **${MIGRATION_SUPPORT_FLOOR}**, which is also the current ` +
          'protocol — there is no supported lateness window right now; the next major to ship widens it ' +
          'again.',
  );
  out();

  return lines;
}

/** One hop's own section: `## Protocol N-1 → N` and everything under it. */
function hopSection(major: number): string[] {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  const step = MIGRATIONS_BY_MAJOR[major];
  const conversions = CONVERSIONS_BY_MAJOR[major] ?? [];
  out(`## Protocol ${major - 1} → ${major}`);
  out();
  if (!step && conversions.length === 0) {
    out('No metadata-facing break shipped in this major — nothing to do.');
    out();
    return lines;
  }
  if (step) {
    out(step.rationale);
    out();
  }
  if (conversions.length > 0) {
    out('### Mechanical (applied for you)');
    out();
    out('| Conversion | Surface | Change | Load window |');
    out('|---|---|---|---|');
    for (const c of conversions) {
      const window = c.retiredFromLoadPath
        ? 'retired — `migrate meta` only'
        : `live — protocol ${c.toMajor} loader accepts the old shape`;
      out(`| \`${c.id}\` | \`${c.surface}\` | ${c.summary} | ${window} |`);
    }
    out();
  }
  const semantic = step?.semantic ?? [];
  if (semantic.length > 0) {
    out('### Semantic (delegated to you, with acceptance criteria)');
    out();
    for (const s of semantic) {
      out(`- **\`${s.id}\`** — \`${s.surface}\` → ${s.replacement}`);
      out(`  - Why not automatic: ${s.reason}`);
      out(`  - Done when: ${s.acceptanceCriteria}`);
    }
    out();
  }
  return lines;
}

/** The closing lines: the machine-readable equivalents. */
function footer(): string[] {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  out('---');
  out();
  out(
    '*Machine-readable equivalents: `spec-changes.json` (shipped in `@objectstack/spec` and attached to ' +
      'each GitHub Release) and the structured output of `objectstack migrate meta --json`.*',
  );
  out();
  return lines;
}

/** The majors the chain carries a hop for, oldest first. */
function hopMajors(): number[] {
  const majors: number[] = [];
  for (let major = MIGRATION_SUPPORT_FLOOR + 1; major <= PROTOCOL_MAJOR; major++) majors.push(major);
  return majors;
}

/** The single-file guide: what the package ships and the Release carries. */
function build(): string {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  out('<!-- GENERATED (ADR-0087 D4) — do not edit by hand. -->');
  out('<!-- Regenerate: pnpm --filter @objectstack/spec exec tsx scripts/build-upgrade-guide.ts --out FILE -->');
  out();
  out('# Metadata protocol upgrade guide');
  out();
  out(
    `Current protocol: **${PROTOCOL_VERSION}** · chain support floor: **protocol ${MIGRATION_SUPPORT_FLOOR}** · ` +
      'generated from the ADR-0087 registries (`@objectstack/spec` `conversions/` + `migrations/`).',
  );
  out();
  lines.push(...howToUpgrade('file'));
  for (const major of hopMajors()) lines.push(...hopSection(major));
  lines.push(...footer());
  return lines.join('\n');
}

/** One clause naming what a generated guide holds, for `--check`'s success line. */
function describeGuide(text: string): string {
  const hops = text.split('\n').filter((line) => line.startsWith('## Protocol ')).length;
  return `protocol ${PROTOCOL_VERSION}, ${hops} major hop section(s), ${Buffer.byteLength(text)} bytes`;
}

/** The docs pages: one per hop the chain carries, plus the index (`lib/upgrade-guide-docs.ts`). */
function buildDocs(): Map<string, string> {
  const { version } = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')) as { version: string };
  const hops: HopInput[] = hopMajors().map((major) => ({ major, section: hopSection(major) }));
  return buildDocsPages({ specVersion: version, howToUpgrade: howToUpgrade('page'), hops, footer: footer() });
}

/**
 * `--docs <dir>`, or no flag at all: write the docs pages. `--check` and
 * `--out` stay `lib/projection-cli.ts`'s, untouched.
 */
function runDocs(argv: readonly string[]): ProjectionCliResult | null {
  const at = argv.indexOf('--docs');
  const modeFlag = argv.includes('--check') || argv.includes('--out');
  if (at < 0 && modeFlag) return null;
  const usage = (line: string): ProjectionCliResult => ({ code: 2, stdout: [], stderr: [line], wrote: null });
  if (at >= 0 && modeFlag) return usage('--docs writes the docs pages; --check and --out are the single-file modes. Pass one.');
  const value = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && (value === undefined || value.startsWith('--'))) return usage('--docs needs a directory: --docs <dir>.');
  const dir = resolve(value ?? resolve(REPO_ROOT, DOCS_DIR));

  let files: Map<string, string>;
  try {
    files = buildDocs();
  } catch (err) {
    return {
      code: 1,
      stdout: [],
      stderr: [
        '✗ the protocol upgrade guide could not be generated from the ADR-0087 registries. Nothing was written.',
        `  ${(err instanceof Error ? (err.stack ?? err.message) : String(err)).split('\n').join('\n  ')}`,
      ],
      wrote: null,
    };
  }
  try {
    writeDocsPages(dir, files);
  } catch (err) {
    return { code: 1, stdout: [], stderr: [`✗ ${err instanceof Error ? err.message : String(err)}`], wrote: null };
  }
  return {
    code: 0,
    stdout: [`Wrote ${files.size} docs file(s) to ${dir}: ${[...files.keys()].join(', ')}`],
    stderr: [],
    wrote: dir,
  };
}

exitWith(
  runDocs(process.argv) ??
    runProjectionCli({
      name: 'protocol-upgrade-guide.md',
      build,
      describe: describeGuide,
      argv: process.argv,
    }),
);

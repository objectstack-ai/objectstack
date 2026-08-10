// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4776 — the vocabulary GATE. The rule next door is a pure decision procedure
// that ships to any caller with source in hand; this file is the one that makes
// it bite in THIS repo, by running it over every `.ts` under `packages/`.
//
// Why the enforcement lives in a test rather than in another `scripts/check-*`:
// the shape it looks for is a lint-layer vocabulary, and `@objectstack/lint` is
// where the vocabulary lives. A rule on the package's public export surface
// reads — to a human and to an AI author alike — as a check the platform
// performs (Prime Directive #10, and the closure `authoring-rule-wiring.test.ts`
// draws around it). This is that check. `pnpm check:startup-registry-verdict`
// enforces the SERVICE-registry half of the same family and is untouched; see
// the rule module for the measured division of labour between the two.
//
// Two false greens this is built to refuse:
//
//  1. **A corpus that was never read.** An unreadable directory would silently
//     shrink the sweep while the file count stayed comfortably non-zero, and the
//     test would report a clean audit over source it never opened — the exact
//     shape the rule itself is about, turned on the rule (#4930). So the root is
//     resolved up front and the walk carries no `catch`.
//  2. **A rule that matches nothing.** A ratchet that has only ever been green
//     cannot be told apart from a dead one (#4690), and this one has been green
//     from its first commit. `the sweep can still fire` therefore pushes a
//     known-bad source through the SAME sweep function the corpus goes through.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  findStartupRegistryVerdicts,
  type StartupRegistryVerdictFinding,
} from './lint-startup-registry-verdict.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(srcDir, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');

/**
 * Reviewed exceptions. **Shrink-only**, hand-edited: an entry must name WHY the
 * site is still here and WHAT closes it. There is deliberately no generator — a
 * `--update` flag lets a new violation be admitted by "just run the update
 * command", which is how a ratchet stops meaning anything.
 *
 * Empty on purpose: the three instances this vocabulary was written from
 * (#4769 / #4771 / #4772) were all fixed before it landed. The non-vacuity proof
 * is the `the sweep can still fire` case below, not the emptiness of this list.
 */
const LEDGER: Readonly<Record<string, string>> = {};

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache', '.next']);

/**
 * Every auditable `.ts` under `dir`.
 *
 * No `catch`: an error during the walk means the corpus was only partly read,
 * which must not be reported as a clean audit.
 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.includes('.test.') &&
      !entry.includes('.spec.') &&
      !entry.includes('.conformance.')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** The sweep, as one function, so the corpus and the non-vacuity case share it. */
function sweep(sources: Array<{ file: string; source: string }>): StartupRegistryVerdictFinding[] {
  return sources.flatMap(({ file, source }) => findStartupRegistryVerdicts(source, { file }));
}

describe('startup open-vocabulary verdicts across packages/ (#4776)', () => {
  const stat = statSync(packagesDir);
  expect(stat.isDirectory(), `${packagesDir} must be a directory — the sweep's verdict is drawn from reading it`).toBe(
    true,
  );
  const files = collectSourceFiles(packagesDir);

  it('reads a non-empty corpus', () => {
    // A zero-file sweep returns zero findings and would otherwise print as a
    // clean audit over nothing at all.
    expect(files.length).toBeGreaterThan(500);
  });

  it('no package records a verdict the boot can still contradict', () => {
    const findings = sweep(
      files.map((file) => ({ file: relative(repoRoot, file), source: readFileSync(file, 'utf8') })),
    );
    const unledgered = findings.filter((f) => !(`${f.path}::${f.rule}` in LEDGER));

    expect(
      unledgered.map((f) => `[${f.rule}] ${f.path} — ${f.where}: ${f.message}`),
      `${unledgered.length} startup open-vocabulary verdict(s).\n` +
        `Each one draws a conclusion from a registry a plugin can still fill during this same boot, and ` +
        `records it where nothing retracts it. Fix it (the finding's hint carries the three shapes the ` +
        `#4769/#4771/#4772 fixes took), or add an entry to LEDGER in this file WITH the reason it is ` +
        `still here and what closes it.`,
    ).toEqual([]);
  });

  it('no ledger entry is stale', () => {
    // A ledger that outlives its site is a standing permission nobody reviewed.
    const findings = sweep(
      files.map((file) => ({ file: relative(repoRoot, file), source: readFileSync(file, 'utf8') })),
    );
    const live = new Set(findings.map((f) => `${f.path}::${f.rule}`));
    const stale = Object.keys(LEDGER).filter((key) => !live.has(key));
    expect(stale, `stale LEDGER entr(ies) — the site is fixed, delete the line: ${stale.join(', ')}`).toEqual([]);
  });

  it('the sweep can still fire (#4690 — a green ratchet must be told apart from a dead one)', () => {
    // #4771, reconstructed: the flow node-type verdict drawn in start(), 0.8s
    // before the executor that answers it was registered. Pushed through the
    // SAME sweep the corpus goes through, so a change that broke matching would
    // fail here instead of quietly turning the corpus green.
    const reconstructed = `
      export class AutomationServicePlugin {
        name = 'com.objectstack.service-automation';
        async init() {}
        async start(ctx) {
          const known = this.engine.getRegisteredNodeTypes();
          for (const flow of this.flows) {
            if (!known.includes(flow.type)) {
              ctx.logger.warn(\`Flow '\${flow.name}' will fail at execution time.\`);
            }
          }
        }
      }
    `;
    const findings = sweep([{ file: 'packages/services/service-automation/src/plugin.ts', source: reconstructed }]);
    expect(findings.map((f) => f.rule)).toEqual([
      'startup-open-vocabulary-verdict',
      'startup-verdict-assertive-wording',
    ]);
  });
});

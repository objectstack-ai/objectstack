// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the `check:generated` LEDGER against package.json — the reconciliation
// that decides whether every `check:`/`gen:` script in this package is actually
// covered by a gate, or has quietly dropped out of coverage.
//
// WHY IT IS WORTH A TEST AND NOT JUST A CI STEP. The reconciliation has been
// dormant or unsatisfied three times now, and each time the cost was a CI lap
// rather than a local one:
//
//   • #4177 and #4232 landed unclassified scripts while nothing in CI ran the
//     reconciliation at all, so `main` carried a wrapper that exited red before
//     running a single gate.
//   • #4291 fixed that by wiring `--reconcile-only` into lint.yml's unfiltered
//     required job — which is exactly where #5286's own first push then died,
//     because the two scripts it added (`check:test-typecheck`,
//     `gen:test-typecheck-debt`) were in neither ledger bucket. `tsc` passed;
//     the step after it did not.
//
// So the negative direction of this reconciliation is not hypothetical — it is
// the reason this file exists, observed in production twice. What was missing
// was a signal BEFORE the push: `pnpm --filter @objectstack/spec test` did not
// read the ledger, so a script added in one file and unclassified in another was
// invisible until a runner said so ten minutes later. This closes that gap.
//
// It runs the real script in place: `--reconcile-only` reads package.json and
// the ledger arrays and exits — no gates, no build, no writes, sub-second — so
// there is nothing to sandbox and no way for it to differ from what CI runs.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');

function runReconcile(): { status: number | null; output: string } {
  const require = createRequire(import.meta.url);
  const tsx = require.resolve('tsx/cli');
  const result = spawnSync(process.execPath, [tsx, path.join(HERE, 'check-generated.ts'), '--reconcile-only'], {
    cwd: SPEC,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('check:generated --reconcile-only', () => {
  const scripts: Record<string, string> = JSON.parse(fs.readFileSync(path.join(SPEC, 'package.json'), 'utf8')).scripts;
  const checks = Object.keys(scripts).filter((n) => n.startsWith('check:'));
  const gens = Object.keys(scripts).filter((n) => n.startsWith('gen:'));

  it('classifies every check:/gen: script this package declares', () => {
    const { status, output } = runReconcile();
    // The failure text is the useful part when this goes red: it names the
    // unclassified script and asks the classifying question.
    expect(output).not.toMatch(/is in neither GATED nor NO_GENERATOR/);
    expect(output).not.toMatch(/it is not in UNGATED_GENERATORS/);
    expect(status, output).toBe(0);
  });

  it('reports the same script counts package.json actually declares', () => {
    // Derived from package.json rather than hardcoded, so adding a gate does not
    // churn this test — only FAILING to classify one does.
    const { output } = runReconcile();
    expect(output).toContain(`${checks.length} check: + ${gens.length} gen: scripts`);
    expect(output).toContain('all classified');
  });

  it('covers the explicit, manual-only anchor generator (#5358)', () => {
    // `gen:authorable-surface-base` is the third classification this ledger
    // carries, and the one most likely to be mis-filed by a later change:
    // UNGATED_GENERATORS would claim nothing verifies its artifact (false —
    // check:authorable-surface proves the anchor authentic), while a GATED entry
    // would put it in reach of `--fix`, which is the side effect #5358 removed.
    expect(scripts['gen:authorable-surface-base']).toBeDefined();
    expect(scripts['gen:authorable-surface-base']).toContain('--update-base');
    const { status, output } = runReconcile();
    expect(status, output).toBe(0);
    expect(output).toContain('1 explicit manual-only generators');
  });

  it('files the gate whose input this repo cannot produce as EXTERNAL_INPUT_REQUIRED (#4690)', () => {
    // NO_GENERATOR would say "runnable, deliberately not run here" — which is what
    // `check:react-declaration-parity` said while it was wired into no workflow and
    // skipping by default, i.e. while running nowhere at all. The classification has
    // to carry the two facts a reader needs instead: WHICH input is missing, and WHO
    // supplies it.
    const { status, output } = runReconcile();
    expect(status, output).toBe(0);
    expect(output).toContain('1 needing an external input');
    expect(output).toContain('cannot run here: check:react-declaration-parity');
    expect(output).toContain('MANIFEST');
    expect(output).toContain('scripts/gen-sdui-manifest.sh');
    // And the claim is not free: `runBy` must still invoke the gate. The
    // reconciliation fails otherwise (a gate classified as "runs elsewhere" while
    // running nowhere is the hole this category exists to make visible), so this
    // asserts the same fact where the failure message is legible.
    const runner = path.resolve(SPEC, '..', '..', 'scripts/gen-sdui-manifest.sh');
    expect(fs.existsSync(runner)).toBe(true);
    expect(fs.readFileSync(runner, 'utf8')).toContain('check:react-declaration-parity');
  });

  it('covers the test-layer typecheck gate and its writer (#5286)', () => {
    // The specific pair that failed CI on this branch. Named here so a later
    // change that drops either script also has to come back through this file.
    expect(scripts['check:test-typecheck']).toBeDefined();
    expect(scripts['gen:test-typecheck-debt']).toBeDefined();
    expect(runReconcile().status).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // #4723 — no `check:` script may run a `gen:` script.
  //
  // The defect this pins is a COMPOSITION, one line of package.json, and that is
  // why it is pinned here rather than by an end-to-end run: nothing has to be
  // executed to see it, and a source-level assertion cannot go quiet the way a
  // spawned run can when its gitignored input is absent (which is the state
  // `turbo run test` leaves this package in — see root-index.test.ts).
  //
  // `check:docs` was `pnpm gen:schema && tsx scripts/build-docs.ts --check`. The
  // first half is a GENERATOR: on a stale tree it rewrites `json-schema.manifest.json`
  // and `authorable-surface.json`, both TRACKED. So running the gate edited the
  // working tree of whoever ran it, and — because `check:generated` runs
  // `check:authorable-surface` first and does not stop on failure — a single
  // aggregate run produced a red report about a manifest that the gate two lines
  // below had already quietly fixed. #4711 removed exactly this from `--check`;
  // this was the same defect at a different entry.
  //
  // Stated as the CLASS rather than the one instance, because the class is what
  // came back: a check that repairs what it detects can never report it.
  describe('no check: script composes a gen: script (#4711, #4723)', () => {
    const generatorNames = gens;

    it('is true of every check: script in this package', () => {
      const offenders = checks
        .map((name) => ({
          name,
          runs: generatorNames.filter((g) =>
            // The composition spellings pnpm accepts. Matched with the boundary
            // included so `gen:schema` does not also match `gen:schema-foo`.
            new RegExp(`pnpm(?: run)? ${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w:-])`).test(scripts[name]),
          ),
        }))
        .filter((o) => o.runs.length > 0);

      expect(
        offenders,
        offenders
          .map(
            (o) =>
              `\`${o.name}\` runs the generator(s) ${o.runs.map((r) => `\`${r}\``).join(', ')}:\n` +
              `    ${scripts[o.name]}\n` +
              '  A gate that regenerates repairs the tracked artifact it is supposed to report,\n' +
              "  and silently edits the tree of whoever ran it. Move the generation to the CALLER\n" +
              '  (the CI step / the check:generated gate order), or make the gate read the build\n' +
              '  artifact and refuse when it is stale, as build-docs.ts does (#4711, #4723).',
          )
          .join('\n'),
      ).toEqual([]);
    });

    it('leaves check:docs as the read-only half it is named for', () => {
      // The specimen, named so a re-composition has to come back through here
      // even if the regex above is ever loosened.
      expect(scripts['check:docs']).toBe('tsx scripts/build-docs.ts --check');
    });
  });

  it('declares which gate generates the tree check:docs renders from (#4723)', () => {
    // With the generation gone from the composition, `check:docs` depends on a
    // gitignored build artifact somebody else produced. Inside this aggregate that
    // somebody is the gate ORDER — a dependency an array literal expresses by
    // accident, so the ledger declares it and the reconciliation enforces it. The
    // narration is asserted because an ordering nobody can see is one the next
    // tidy-up breaks silently.
    const { status, output } = runReconcile();
    expect(status, output).toBe(0);
    expect(output).toContain(
      'check:docs renders from json-schema/, generated by check:authorable-surface above it.',
    );
    // And the enforcement itself is real, not just printed: the two failure
    // sentences exist in the script that would emit them.
    const ledger = fs.readFileSync(path.join(HERE, 'check-generated.ts'), 'utf8');
    expect(ledger).toContain('BEFORE its declared producer');
    expect(ledger).toContain('which this ledger does not run');
  });
});

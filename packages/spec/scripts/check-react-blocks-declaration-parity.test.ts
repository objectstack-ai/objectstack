// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins WHAT `check-react-blocks-declaration-parity` claims, not only what it
// computes (#4472).
//
// The script's defect was never its arithmetic — the set difference it prints
// was always right. The defect was the sentence wrapped around it: it opened by
// saying it "confirms the objectui components ACTUALLY implement the props the
// spec protocol declares", which is a statement about renderers, and it has
// never read a renderer. It reads two DECLARATIONS: the spec zod schema on one
// side, and on the other the objectui registry config's `inputs` — copied
// verbatim into the manifest by `manifestFromConfigs`, so also a declaration.
//
// A claim that outruns the capability is worse than no claim: with no gate a
// human checks by hand, and #4413's four dead `record:*` blocks were in fact
// found by hand — while this check reported `{ frontendOnly: [], missing: false }`
// for every one of them, for that defect's entire lifetime, because both
// declarations agreed and neither was lying. Only the renderer was, and the
// renderer is not in scope here.
//
// So these tests assert four things in one process run:
//   1. the signals it CAN see, in both directions (spec-only / registry-only);
//   2. the scope caveat rides along with EVERY report, success included —
//      whoever forms a belief from this gate is reading a CI log, not a header;
//   3. the implementation claim stays gone. This is the executable half of
//      Prime Directive #10 ("never advertise a capability the runtime doesn't
//      deliver"): the wording that caused #4472 fails a test if it comes back.
//   4. THE GATE CAN GO RED (#4690). The three above all read the report text,
//      which a gate that exits 0 on everything would still produce. #4690 is
//      that shape: no workflow ran this gate, and a manual run without MANIFEST
//      printed a `⚠` and exited 0 — no path existed on which it could fail, and
//      two other issues (#4804/#4777) had started citing it as the negative
//      example of a gate nobody can prove catches anything. The last describe
//      block therefore asserts EXIT CODES against fabricated violations: a
//      registry-only input and a vanished block must each exit non-zero naming
//      themselves, an absent/unusable manifest must exit non-zero as "did not
//      run", and an accepted state must still exit 0 so the red is discriminating.

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const SCRIPT = path.join(HERE, 'check-react-blocks-declaration-parity.ts');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');

type ManifestInput = { name: string };
type Manifest = { components: Record<string, { type: string; inputs: ManifestInput[] }> };

/** Build a manifest declaring exactly `inputs` for `type`. */
const manifestFor = (type: string, inputs: string[]): Manifest => ({
  components: { [type]: { type, inputs: inputs.map((name) => ({ name })) } },
});

/**
 * Every `run()` spawns a fresh tsx process that loads the whole spec schema
 * surface — ~4.5s alone and 5–7s under turbo's parallel test load, which is
 * ON the 5s vitest default. Which test crossed the line varied run to run:
 * three consecutive `pnpm test` sweeps failed a different `it` of this file
 * each time, every one a timeout, while the file alone stayed green. A
 * timeout here should mean "the script hung", not "the runner was busy".
 */
const SPAWN_TIMEOUT_MS = 60_000;

/** Run the real script against a synthetic manifest; return stdout+stderr. */
function run(manifest: Manifest, args: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-parity-'));
  const file = path.join(dir, 'sdui.manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest), 'utf8');
  try {
    return execFileSync(TSX, [SCRIPT, ...args], {
      cwd: PKG,
      env: { ...process.env, MANIFEST: file },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e: any) {
    // Non-zero exit (e.g. --strict on divergence) still carries the report.
    return `${e?.stdout ?? ''}${e?.stderr ?? ''}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The committed baseline's shape, per block, as the ratchet reads it. */
type BaselineFile = { blocks: Record<string, { registryOnly: string[]; missing: boolean }> };

/**
 * Same script, same spawn — but the EXIT CODE is the assertion.
 *
 * `run()` above deliberately swallows a non-zero exit to return the report text;
 * every test using it would pass unchanged against a script that always exited 0,
 * which is precisely the #4690 failure mode. So the red-path tests go through this
 * helper instead: it never throws, and hands back `status` alongside the output.
 *
 * `manifest` is written to a tmp file and passed as MANIFEST (a string is written
 * verbatim, so malformed JSON can be exercised); `manifestPath` sets MANIFEST to a
 * literal path instead; passing neither leaves MANIFEST unset — the case that used
 * to skip. MANIFEST is stripped from the inherited env so an ambient one (a
 * developer who exported it, `pnpm sdui:manifest` in the same shell) cannot make
 * the "no manifest" test silently exercise a real manifest.
 */
function runExit(opts: {
  manifest?: Manifest | string;
  manifestPath?: string;
  baseline?: BaselineFile;
  args?: string[];
}): { status: number | null; output: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-parity-exit-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.MANIFEST;
    if (opts.manifest !== undefined) {
      const file = path.join(dir, 'sdui.manifest.json');
      fs.writeFileSync(file, typeof opts.manifest === 'string' ? opts.manifest : JSON.stringify(opts.manifest), 'utf8');
      env.MANIFEST = file;
    } else if (opts.manifestPath !== undefined) {
      env.MANIFEST = opts.manifestPath;
    }
    const argv = [...(opts.args ?? [])];
    if (opts.baseline) {
      const baselineFile = path.join(dir, 'baseline.json');
      fs.writeFileSync(baselineFile, JSON.stringify(opts.baseline), 'utf8');
      argv.push('--baseline', baselineFile);
    }
    const res = spawnSync(TSX, [SCRIPT, ...argv], { cwd: PKG, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (res.error) throw res.error;
    return { status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// `object-form` is a real REACT_BLOCKS entry backed by FormViewSchema. Two of
// its schema props are enough to exercise both directions; the rest of the
// schema simply shows up as spec-only, which is the soft signal.
const SCHEMA_PROP = 'layout';
const NOT_A_SCHEMA_PROP = 'zzzNotInTheFormViewSchema';

describe('check:react-declaration-parity — the signals it can see', () => {
  it('reports a registry-declared input the spec does not declare as registry-only', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const out = run(manifestFor('object-form', [SCHEMA_PROP, NOT_A_SCHEMA_PROP]));
    expect(out).toMatch(/registry declares, spec does not: .*zzzNotInTheFormViewSchema/);
  });

  it('reports a spec-declared prop the registry does not declare as spec-only', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const out = run(manifestFor('object-form', []));
    expect(out).toMatch(new RegExp(`spec declares, registry does not: .*${SCHEMA_PROP}`));
  });

  it('reports a block absent from the manifest as missing', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const out = run(manifestFor('something-else', []));
    expect(out).toMatch(/<ObjectForm> \(object-form\): NO component in the manifest/);
  });
});

describe('check:react-declaration-parity — the blind spot is stated, every run (#4413/#4472)', () => {
  /**
   * The #4413 shape, reconstructed: both sides declare the same prop, so the
   * report is clean. Nothing in this run touched a renderer — if `object-form`'s
   * renderer stopped reading `layout` tomorrow, this output would not move. That
   * is precisely how four `record:*` blocks that rendered "bind a record to
   * preview" sat behind a green ratchet.
   *
   * The assertion is therefore not "it catches this" (it cannot) but "it says so
   * while reporting the agreement".
   */
  it('calls agreeing declarations agreement — and prints the caveat alongside it', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const out = run(manifestFor('object-form', [SCHEMA_PROP]));
    expect(out).toMatch(/declared by both/);
    expect(out).not.toMatch(/registry declares, spec does not/);
    expect(out).toMatch(/compares two DECLARATIONS/);
    expect(out).toMatch(/No renderer is inspected/);
    expect(out).toMatch(/#4413/);
  });

  it('carries the caveat on a clean baseline ratchet too, where it is easiest to over-read', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const baseline = path.join(PKG, 'react-declaration-parity.baseline.json');
    // Every baselined block must be present, or the run reports them vanished
    // instead of clean. Each declares only spec props, so registry-only is empty
    // — the committed baseline's accepted state.
    const manifest: Manifest = {
      components: {
        ...manifestFor('object-form', [SCHEMA_PROP]).components,
        ...manifestFor('list-view', []).components,
        ...manifestFor('object-chart', []).components,
      },
    };
    const out = run(manifest, ['--baseline', baseline]);
    expect(out).toMatch(/no new DECLARATION divergence/);
    expect(out).toMatch(/compares two DECLARATIONS/);
  });
});

describe('check:react-declaration-parity — the retired claim stays retired (Prime Directive #10)', () => {
  /**
   * Guards the wording, in the script AND in what it prints. "conformance",
   * "implements", "honors" all assert something about the render path; this gate
   * observes none of it. If a future edit reaches for them again, #4472 recurs —
   * a gate whose name promises more than it checks, trusted accordingly.
   *
   * Scoped to the prose the reader forms a belief from: the file's own
   * explanations of what it cannot do are allowed to name the retired claim (and
   * do), so the check runs against the report, plus the script's leading header
   * block minus the lines that quote the old claim to correct it.
   */
  const CLAIM_WORDS = /\b(actually implements?|conforms? to|conformance)\b/i;

  it('the report never claims the frontend implements anything', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const out = run(manifestFor('object-form', [SCHEMA_PROP, NOT_A_SCHEMA_PROP]));
    expect(out).not.toMatch(CLAIM_WORDS);
  });

  it('the script advertises its scope before its first line of code', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const header = src.slice(0, src.indexOf('process.env.OS_EAGER_SCHEMAS'));
    expect(header).toMatch(/DECLARATION PARITY/);
    expect(header).toMatch(/It never looks at a renderer|never (?:reads|inspects) a renderer/i);
    // The one blind spot, named in the header rather than left to be rediscovered.
    expect(header).toMatch(/BOTH SIDES declare and NO RENDERER READS/);
  });
});

describe('check:react-declaration-parity — the gate CAN go red (#4690)', () => {
  // `ObjectForm` is the baseline KEY for the `object-form` block (baselines are
  // keyed by tag, not schemaType). If the tag ever changes, these tests fail — which
  // is the right outcome: the committed baseline would need the same rename.
  const TAG = 'ObjectForm';
  const ACCEPTED: BaselineFile = { blocks: { [TAG]: { registryOnly: [], missing: false } } };
  const FABRICATED = 'zzzFabricatedRegistryOnlyInput';

  /**
   * The self-proof #4804/#4777 ask for: a gate that is only ever green on the
   * current `main` has not shown it catches anything. Each of these fabricates a
   * violation the gate claims to see and asserts a non-zero exit that NAMES it.
   */
  it('exits non-zero naming a fabricated registry-only input', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const { status, output } = runExit({
      manifest: manifestFor('object-form', [SCHEMA_PROP, FABRICATED]),
      baseline: ACCEPTED,
      args: ['--strict'],
    });
    expect(output).toContain(`new registry-only input(s) not in baseline: ${FABRICATED}`);
    expect(status, output).toBe(1);
  });

  it('exits non-zero naming a block that vanished from the manifest', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const { status, output } = runExit({
      manifest: manifestFor('something-else', []),
      baseline: ACCEPTED,
      args: ['--strict'],
    });
    expect(output).toContain(`<${TAG}>: block vanished from the manifest`);
    expect(status, output).toBe(1);
  });

  /**
   * The control. Without it the two reds above could be red for any reason — a
   * broken spawn, a bad path — and the suite would still look like proof.
   */
  it('exits 0 when the manifest matches the accepted baseline', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const { status, output } = runExit({
      manifest: manifestFor('object-form', [SCHEMA_PROP]),
      baseline: ACCEPTED,
      args: ['--strict'],
    });
    expect(output).toMatch(/no new DECLARATION divergence/);
    expect(status, output).toBe(0);
  });

  /**
   * `--strict` decides what a DIVERGENCE costs. The four cases below are the other
   * thing entirely — no comparison happened at all — so they must fail WITHOUT
   * `--strict` too. Tying "could not run" to the flag would rebuild #4690's hole one
   * flag deeper: every one of these exited 0 before, and the first was the shipped
   * default of the manual run.
   */
  it('a missing MANIFEST is a failure, not a skip', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const { status, output } = runExit({});
    expect(status, output).toBe(1);
    expect(output).toMatch(/did NOT run/);
    expect(output).not.toMatch(/skipping/);
    // The refusal has to be actionable: the manifest's producer lives in another repo.
    expect(output).toContain('pnpm sdui:manifest');
    expect(output).toContain('OBJECTUI_ROOT=../objectui');
  });

  it('a MANIFEST path that does not exist fails loudly, naming the path', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const { status, output } = runExit({ manifestPath: '/nonexistent/sdui.manifest.json' });
    expect(status, output).toBe(1);
    expect(output).toContain('/nonexistent/sdui.manifest.json does not exist');
  });

  it('an unreadable manifest fails as a diagnosis, not as an uncaught throw', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const { status, output } = runExit({ manifest: '{ not json' });
    expect(status, output).toBe(1);
    expect(output).toMatch(/is not readable JSON/);
  });

  it('an empty registry dump is refused rather than compared against nothing', { timeout: SPAWN_TIMEOUT_MS }, () => {
    // Every block would report "missing" — catastrophic under --strict, vacuous
    // without it. objectui's dumper refuses to WRITE one; this refuses to READ one.
    const { status, output } = runExit({ manifest: { components: {} } });
    expect(status, output).toBe(1);
    expect(output).toMatch(/declares no components/);
  });
});

/**
 * The SDUI `object-*` blocks ride this gate as of #7751 (maintainer ruling
 * 2026-08-12, direction A: the parity burden goes through THIS machinery, no
 * new gate). Same comparison, same ratchet, baseline-keyed by the TYPE itself
 * (`object-grid`) rather than a PascalCase tag. These tests prove the new
 * iteration source with the same fixture harness — including that it can go
 * red — because the real manifest only exists at pin-bump time and cannot be
 * produced here (#4690's constraint, unchanged).
 */
describe('check:react-declaration-parity — SDUI object-* blocks (#7751)', () => {
  it('compares an object-* ComponentPropsMap entry against the manifest (both directions)', { timeout: SPAWN_TIMEOUT_MS }, () => {
    // `filter` IS declared by ObjectGridPropsSchema; the fabricated name is not.
    const out = run(manifestFor('object-grid', ['objectName', 'filter', 'zzzNotInTheGridSchema']));
    expect(out).toMatch(/# Spec ↔ registry declaration parity \(SDUI object-\* blocks, #7751\)/);
    expect(out).toMatch(/object-grid: 2 declared by both/);
    expect(out).toMatch(/registry declares, spec does not: .*zzzNotInTheGridSchema/);
    // The declared-set surplus (renderer-read keys the palette does not offer)
    // is the SOFT signal, present and named:
    expect(out).toMatch(/⚠ object-grid: .*spec-only/);
  });

  it('reports an object-* block absent from the manifest as missing', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const out = run(manifestFor('something-else', []));
    expect(out).toMatch(/✗ object-grid: NO component in the manifest/);
    expect(out).toMatch(/✗ object-metric: NO component in the manifest/);
  });

  it('ratchets a fabricated registry-only input on an object-* block — non-zero, named', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const { status, output } = runExit({
      manifest: manifestFor('object-kanban', ['groupBy', 'zzzFabricatedKanbanInput']),
      baseline: { blocks: { 'object-kanban': { registryOnly: [], missing: false } } },
      args: ['--strict'],
    });
    expect(output).toContain('new registry-only input(s) not in baseline: zzzFabricatedKanbanInput');
    expect(status, output).toBe(1);
  });

  it('a block not yet in the baseline is additive, not a regression (pin-bump onboarding path)', { timeout: SPAWN_TIMEOUT_MS }, () => {
    // The committed baseline predates #7751's blocks; the first pin-bump run
    // must not go red because coverage GREW. (`--update` then records them.)
    const { status, output } = runExit({
      manifest: manifestFor('object-grid', ['objectName', 'columns', 'filter']),
      baseline: { blocks: { ObjectForm: { registryOnly: [], missing: true } } },
      args: ['--strict'],
    });
    expect(output).toMatch(/no new DECLARATION divergence/);
    expect(status, output).toBe(0);
  });
});

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
// So these tests assert three things in one process run:
//   1. the signals it CAN see, in both directions (spec-only / registry-only);
//   2. the scope caveat rides along with EVERY report, success included —
//      whoever forms a belief from this gate is reading a CI log, not a header;
//   3. the implementation claim stays gone. This is the executable half of
//      Prime Directive #10 ("never advertise a capability the runtime doesn't
//      deliver"): the wording that caused #4472 fails a test if it comes back.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
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

// `object-form` is a real REACT_BLOCKS entry backed by FormViewSchema. Two of
// its schema props are enough to exercise both directions; the rest of the
// schema simply shows up as spec-only, which is the soft signal.
const SCHEMA_PROP = 'layout';
const NOT_A_SCHEMA_PROP = 'zzzNotInTheFormViewSchema';

describe('check:react-declaration-parity — the signals it can see', () => {
  it('reports a registry-declared input the spec does not declare as registry-only', () => {
    const out = run(manifestFor('object-form', [SCHEMA_PROP, NOT_A_SCHEMA_PROP]));
    expect(out).toMatch(/registry declares, spec does not: .*zzzNotInTheFormViewSchema/);
  });

  it('reports a spec-declared prop the registry does not declare as spec-only', () => {
    const out = run(manifestFor('object-form', []));
    expect(out).toMatch(new RegExp(`spec declares, registry does not: .*${SCHEMA_PROP}`));
  });

  it('reports a block absent from the manifest as missing', () => {
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
  it('calls agreeing declarations agreement — and prints the caveat alongside it', () => {
    const out = run(manifestFor('object-form', [SCHEMA_PROP]));
    expect(out).toMatch(/declared by both/);
    expect(out).not.toMatch(/registry declares, spec does not/);
    expect(out).toMatch(/compares two DECLARATIONS/);
    expect(out).toMatch(/No renderer is inspected/);
    expect(out).toMatch(/#4413/);
  });

  it('carries the caveat on a clean baseline ratchet too, where it is easiest to over-read', () => {
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

  it('the report never claims the frontend implements anything', () => {
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

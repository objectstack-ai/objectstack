// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11727 — `os build --json` dropped the #3366 capability-provider hints and
 * the ADR-0046 package-docs advisories that `os validate --json` carries.
 *
 * The fourth measured instance of one class in these two files (#10953,
 * #11174, #11643, this): an advisory computed and then formatted *inside* an
 * `if (... && !flags.json)` print block, which puts it structurally out of
 * reach of the payload — computed, then discarded, for the one audience
 * `--json` exists to serve. Measured at `origin/main` 589758d22 over the
 * `planted` fixture below, both commands exiting 0:
 *
 *   os build            ⚠ requires: "…" is not a known platform capability …
 *                       ⚠ src/docs/…: Frontmatter `tags:` … is not a list …
 *   os validate --json  warnings: [ {doc record}, {token,message}, "No apps…" ]
 *   os build    --json  warnings: []                             <- the defect
 *
 * A CI job gating on `os build --json` therefore read an empty advisory list
 * for a stack that names an unknown capability token and ships a doc whose
 * frontmatter silently dropped its tags — while the identical job gating on
 * `os validate --json` over the same tree read both.
 *
 * ## WHAT THESE PINS ASSERT — parity measured from ONE tree
 *
 * Not "build printed something". The two commands are run over the SAME temp
 * project inside one test and their payloads compared per class, so a build
 * that reports a *different* set from validate cannot pass. The reverse end is
 * pinned too: a clean fixture yields neither advisory on either face, so
 * "present" is distinguishable from "always present".
 *
 * Detection is STRUCTURAL — a capability hint is a record carrying `token`, a
 * doc advisory is a record whose `rule` is namespaced `docs/`. Deliberately not
 * a substring of the planted token or of the warning prose: a reverse-check
 * spelled as a fragment of the term under test can match for reasons that have
 * nothing to do with the behaviour, in both directions.
 *
 * ## Shape: mirrored from `os validate --json`, not chosen here
 *
 * `validate.ts` ships `warnings: [...ruleAdvisories, ...docWarnings,
 * ...unknownKeyWarnings, ...capProviderWarnings, ...structuralWarnings]` —
 * doc advisories as the ISSUE RECORDS `collectAndLintDocs` returns, capability
 * hints mapped to `{ token, message }`. `build --json` now emits that list
 * minus its last member, in that order, so a consumer reads one shape per class
 * from either command rather than learning two.
 *
 * ## `structuralWarnings` is reported, NOT ported — and pinned as the residue
 *
 * The one member validate has that build does not is the structural advisory
 * set ("No apps or plugins defined …" and its three siblings). That is a
 * MISSING COMPUTATION on the build path, not a dropped list: `compile.ts`
 * contains no such string in any face, while `validate.ts` derives all four
 * from `collectMetadataStats` — the very helper `compile.ts` already calls. So
 * the inputs are present and identical and only the computation is absent,
 * which makes "should a command that writes an artifact advise 'No apps or
 * plugins defined'?" a judgment rather than a mechanical port. #11727 fixes the
 * two genuinely dropped lists and splits this one out as #11896, which is
 * where the judgment is made and which outlives #11727 closing.
 *
 * The last pin below makes that report executable: the build/validate residue
 * must be structural advisories and nothing else. A future port of them turns
 * it red on purpose — the decision then gets made in the open, and a FIFTH
 * dropped list cannot hide inside the same gap.
 *
 * ## Fixture notes
 *
 * An undeclared key directly on an object or field is a hard parse error since
 * #4001, so fixtures in this class must be checked for reaching the code path
 * at all. Both fixtures here are asserted to exit 0, and the planted one is
 * asserted to raise both advisories on the text face, before any claim is made
 * about a payload.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
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

/** The planted capability token. Matched by EQUALITY below, never as a fragment. */
const PLANTED_TOKEN = 'zzz_unknown_capability_token';
/** The planted doc, whose `tags:` scalar the reader cannot parse into a list. */
const PLANTED_DOC = 'advparity_guide.md';

/**
 * A stack that BUILDS CLEANLY (exit 0) while raising one advisory of each class
 * under test, plus an authoring-RULE advisory:
 *
 *  - `requires` names an unknown token   -> one #3366 capability hint (RECORD);
 *  - `src/docs/*.md` has unreadable tags -> one ADR-0046 doc advisory (RECORD);
 *  - a bare `unique: true` index         -> one authoring-rule advisory, so a
 *    regression that REPLACED `ruleAdvisories` while folding the new lists in
 *    goes red here instead of passing quietly.
 */
const CONFIG_PLANTED = `
export default {
  manifest: { id: 'com.example.advparity', name: 'advparity', version: '1.0.0', type: 'app', namespace: 'advparity' },
  requires: ['${PLANTED_TOKEN}'],
  objects: [
    {
      name: 'ap_thing',
      label: 'Thing',
      sharingModel: 'private',
      indexes: [{ name: 'ap_title_idx', fields: ['title'], unique: true }],
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
};
`;

const DOC_PLANTED = `---
title: Guide
tags: not-a-list
---

Body text.
`;

/**
 * The control: the same stack with a resolvable `requires` list and a readable
 * `tags:` list. Without it, "the payload contains a capability hint" would also
 * pass against a build that emitted one unconditionally.
 */
const CONFIG_CLEAN = `
export default {
  manifest: { id: 'com.example.advclean', name: 'advclean', version: '1.0.0', type: 'app', namespace: 'advclean' },
  requires: [],
  objects: [
    {
      name: 'ac_thing',
      label: 'Thing',
      sharingModel: 'private',
      indexes: [{ name: 'ac_title_idx', fields: ['title'], unique: true }],
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
};
`;

const DOC_CLEAN = `---
title: Guide
tags: [tutorial, beginner]
---

Body text.
`;

/** #3366 capability hints: records carrying a `token`. Structural, not textual. */
function capabilityHints(warnings: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(warnings)) return [];
  return warnings.filter(
    (w): w is Record<string, unknown> => typeof w === 'object' && w !== null && 'token' in w,
  );
}

/** ADR-0046 doc advisories: records whose `rule` is namespaced `docs/`. */
function docAdvisories(warnings: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(warnings)) return [];
  return warnings.filter(
    (w): w is Record<string, unknown> =>
      typeof w === 'object' && w !== null && typeof (w as { rule?: unknown }).rule === 'string' &&
      ((w as { rule: string }).rule).startsWith('docs/'),
  );
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-adv-parity-'));
  const fixtures = {
    planted: { config: CONFIG_PLANTED, docName: PLANTED_DOC, doc: DOC_PLANTED },
    clean: { config: CONFIG_CLEAN, docName: 'advclean_guide.md', doc: DOC_CLEAN },
  };
  for (const [name, f] of Object.entries(fixtures)) {
    const dir = join(root, name);
    mkdirSync(join(dir, 'src', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), f.config);
    writeFileSync(join(dir, 'src', 'docs', f.docName), f.doc);
    dirs[name] = dir;
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#11727 — `os build --json` carries the capability-provider and package-docs advisories', () => {
  it('the planted fixture reaches the code path: exit 0, both advisories on the TEXT face', async () => {
    // Asserted BEFORE any payload claim. A fixture that made the command exit 1
    // (or that quietly stopped raising an advisory) would let every negative
    // assertion below pass for the wrong reason.
    const run = await runCli(['build'], dirs.planted);
    expect(run.code, `os build failed:\n${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain(`requires: "${PLANTED_TOKEN}" is not a known platform capability`);
    expect(run.stdout).toContain('rule: docs/frontmatter-tags');
  }, 120_000);

  it('carries the #3366 capability hint in the payload, as the `{token,message}` record validate ships', async () => {
    const run = await runCli(['build', '--json'], dirs.planted);
    expect(run.code, `os build --json failed:\n${run.stdout}${run.stderr}`).toBe(0);
    const payload = payloadOf(run, 'os build --json');
    expect(payload.success).toBe(true);

    const hints = capabilityHints(payload.warnings);
    expect(
      hints.map((h) => h.token),
      'the payload carries no capability-provider hint — computed and then discarded, which is the defect',
    ).toEqual([PLANTED_TOKEN]);
    expect(typeof hints[0]?.message).toBe('string');
  }, 120_000);

  it('carries the ADR-0046 doc advisory in the payload, as the issue RECORD validate ships', async () => {
    const run = await runCli(['build', '--json'], dirs.planted);
    expect(run.code, `os build --json failed:\n${run.stdout}${run.stderr}`).toBe(0);
    const payload = payloadOf(run, 'os build --json');

    const docs = docAdvisories(payload.warnings);
    expect(
      docs.map((d) => d.rule),
      'the payload carries no package-docs advisory — computed and then discarded, which is the defect',
    ).toEqual(['docs/frontmatter-tags']);
    expect(docs[0]?.path).toBe(`src/docs/${PLANTED_DOC}`);
    expect(docs[0]?.severity).toBe('warning');
  }, 120_000);

  it('reports the SAME sets `os validate --json` reports on the same tree, per class', async () => {
    // Parity is measured, not assumed: both commands run over ONE project.
    const build = await runCli(['build', '--json'], dirs.planted);
    const validate = await runCli(['validate', '--json'], dirs.planted);
    expect(build.code, `build failed:\n${build.stdout}${build.stderr}`).toBe(0);
    expect(validate.code, `validate failed:\n${validate.stdout}${validate.stderr}`).toBe(0);

    const bw = payloadOf(build, 'os build --json').warnings;
    const vw = payloadOf(validate, 'os validate --json').warnings;

    // The instrument must produce a POSITIVE before any set equality below is
    // evidence: an empty-vs-empty match would "pass" while proving nothing.
    expect(capabilityHints(vw).length, 'the fixture stopped producing a capability hint at all').toBeGreaterThan(0);
    expect(docAdvisories(vw).length, 'the fixture stopped producing a doc advisory at all').toBeGreaterThan(0);

    const key = (x: unknown) => JSON.stringify(x);
    expect(
      new Set(capabilityHints(bw).map(key)),
      'a CI consumer reading `warnings` off the two commands gets different capability hints',
    ).toEqual(new Set(capabilityHints(vw).map(key)));
    expect(
      new Set(docAdvisories(bw).map(key)),
      'a CI consumer reading `warnings` off the two commands gets different doc advisories',
    ).toEqual(new Set(docAdvisories(vw).map(key)));
  }, 180_000);

  it('folds them in BESIDE the authoring-rule advisories — the fold added to the list, it did not replace it', async () => {
    const run = await runCli(['build', '--json'], dirs.planted);
    const warnings = payloadOf(run, 'os build --json').warnings as unknown[];
    const records = warnings.filter((w) => typeof w === 'object' && w !== null) as Array<Record<string, unknown>>;
    expect(
      records.map((r) => r.rule),
      'the authoring-rule advisory records were lost from `warnings`',
    ).toContain('unique/unscoped-declared-index');
  }, 120_000);

  it('adds NO new top-level key to the payload — this fills a declared key, it is not a new surface', async () => {
    const run = await runCli(['build', '--json'], dirs.planted);
    const payload = payloadOf(run, 'os build --json');
    expect(Object.keys(payload).sort()).toEqual(
      [
        'bodyExtractionWarnings',
        'conversions',
        'duration',
        'handlersBundled',
        'output',
        'runtimeModule',
        'runtimeModuleSize',
        'size',
        'specVersionGap',
        'stats',
        'success',
        'warnings',
      ].sort(),
    );
  }, 120_000);

  it('CONTROL — a clean stack reports neither advisory, on either face', async () => {
    const build = await runCli(['build', '--json'], dirs.clean);
    const validate = await runCli(['validate', '--json'], dirs.clean);
    expect(build.code, `build failed:\n${build.stdout}${build.stderr}`).toBe(0);
    expect(validate.code, `validate failed:\n${validate.stdout}${validate.stderr}`).toBe(0);

    for (const [label, payload] of [
      ['os build --json', payloadOf(build, 'os build --json')],
      ['os validate --json', payloadOf(validate, 'os validate --json')],
    ] as const) {
      expect(capabilityHints(payload.warnings), `${label} raised a capability hint on a clean stack`).toEqual([]);
      expect(docAdvisories(payload.warnings), `${label} raised a doc advisory on a clean stack`).toEqual([]);
    }
  }, 180_000);

  it('the ONLY residue between the two payloads is the structural advisory set — deferred to #11896, not ported', async () => {
    // The executable half of this card's third finding. `os validate` derives
    // four structural advisories from `collectMetadataStats`; `os compile`
    // calls that same helper but computes none of them, in any face — a MISSING
    // COMPUTATION, not a dropped list, and a judgment this card does not
    // settle. Pinning the residue keeps that judgment visible: porting them
    // turns this red on purpose, and a fifth genuinely DROPPED list cannot hide
    // in the gap while it stays open.
    const build = await runCli(['build', '--json'], dirs.planted);
    const validate = await runCli(['validate', '--json'], dirs.planted);
    const bw = payloadOf(build, 'os build --json').warnings as unknown[];
    const vw = payloadOf(validate, 'os validate --json').warnings as unknown[];

    const inBuild = new Set(bw.map((x) => JSON.stringify(x)));
    const missingFromBuild = vw.filter((x) => !inBuild.has(JSON.stringify(x)));

    expect(missingFromBuild).toEqual(['No apps or plugins defined — this stack may not do much']);

    // …and nothing rides in build that validate does not also report.
    const inValidate = new Set(vw.map((x) => JSON.stringify(x)));
    expect(bw.filter((x) => !inValidate.has(JSON.stringify(x)))).toEqual([]);
  }, 180_000);
});

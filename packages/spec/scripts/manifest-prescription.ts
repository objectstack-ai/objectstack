// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The prescription every "could not run" exit of `check:react-declaration-parity`
// carries — and the PROBE that decides which prescription is true here.
//
// A refusal is only better than a skip if the reader can act on it. The manifest's
// provenance is two repos away from whoever hits this — it is dumped from objectui's
// registry in a browser — so the exit that replaced the skip has to hand over the
// whole path, not just the missing variable's name.
//
// WHY THIS IS A FUNCTION OF A PROBE AND NOT A CONSTANT (#16715).
//
// The single constant this file replaced asserted, unconditionally, that "this
// repository contains no copy of it" and sent the reader off to build objectui and
// dump one in a browser. That stopped being true at #13446, when `sdui.manifest.json`
// was checked in at the repository root and `lint.yml` began running this gate
// against it with `MANIFEST="$PWD/sdui.manifest.json"`.
//
// The prose kept its old certainty, and it is read at the exact moment a reader is
// deciding whether the gate can run at all — the shape that gets believed. Measured
// cost, twice: on #16489 / PR #16697 and again on PR #16777 a dev read it, reported
// the gate as `EXTERNAL_INPUT_REQUIRED` / NOT MEASURED, and one of those declarations
// reached a deliverable — on a head where setting that one variable and re-running
// gave exit 0 and "no new DECLARATION divergence vs accepted baseline".
//
// So: neither branch may assert the other's world. When the file is there the reader
// gets a command to paste; only when it is genuinely absent does the objectui dump
// path appear. Both branches are pinned in
// `check-react-blocks-declaration-parity.test.ts` — one branch tested is how this
// defect was built in the first place.

import fs from 'node:fs';
import path from 'node:path';

/** Where the manifest is committed, relative to the repository root. */
export const REPO_MANIFEST_RELATIVE = 'sdui.manifest.json';

/**
 * Is a manifest checked in at `repoRoot`?
 *
 * A filesystem probe and nothing else: no env var, no config key, no build state.
 * The question is "can the reader point MANIFEST at a file that exists right now",
 * and only the filesystem answers that.
 */
export function repoManifestPath(repoRoot: string): string {
  return path.join(repoRoot, REPO_MANIFEST_RELATIVE);
}

export function repoManifestIsCheckedIn(repoRoot: string): boolean {
  return fs.existsSync(repoManifestPath(repoRoot));
}

/**
 * The prescription text, for whichever world the probe found.
 *
 * `repoRoot` is printed as a `cd` so the block is paste-ready from any working
 * directory while still spelling the variable the way CI does — `$PWD` is only
 * correct once you are standing at the root, so the command that sets it says how
 * to get there.
 */
export function manifestPrescription(opts: { repoRoot: string; checkedIn: boolean }): string {
  const { repoRoot, checkedIn } = opts;

  if (checkedIn) {
    return [
      '',
      "  The registry side of this comparison is objectui's sdui.manifest.json, and a copy",
      `  IS checked in at this repository's root (${repoManifestPath(repoRoot)}) — the very`,
      '  artefact CI feeds this gate. Nothing has to be produced. Run it as CI runs it:',
      '',
      `    cd ${repoRoot}`,
      '    MANIFEST="$PWD/sdui.manifest.json" \\',
      '      pnpm --filter @objectstack/spec check:react-declaration-parity \\',
      '      --baseline react-declaration-parity.baseline.json --strict',
      '',
      '  That is a complete local run: no browser, no objectui checkout, no dump step. So a',
      '  non-zero exit from THIS gate is a reading, not an unavailable input — do not report',
      '  it as EXTERNAL_INPUT_REQUIRED or NOT MEASURED (#16715).',
      '',
      '  The committed manifest tracks the objectui pin: when .objectui-sha moves, regenerate it',
      '  and its record with `node scripts/gen-sdui-manifest-node.mjs` (check-sdui-manifest.mjs',
      '  prints the exact call). ⛔ `pnpm sdui:manifest` does NOT rewrite this file: it dumps to',
      '  packages/console/dist/, not to the root.',
    ].join('\n');
  }

  return [
    '',
    "  The registry side of this comparison is objectui's sdui.manifest.json, and no copy of",
    `  it is checked in at ${repoManifestPath(repoRoot)}. Nothing here can produce one:`,
    '  packages/console/dist/ is gitignored, the console build deliberately does not produce',
    '  one (it must not pull in a browser), and the published @objectstack/console ships none',
    '  either. Produce one, then re-run:',
    '',
    `    cd ${repoRoot}`,
    '    pnpm objectui:build     # build + vendor the console at the pinned .objectui-sha',
    '    pnpm sdui:manifest      # dump the manifest in a browser AND run this ratchet',
    '',
    '  Against a sibling objectui checkout, point the build at it first:',
    '',
    '    OBJECTUI_ROOT=../objectui pnpm objectui:build && pnpm sdui:manifest',
    '',
    '  Or, with a manifest already in hand:',
    '',
    '    MANIFEST=/path/to/sdui.manifest.json \\',
    '      pnpm --filter @objectstack/spec check:react-declaration-parity \\',
    '      --baseline react-declaration-parity.baseline.json --strict',
    '',
    '  (the dump needs a browser: pnpm exec playwright install chromium-headless-shell)',
  ].join('\n');
}

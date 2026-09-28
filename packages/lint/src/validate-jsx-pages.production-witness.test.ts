// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Production-path witness + first-wiring ratchet for the SDUI JSX gate
// (#12924, maintainer ruling 2026-08-29: wire it; execution point 3 demands a
// witness that REALLY PARSES the checked-in manifest into `validateTree`).
//
// ── Why this file exists, stated as the blind spot it closes ──────────────
//
// Every other guard on `validateTree` in this repo constructs its manifest
// IN MEMORY, so a green suite was compatible with the production gate being
// parse-only for the whole life of the code — no test resolved a real
// artefact, because there was nothing to resolve (#12924's finding). These
// tests read the REAL repo-root `sdui.manifest.json` from DISK, feed it
// through the REAL production entry points, and pin the arming delta itself.
//
// Two cross-package inputs, both declared so the graph can see them
// (`check:examples-live-imports`, `@objectstack/lint#test` inputs in
// turbo.json): the repo-root artefact, and the three shipped html pages.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateJsxPages } from './validate-jsx-pages.js';
import { runAuthoringRules } from './authoring-rules.js';

import { CapabilityMapPage } from '../../../examples/app-showcase/src/ui/pages/capability-map.page.js';
import { CommandCenterJsxPage } from '../../../examples/app-showcase/src/ui/pages/command-center-jsx.page.js';
import { StartHerePage } from '../../../examples/app-showcase/src/ui/pages/start-here.page.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Walk up to the workspace root — the directory holding pnpm-workspace.yaml. */
function findUp(predicate: (dir: string) => boolean): string {
  let dir = HERE;
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('workspace root not found from ' + HERE);
    dir = parent;
  }
}
const REPO = findUp((dir) => existsSync(join(dir, 'pnpm-workspace.yaml')));

// The artefact, from DISK — the same bytes `resolveSduiManifest()` (packages/
// cli, path 1: join(process.cwd(), 'sdui.manifest.json')) picks up when the
// gate runs from the repo root. Loud absence: an absent artefact silently
// reverts production to parse-only, so this read failing IS the regression.
const ARTEFACT = join(REPO, 'sdui.manifest.json');
const manifest = JSON.parse(readFileSync(ARTEFACT, 'utf8'));

describe('production witness: the checked-in manifest reaches validateTree', () => {
  it('is the real artefact (html-tier tags declared, `div` still refused)', () => {
    const keys = Object.keys(manifest.components);
    expect(keys.length).toBeGreaterThan(0);
    // The vocabulary facts the clean-run witness below stands on. If a
    // regeneration legitimately changes them, re-check the shipped pages in the
    // same PR.
    expect(keys).toContain('flex');
    expect(keys).toContain('html');
    expect(keys).not.toContain('div');
  });

  it('arms full validation through validateJsxPages: manifest-only diagnostics fire', () => {
    const stack = {
      pages: [
        {
          name: 'witness_page',
          kind: 'html',
          // `flex` is a real public component; `no-such-block` is not. Only
          // validateTree (fed by the DISK manifest) can tell them apart —
          // parse-only cannot emit unknown-component at all.
          source: '<flex direction="col" notARealProp="x"><no-such-block /></flex>',
        },
      ],
    };
    const wired = validateJsxPages(stack, { manifest });
    const rules = new Set(wired.map((f) => f.rule));
    expect(rules).toContain('jsx-unknown-component'); // no-such-block, judged by the manifest
    expect(rules).toContain('jsx-unknown-prop'); // notARealProp on flex, judged by flex's declared inputs

    // The arming delta itself: the SAME stack, parse-only, emits neither.
    const parseOnly = validateJsxPages(stack);
    const parseOnlyRules = new Set(parseOnly.map((f) => f.rule));
    expect(parseOnlyRules).not.toContain('jsx-unknown-component');
    expect(parseOnlyRules).not.toContain('jsx-unknown-prop');
  });

  it('threads through the production registry entry (runAuthoringRules ctx.sduiManifest)', () => {
    // The same seam `os validate`/`os build`/`os lint` drive: authoring-rules'
    // validateJsxPages entry reads ctx.sduiManifest — never a lookalike call.
    const stack = {
      pages: [{ name: 'witness_page', kind: 'html', source: '<no-such-block />' }],
    };
    const withManifest = runAuthoringRules('validate', {
      normalized: stack,
      sduiManifest: manifest,
    });
    expect(withManifest.some((f) => f.rule === 'jsx-unknown-component')).toBe(true);

    const without = runAuthoringRules('validate', { normalized: stack });
    expect(without.some((f) => f.rule === 'jsx-unknown-component')).toBe(false);
  });
});

describe('first-wiring ratchet, closed: the shipped pages against the wired gate (ui#6779 ratchet-to-zero)', () => {
  // The ratchet-to-zero ledger (sdui-jsx-baseline.json) reached zero rows and was
  // deleted, as its header prescribed: the manifest regenerated at objectui
  // 9f0c84a448d1 declares the html tier's intrinsic tags (a, p, h1-h6, ...), and
  // the three pages moved their `div` wrappers to `box`, the drop-in swap the tier
  // names now that it refuses `div`. So the census assertion inverts: the wired
  // run over the shipped pages is clean, and any finding here is a NEW violation —
  // fix the page (or regenerate the manifest if the vocabulary legitimately grew).
  it('wired run over the three shipped html pages is clean', () => {
    const stack = { pages: [CapabilityMapPage, CommandCenterJsxPage, StartHerePage] };
    const findings = validateJsxPages(stack as never, { manifest });
    expect(findings.map((f) => `${f.rule}|${f.severity}|${f.where}`)).toEqual([]);
  });

  it('parse-only over the same pages stays clean (today\'s pre-wiring behavior, pinned)', () => {
    const stack = { pages: [CapabilityMapPage, CommandCenterJsxPage, StartHerePage] };
    expect(validateJsxPages(stack as never)).toEqual([]);
  });
});

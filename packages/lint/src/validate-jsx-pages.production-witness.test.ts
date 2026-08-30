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

import ledger from './sdui-jsx-baseline.json';

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
  it('is the real artefact (57-component public tier, no intrinsic HTML tags)', () => {
    const keys = Object.keys(manifest.components);
    expect(keys.length).toBeGreaterThan(0);
    // The vocabulary facts the ratchet below stands on. If a regeneration
    // legitimately changes them, the ledger is re-derived in the same PR.
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

describe('first-wiring ratchet: the shipped pages against the wired gate (ui#6779 ratchet-to-zero)', () => {
  it('wired census over the three shipped html pages equals the ledger — both directions', () => {
    const stack = { pages: [CapabilityMapPage, CommandCenterJsxPage, StartHerePage] };
    const findings = validateJsxPages(stack as never, { manifest });

    const census = new Map<string, number>();
    for (const f of findings) {
      const page = /page "([^"]+)"/.exec(f.where)?.[1] ?? '(unknown page)';
      const tag = /<([a-zA-Z0-9:_-]+)>/.exec(f.where)?.[1] ?? '(no tag)';
      const key = `${page}|${f.rule}|${f.severity}|${tag}`;
      census.set(key, (census.get(key) ?? 0) + 1);
    }

    const recorded = new Map<string, number>(
      ledger.findings.map((r) => [`${r.page}|${r.rule}|${r.severity}|${r.tag}`, r.count]),
    );

    const newViolations: string[] = [];
    for (const [key, count] of census) {
      const allowed = recorded.get(key) ?? 0;
      if (count > allowed) newViolations.push(`${key} — live ${count} vs ledger ${allowed}`);
    }
    const stale: string[] = [];
    for (const [key, count] of recorded) {
      const live = census.get(key) ?? 0;
      if (live < count) stale.push(`${key} — ledger ${count} vs live ${live}`);
    }

    expect(
      newViolations,
      'NEW wired-gate findings beyond the ratchet ledger. Fix the page (or regenerate the manifest ' +
        'if the vocabulary legitimately grew) — never grow packages/lint/src/sdui-jsx-baseline.json.',
    ).toEqual([]);
    expect(
      stale,
      'STALE ledger rows — the live run no longer produces them. Ratchet-to-zero: delete these rows ' +
        'from packages/lint/src/sdui-jsx-baseline.json in this same PR.',
    ).toEqual([]);
  });

  it('parse-only over the same pages stays clean (today\'s pre-wiring behavior, pinned)', () => {
    const stack = { pages: [CapabilityMapPage, CommandCenterJsxPage, StartHerePage] };
    expect(validateJsxPages(stack as never)).toEqual([]);
  });
});

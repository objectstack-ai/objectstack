/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#3025 ratchet (AGENTS.md Commandment #6 — "No `any`"). Same shape as
 * the ADR-0054 and #2269 ratchets: runs in the gating `pnpm test` job and fails
 * if the anti-pattern reappears.
 *
 * The bug this guards. Two call sites carried
 * `const PanelGroup = ResizablePanelGroup as React.FC<any>`. The cast erased
 * the component's props to `any`, so when react-resizable-panels v4 renamed
 * `PanelGroup`'s `direction` prop to `orientation`, the stale `direction` kept
 * type-checking against nothing — for a whole major version. It silently became
 * a dead prop that React forwarded to the DOM as a stray attribute. Removing
 * the casts is what turned it back into a hard `TS2322`.
 *
 * Both comments blamed the toolchain (vite-plugin-dts "not resolving the prop
 * type correctly"; a prop that "does not always narrow cleanly in our TS
 * config"). Neither was true. That is the real hazard here: a cast like this
 * reads as a workaround for a tooling quirk while actually disabling the check
 * that would have caught a breaking upstream rename.
 *
 * If this fails: do not widen a component's props to `any` to make an error go
 * away. Read the dependency's current prop types — the prop was probably
 * renamed or removed. If a genuinely-invalid prop must be passed, type the
 * escape hatch narrowly (`as ComponentProps<typeof X> & { extra?: T }`), never
 * with a blanket `any`.
 *
 * SCOPE — repo-wide over `packages/<pkg>/src` and `apps/<app>/src`, production
 * sources only. Test files are excluded, both to match the existing ratchets
 * and because this file necessarily contains the pattern in its own regex.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/app-shell/src  ->  repo root
const repoRoot = path.resolve(here, '../../..');

/**
 * Banned: casting a value to a component type parameterised with `any`.
 *
 * Covers the three spellings that erase props identically — `FC`,
 * `FunctionComponent`, `ComponentType` — with or without the `React.`
 * qualifier, and tolerant of whitespace inside the type arguments.
 */
const COMPONENT_ANY_CAST =
  /\bas\s+(?:React\.)?(?:FC|FunctionComponent|ComponentType)\s*<\s*any\s*>/;

function collectSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.wt-') || name === '.next') {
        continue;
      }
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  for (const group of ['packages', 'apps']) {
    const groupDir = path.join(repoRoot, group);
    let pkgs: string[];
    try {
      pkgs = readdirSync(groupDir);
    } catch {
      continue;
    }
    for (const pkg of pkgs) {
      const srcDir = path.join(groupDir, pkg, 'src');
      try {
        if (statSync(srcDir).isDirectory()) walk(srcDir);
      } catch {
        /* package has no src/ */
      }
    }
  }
  return out;
}

describe('objectui#3025 — no component-props-to-any cast ratchet', () => {
  it('finds the repo sources (guards against a broken scan path)', () => {
    // The repo has thousands of source files; if this collapses, the scan
    // globs have gone stale and the ratchet would silently pass on nothing.
    expect(collectSourceFiles().length).toBeGreaterThan(500);
  });

  it('detects the pattern it is meant to ban (guards against a dead regex)', () => {
    // A ratchet whose regex silently stops matching is worse than no ratchet,
    // so pin it against the exact casts #3025 removed, plus spelling variants.
    for (const sample of [
      'const PanelGroup = ResizablePanelGroup as React.FC<any>;',
      'const X = Y as FC<any>',
      'const X = Y as React.ComponentType< any >',
      'const X = Y as FunctionComponent<any>',
    ]) {
      expect(COMPONENT_ANY_CAST.test(sample), sample).toBe(true);
    }
    // ...and must not fire on legitimate neighbours.
    for (const ok of [
      'const x = y as Record<string, any>',
      'const x = y as ComponentProps<typeof Button>',
      'const C: React.FC<Props> = (p) => null',
    ]) {
      expect(COMPONENT_ANY_CAST.test(ok), ok).toBe(false);
    }
  });

  it('has zero component-props-to-any casts in production sources', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        if (COMPONENT_ANY_CAST.test(line)) {
          offenders.push(`${path.relative(repoRoot, file)} :: ${line.trim()}`);
        }
      }
    }
    // If this fails: you widened a component's props to `any`. That disables
    // the check that catches renamed/removed props across a dependency major —
    // exactly how #3025's dead `direction` prop survived. Read the current
    // prop types instead, or type the escape hatch narrowly. Do not allowlist.
    expect(offenders).toEqual([]);
  });
});

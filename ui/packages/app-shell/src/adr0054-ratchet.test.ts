/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0054 "UI testability contract" — Phase 5 ratchet (CI enforcement).
 *
 * Fails when a new synthetic-event trigger is introduced anywhere in the source
 * tree. The repo's `Lint` workflow is manual (`workflow_dispatch`), so the
 * matching ESLint rule (`object-ui/no-synthetic-event-trigger`) is a local-dev
 * aid; THIS test — running in the gating `pnpm test` job — is the enforcement.
 * "Counts can only go down."
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/app-shell/src  ->  repo root
const repoRoot = path.resolve(here, '../../..');

/** Banned: dispatching a synthetic Keyboard/Mouse/PointerEvent to trigger behavior (C1). */
const SYNTHETIC_TRIGGER = /\.dispatchEvent\(\s*new\s+(?:KeyboardEvent|MouseEvent|PointerEvent)\b/;

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
      } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
        out.push(full);
      }
    }
  };
  for (const group of ['packages', 'apps']) {
    const groupDir = path.join(repoRoot, group);
    // Assigned by readdirSync below before the read; the catch `continue`s, so
    // the loop body past the try only runs when pkgs was assigned.
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

describe('ADR-0054 testability ratchet', () => {
  it('finds the source tree (guards against a broken scan path)', () => {
    expect(collectSourceFiles().length).toBeGreaterThan(100);
  });

  it('has zero synthetic-event triggers across packages/apps src (C1)', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles()) {
      if (SYNTHETIC_TRIGGER.test(readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
    // If this fails: replace the synthetic `dispatchEvent(new …Event())` with a
    // direct, idempotent command (see ADR-0054 C1 / useCommandPalette /
    // useUrlOverlay). Do not add files to an allowlist.
    expect(offenders).toEqual([]);
  });
});

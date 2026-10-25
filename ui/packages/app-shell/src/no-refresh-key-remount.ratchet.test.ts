/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#2269 ratchet (AGENTS.md Commandment #8 — "refresh data, don't
 * rebuild UI"). CI enforcement, same shape as the ADR-0054 ratchet: this test
 * runs in the gating `pnpm test` job and fails if the refetch-by-remount
 * anti-pattern reappears.
 *
 * The bug this guards: a record surface used `key={refreshKey}` /
 * `key={actionRefreshKey}` to force a REMOUNT on save/action so its data
 * refetched — which also destroyed the active tab, scroll position, collapsed
 * sections, and in-progress inline edits, and triggered a full refetch storm.
 * The fix (objectui#2269) routes writes through the data-invalidation bus so
 * consumers refetch IN PLACE. This ratchet keeps the anti-pattern from
 * silently returning.
 *
 * If this fails: don't add a `key={…Refresh…}` remount. Invalidate the data
 * (`notifyDataChanged` from `@object-ui/react`) and let readers refetch via
 * `useDataInvalidation`. See objectui#2269 / DetailView / RecordDetailView.
 *
 * SCOPE — the RECORD-DETAIL data surfaces #2269 fixed, plus the custom-page
 * host `PageView` (objectui#10519). It is deliberately not repo-wide: the
 * Studio dev preview harness (`sdui-workbench-preview.tsx`) legitimately
 * remounts to reset, and is a different concern from "a SAVE silently rebuilt
 * the page under the user". `PageView.onRefresh` is NOT such an affordance —
 * an earlier version of this header called it "an explicit user 'Refresh this
 * page' affordance", which was false by a source reading of
 * `useConsoleActionRuntime`: `onRefresh` is fed only by the console action
 * runtime's post-action refresh (`api`, flow and server-action success, undo,
 * screen-flow completion), and `PageView` has no refresh control. objectui#10519
 * routed that refresh through the bus and brought the file into scope. Guarding
 * the fixed surfaces exactly, with no allowlist-of-shame, is the honest lock;
 * AGENTS.md Commandment #8 + review cover brand-new surfaces.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/app-shell/src  ->  repo root
const repoRoot = path.resolve(here, '../../..');

/**
 * Banned: a React `key=` bound to any "*refresh*" / "*reload*" expression —
 * the tell-tale of "bump a key to remount so data refetches". Case-insensitive
 * on the identifier; tolerant of whitespace inside the JSX brace.
 */
const REFRESH_KEY_REMOUNT = /\bkey=\{\s*[^}]*(?:refresh|reload)[^}]*\}/i;

/**
 * The record-detail data surfaces #2269 fixed, and the custom-page host
 * objectui#10519 fixed. Path fragments (POSIX) — a file is in scope if its
 * repo-relative path contains any of these.
 */
const IN_SCOPE = [
  'packages/plugin-detail/src/',
  'packages/app-shell/src/views/RecordDetailView',
  'packages/app-shell/src/views/RelatedRecordActionsBridge',
  'packages/app-shell/src/console/AppContent',
  // objectui#10519: the page host declares a page action's change on the bus;
  // its two render branches are keyed on identity, never on a refresh counter.
  'packages/app-shell/src/views/PageView',
];

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
      } else if (/\.tsx$/.test(name) && !/\.(test|spec)\.tsx$/.test(name)) {
        const rel = path.relative(repoRoot, full).split(path.sep).join('/');
        if (IN_SCOPE.some((frag) => rel.includes(frag))) out.push(full);
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

describe('objectui#2269 — no refetch-by-remount ratchet', () => {
  it('finds the in-scope record-detail surfaces and the PageView page host (guards against a broken scan path)', () => {
    // plugin-detail alone has dozens of source files; if this drops the
    // scope globs have gone stale and the ratchet would silently pass.
    expect(collectSourceFiles().length).toBeGreaterThan(20);
  });

  it('has zero `key={…refresh/reload…}` remount sites in the record-detail surfaces or the PageView page host', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        if (REFRESH_KEY_REMOUNT.test(line)) {
          offenders.push(`${path.relative(repoRoot, file)} :: ${line.trim()}`);
        }
      }
    }
    // If this fails: you re-introduced "bump a key to remount so data
    // refetches". Invalidate the data instead (notifyDataChanged +
    // useDataInvalidation, objectui#2269). Do not allowlist.
    expect(offenders).toEqual([]);
  });
});

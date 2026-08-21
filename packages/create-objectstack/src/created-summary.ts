// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Builds the run's closing "Created files" summary by READING THE PROJECT
// DIRECTORY once every write has landed — never by accumulating a list as the
// writes happen.
//
// ## Why the source of the list is the whole fix
//
// The summary this replaces was `copyDir`'s `collected` array: the template
// files, and nothing else. Measured against published `create-objectstack@
// 17.1.0` (`create-objectstack demo-app`, then a full walk of the result):
//
//     printed summary entries : 12
//     paths written on disk   : 18045
//     UNREACHABLE from summary: 18033
//        .agents/          49   agent/          49   .claude/         11
//        .github/           1   AGENTS.md        1   skills-lock.json  1
//        pnpm-lock.yaml     1   node_modules/  17920
//
// Two ~968 KB trees of agent instructions and both lockfiles landed on the
// user's disk unnamed — and the same run closes with the `skills` CLI printing
// "Review skills before use; they run with full agent permissions." Advice to
// review files the run never named is advice a newcomer cannot act on, and for
// a security-flavoured warning that is the wrong failure direction.
//
// The list could not have been right, because of WHERE it was built. Three
// phases write into the project, in this order:
//
//   1. template copy + identity rewrite + AGENTS.md/copilot-instructions.md
//   2. `<pm> install`                      -> pnpm-lock.yaml, node_modules/
//   3. `npx skills add … --all`            -> .agents/, agent/, .claude/,
//                                             skills-lock.json
//
// and the list was printed between (1) and (2). Phases 2 and 3 are third-party
// processes whose outputs this package does not choose and cannot enumerate
// ahead of time — the `skills` CLI fans out to every agent runtime it knows,
// and that set changes with ITS releases, not ours. So any hand-maintained
// list is not merely incomplete, it is unmaintainable: it drifts the next time
// a dependency learns a new destination, silently, in the one direction that
// hides files rather than inventing them.
//
// Reading the directory afterwards is what makes the summary self-correcting.
// A path that appears because some future dependency wrote it appears in the
// summary too, with nobody editing this file.
//
// ## The property, and why it is not "list everything"
//
// The bar is REACHABILITY: every path the run wrote must be findable from what
// the run printed. Enumerating 18,045 lines satisfies it and is unreadable, so
// a directory holding more than `COLLAPSE_AT` entries collapses to one line
// carrying its path, its entry count and its size — the reader is shown where
// the bulk landed and how much of it there is, which is exactly what "go
// review the skills" requires. `created-summary.test.ts` asserts the
// reachability property itself against a synthetic tree, never a file count:
// a count assertion would rot the moment the template changes, and a drifted
// hard-coded list is why this module exists.

import fs from 'node:fs';
import path from 'node:path';

/** A directory holding more than this many entries is collapsed to one line. */
export const COLLAPSE_AT = 10;

/**
 * Entries this module is willing to `lstat` per top-level entry before it
 * stops counting and reports a lower bound.
 *
 * The budget is PER TOP-LEVEL ENTRY, not global, and that is load-bearing:
 * with one shared budget, `node_modules/` (17,920 paths in the measurement
 * above) exhausts it before the walk reaches the project's own files, and the
 * summary silently truncates the very content it exists to disclose. Whether
 * that happened would depend on `readdir` order.
 */
export const MEASURE_BUDGET = 2000;

export interface SummaryEntry {
  /** Project-relative path. Directories carry a trailing `/`. */
  path: string;
  kind: 'file' | 'dir';
  /** Files and symlinks in the subtree (always 1 for a file). */
  entries: number;
  /** Total size in bytes. Meaningless when `truncated`. */
  bytes: number;
  /** Measurement stopped at the budget — `entries` and `bytes` are lower bounds. */
  truncated: boolean;
}

interface Node {
  name: string;
  dir: boolean;
  entries: number;
  bytes: number;
  truncated: boolean;
  children: Node[];
}

/**
 * Walk one entry. Symlinks are counted as leaves and never followed — the
 * `skills` CLI writes `.claude/skills/*` as symlinks into `.agents/skills/`,
 * and following them would double-count the tree they point at.
 */
function scan(abs: string, name: string, budget: { left: number }): Node {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    // Raced away between readdir and lstat — not ours to report.
    return { name, dir: false, entries: 0, bytes: 0, truncated: false, children: [] };
  }

  if (!st.isDirectory()) {
    budget.left -= 1;
    return { name, dir: false, entries: 1, bytes: st.size, truncated: false, children: [] };
  }

  const node: Node = { name, dir: true, entries: 0, bytes: 0, truncated: false, children: [] };
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return node; // unreadable directory — still named by its parent's line
  }

  for (const entry of dirents) {
    if (budget.left <= 0) {
      node.truncated = true;
      break;
    }
    const child = scan(path.join(abs, entry.name), entry.name, budget);
    node.entries += child.entries;
    node.bytes += child.bytes;
    if (child.truncated) node.truncated = true;
    node.children.push(child);
  }
  return node;
}

function byName(a: Node, b: Node): number {
  return a.name.localeCompare(b.name, 'en');
}

function flatten(node: Node, prefix: string, out: SummaryEntry[]): void {
  for (const child of [...node.children].sort(byName)) {
    const rel = prefix + child.name;

    if (!child.dir) {
      out.push({ path: rel, kind: 'file', entries: 1, bytes: child.bytes, truncated: false });
      continue;
    }

    // Small enough to show file by file.
    if (!child.truncated && child.entries <= COLLAPSE_AT) {
      flatten(child, `${rel}/`, out);
      continue;
    }

    // Collapse — but walk down through single-child directory chains first, so
    // the line names the directory a reader would actually open
    // (`.agents/skills/`, not `.agents/`).
    let deepest = child;
    let shown = rel;
    while (deepest.children.length === 1 && deepest.children[0].dir) {
      deepest = deepest.children[0];
      shown = `${shown}/${deepest.name}`;
    }
    out.push({
      path: `${shown}/`,
      kind: 'dir',
      entries: deepest.entries,
      bytes: deepest.bytes,
      truncated: deepest.truncated,
    });
  }
}

/**
 * Summarize everything under `root`, collapsing large directories.
 *
 * Returns files first (alphabetical), then collapsed directories
 * (alphabetical), so the enumerated content reads as a list and the bulk
 * trees read as a block with their sizes.
 */
export function summarizeTree(root: string): SummaryEntry[] {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const top: Node = { name: '', dir: true, entries: 0, bytes: 0, truncated: false, children: [] };
  for (const entry of dirents) {
    // A fresh budget per top-level entry: see MEASURE_BUDGET.
    top.children.push(scan(path.join(root, entry.name), entry.name, { left: MEASURE_BUDGET }));
  }

  const out: SummaryEntry[] = [];
  flatten(top, '', out);
  return [
    ...out.filter((e) => e.kind === 'file'),
    ...out.filter((e) => e.kind === 'dir'),
  ];
}

/** Human-readable byte count. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The measurement note that follows a collapsed directory's path. */
export function describeEntry(entry: SummaryEntry): string {
  if (entry.kind === 'file') return '';
  const noun = entry.entries === 1 ? 'file' : 'files';
  if (entry.truncated) return `over ${entry.entries.toLocaleString('en-US')} ${noun}`;
  return `${entry.entries.toLocaleString('en-US')} ${noun}, ${formatBytes(entry.bytes)}`;
}

/**
 * The property this module exists to hold: every path in `written` is either
 * named outright by a summary entry, or lies beneath a directory entry that
 * is. Returns the paths that are NOT reachable — empty means the summary is
 * complete.
 *
 * Exported because it is the assertion, and an assertion that lives only in a
 * test file cannot be run against a real scaffold from anywhere else.
 */
export function unreachablePaths(entries: SummaryEntry[], written: string[]): string[] {
  const named = new Set(entries.filter((e) => e.kind === 'file').map((e) => e.path));
  const dirs = entries.filter((e) => e.kind === 'dir').map((e) => e.path);
  return written.filter(
    (p) => !named.has(p) && !dirs.some((d) => `${p}/`.startsWith(d)),
  );
}

#!/usr/bin/env node
// Map a set of `packages/**` code changes to the hand-written docs that reference
// the affected packages, so a doc-accuracy audit can be scoped to what actually
// changed instead of re-auditing all 128 hand-written docs every time.
//
// Usage:
//   node scripts/docs-audit/affected-docs.mjs [sinceRef]   # docs affected by changes since <sinceRef> (default origin/main)
//   node scripts/docs-audit/affected-docs.mjs --all         # every hand-written doc (full audit)
//   node scripts/docs-audit/affected-docs.mjs --json [...]   # emit JSON {docs, changedPackages, ...} instead of a path list
//
// Scope: hand-written docs only = content/docs/**/*.mdx MINUS content/docs/references/**
// (references are generated from packages/spec and handled by a separate regenerate pass).
//
// Heuristic: a doc is "affected" by a changed package P if the doc text mentions P's
// npm name (`@objectstack/<x>`) or its repo path (`packages/<x>`). Over-inclusion is
// intentionally preferred over misses; the periodic FULL audit is the backstop for
// docs that describe a package without naming it.

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const all = args.includes('--all');
const sinceRef = args.find((a) => !a.startsWith('--')) || 'origin/main';

function sh(cmd) {
  return execSync(cmd, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

// --- 1. enumerate hand-written docs ----------------------------------------
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.mdx')) out.push(p);
  }
  return out;
}
const docsRoot = join(repoRoot, 'content/docs');
const refsRoot = join(repoRoot, 'content/docs/references');
const handwritten = walk(docsRoot)
  .filter((p) => !p.startsWith(refsRoot))
  .map((p) => relative(repoRoot, p))
  .sort();

if (all) {
  emit(handwritten, [], 'all hand-written docs');
  process.exit(0);
}

// --- 2. changed package roots since <sinceRef> -----------------------------
let changedFiles = [];
try {
  // three-dot: changes on HEAD since the merge-base with sinceRef
  changedFiles = sh(`git diff --name-only ${sinceRef}...HEAD -- packages/`).split('\n').filter(Boolean);
} catch {
  // fall back to two-dot (e.g. detached/ranges that lack a merge-base)
  changedFiles = sh(`git diff --name-only ${sinceRef} -- packages/`).split('\n').filter(Boolean);
}

// collect package roots: packages/<x> and packages/plugins/<x>
const pkgRoots = new Set();
for (const f of changedFiles) {
  let m = f.match(/^(packages\/plugins\/[^/]+)\//) || f.match(/^(packages\/[^/]+)\//);
  if (m) pkgRoots.add(m[1]);
}

// resolve each root to its npm name + keep the path token
const changedPackages = []; // {dir, name}
for (const dir of pkgRoots) {
  let name = null;
  const pj = join(repoRoot, dir, 'package.json');
  if (existsSync(pj)) {
    try { name = JSON.parse(readFileSync(pj, 'utf8')).name || null; } catch { /* ignore */ }
  }
  changedPackages.push({ dir, name });
}

// --- 3. match docs that mention an affected package ------------------------
const affected = [];
for (const doc of handwritten) {
  const text = readFileSync(join(repoRoot, doc), 'utf8');
  const hits = [];
  for (const { dir, name } of changedPackages) {
    if (name && text.includes(name)) hits.push(name);
    else if (text.includes(dir)) hits.push(dir);
  }
  if (hits.length) affected.push({ doc, via: [...new Set(hits)] });
}

emit(affected.map((a) => a.doc), changedPackages, `${affected.length} docs affected by ${changedPackages.length} changed package(s) since ${sinceRef}`, affected);

function emit(docList, changedPackages, summary, detail) {
  if (asJson) {
    process.stdout.write(JSON.stringify({ summary, sinceRef: all ? null : sinceRef, changedPackages, docs: docList, detail: detail || null }, null, 2) + '\n');
  } else {
    process.stderr.write(`# ${summary}\n`);
    process.stdout.write(docList.join('\n') + (docList.length ? '\n' : ''));
  }
}

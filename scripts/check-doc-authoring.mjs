#!/usr/bin/env node
// check-doc-authoring.mjs — guard the docs/skills corpus against the bare
// metadata-literal anti-pattern (#2035 / ADR-0059).
//
// The example apps are kept on the `defineX` factories by an ESLint rule, but
// TypeScript code blocks inside Markdown/MDX are not type-checked or linted by
// anything — which is exactly how skills/ and content/docs/ drifted back to
// teaching `: Page = {}` while the examples stayed clean. Skills are the corpus
// AI authors from, so a bad sample there is worse than one in app code.
//
// This scans ```ts|typescript|tsx fenced blocks for an exported metadata literal
// annotated with one of the 16 factory domains (or its `Input` alias) instead of
// being wrapped in the `defineX(...)` factory, and fails if it finds one.
//
//   node scripts/check-doc-authoring.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['skills', 'content'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'references']);
// Generated from spec/frontmatter — not hand-authored, don't police.
const SKIP_FILES = new Set(['content/docs/ai/skills-reference.mdx']);

const DOMAINS = [
  'Datasource', 'Connector', 'Policy', 'SharingRule', 'Role', 'PermissionSet',
  'EmailTemplateDefinition', 'Report', 'Webhook', 'ObjectExtension', 'Cube',
  'Mapping', 'Theme', 'TranslationBundle', 'Page', 'Action',
].join('|');
const NS = '(?:UI\\.|Data\\.|System\\.|Security\\.|Identity\\.|Automation\\.|Integration\\.)?';
const BARE = new RegExp(`^export const \\w+:\\s*${NS}(?:${DOMAINS})(?:Input)?\\s*=\\s*\\{`);
const FENCE_OPEN = /^```(?:ts|typescript|tsx)\s*$/;
const FENCE_CLOSE = /^```\s*$/;

function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.mdx?$/.test(e) && !SKIP_FILES.has(p)) out.push(p);
  }
}

const files = [];
for (const r of ROOTS) { try { walk(r, files); } catch {} }

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!inBlock) { if (FENCE_OPEN.test(ln)) inBlock = true; continue; }
    if (FENCE_CLOSE.test(ln)) { inBlock = false; continue; }
    if (BARE.test(ln)) violations.push({ file, line: i + 1, text: ln.trim() });
  }
}

if (violations.length === 0) {
  console.log(`✓ doc authoring guard: ${files.length} files clean — no bare metadata literals.`);
  process.exit(0);
}

console.error(`\n✗ Bare metadata-literal authoring found in docs/skills (#2035). Use the defineX factory instead:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.text}`);
}
console.error(`\n${violations.length} violation(s). Author via e.g. \`definePage({ ... })\` — a value import that fails loudly, validates at parse time, and is the one pattern AI should learn. See ADR-0059.\n`);
process.exit(1);

#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// measure-partial-retirement-annotation -- a ONE-SHOT MEASUREMENT INSTRUMENT for
// the #6635 signal. It is NOT a gate, it is NOT wired into any workflow, and it
// is deliberately not named `check:*` or `gen:*` so the #4203 script ledger has
// nothing to classify.
//
//   node scripts/measure-partial-retirement-annotation.mjs            # summary
//   node scripts/measure-partial-retirement-annotation.mjs --hits     # every hit
//   node scripts/measure-partial-retirement-annotation.mjs --json     # machine
//   node scripts/measure-partial-retirement-annotation.mjs --tier A   # one tier
//   node scripts/measure-partial-retirement-annotation.mjs --file <p> # one file
//
// ## Why it exists
//
// #6635 proposed a gate: flag a file where a retired symbol's retirement issue
// number appears in SOME but not ALL of that symbol's mentions -- evidence that
// a retirement pass touched the file and provably missed siblings. The
// maintainer ruled on 2026-08-09 that the dispatchable deliverable is the
// MEASUREMENT, not the gate: total hits, a spot-verified true/false-positive
// split, and the exemption count a warning-tier rule would need on day one.
// This script produces those numbers reproducibly. Whether the gate is ever
// built is a separate decision the numbers feed.
//
// ## The signal, precisely
//
// For each (file F, retired symbol S):
//   - collect every MENTION of S in F's prose (comments in code files, all text
//     in markdown -- see `extractProse`);
//   - a mention is ANNOTATED when its stanza cites one of S's retirement issue
//     numbers, or frames S historically ("was removed", "until #N", "no longer",
//     ...). The card is explicit that historical framing counts as annotated:
//     the gate keys on ANNOTATION-presence, never on NAME-presence, which is
//     what lets a tombstone error string -- whose whole job is to name the
//     retired key -- pass;
//   - flag F when at least one mention is annotated AND at least one other is
//     not, i.e. someone updated this file and missed a sibling.
//
// A STANZA is the annotation window: a maximal run of consecutive lines with
// non-empty content after comment markers are stripped. In a TSDoc block that
// is the paragraph (` *` alone separates); in markdown it is the paragraph.
// `--window N` swaps it for a plus/minus-N-line window, for sensitivity.
//
// ## The three tiers, and why the split is load-bearing
//
// The repo's retirement playbook records that bare-name matching hits surviving
// families. The inventory is therefore tiered by how distinctive the name is,
// and the tiers are measured separately rather than pooled:
//
//   A  retired DEF names        `ETLPipeline`, `WidgetManifest`   distinctive
//   B  retired KEYS, qualified  `Manifest.loading`, `X:key`       distinctive
//   C  retired KEYS, bare       `transform`, `tools`, `layout`    the noise floor
//
// Tier C is measured to SIZE the noise, not because a gate should ship it.
//
// ## Inventory provenance
//
// The retired-symbol inventory is the repo's own declaration surface:
//
//   1. `RETIRED_DEFS_BY_MAJOR` (packages/spec/src/migrations/registry.ts)
//   2. `RETIRED_KEYS_BY_MAJOR` (same file)
//   3. `retiredKey()` tombstone guidance strings across packages/spec
//
// Issue attribution for (1) and (2) is read from the per-group comments inside
// each array literal, with the leading group (which has no per-group comment,
// only the block's doc comment) curated below in `CURATED_DEF_ISSUES`. Every
// attribution was hand-checked against the registry comments; the curation is
// spelled out rather than inferred so a reader can audit it. Attribution for
// (3) is mechanical: the guidance string states its own issue numbers.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const REGISTRY = 'packages/spec/src/migrations/registry.ts';

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/**
 * Retirement issue attribution for both registry tables, CURATED BY HAND from
 * the per-group comments in `packages/spec/src/migrations/registry.ts`.
 *
 * ## Why this is hand-written rather than parsed -- a finding in its own right
 *
 * A gate would need "retired symbol -> its retirement issue" as DATA. The repo
 * does not carry that mapping in machine-readable form: the registry tables are
 * flat string arrays and the attribution lives only in free prose above each
 * group. Parsing "nearest preceding `#NNNN`" was tried first and is wrong in
 * two measured ways, both silent:
 *
 *   - it reads the wrong number when a comment names more than one issue. The
 *     `transform` trio's header reads "The first entries since #4659 built this
 *     table (#5552)": #4659 built the TABLE, #5552 is the RETIREMENT. Nearest-
 *     preceding picks #4659 and every annotation check downstream then looks for
 *     a number no author ever wrote.
 *   - it cannot see repo boundaries. The #6946 group's comment cites
 *     "objectui#3829" and "objectui#3818" -- issue numbers in a DIFFERENT repo,
 *     indistinguishable from local ones once the prefix is dropped.
 *
 * So the attribution below is read off the comments by a human and stated
 * explicitly, so a reader can audit it against the registry in one pass.
 */
const CURATED_ISSUES = {
  // --- RETIRED_DEFS_BY_MAJOR[17] -------------------------------------------
  // "The first entry since #4725 built this table (#5552)"
  'shared/FieldMappingTransform': ['5552'],
  // "The ten that follow are #5055 (ADR-0049 enforce-or-remove ...)"
  'ui/WidgetManifest': ['5055'],
  'ui/WidgetLifecycle': ['5055'],
  'ui/WidgetEvent': ['5055'],
  'ui/WidgetProperty': ['5055'],
  'ui/WidgetSource': ['5055'],
  'ui/I18nObject': ['5055'],
  'ui/PluralRule': ['5055'],
  'ui/NumberFormat': ['5055'],
  'ui/DateFormat': ['5055'],
  'ui/LocaleConfig': ['5055'],
  // "// #5295 -- system/http-server.zod.ts runtime vocabulary"
  'system/ServerEvent': ['5295'],
  'system/ServerEventType': ['5295'],
  'system/ServerCapabilities': ['5295'],
  'system/ServerStatus': ['5295'],
  // "// #6239 -- api/protocol.zod.ts view-management operations"
  'api/ListViewsRequest': ['6239'],
  'api/ListViewsResponse': ['6239'],
  'api/GetViewRequest': ['6239'],
  'api/GetViewResponse': ['6239'],
  'api/CreateViewRequest': ['6239'],
  'api/CreateViewResponse': ['6239'],
  'api/UpdateViewRequest': ['6239'],
  'api/UpdateViewResponse': ['6239'],
  'api/DeleteViewRequest': ['6239'],
  'api/DeleteViewResponse': ['6239'],
  // "// #6414 -- automation/etl.zod.ts, the whole L2 layer" (the #6635 specimen)
  'automation/ETLPipeline': ['6414'],
  'automation/ETLPipelineRun': ['6414'],
  'automation/ETLSource': ['6414'],
  'automation/ETLDestination': ['6414'],
  'automation/ETLTransformation': ['6414'],
  'automation/ETLEndpointType': ['6414'],
  'automation/ETLTransformationType': ['6414'],
  'automation/ETLSyncMode': ['6414'],
  'automation/ETLRunStatus': ['6414'],
  // "// #4914 -- the plugin manifest's `loading` block"
  'kernel/PluginLoadingConfig': ['4914'],
  'kernel/PluginLoadingStrategy': ['4914'],
  'kernel/PluginPreloadConfig': ['4914'],
  'kernel/PluginCodeSplitting': ['4914'],
  'kernel/PluginDynamicImport': ['4914'],
  'kernel/PluginInitialization': ['4914'],
  'kernel/PluginDependencyResolution': ['4914'],
  'kernel/PluginHotReload': ['4914'],
  'kernel/PluginCaching': ['4914'],
  'kernel/PluginSandboxing': ['4914'],
  'kernel/PluginPerformanceMonitoring': ['4914'],

  // --- RETIRED_KEYS_BY_MAJOR[17] -------------------------------------------
  // Same #5552 retirement as the def above -- one tombstone, three walked shapes.
  'data/ExternalFieldMapping:transform': ['5552'],
  'integration/ConnectorFieldMapping:transform': ['5552'],
  'shared/FieldMapping:transform': ['5552'],
  // "// #5775 -- the SDUI component-props reconciliation"
  'ui/ElementRecordPickerProps:displayField': ['5775'],
  'ui/ElementRecordPickerProps:multiple': ['5775'],
  'ui/ElementRecordPickerProps:searchFields': ['5775'],
  'ui/PageCardProps:body': ['5775'],
  // "// #6776 -- #5775's count was incomplete"
  'ui/PageTabsProps:type': ['6776'],
  // "// #6748 -- ADR-0049 enforce-or-remove on the action-descriptor block"
  'automation/ActionDescriptor:isAsync': ['6748'],
  // "// #6361 -- the notification-inbox pagination key"
  'api/ListNotificationsRequest:cursor': ['6361'],
  'api/ListNotificationsResponse:cursor': ['6361'],
  // "// #4914 -- the plugin manifest's whole `loading` block"
  'kernel/Manifest:loading': ['4914'],
  // "// #6815 -- the per-aggregation DISTINCT flag"
  'data/AggregationNode:distinct': ['6815'],
  // "// #6946 -- three SDUI page-component props" (objectui#3829 / objectui#3818
  // are the sibling-repo halves, deliberately not used as the local annotation)
  'ui/PageCardProps:actions': ['6946'],
  'ui/PageHeaderProps:icon': ['6946'],
  'ui/RecordDetailsProps:layout': ['6946'],
};

/** Extract the body of `export const <NAME>...= {` up to the closing `};`. */
function tableBody(source, name) {
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`table ${name} not found in ${REGISTRY}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated table ${name}`);
}

/**
 * Walk an array literal's lines, tracking the most recent `// #NNNN` comment
 * line as the group's attribution, and attach it to each quoted entry.
 */
function entriesWithIssues(body) {
  const out = [];
  let current = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('//')) {
      const m = line.match(/#(\d{3,6})/);
      if (m) current = [m[1]];
      continue;
    }
    const m = line.match(/^'([^']+)',?$/);
    if (m) out.push({ entry: m[1], issues: current });
  }
  return out;
}

function buildInventory() {
  const source = readFileSync(join(ROOT, REGISTRY), 'utf8');
  const symbols = [];

  // --- Tier A: retired def names -------------------------------------------
  for (const { entry, issues } of entriesWithIssues(tableBody(source, 'RETIRED_DEFS_BY_MAJOR'))) {
    const attributed = CURATED_ISSUES[entry] ?? issues;
    if (!attributed) continue;
    const name = entry.split('/').pop();
    symbols.push({
      tier: 'A',
      id: entry,
      name,
      issues: attributed,
      // Word-boundary on a PascalCase def name. `\b` is safe here because every
      // name in this table is a distinctive multi-word identifier.
      pattern: new RegExp(`\\b${name}\\b`, 'g'),
    });
  }

  // --- Tiers B and C: retired keys -----------------------------------------
  for (const { entry, issues: parsed } of entriesWithIssues(tableBody(source, 'RETIRED_KEYS_BY_MAJOR'))) {
    const issues = CURATED_ISSUES[entry] ?? parsed;
    if (!issues) continue;
    const [defKey, key] = entry.split(':');
    const shape = defKey.split('/').pop();
    symbols.push({
      tier: 'B',
      id: entry,
      name: `${shape}.${key}`,
      issues,
      // Qualified only: `Shape.key` or `Shape:key`.
      pattern: new RegExp(`\\b${shape}[.:]${key}\\b`, 'g'),
    });
    symbols.push({
      tier: 'C',
      id: `${entry} (bare)`,
      name: key,
      issues,
      // The noise floor: a backticked bare key, the way prose spells it.
      pattern: new RegExp('`' + key + '`', 'g'),
    });
  }

  // --- Tier A (second source): retiredKey() tombstone guidance --------------
  // "`<key>` was removed in @objectstack/spec 17.0.0 (#4661, #4964) -- ..."
  // Test files are excluded: they quote SPECIMEN guidance strings (a
  // `retired-key-migrate-sentence.test.ts` fixture spells "`x.y` was removed in
  // @objectstack/spec 17.0.0 (#0000)"), which are illustrations, not retirements.
  const specFiles = gitFiles().filter(
    (f) => f.startsWith('packages/spec/src/') && f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  const seenTombstones = new Set();
  for (const file of specFiles) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const re = /`([A-Za-z][A-Za-z0-9_.]*)`\s+(?:was|were)\s+removed[^\n]{0,200}/g;
    let m;
    while ((m = re.exec(text))) {
      const key = m[1];
      const issues = [...m[0].matchAll(/#(\d{3,6})/g)].map((x) => x[1]);
      if (!issues.length) continue;
      // Only the qualified spellings; a bare tombstoned key is Tier C material
      // and already represented by the registry table.
      if (!key.includes('.')) continue;
      const id = `tombstone:${key}`;
      if (seenTombstones.has(id)) continue;
      seenTombstones.add(id);
      symbols.push({
        tier: 'B',
        id,
        name: key,
        issues,
        pattern: new RegExp(`\\b${key.replace(/\./g, '[.:]')}\\b`, 'g'),
      });
    }
  }

  return symbols;
}

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

let _files = null;
function gitFiles() {
  if (_files) return _files;
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  _files = out.toString('utf8').split('\u0000').filter(Boolean);
  return _files;
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const DOC_EXT = /\.(md|mdx)$/;

function corpus() {
  return gitFiles().filter((f) => {
    if (f.includes('node_modules/')) return false;
    if (f.includes('/dist/') || f.startsWith('dist/')) return false;
    return CODE_EXT.test(f) || DOC_EXT.test(f);
  });
}

/**
 * Reduce a source file to its PROSE: comment text and string-literal text, with
 * every other character blanked out so line and column numbers survive. A
 * markdown file is already prose and is returned unchanged.
 *
 * Blanking rather than deleting is what keeps a hit's reported line number
 * usable for hand-verification, which this measurement depends on.
 */
function extractProse(text, file) {
  if (DOC_EXT.test(file)) return text;
  const out = new Array(text.length).fill(' ');
  let i = 0;
  const n = text.length;
  let state = 'code';
  let quote = '';
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === '\n') {
      out[i] = '\n';
      if (state === 'line') state = 'code';
      i++;
      continue;
    }
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'string'; quote = c; i++; continue; }
      i++;
      continue;
    }
    if (state === 'line') { out[i] = c; i++; continue; }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; }
      out[i] = c;
      i++;
      continue;
    }
    // string
    if (c === '\\') { i += 2; continue; }
    if (c === quote) { state = 'code'; i++; continue; }
    out[i] = c;
    i++;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Stanzas
// ---------------------------------------------------------------------------

/** Strip comment furniture so "is this line empty" is a question about content. */
function stanzaContent(line) {
  return line
    .replace(/^\s*\*\/?/, '')
    .replace(/^\s*\/\//, '')
    .replace(/^\s*#{1,6}\s/, '')
    .trim();
}

/**
 * Partition a file's lines into stanzas: maximal runs of lines whose content is
 * non-empty. Returns an array of { start, end } (1-based, inclusive).
 */
function stanzas(lines) {
  const out = [];
  let start = null;
  for (let i = 0; i < lines.length; i++) {
    const has = stanzaContent(lines[i]).length > 0;
    if (has && start === null) start = i;
    if (!has && start !== null) { out.push({ start, end: i - 1 }); start = null; }
  }
  if (start !== null) out.push({ start, end: lines.length - 1 });
  return out;
}

function stanzaFor(index, list, lines, window) {
  if (window > 0) {
    return { start: Math.max(0, index - window), end: Math.min(lines.length - 1, index + window) };
  }
  for (const s of list) if (index >= s.start && index <= s.end) return s;
  return { start: index, end: index };
}

/**
 * Historical framing -- the card's explicit carve-out. A mention that FRAMES the
 * symbol as gone is already updated prose, whether or not it cites the number.
 */
const HISTORICAL = new RegExp(
  [
    '\\b(?:was|were|is|are|has been|have been)\\s+(?:since\\s+)?(?:removed|retired|deleted|dropped|renamed|replaced|unpublished)\\b',
    '\\bno longer\\b',
    '\\buntil\\s+#\\d',
    '\\bbefore\\s+#\\d',
    '\\bformerly\\b',
    '\\bused to\\b',
    '\\bretired (?:at|in|by|the|it|this|that|under|whole)\\b',
    '\\bremoved (?:at|in|by|the|it|this|that|under)\\b',
    '\\bpre-\\d',
    '\\bwent with\\b',
    '\\bpermanently\\b',
    '\\bdoes not exist\\b',
    '\\bnever (?:existed|shipped)\\b',
  ].join('|'),
  'i',
);

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function scan({ tiers, window, only }) {
  const inventory = buildInventory().filter((s) => tiers.includes(s.tier));
  const files = only ? [only] : corpus();
  const hits = [];

  for (const file of files) {
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue;
    let raw;
    try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
    const prose = extractProse(raw, file);
    const lines = prose.split('\n');
    const rawLines = raw.split('\n');
    const stanzaList = stanzas(lines);

    for (const sym of inventory) {
      sym.pattern.lastIndex = 0;
      if (!sym.pattern.test(prose)) continue;
      sym.pattern.lastIndex = 0;

      const mentions = [];
      for (let i = 0; i < lines.length; i++) {
        sym.pattern.lastIndex = 0;
        if (!sym.pattern.test(lines[i])) continue;
        const s = stanzaFor(i, stanzaList, lines, window);
        const text = lines.slice(s.start, s.end + 1).join('\n');
        const cited = sym.issues.some((n) => new RegExp(`#${n}\\b`).test(text));
        const historical = HISTORICAL.test(text);
        mentions.push({ line: i + 1, cited, historical, text: rawLines[i].trim() });
      }
      if (mentions.length < 2) continue;

      const annotated = mentions.filter((m) => m.cited);
      const bare = mentions.filter((m) => !m.cited && !m.historical);
      if (annotated.length === 0 || bare.length === 0) continue;

      hits.push({
        file,
        tier: sym.tier,
        symbol: sym.name,
        id: sym.id,
        issues: sym.issues,
        mentions: mentions.length,
        annotated: annotated.length,
        historicalOnly: mentions.filter((m) => !m.cited && m.historical).length,
        bare: bare.map((m) => ({ line: m.line, text: m.text })),
        citedLines: annotated.map((m) => m.line),
      });
    }
  }
  return { inventory, hits, fileCount: files.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : fallback;
};

const tiers = (arg('--tier', 'A,B,C') || '').split(',').map((t) => t.trim()).filter(Boolean);
const window = Number(arg('--window', '0'));
const only = arg('--file', null);
const result = scan({ tiers, window, only: only ? relative(ROOT, only) || only : null });

if (argv.includes('--inventory')) {
  for (const s of result.inventory) console.log(`${s.tier}  ${s.name}  <- #${s.issues.join(' #')}  (${s.id})`);
  console.log(`\ninventory: ${result.inventory.length} symbols`);
  process.exit(0);
}

if (argv.includes('--json')) {
  console.log(JSON.stringify(result.hits, null, 2));
  process.exit(0);
}

const byTier = {};
for (const h of result.hits) byTier[h.tier] = (byTier[h.tier] ?? 0) + 1;
const filesFlagged = new Set(result.hits.map((h) => h.file)).size;

if (argv.includes('--hits')) {
  for (const h of result.hits) {
    console.log(`\n[${h.tier}] ${h.file}  ${h.symbol}  (retired by #${h.issues.join(', #')})`);
    console.log(`     mentions=${h.mentions} cited=${h.annotated} historical=${h.historicalOnly} bare=${h.bare.length}`);
    console.log(`     cited at lines: ${h.citedLines.join(', ')}`);
    for (const b of h.bare) console.log(`     BARE  L${b.line}: ${b.text.slice(0, 150)}`);
  }
}

console.log(`\ncorpus: ${result.fileCount} files, inventory: ${result.inventory.length} symbols, window: ${window || 'stanza'}`);
console.log(`hits (file x symbol): ${result.hits.length}`);
console.log(`files flagged: ${filesFlagged}`);
for (const t of Object.keys(byTier).sort()) console.log(`  tier ${t}: ${byTier[t]}`);

#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-react-page-adapter-contract (#10751) -- the two `useAdapter()` contracts
// a hand-rolled rollup owns, swept over EVERY react-page source this repo ships:
// the app-showcase page modules AND the react-page samples in `content/docs`.
//
//   node scripts/check-react-page-adapter-contract.mjs
//   node scripts/check-react-page-adapter-contract.mjs --self-test
//
// ## The defect this exists to make impossible
//
// ONE wrong read -- `result.records` off an `ObjectStackAdapter.find()` result,
// where the normalized `QueryResult` only ever declares `data` -- was fixed
// THREE separate times:
//
//   1. examples/app-showcase/src/ui/pages/crm-workbench.page.ts
//   2. examples/app-showcase/src/ui/pages/renewals-pipeline.page.ts   (#10288)
//   3. content/docs/ui/react-pages.mdx                                (#10469)
//
// #10288 left a guard behind so there would not be a fourth --
// `examples/app-showcase/test/react-page-adapter-query-contract.test.ts`, which
// swept `kind: 'react'` pages for both traps. The detectors were right. Its
// POPULATION was the gap: it read the app-showcase page registry, so the react
// samples in `content/docs` -- the copy a customer starts from -- were invisible
// to it, which is exactly how instance 3 survived the two code fixes.
//
// ## Why this is a gate and not that test with a wider reach (#10751 ruling 3)
//
// A test in an example app reading `content/docs` needs a
// `check:cross-package-test-inputs` declaration plus a `turbo.json` entry
// hashing every declared glob. Measured on this tree before choosing:
//
//   * `content/docs/**` as a declared glob: 22 of the last 132 commits on
//     `main` touch it (16.7%), against 3 that touch `examples/app-showcase`.
//     It would put the example app's whole suite on ~1 PR in 6, and 19 of
//     those 22 commits touch docs carrying no react sample at all. That is the
//     cost `check-cross-package-test-inputs`'s own roster refuses twice, in
//     those words: "Per-page rather than `content/docs/**`: docs are edited far
//     more often than any package here, and a subtree glob would put cli's e2e
//     suite on every documentation PR."
//   * The per-page narrowing that roster prefers instead -- declaring
//     `content/docs/ui/react-pages.mdx` and nothing else -- REBUILDS this
//     card's defect. `adapter.find(` occurs in exactly one docs page today, so
//     a per-page list is green and complete today and goes silently incomplete
//     the day a react sample lands on a second page. A list someone must
//     remember to extend is the failure mode, not the fix.
//
// A `scripts/check-*.mjs` gate has no radius to maintain: lint.yml runs it on
// every PR over the whole tree, so a new docs page is in the population the
// moment it exists.
//
// ## One scanner, two populations
//
// The detectors below are MOVED, not copied. The app-showcase sweep left that
// test file in the same edit that added this gate, because two copies of
// `recordsReads()` would double the places a future fix has to land --
// which is the shape of the defect above, not a fix for it. The test keeps the
// half a text scan cannot do: it EXECUTES the renewals-pipeline rollup against
// a contract-faithful adapter double.
//
// ## The population, and what it deliberately excludes
//
// Population A -- every page module under `examples/app-showcase/src/**`
// (`*.page.ts` / `*.pages.ts`). A whole-directory glob rather than the shipped
// `kind: 'react'` registry the test used: it is a strict SUPERSET (a page that
// nobody exported from `index.ts` is still swept), and it cannot shrink by
// someone forgetting an export.
//
// Population B -- fenced blocks in `content/docs/**/*.mdx|md` that hold the
// adapter. `.find(` alone is NOT the marker, and that is the whole difficulty:
// this tree has three different `find()` contracts in its docs, and only one of
// them declares `data`.
//
//   adapter.find / dataSource.find  -> objectui `ObjectStackAdapter`, options are
//                                      `$`-prefixed, rows under `data`.  SWEPT.
//   engine.find / dataEngine.find   -> ObjectQL `IDataEngine`, options are
//                                      `where` / `fields` / `sort`, UNPREFIXED
//                                      BY CONTRACT. `content/docs/protocol/objectql/
//                                      query-syntax.mdx` alone holds 11 of them.
//                                      Sweeping those would fabricate ~30 findings.
//   client.data.find / useQuery     -> `@objectstack/client`, which resolves a
//                                      `PaginatedResult` whose rows ARE under
//                                      `records` (packages/client/src/index.ts:310).
//                                      `content/docs/api/client-sdk.mdx:659`
//                                      reads `data?.records.map(...)` and is
//                                      CORRECT. Sweeping it would fabricate a
//                                      fourth instance of a defect that is not there.
//
// So the marker is the identifier holding the adapter, not the method name:
// `useAdapter(`, or a `find`/`findOne` on an `adapter` / `dataSource`. A
// language-tagged fence needs either; an UNTAGGED fence needs the real call,
// which keeps `react-pages.mdx`'s untagged CLI-error block (it names
// `useAdapter().findOne` in an error hint) out while still catching a page
// sample someone forgot to tag.
//
// Known exclusions, stated rather than discovered later:
//   * A deliberate counter-example written as a runnable fence would be flagged.
//     This doc set writes its counter-examples as PROSE (see the "$ prefixes are
//     load-bearing" Callout in react-pages.mdx), and no fence in the tree is one
//     today, so no opt-out is invented here. If one is ever needed, extend this
//     gate with it in the same edit rather than routing around the gate.
//   * A sample that holds the adapter under some third name (`const ds = ...`
//     with no `useAdapter(` in the fence) is missed. `useAdapter(` is what the
//     hook is called, so a fence obtaining an adapter without naming it is not
//     a shape that occurs.
//   * `content/` outside `docs/`, and `docs/` (the ADR tree) are not swept.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/** The repo this script lives in -- resolved from the script, so cwd cannot lie. */
function scriptRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

const APP_SHOWCASE_SRC = 'examples/app-showcase/src';
const DOCS_ROOT = 'content/docs';

/**
 * The three sites the defect was fixed at, pinned as census anchors.
 *
 * Ruling: an empty sweep of EITHER half must fail, and "non-empty" is not
 * enough -- the app-showcase half stayed non-empty through all three
 * occurrences while the docs half did not exist. Each anchor is a file the
 * defect was actually repaired in, so a population that drops one has lost
 * coverage it demonstrably needed.
 */
const CENSUS_ANCHORS = {
  appShowcase: [
    `${APP_SHOWCASE_SRC}/ui/pages/crm-workbench.page.ts`,
    `${APP_SHOWCASE_SRC}/ui/pages/renewals-pipeline.page.ts`,
  ],
  docs: [`${DOCS_ROOT}/ui/react-pages.mdx`],
};

// ---------------------------------------------------------------------------
// The two detectors -- MOVED from
// examples/app-showcase/test/react-page-adapter-query-contract.test.ts (#10288).
// `unprefixedQueryKeys` is still verbatim. `recordsReads` is NOT: it arrived
// carrying a `.data`-beside carve-out that made `data ?? records` invisible,
// and that carve-out was narrowed to comment/string stripping in the same
// edit that deleted the two aliases it was load-bearing for. See the
// function's own header for why a tolerant alias is a finding.
// ---------------------------------------------------------------------------

const DECLARED_QUERY_PARAM_PREFIX = '$';

/**
 * Top-level keys of an object-literal source slice.
 *
 * @param {string} objSrc
 * @returns {string[]}
 */
export function topLevelKeys(objSrc) {
  const keys = [];
  let depth = 0;
  let i = 0;
  let expectKey = true;
  while (i < objSrc.length) {
    const c = objSrc[i];
    if (c === '{' || c === '[' || c === '(') { depth++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; i++; continue; }
    if (depth === 1) {
      if (c === ',') { expectKey = true; i++; continue; }
      if (c === ':') { expectKey = false; i++; continue; }
      if (expectKey) {
        const m = /^(['"]?)([A-Za-z_$][\w$]*)\1\s*:/.exec(objSrc.slice(i));
        if (m) { keys.push(m[2]); i += m[0].length; expectKey = false; continue; }
      }
    }
    i++;
  }
  return keys;
}

/**
 * Every unprefixed key handed to an `adapter.find`/`findOne` in one source.
 *
 * `QueryParams` (objectui `packages/types/src/data.ts`) declares ONLY
 * `$`-prefixed keys, and `ObjectStackAdapter.convertQueryParams` builds its
 * outgoing options by copying exactly those. A bare `top:` / `limit:` reaches
 * no branch and is dropped -- and it does NOT fall back to a default page,
 * because the GET list route has no default page size. The cap the author wrote
 * simply never happens, with no error anywhere.
 *
 * MOVED VERBATIM, with ONE additive field: `index`, the character offset of the
 * params literal, so a caller can name the LINE a finding sits on. Nothing else
 * about the walk changed — the #10288 positive control asserts over `.key` and
 * still passes unchanged.
 *
 * @param {string} source
 * @returns {{ key: string, snippet: string, index: number }[]}
 */
export function unprefixedQueryKeys(source) {
  const found = [];
  const call = /\b(?:adapter|dataSource)\s*\.\s*(?:find|findOne)\s*\(/g;
  let m;
  while ((m = call.exec(source))) {
    // Walk to the params object literal, staying inside this call's parens.
    let i = m.index + m[0].length;
    let depth = 1;
    let objStart = -1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      else if (c === '{' && depth === 1) { objStart = i; break; }
      i++;
    }
    if (objStart < 0) continue;
    let braces = 0;
    let objEnd = -1;
    for (let j = objStart; j < source.length; j++) {
      if (source[j] === '{') braces++;
      else if (source[j] === '}') { braces--; if (braces === 0) { objEnd = j; break; } }
    }
    if (objEnd < 0) continue;
    const obj = source.slice(objStart, objEnd + 1);
    for (const k of topLevelKeys(obj)) {
      if (!k.startsWith(DECLARED_QUERY_PARAM_PREFIX)) {
        found.push({ key: k, snippet: obj.replace(/\s+/g, ' ').slice(0, 100), index: objStart });
      }
    }
  }
  return found;
}

/** A `.records` / `?.records` PROPERTY read -- not the bare word, not a longer name. */
const RECORDS_READ = /\??\.\s*records\b/;

/**
 * One line's executable text: string and template bodies blanked (quotes kept),
 * and a trailing `//` or block comment dropped.
 *
 * This is what lets the `.data`-beside carve-out go without the detector
 * starting to fire on text that merely SPELLS the trap: a webhook payload
 * naming `'data.records.updated'`, or a line whose trailing comment explains
 * why `.records` is wrong. Both are kept out of the sweep by the SELECTOR
 * today, and a detector that is quiet only because of the selector is one
 * population change away from firing.
 *
 * @param {string} line
 * @returns {string}
 */
export function codeOnly(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== null) {
      if (c === '\\') { i++; continue; }
      if (c === quote) { quote = null; out += c; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) break;
    out += c;
  }
  return out;
}

/**
 * Every `.records` read off a find() result, judged on the line's CODE.
 *
 * `find()` resolves to a normalized `QueryResult` -- rows under `data`, never
 * the REST envelope's `records`. Reading `.records` yields `undefined` on every
 * call, so a KPI over it sticks at 0 forever while the `<ListView>` beside it
 * shows the same rows correctly.
 *
 * Whole-line comments are skipped and `codeOnly()` strips the rest: a page that
 * explains the trap in prose (and `crm-workbench` does, right above the call it
 * once got wrong) is documenting the contract, not violating it. The read
 * itself is what this looks for.
 *
 * ⛔ A `.data` READ BESIDE IT IS NOT AN EXEMPTION. This detector used to skip
 * any line carrying `.data`, which made `result.data ?? result.records` the one
 * shape it could not see -- and that is the shape BOTH surviving repairs of
 * this defect had landed as, including the sample in
 * `content/docs/ui/react-pages.mdx` that a customer copies from. A tolerant
 * alias renders correctly today (`.data` is read first and always wins), so
 * nothing is on fire; what it does is teach authors and code assistants a
 * spelling the producer cannot emit, leaving the next author who simplifies
 * the chain to guess which limb was real. That guess is how ONE wrong read
 * reached three files.
 *
 * Measured before the narrowing landed: the carve-out was load-bearing for
 * exactly two lines across both populations -- the two aliases deleted in this
 * same edit -- and nothing else. So it reds no bystander.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function recordsReads(source) {
  const out = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (!RECORDS_READ.test(codeOnly(trimmed))) continue;
    out.push(trimmed);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Population B -- fenced blocks in the docs corpus
// ---------------------------------------------------------------------------

/** Languages a runnable react-page sample is tagged with. */
const SAMPLE_LANGS = new Set(['jsx', 'tsx', 'js', 'ts', 'javascript', 'typescript']);

/** A real `find`/`findOne` on the objectui adapter -- never on `engine`/`client`. */
const ADAPTER_CALL = /\b(?:adapter|dataSource)\s*\.\s*(?:find|findOne)\s*\(/;

/** The hook that hands a page the adapter. Case-sensitive, so `useAdapter` alone matches. */
const USE_ADAPTER = /\buseAdapter\s*\(/;

/**
 * Every fenced block in a markdown source, with its language and 1-based start line.
 *
 * Handles indented fences (a fence inside a `<Callout>`) and long fences
 * (````), and closes only on a marker of the same character and at least the
 * opening length -- so a ``` inside a ```` block does not end it.
 *
 * @param {string} markdown
 * @returns {{ lang: string, body: string, line: number }[]}
 */
export function fencedBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)/.exec(lines[i]);
    if (open === null) {
      if (m) open = { char: m[2][0], len: m[2].length, lang: m[3].toLowerCase(), line: i + 2, body: [] };
      continue;
    }
    if (m && m[2][0] === open.char && m[2].length >= open.len && m[3] === '') {
      blocks.push({ lang: open.lang, body: open.body.join('\n'), line: open.line });
      open = null;
      continue;
    }
    open.body.push(lines[i]);
  }
  // An unterminated fence still yields its body: a truncated block is a docs
  // defect, but dropping it here would silently shrink the population.
  if (open !== null) blocks.push({ lang: open.lang, body: open.body.join('\n'), line: open.line });
  return blocks;
}

/**
 * Is this fence a react-page sample on the `useAdapter()` contract?
 *
 * A language-tagged fence qualifies on either marker. An UNTAGGED fence needs
 * the real call: `react-pages.mdx` carries an untagged block of CLI error
 * output whose hint names `useAdapter().findOne` in prose, and that is not a
 * sample.
 *
 * @param {{ lang: string, body: string }} block
 */
export function isReactPageSample(block) {
  if (SAMPLE_LANGS.has(block.lang)) return ADAPTER_CALL.test(block.body) || USE_ADAPTER.test(block.body);
  // Any OTHER tag — `bash`, `json`, `text`, a shell transcript — is a
  // deliberate statement that this is not JavaScript, and is taken at its word.
  if (block.lang !== '') return false;
  return ADAPTER_CALL.test(block.body);
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/** Every file under `dir` (recursively) whose name passes `keep`. */
function walk(dir, keep, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(full, keep, out);
    } else if (e.isFile() && keep(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Both populations, as `{ path, source }` records with repo-relative paths.
 *
 * @param {string} root  repo root
 */
export function collectSources(root) {
  const appShowcase = walk(join(root, APP_SHOWCASE_SRC), (n) => /\.pages?\.ts$/.test(n)).map((f) => {
    const rel = relative(root, f).split('\\').join('/');
    return { path: rel, file: rel, startLine: 1, source: readFileSync(f, 'utf8') };
  });

  const docs = [];
  let docFilesRead = 0;
  let fencesSeen = 0;
  for (const f of walk(join(root, DOCS_ROOT), (n) => n.endsWith('.mdx') || n.endsWith('.md'))) {
    const rel = relative(root, f).split('\\').join('/');
    // Release notes are compiled centrally at release time and are historical
    // record, not a page a customer copies from.
    if (rel.startsWith(`${DOCS_ROOT}/releases/`)) continue;
    docFilesRead++;
    const blocks = fencedBlocks(readFileSync(f, 'utf8'));
    fencesSeen += blocks.length;
    for (const b of blocks) {
      if (!isReactPageSample(b)) continue;
      docs.push({ path: `${rel}:${b.line}`, file: rel, startLine: b.line, source: b.body });
    }
  }
  return { appShowcase, docs, stats: { docFilesRead, fencesSeen } };
}

// ---------------------------------------------------------------------------
// The census control -- ruling 4 of #10751
// ---------------------------------------------------------------------------

/**
 * The population must be non-empty on BOTH halves, and must still contain each
 * site the defect was repaired at.
 *
 * A sweep over an empty list is vacuously green. The guard this replaces had
 * that control for its app-showcase half only; extending a population is
 * exactly when a control quietly stops covering what it used to.
 *
 * @param {{ appShowcase: {path:string}[], docs: {path:string, file:string}[] }} population
 * @returns {string[]} failures, empty when the census holds
 */
export function censusFailures(population) {
  const failures = [];
  if (population.appShowcase.length < 2) {
    failures.push(
      `app-showcase contributed ${population.appShowcase.length} page source(s); expected at least 2. `
      + `A sweep over an empty list is vacuously green.`,
    );
  }
  if (population.docs.length < 1) {
    failures.push(
      `the ${DOCS_ROOT} corpus contributed 0 react-page sample(s). This is the half #10751 added: `
      + `an empty docs sweep passing silently is exactly how the same \`.records\` read survived `
      + `three separate fixes. Either a sample stopped matching the selector `
      + `(useAdapter( / adapter.find( in a fenced block) or the corpus moved.`,
    );
  }
  const havePages = new Set(population.appShowcase.map((s) => s.path));
  for (const anchor of CENSUS_ANCHORS.appShowcase) {
    if (!havePages.has(anchor)) failures.push(`census anchor missing from the sweep: ${anchor} (the defect was repaired there)`);
  }
  const haveDocs = new Set(population.docs.map((s) => s.file));
  for (const anchor of CENSUS_ANCHORS.docs) {
    if (!haveDocs.has(anchor)) failures.push(`census anchor missing from the sweep: ${anchor} (the defect was repaired there)`);
  }
  return failures;
}

// ---------------------------------------------------------------------------

/**
 * Run both detectors over both populations.
 *
 * @param {{ appShowcase: {path:string, source:string}[], docs: {path:string, file:string, source:string}[] }} population
 */
export function sweep(population) {
  const findings = [];
  for (const half of [population.appShowcase, population.docs]) {
    for (const entry of half) {
      const { file, startLine, source } = entry;
      /** The finding's line in the FILE, not in the slice the detector saw. */
      const at = (localLine) => `${file}:${startLine + localLine - 1}`;
      for (const { key, snippet, index } of unprefixedQueryKeys(source)) {
        findings.push(
          `${at(lineOfIndex(source, index))}: query option \`${key}\` has no \`$\` prefix, so `
          + `ObjectStackAdapter drops it — the read runs UNBOUNDED and unfiltered, with no error. `
          + `Spell it \`${key === 'limit' ? 'top' : key}\`. In: ${snippet}`,
        );
      }
      for (const line of recordsReads(source)) {
        findings.push(
          `${at(lineOfText(source, line))}: reads \`.records\` off a find() result. \`QueryResult\` `
          + `declares rows under \`data\` — \`.records\` is \`undefined\` on every call, forever, `
          + `silently. In: ${line}`,
        );
      }
    }
  }
  return findings;
}

/** 1-based line holding character offset `index`. */
export function lineOfIndex(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

/** 1-based line whose trimmed text is `trimmed`, or 1 when it cannot be found. */
export function lineOfText(source, trimmed) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i].trim() === trimmed) return i + 1;
  return 1;
}

function report({ population, findings, censusProblems }) {
  const scope =
    `${population.appShowcase.length} app-showcase page module(s) + `
    + `${population.docs.length} ${DOCS_ROOT} react-page sample(s) `
    + `(from ${population.stats.docFilesRead} doc file(s), ${population.stats.fencesSeen} fenced block(s))`;

  if (censusProblems.length) {
    console.error(`✗ check-react-page-adapter-contract — the population census failed, so the sweep's verdict means nothing:\n`);
    for (const p of censusProblems) console.error(`  • ${p}`);
    console.error(`\n  Swept: ${scope}`);
    return 1;
  }
  if (findings.length) {
    console.error(`✗ check-react-page-adapter-contract — ${findings.length} useAdapter() contract violation(s):\n`);
    for (const f of findings) console.error(`  • ${f}`);
    console.error(
      `\n  Both traps are DROP-SHAPED: nothing throws, nothing warns, and the page renders a\n`
      + `  plausible number either way — which is why neither \`os validate\` nor \`tsc\` nor a\n`
      + `  smoke test catches them. If a flagged fence is a deliberate counter-example, this\n`
      + `  doc set writes those as prose (see the "$ prefixes are load-bearing" Callout in\n`
      + `  ${DOCS_ROOT}/ui/react-pages.mdx); extend this gate with an opt-out in the same edit\n`
      + `  rather than routing around it.\n`
      + `\n  Swept: ${scope}`,
    );
    return 1;
  }
  console.log(`✓ check-react-page-adapter-contract: ${scope} — every adapter query option is $-prefixed and every row read is off \`data\`.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (ok, name) => { checked++; if (!ok) failures.push(name); };

  // ── The positive control, MOVED from the #10288 test file ────────────────
  // "the scanners fire on a known-bad source" — carried verbatim, because
  // extending a population is exactly when a control quietly stops covering
  // what it used to.
  const bad = `
      const a = await adapter.find('showcase_project', { $filter: ['account', '=', sel], top: 500 });
      const b = await adapter.find('showcase_invoice', { limit: 200 });
      // a comment mentioning .records must NOT count as a read
      const rows = (a && a.records) || [];
    `;
  assert(
    JSON.stringify(unprefixedQueryKeys(bad).map((f) => f.key)) === JSON.stringify(['top', 'limit']),
    'unprefixedQueryKeys fires on a known-bad source, naming both dropped keys',
  );
  assert(
    JSON.stringify(recordsReads(bad)) === JSON.stringify(['const rows = (a && a.records) || [];']),
    'recordsReads fires on a known-bad source, and a COMMENT mentioning .records is not a read',
  );

  // ...and stay silent on the corrected shape, so a green means something.
  const good = `
      const a = await adapter.find('showcase_project', { $filter: ['account', '=', sel], $top: 500 });
      const rows = a.data ?? [];
    `;
  assert(unprefixedQueryKeys(good).length === 0, 'unprefixedQueryKeys is silent on the corrected shape');
  assert(recordsReads(good).length === 0, 'recordsReads is silent on the corrected shape');

  // ── The narrowing: a `.data` read BESIDE it is not an exemption ───────────
  // The first two are the two tolerant aliases the `.data`-beside carve-out
  // used to bless -- the app-showcase one and, worse, the docs sample a
  // customer copies from. Both rendered correctly while teaching a spelling
  // `ObjectStackAdapter.find()` cannot emit, which is what the carve-out cost.
  assert(
    recordsReads(`const rows = Array.isArray(all) ? all : (all && (all.data || all.records)) || [];`).length === 1,
    'a `data || records` alias IS a finding — the carve-out that blessed it is what let BOTH surviving repairs land as tolerance',
  );
  assert(
    recordsReads(`const records = result?.data ?? result?.records ?? (Array.isArray(result) ? result : []);`).length === 1,
    'the docs sample\'s `?? result?.records` alias IS a finding — optional chaining is a read',
  );
  assert(
    recordsReads(`const records = result?.data ?? (Array.isArray(result) ? result : []);`).length === 0,
    'the REPAIRED docs sample is silent — a local named `records` is not a `.records` read',
  );

  // ...and the narrowing must not start firing on text that merely SPELLS it.
  assert(
    recordsReads(`emit({ type: 'data.records.updated' });`).length === 0,
    'a webhook payload naming data.records.updated in a STRING is not a read — the detector no longer leans on the selector for this',
  );
  assert(
    recordsReads(`const rows = result.data ?? []; // never .records — QueryResult does not declare it`).length === 0,
    'a TRAILING comment naming .records beside a canonical read is not a finding — prose documenting the trap is not the trap',
  );
  assert(
    recordsReads(`const n = result.recordsCount;`).length === 0,
    'a LONGER property is not a `.records` read — the detector matches a whole property name',
  );
  assert(
    codeOnly(`a.records // '.data'`) === 'a.records ' && codeOnly(`x('.records')`) === `x('')`,
    'codeOnly drops a trailing comment and blanks string BODIES while keeping the quotes',
  );

  // ── The contracts this sweep must NOT fabricate findings on ─────────────
  // Both are real lines from `content/docs`, and both are CORRECT where they sit.
  assert(
    unprefixedQueryKeys(`const customers = await engine.find('customer', { where: { industry: 'tech' }, limit: 10 });`).length === 0,
    'an ObjectQL `engine.find` is a different contract — its unprefixed keys are not findings',
  );
  assert(
    recordsReads(`  return data?.records.map(a => <div key={a.id}>{a.name}</div>);`).length === 1,
    'the detector itself DOES flag a bare .records read — so the client-sdk exclusion has to happen in the SELECTOR',
  );
  assert(
    !isReactPageSample({ lang: 'typescript', body: `const { data } = useQuery('account', { limit: 20 });\nreturn data?.records.map(a => a.name);` }),
    'a `useQuery` sample is NOT selected: `@objectstack/client` resolves a PaginatedResult whose rows ARE `records`',
  );
  assert(
    !isReactPageSample({ lang: 'ts', body: `emit({ type: 'data.records.updated' });` }),
    'a webhook payload naming `data.records.updated` is not a react-page sample',
  );

  // ── The selector ────────────────────────────────────────────────────────
  assert(
    isReactPageSample({ lang: 'jsx', body: `const adapter = useAdapter();` }),
    'a tagged fence holding the adapter is selected on the hook alone',
  );
  assert(
    isReactPageSample({ lang: 'jsx', body: `const r = await adapter.find('x', { $top: 1 });` }),
    'a tagged fence is selected on a real adapter.find',
  );
  assert(
    !isReactPageSample({ lang: 'jsx', body: `<ListView objectName="showcase_account" />` }),
    'a plain block fence is NOT selected — admitting every jsx fence is the fabrication direction',
  );
  assert(
    !isReactPageSample({ lang: '', body: `read the record with useAdapter().findOne and lay it out in JSX.` }),
    'an UNTAGGED block that only NAMES the hook in prose is not a sample (react-pages.mdx CLI error output)',
  );
  assert(
    isReactPageSample({ lang: '', body: `const r = await adapter.find('x', { top: 1 });` }),
    'an UNTAGGED fence carrying a real adapter.find IS swept — a forgotten language tag is not an exemption',
  );
  assert(
    !isReactPageSample({ lang: 'bash', body: `adapter.find('x', { top: 1 })` }),
    'a shell transcript is not a page sample even when it quotes the call',
  );

  // ── The fence parser ────────────────────────────────────────────────────
  const md = [
    'intro', '```jsx', 'const a = 1;', '```', 'mid',
    '````md', '```jsx', 'nested, not a block of its own', '```', '````',
    '  ```ts title="x"', '  const b = 2;', '  ```',
  ].join('\n');
  const blocks = fencedBlocks(md);
  assert(blocks.length === 3, 'three blocks parsed: a short fence inside a longer one does not end it (got ' + blocks.length + ')');
  assert(blocks[0].lang === 'jsx' && blocks[0].body === 'const a = 1;', 'the first block carries its language and body');
  assert(blocks[0].line === 3, `a block reports the 1-based line its body starts on (got ${blocks[0].line})`);
  assert(blocks[2].lang === 'ts', 'an indented fence with meta after the language is parsed, and the meta is not the language');
  assert(fencedBlocks('```jsx\nunterminated').length === 1, 'an unterminated fence still yields its body rather than shrinking the population');

  // ── The census control refuses to report OK over nothing (ruling 4) ──────
  const full = {
    appShowcase: CENSUS_ANCHORS.appShowcase.map((path) => ({ path })),
    docs: CENSUS_ANCHORS.docs.map((file) => ({ path: `${file}:1`, file })),
  };
  assert(censusFailures(full).length === 0, 'a population holding every anchor passes the census');
  assert(
    censusFailures({ ...full, docs: [] }).some((f) => f.includes(DOCS_ROOT)),
    'AN EMPTY DOCS SWEEP FAILS — the ruling-4 half, and the one a population extension silently drops',
  );
  assert(
    censusFailures({ ...full, appShowcase: [] }).length > 0,
    'an empty app-showcase sweep fails — the control the #10288 guard already had',
  );
  assert(
    censusFailures({ ...full, docs: [{ path: 'content/docs/other.mdx:1', file: 'content/docs/other.mdx' }] })
      .some((f) => f.includes('react-pages.mdx')),
    'a docs half that is non-empty but has LOST the repaired page fails — non-empty is not the same as covering',
  );
  assert(
    censusFailures({ ...full, appShowcase: full.appShowcase.slice(0, 1).concat([{ path: 'x' }]) })
      .some((f) => f.includes('renewals-pipeline')),
    'an app-showcase half that dropped a repaired page fails',
  );

  // ── The sweep wires the detectors to both halves, and NAMES A LINE ───────
  const fromPage = sweep({ appShowcase: [{ file: 'p.ts', startLine: 1, source: bad }], docs: [] });
  assert(fromPage.length === 3, 'the sweep reports every finding from the app-showcase half');
  assert(
    fromPage[0].startsWith('p.ts:2') && fromPage[1].startsWith('p.ts:3') && fromPage[2].startsWith('p.ts:5'),
    'each finding names the line it sits on — two identical drops in one file must be separable, got '
      + fromPage.map((f) => f.split(':').slice(0, 2).join(':')).join(' / '),
  );
  const fromDocs = sweep({ appShowcase: [], docs: [{ file: 'd.mdx', startLine: 100, source: bad }] });
  assert(fromDocs.length === 3, 'the sweep reports every finding from the DOCS half — the half this gate exists to add');
  assert(
    fromDocs[0].startsWith('d.mdx:101'),
    'a docs finding names the line IN THE FILE, not in the fence body — a fence-relative line sends the author nowhere, got '
      + fromDocs[0].split(':').slice(0, 2).join(':'),
  );
  assert(lineOfIndex('a\nb\nc', 4) === 3 && lineOfIndex('a\nb', 0) === 1, 'lineOfIndex counts newlines before the offset');
  assert(lineOfText('x\n  hit\ny', 'hit') === 2 && lineOfText('x', 'nope') === 1, 'lineOfText matches on the TRIMMED line, and falls back to 1');

  if (failures.length) {
    console.error(`✗ check-react-page-adapter-contract --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    return 1;
  }
  console.log(
    `✓ check-react-page-adapter-contract --self-test: ${checked} assertions — both detectors observed FIRING and observed silent, `
    + `the selector observed refusing the engine.find / useQuery / webhook shapes it must not fabricate on, `
    + `and an empty sweep of EITHER half observed failing the census.`,
  );
  return 0;
}

// ---------------------------------------------------------------------------

function main() {
  const root = scriptRepoRoot();
  const population = collectSources(root);
  const censusProblems = censusFailures(population);
  const findings = censusProblems.length ? [] : sweep(population);
  return report({ population, findings, censusProblems });
}

if (isEntrypoint(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : main());
}

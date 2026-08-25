#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-whole-set-label-write (#10778) -- nothing this repo executes may issue
 * `PUT /issues/{n}/labels`, in any spelling.
 *
 *   node scripts/check-whole-set-label-write.mjs              # the gate
 *   node scripts/check-whole-set-label-write.mjs --list       # the census it judged
 *   node scripts/check-whole-set-label-write.mjs --self-test  # prove it can go red
 *
 * ## The defect
 *
 * Only three verbs touch a label set and only one is destructive:
 *
 *   POST   /issues/{n}/labels          adds the named labels, touches nothing else
 *   DELETE /issues/{n}/labels/{name}   removes ONE label, BY NAME
 *   PUT    /issues/{n}/labels          replaces the whole set -- DESTRUCTIVE
 *
 * A whole-set PUT is a read-modify-write across a network round trip, so it
 * destroys any label that lands between the read and the write -- silently,
 * with an `unlabeled` event nobody watches for. Measured on PR #10698, every
 * label event from the timeline API:
 *
 *   09:05:29Z  labeled    skip-changeset  claude[bot]          (additive POST, HTTP 200)
 *   09:05:30Z  unlabeled  skip-changeset  github-actions[bot]  <-- the size labeler's PUT
 *   09:05:30Z  labeled    size/l          github-actions[bot]
 *   09:06:03Z  labeled    skip-changeset  claude[bot]          (re-applied after read-back)
 *
 * One second. The writer did everything right -- additive POST, HTTP 200,
 * read-back confirmed -- and still lost the label.
 *
 * ## Why a gate, when #10703 already removed both writers
 *
 * #10703 made both label writers in `.github/workflows/pr-automation.yml`
 * additive. That removed the two whole-set writes; it did not make the verb
 * UNAVAILABLE. Until this file existed the whole guard was (a) a prose
 * paragraph in that workflow's header and (b) `scripts/pr-labels.mjs
 * --self-test`, which constrains that one script. Neither notices a newly
 * added third-party labeler, nor a second workflow calling the endpoint
 * directly -- i.e. a live defect class tracked only by prose.
 *
 * ⭐ The second-order cost is the sharp one, and it is why the verb is worth
 * banning rather than merely avoiding: while a whole-set write is reachable,
 * **"the label is absent" stops meaning anything.** Absence has two causes --
 * cleared deliberately, or erased by somebody's PUT -- so every seat that finds
 * a missing gate label has to do forensics before it can act. Read-back is the
 * only detection there is, so a write without one is silent.
 *
 * ## What is asserted
 *
 * Over `.github/workflows/**`, `.github/actions/**` and `scripts/**`:
 *
 *   1. no `PUT` against `/issues/{n}/labels` in any spelling -- `curl -X PUT`,
 *      `gh api -X PUT`/`--method PUT`, `octokit.request('PUT /repos/...')`,
 *      `fetch(url, { method: 'PUT' })`, and `issues.setLabels`, which IS the
 *      PUT under an SDK name;
 *   2. no `uses:` of an action known to write the whole set;
 *   3. an ALLOWLIST entry requires a stated reason, so a deliberate exception
 *      is a recorded decision rather than an omission. `run()` REFUSES on an
 *      entry without one -- the rule is enforced in CI, not only in the
 *      self-test.
 *
 * ## ⛔ Only EXECUTABLE content is judged, and the comments are the probe
 *
 * The two files that DOCUMENT this ban spell every forbidden form inside
 * comments -- `pr-automation.yml`'s header and `pr-labels.mjs`'s. A raw-text
 * matcher reds on the documentation of the rule it enforces, which is the
 * "gate forbids the fix" shape. So comments are blanked before judgment, per
 * language (`#` for YAML/shell, `//` and slash-star for JS), preserving line
 * numbers.
 *
 * That stripper is itself a vacuity risk: over-strip and the gate reports a
 * confident green over a corpus it never read. The answer is that the SAME
 * matcher runs twice -- once over raw text, once over stripped -- and both
 * counts are printed. The raw count is a live positive control on real files:
 * `PROSE_PROBES` names the two headers that must keep matching, and `run()`
 * REFUSES if either stops. So a zero in the judged column is a measurement
 * against a matcher observed working on this tree, not a silence.
 *
 * Measured on the tree this landed against (base 387e23138), and this is the
 * verdict line verbatim, not a paraphrase: 194 files over 3 roots, 11 raw
 * mentions, ALL 11 cleared as comments (in 3 files: this repo's two documenting
 * headers plus this gate's own wiring comment in lint.yml), 0 in EXECUTABLE
 * content, 147 `uses:`
 * pins over 18 distinct actions judged, 0 violations, 0 allowlist entries.
 *
 * ⭐ That the allowlist is EMPTY is the load-bearing part of the measurement.
 * The population was measured before this gate was written: neither
 * `codelytv/pr-size-labeler` nor `actions/labeler` is pinned anywhere any more
 * (#10703 retired both), no workflow or script reaches the endpoint with PUT,
 * and `scripts/pr-labels.mjs` -- which models the retired PUT in a pure
 * function to prove it destroys labels -- is clean WITHOUT an exemption. See
 * the next section for why that last one is not luck.
 *
 * ## Keyed on the METHOD SLOT, not on the token `PUT`
 *
 * A rule that flags a bare `PUT` near a `/labels` path reds on this, in
 * `scripts/pr-labels.mjs`'s self-test:
 *
 *   path: '/issues/10698/labels',                                   (line 668)
 *   check('the retired whole-set PUT destroys the concurrent label' (line 673)
 *
 * Five lines apart, both executable, and correct as written: it is the fixture
 * that PROVES the retired write was destructive. Deleting it to satisfy a gate
 * would delete the evidence. So `PUT` counts only where it is the HTTP METHOD
 * -- after `-X`, `--request`, `--method`, as a `method:` / `method =` value, or
 * heading an octokit route string -- and a `PUT` inside prose or a test name is
 * not that. Same reason `if (step.method === 'PUT') throw` stays clean: a
 * comparison is a REFUSAL of the verb, not a use of it.
 *
 * ## Known bounds, stated rather than implied
 *
 * Every one of these fails toward a MISS, never a false red, and each is
 * pinned by `--self-test` so it cannot drift silently:
 *
 *   * WINDOW_LINES. The method slot and the `/labels` path may sit on separate
 *     lines (a backslash-continued `curl`, a multi-line `fetch` options
 *     object). They are paired within WINDOW_LINES lines of each other.
 *     Further apart is a miss.
 *   * INDIRECTION. `method: FORBIDDEN_VERB` where the constant holds `'PUT'`
 *     is not matched -- a text gate does not fold constants. That exact
 *     spelling is live in `pr-labels.mjs`, where the plan is a fixture that is
 *     never dispatched (its dispatcher refuses the verb), so the miss costs
 *     nothing there. A real writer hiding the verb behind a constant is out of
 *     reach of this gate BY CONSTRUCTION; that is what the `uses:` limb and
 *     `pr-labels.mjs --self-test` cover from the other side.
 *   * QUOTE TRACKING in `#`-comment languages is per line. An apostrophe in an
 *     unquoted YAML scalar before a `#` leaves that comment unstripped, which
 *     can only ever ADD a false red -- loud, with the allowlist as the hatch.
 *
 * ⛔ If this gate reds on a file that is correctly TEACHING the ban, the fix is
 * an ALLOWLIST entry with a reason -- never a weakening of the rule, and never
 * a deletion of the counter-example.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

export const EXIT_CLEAN = 0;
export const EXIT_VIOLATIONS = 1;
export const EXIT_REFUSED = 2;

/** The executed surface. A whole-set write can only come from something that runs. */
export const ROOTS = ['.github/workflows', '.github/actions', 'scripts'];

/** Extensions read as executable content. */
export const SCANNED_EXTENSIONS = new Set(['.yml', '.yaml', '.mjs', '.js', '.cjs', '.ts', '.sh']);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

/**
 * How far apart the method slot and the `/labels` path may sit and still be
 * read as one call. A backslash-continued `curl` puts them 1-3 lines apart; a
 * multi-line `fetch` options object, 1-4. Six is that with headroom.
 *
 * Pinned in BOTH directions by `--self-test`: WINDOW_LINES-1 apart is RED,
 * WINDOW_LINES apart is a stated miss.
 */
export const WINDOW_LINES = 6;

/**
 * Actions MEASURED to replace the whole label set, keyed by `owner/repo` so no
 * version can slip the ban. Each reason is the source read recorded on #10703
 * -- read out of the pinned sources rather than inferred from the docs (#5649).
 *
 * ⚠️ Neither is pinned in this repo any more, so this roster is FORWARD-LOOKING:
 * it is what stops a future PR from reintroducing one. A future version that is
 * genuinely additive is an ALLOWLIST entry with that measurement as its reason
 * -- not a deletion from this map.
 */
export const WHOLE_SET_ACTIONS = new Map([
  [
    'codelytv/pr-size-labeler',
    'v1.10.4 src/github.sh:68-91 (`github::add_label_to_pr`): GETs the PR, greps its OWN size ' +
      'family out of the result, appends the new size label, then `curl -X PUT ' +
      '.../issues/$pr_number/labels` with the whole set. No mitigation of any kind.'
  ],
  [
    'actions/labeler',
    'v7.0.0 src/labeler.ts:56,111-133 plus src/api/set-labels.ts: snapshots `preexistingLabels`, ' +
      'unions in the config matches, re-reads once, then calls `client.rest.issues.setLabels` -- ' +
      'which IS the PUT. The re-read NARROWS the window; it does not close it.'
  ]
]);

/**
 * Deliberate exceptions. Shape: `{ path, rule, reason }`.
 *
 * `rule` is `'endpoint'` or `'action'`. The reason is REQUIRED and must be a
 * real sentence -- `run()` REFUSES (exit EXIT_REFUSED, not a pass) on an entry
 * without one, because "why is this allowed" is the entire content of an
 * exemption. That refusal is assertion 3 of the card, mechanically.
 *
 * EMPTY today, and that is a measurement rather than an oversight: the
 * violating population was measured at zero before this gate was written.
 *
 * @type {{ path: string, rule: 'endpoint' | 'action', reason: string }[]}
 */
export const ALLOWLIST = [];

/** The shortest string that can pass as a stated reason. */
export const MIN_REASON_LENGTH = 20;

/**
 * The file that OWNS this rule and is therefore not judged by it.
 *
 * This file spells every forbidden form, in its header and in its `--self-test`
 * fixtures. Judging it would make the gate fail on its own positive controls,
 * and deleting them to appease it would delete the only proof it can fail at
 * all. Pinned at exactly one entry by `--self-test`, so it cannot quietly
 * become a second allowlist.
 */
export const RULE_OWNING_FILES = ['scripts/check-whole-set-label-write.mjs'];

/**
 * Live positive controls: files whose RAW text must still match the matcher.
 *
 * These are the two headers that document the ban. They are the answer to
 * "is the judged zero a measurement or a silence" -- if the matcher breaks,
 * these stop matching and `run()` REFUSES instead of printing a green.
 *
 * @type {{ path: string, reason: string }[]}
 */
export const PROSE_PROBES = [
  {
    path: '.github/workflows/pr-automation.yml',
    reason:
      'its header spells the three verbs and both retired actions, including `curl -X PUT ' +
      '.../issues/$pr_number/labels` and `issues.setLabels`. If the matcher stops seeing those, ' +
      'it would stop seeing a real one.'
  },
  {
    path: 'scripts/pr-labels.mjs',
    reason:
      'the additive writer, whose header carries the same verb table and source reads. Second ' +
      'probe on purpose: one file could be legitimately rewritten, two going dark at once is the ' +
      'matcher.'
  }
];

/* ───────────────────────────── comment blanking ───────────────────────────── */

/** @param {string} file @returns {'hash' | 'js'} */
export function commentKind(file) {
  return /\.(ya?ml|sh)$/.test(file) ? 'hash' : 'js';
}

/**
 * Blank comments, preserving byte offsets and line numbers so a finding still
 * reports the line the reader will open.
 *
 * @param {string} text
 * @param {'hash' | 'js'} kind
 * @returns {string}
 */
export function blankComments(text, kind) {
  return kind === 'hash' ? blankHashComments(text) : blankJsComments(text);
}

function blankHashComments(text) {
  return text
    .split('\n')
    .map((line) => {
      let single = false;
      let double = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '\\' && double) {
          i++;
          continue;
        }
        if (c === "'" && !double) single = !single;
        else if (c === '"' && !single) double = !double;
        else if (c === '#' && !single && !double && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i) + ' '.repeat(line.length - i);
        }
      }
      return line;
    })
    .join('\n');
}

/** Chars after which a `/` opens a regex literal rather than dividing. */
function opensRegex(prev) {
  return prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev);
}

function blankJsComments(text) {
  const out = [...text];
  const n = text.length;
  let i = 0;
  let prev = '';
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      out[i++] = ' ';
      out[i++] = ' ';
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i++] = ' ';
        out[i++] = ' ';
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === c) {
          i++;
          break;
        }
        i++;
      }
      prev = c;
      continue;
    }
    if (c === '/' && opensRegex(prev)) {
      i++;
      let inClass = false;
      while (i < n && text[i] !== '\n') {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '[') inClass = true;
        else if (text[i] === ']') inClass = false;
        else if (text[i] === '/' && !inClass) {
          i++;
          break;
        }
        i++;
      }
      prev = '/';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/* ──────────────────────────────── matchers ────────────────────────────────── */

/** The labels endpoint, in every path spelling. `.labels` is NOT this. */
const LABELS_PATH_RE = /\/labels\b/;

/** The SDK name for the same PUT. Self-sufficient: no method slot needed. */
const SET_LABELS_RE = /\bsetLabels\b/;

/**
 * `PUT` in a METHOD SLOT. See the header for why the bare token is not enough.
 *
 * A comparison (`=== 'PUT'`, `== 'PUT'`) is deliberately excluded: that is code
 * REFUSING the verb, which is the shape of a fix, not of a defect.
 */
export const METHOD_SLOTS = [
  { name: 'curl/gh -X PUT', re: /(?:^|\s)-X[=\s]*["']?PUT\b/ },
  { name: '--request PUT', re: /--request[=\s]+["']?PUT\b/ },
  { name: '--method PUT', re: /--method[=\s]+["']?PUT\b/ },
  { name: "method: 'PUT'", re: /["']?\bmethod\b["']?\s*:\s*["']?PUT\b/ },
  { name: "method = 'PUT'", re: /\bmethod\b["']?\s*(?<![=!<>])=(?!=)\s*["']?PUT\b/ },
  { name: 'PUT route string', re: /\bPUT\s+\/[A-Za-z{$]/ },
  { name: '.put(', re: /\.put\s*\(/ }
];

function excerpt(text) {
  const trimmed = text.trim();
  return trimmed.length > 150 ? `${trimmed.slice(0, 147)}...` : trimmed;
}

/**
 * Every whole-set label write in one file's lines.
 *
 * Run over RAW lines it is the reachability probe; over comment-blanked lines
 * it is the verdict. Same function both times, on purpose: the two numbers are
 * only comparable if one matcher produced them.
 *
 * @param {string[]} lines
 * @param {string} file
 * @returns {{ file: string, line: number, rule: 'endpoint', spelling: string, partnerLine?: number, excerpt: string }[]}
 */
export function findEndpointWrites(lines, file) {
  const findings = [];
  const labelPaths = [];
  const methodHits = [];

  lines.forEach((text, index) => {
    const line = index + 1;
    if (SET_LABELS_RE.test(text)) {
      findings.push({ file, line, rule: 'endpoint', spelling: 'issues.setLabels', excerpt: excerpt(text) });
    }
    if (LABELS_PATH_RE.test(text)) labelPaths.push(line);
    for (const slot of METHOD_SLOTS) {
      if (slot.re.test(text)) {
        methodHits.push({ line, text, spelling: slot.name });
        break;
      }
    }
  });

  for (const hit of methodHits) {
    const partner = labelPaths.find((line) => Math.abs(line - hit.line) < WINDOW_LINES);
    if (partner === undefined) continue;
    findings.push({
      file,
      line: hit.line,
      rule: 'endpoint',
      spelling: hit.spelling,
      partnerLine: partner,
      excerpt: excerpt(hit.text)
    });
  }

  return findings;
}

const USES_RE = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s]+)/;

/**
 * `owner/repo` for a marketplace action, or null for a local/docker `uses:`
 * (a local composite action is scanned as a file in its own right).
 *
 * @param {string} ref
 * @returns {string | null}
 */
export function normalizeActionRef(ref) {
  if (ref.startsWith('.') || ref.startsWith('/') || ref.startsWith('docker://')) return null;
  const at = ref.indexOf('@');
  const segments = (at === -1 ? ref : ref.slice(0, at)).split('/').filter(Boolean);
  if (segments.length < 2) return null;
  return `${segments[0]}/${segments[1]}`.toLowerCase();
}

/* ───────────────────────────────── the sweep ──────────────────────────────── */

function walk(root, dir, out) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, rel, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot !== -1 && SCANNED_EXTENSIONS.has(entry.name.slice(dot))) out.push(rel);
    }
  }
}

/**
 * @param {string} root
 * @param {{ roots?: string[], allowlist?: typeof ALLOWLIST }} [options]
 */
export function sweep(root = REPO_ROOT, options = {}) {
  const roots = options.roots ?? ROOTS;
  const allowlist = options.allowlist ?? ALLOWLIST;

  const files = [];
  for (const dir of roots) walk(root, dir, files);
  files.sort();

  const findings = [];
  const exempted = [];
  let rawMentions = 0;
  let judgedMentions = 0;
  let usesPins = 0;
  const distinctActions = new Set();
  const probeHits = new Map();

  const exemptFor = (file, rule) => allowlist.find((entry) => entry.path === file && entry.rule === rule);

  for (const file of files) {
    if (RULE_OWNING_FILES.includes(file)) continue;
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }

    const rawLines = text.split('\n');
    const raw = findEndpointWrites(rawLines, file);
    rawMentions += raw.length;
    if (raw.length > 0) probeHits.set(file, raw.length);

    const executable = findEndpointWrites(blankComments(text, commentKind(file)).split('\n'), file);
    judgedMentions += executable.length;
    for (const finding of executable) {
      const entry = exemptFor(file, 'endpoint');
      if (entry) exempted.push({ ...finding, reason: entry.reason });
      else findings.push(finding);
    }

    if (!/\.ya?ml$/.test(file)) continue;
    blankComments(text, 'hash')
      .split('\n')
      .forEach((line, index) => {
        const match = USES_RE.exec(line);
        if (!match) return;
        const action = normalizeActionRef(match[1]);
        if (action === null) return;
        usesPins += 1;
        distinctActions.add(action);
        const why = WHOLE_SET_ACTIONS.get(action);
        if (why === undefined) return;
        const finding = {
          file,
          line: index + 1,
          rule: /** @type {'action'} */ ('action'),
          spelling: `uses: ${match[1]}`,
          action,
          why,
          excerpt: excerpt(line)
        };
        const entry = exemptFor(file, 'action');
        if (entry) exempted.push({ ...finding, reason: entry.reason });
        else findings.push(finding);
      });
  }

  return { files, findings, exempted, rawMentions, judgedMentions, usesPins, distinctActions, probeHits };
}

/* ───────────────────────────────── the gate ───────────────────────────────── */

const FIX =
  'use the additive verbs: POST /issues/{n}/labels to add, DELETE /issues/{n}/labels/{name} to ' +
  'remove one BY NAME. `scripts/pr-labels.mjs` is the worked example.';

/**
 * @param {string} root
 * @param {{ roots?: string[], allowlist?: typeof ALLOWLIST, probes?: typeof PROSE_PROBES }} [options]
 * @param {(s: string) => void} [log]
 * @returns {number} exit code
 */
export function run(root = REPO_ROOT, options = {}, log = console.error) {
  const roots = options.roots ?? ROOTS;
  const allowlist = options.allowlist ?? ALLOWLIST;
  const probes = options.probes ?? PROSE_PROBES;

  // Assertion 3, enforced in CI rather than only in the self-test: an exemption
  // without a stated reason is an omission wearing a decision's clothes.
  for (const [index, entry] of allowlist.entries()) {
    const where = `ALLOWLIST[${index}]`;
    if (typeof entry?.path !== 'string' || entry.path.length === 0) {
      log(`✗ check-whole-set-label-write: ${where} has no \`path\` — REFUSING to report a verdict`);
      return EXIT_REFUSED;
    }
    if (entry.rule !== 'endpoint' && entry.rule !== 'action') {
      log(`✗ check-whole-set-label-write: ${where} (${entry.path}) has no valid \`rule\` — REFUSING`);
      log("  Must be 'endpoint' or 'action'. An entry that matches no rule silences nothing and hides that it does.");
      return EXIT_REFUSED;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < MIN_REASON_LENGTH) {
      log(`✗ check-whole-set-label-write: ${where} (${entry.path}) states no reason — REFUSING`);
      log(`  An allowlist entry REQUIRES a reason of at least ${MIN_REASON_LENGTH} characters (card #10778,`);
      log('  assertion 3): a deliberate exception has to be a recorded decision, not an omission.');
      return EXIT_REFUSED;
    }
  }

  for (const dir of roots) {
    if (existsSync(join(root, dir))) continue;
    log(`✗ check-whole-set-label-write: declared root \`${dir}\` is absent — REFUSING to report a verdict`);
    log('  A verdict over the roots that DID resolve is a verdict about a population nobody configured.');
    return EXIT_REFUSED;
  }

  const result = sweep(root, { roots, allowlist });
  const census =
    `${result.files.length} file(s) over ${roots.length} root(s) · ` +
    `${result.rawMentions} raw mention(s) · ${result.rawMentions - result.judgedMentions} in comments/prose (cleared) · ` +
    `${result.judgedMentions} in EXECUTABLE content (judged) · ` +
    `${result.usesPins} \`uses:\` pin(s) over ${result.distinctActions.size} distinct action(s) judged · ` +
    `${allowlist.length} allowlist entr(ies)`;

  if (result.files.length === 0) {
    log(`✗ check-whole-set-label-write: scanned ZERO files — REFUSING (${census})`);
    return EXIT_REFUSED;
  }
  if (result.usesPins === 0) {
    log(`✗ check-whole-set-label-write: found ZERO \`uses:\` pins — REFUSING (${census})`);
    log('  A workflow corpus with no action pin in it is not this repo; the `uses:` reader is broken.');
    return EXIT_REFUSED;
  }
  for (const probe of probes) {
    if (result.probeHits.has(probe.path)) continue;
    log(`✗ check-whole-set-label-write: live probe \`${probe.path}\` no longer matches — REFUSING (${census})`);
    log(`  Declared as a positive control because: ${probe.reason}`);
    log('  Either the matcher stopped working, or that file was rewritten. A green computed by a');
    log('  matcher that reaches nothing is exactly the defect this gate exists to prevent, so it');
    log('  refuses instead. Fix the matcher, or re-point PROSE_PROBES at prose that still exists.');
    return EXIT_REFUSED;
  }

  if (result.findings.length > 0) {
    log(`✗ check-whole-set-label-write: ${result.findings.length} whole-set label write(s) — ${census}`);
    log('');
    for (const finding of result.findings) {
      log(`  ${finding.file}:${finding.line}`);
      log(`    ${finding.excerpt}`);
      if (finding.rule === 'action') {
        log(`    \`${finding.action}\` replaces the PR's WHOLE label set.`);
        log(`    ${finding.why}`);
      } else {
        const partner = finding.partnerLine === undefined ? '' : ` with the labels endpoint at line ${finding.partnerLine}`;
        log(`    ${finding.spelling}${partner} — a whole-set PUT REPLACES the label set.`);
        log('    It destroys any label that lands between the read and the write, silently.');
      }
      log(`    fix: ${FIX}`);
      log('');
    }
    log('  A deliberate exception goes in ALLOWLIST in scripts/check-whole-set-label-write.mjs,');
    log('  WITH a stated reason. ⛔ Never widen it to make a red go away.');
    return EXIT_VIOLATIONS;
  }

  const exemptNote = result.exempted.length > 0 ? ` · ${result.exempted.length} declared exception(s)` : '';
  log(`✓ check-whole-set-label-write: 0 violations — ${census}${exemptNote}`);
  if (result.judgedMentions === 0) {
    log(`  ⚠️ The EXECUTABLE population is empty: all ${result.rawMentions} mention(s) are comments, in`);
    log(`     ${result.probeHits.size} file(s) that document the ban. That zero is a MEASUREMENT, not a`);
    log('     silence — the same matcher found those mentions on this tree, and the declared probes in');
    log('     PROSE_PROBES make `run()` refuse rather than pass if it ever stops finding them.');
    log(`     The \`uses:\` limb is not vacuous: ${result.usesPins} pin(s) were judged and cleared on the rule.`);
  }
  return EXIT_CLEAN;
}

/* ──────────────────────────────────  --list ───────────────────────────────── */

function list(root = REPO_ROOT, log = console.log) {
  const result = sweep(root);
  log(`files scanned            : ${result.files.length}`);
  log(`raw mentions             : ${result.rawMentions}   (the reachability probe — mostly the prose that documents the ban)`);
  log(`  cleared as comment     : ${result.rawMentions - result.judgedMentions}`);
  log(`  JUDGED (executable)    : ${result.judgedMentions}   (the population the rule rules on)`);
  log(`\`uses:\` pins judged      : ${result.usesPins} over ${result.distinctActions.size} distinct action(s)`);
  log(`violations               : ${result.findings.length}`);
  log(`declared exceptions      : ${ALLOWLIST.length}`);
  log('');
  log('every raw mention, and how it was judged:');
  for (const [file, count] of [...result.probeHits].sort()) {
    const kind = commentKind(file);
    const text = readFileSync(join(root, file), 'utf8');
    const executable = new Set(findEndpointWrites(blankComments(text, kind).split('\n'), file).map((f) => f.line));
    for (const finding of findEndpointWrites(text.split('\n'), file)) {
      log(`  ${executable.has(finding.line) ? 'JUDGED' : 'comment'} ${file}:${finding.line}  ${finding.spelling}`);
    }
    if (count === 0) log(`  (none) ${file}`);
  }
  log('');
  log('distinct actions pinned anywhere in the workflows:');
  for (const action of [...result.distinctActions].sort()) {
    log(`  ${WHOLE_SET_ACTIONS.has(action) ? 'BANNED ' : 'clear  '} ${action}`);
  }
}

/* ─────────────────────────────── --self-test ──────────────────────────────── */
// Fixture trees on disk, driven through the REAL sweep and the REAL run(), so
// what is proven red is the walk, the comment blanker, the matchers, the `uses:`
// reader and the verdict together. A predicate called with a string proves none
// of that.

/** The documenting prose both live probes carry. Kept verbatim-ish so the fixtures exercise the real shapes. */
const PROBE_PROSE_YAML = [
  '# LABEL WRITES IN THIS FILE ARE ADDITIVE.',
  '#   POST   /issues/{n}/labels          adds the named labels',
  '#   PUT    /issues/{n}/labels          replaces the whole set -- DESTRUCTIVE',
  '#   * codelytv/pr-size-labeler -- `curl -X PUT .../issues/$pr_number/labels`',
  '#   * actions/labeler -- calls `client.rest.issues.setLabels`, which IS the PUT.'
].join('\n');

const PROBE_PROSE_JS = [
  '/**',
  ' * `PUT /issues/{n}/labels` REPLACES a PR whole label set.',
  ' *   * codelytv -- `curl -X PUT .../issues/$pr_number/labels` with the whole set.',
  ' *   * actions/labeler -- `client.rest.issues.setLabels` -- which IS the PUT.',
  ' */',
  "const FORBIDDEN_VERB = 'PUT';",
  'export const plan = [{ method: FORBIDDEN_VERB, path: `/issues/${n}/labels` }];',
  "check('the retired whole-set PUT destroys the concurrent label', plan);"
].join('\n');

/** A workflow with real `uses:` pins, so the `uses:` census is never zero. */
const BASE_WORKFLOW = ['jobs:', '  build:', '    steps:', '      - uses: actions/checkout@v7', '      - uses: actions/setup-node@v7'].join('\n');

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
}

/** The base tree every case starts from: all roots present, both probes matching. */
function baseFiles() {
  return {
    '.github/workflows/pr-automation.yml': `${PROBE_PROSE_YAML}\n${BASE_WORKFLOW}\n`,
    '.github/workflows/other.yml': `${BASE_WORKFLOW}\n`,
    '.github/actions/setup-pnpm/action.yml': 'name: setup\nruns:\n  using: composite\n  steps:\n    - uses: pnpm/action-setup@v6\n',
    'scripts/pr-labels.mjs': `${PROBE_PROSE_JS}\n`
  };
}

/** Every spelling that MUST be refused. */
export const RED_CASES = {
  'curl -X PUT, one line': {
    'scripts/writer.sh': 'curl -X PUT -H "auth" "https://api.github.com/repos/o/r/issues/1/labels" -d "{}"\n'
  },
  'curl -X PUT, backslash-continued onto the path line': {
    'scripts/writer.sh': 'curl -X PUT \\\n  -H "auth" \\\n  "https://api.github.com/repos/o/r/issues/1/labels"\n'
  },
  'gh api -X PUT': {
    '.github/workflows/w.yml': 'jobs:\n  j:\n    steps:\n      - run: gh api -X PUT "repos/$R/issues/$N/labels" -f labels[]=a\n'
  },
  'gh api --method PUT': {
    '.github/workflows/w.yml': 'jobs:\n  j:\n    steps:\n      - run: gh api --method PUT repos/o/r/issues/1/labels\n'
  },
  'github-script issues.setLabels': {
    '.github/workflows/w.yml':
      'jobs:\n  j:\n    steps:\n      - uses: actions/github-script@v9\n        with:\n          script: |\n' +
      '            await github.rest.issues.setLabels({ owner, repo, issue_number: 1, labels });\n'
  },
  'octokit.request route string': {
    'scripts/w.mjs': "await octokit.request('PUT /repos/{owner}/{repo}/issues/{issue_number}/labels', { labels });\n"
  },
  'fetch with a multi-line options object': {
    'scripts/w.mjs': 'await fetch(`${api}/repos/${repo}/issues/${n}/labels`, {\n  headers,\n  method: "PUT",\n  body\n});\n'
  },
  'a bare .put( onto the endpoint': {
    'scripts/w.mjs': "await client.put(`/issues/${n}/labels`, { labels });\n"
  },
  'uses: actions/labeler at the version #10703 read': {
    '.github/workflows/w.yml': 'jobs:\n  j:\n    steps:\n      - uses: actions/labeler@v7.0.0\n'
  },
  'uses: actions/labeler at ANY other version': {
    '.github/workflows/w.yml': 'jobs:\n  j:\n    steps:\n      - uses: actions/labeler@a1b2c3d4\n'
  },
  'uses: codelytv/pr-size-labeler': {
    '.github/workflows/w.yml': 'jobs:\n  j:\n    steps:\n      - uses: codelytv/pr-size-labeler@v1.10.4\n'
  },
  'the method slot WINDOW_LINES-1 lines from the path': {
    'scripts/w.mjs': `const url = '/issues/1/labels';\n${'// filler\n'.repeat(WINDOW_LINES - 2)}await go({ method: 'PUT', url });\n`
  }
};

/** Forms that MUST stay clean. Every one is correct as written. */
export const GREEN_CASES = {
  'the additive POST': {
    'scripts/w.mjs': "await gh('POST', `/issues/${n}/labels`, { labels: ['size/l'] });\n"
  },
  'the targeted DELETE': {
    'scripts/w.mjs': "await gh('DELETE', `/issues/${n}/labels/${encodeURIComponent(name)}`);\n"
  },
  'the ban documented in a YAML comment': {
    '.github/workflows/w.yml': '# never `curl -X PUT .../issues/1/labels`, and never issues.setLabels\njobs:\n  j:\n    steps:\n      - run: true\n'
  },
  'the ban documented in a JS block comment': {
    'scripts/w.mjs': '/**\n * `PUT /issues/{n}/labels` and `issues.setLabels` are both banned.\n * Not `curl -X PUT .../issues/1/labels` either.\n */\nexport const ok = 1;\n'
  },
  'the ban documented in a JS line comment': {
    'scripts/w.mjs': "// await octokit.request('PUT /repos/o/r/issues/1/labels') -- BANNED\nexport const ok = 1;\n"
  },
  'a comparison REFUSING the verb': {
    'scripts/w.mjs': "if (step.method === 'PUT') throw new Error(`refused for /issues/${n}/labels`);\n"
  },
  'the verb named in a test name next to a labels path': {
    'scripts/w.mjs': "const plan = { path: '/issues/10698/labels' };\ncheck('the retired whole-set PUT destroys the label', plan);\n"
  },
  'an unrelated action pin': {
    '.github/workflows/w.yml': 'jobs:\n  j:\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/stale@v11.0.0\n'
  },
  'a PUT to a different endpoint entirely': {
    'scripts/w.mjs': "await gh('PUT', `/repos/${repo}/actions/variables/${name}`);\n"
  },
  'a label READ, no write': {
    '.github/workflows/w.yml': 'jobs:\n  j:\n    steps:\n      - run: gh api "repos/$R/issues/$N/labels" --jq ".[].name"\n'
  },
  'steps.labels output references': {
    '.github/workflows/w.yml': "jobs:\n  j:\n    steps:\n      - if: steps.labels.outputs.skip != 'true'\n        run: true\n"
  },
  'the method slot WINDOW_LINES lines from the path (a STATED miss)': {
    'scripts/w.mjs': `const url = '/issues/1/labels';\n${'// filler\n'.repeat(WINDOW_LINES - 1)}await go({ method: 'PUT', url });\n`
  }
};

function withTree(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'os-wholeset-'));
  try {
    writeTree(dir, { ...baseFiles(), ...files });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function selfTest() {
  const failures = [];
  const silent = () => {};

  const expect = (label, actual, wanted) => {
    if (actual === wanted) return;
    failures.push(`${label}: expected ${wanted}, got ${actual}`);
  };

  for (const [label, files] of Object.entries(RED_CASES)) {
    withTree(files, (dir) => {
      expect(`RED   ${label}`, run(dir, {}, silent), EXIT_VIOLATIONS);
    });
  }

  for (const [label, files] of Object.entries(GREEN_CASES)) {
    withTree(files, (dir) => {
      expect(`GREEN ${label}`, run(dir, {}, silent), EXIT_CLEAN);
    });
  }

  // The base tree alone must be CLEAN. Paired with every refusal case below, so
  // "refuses unconditionally" cannot satisfy this battery.
  withTree({}, (dir) => expect('CONTROL base tree is clean', run(dir, {}, silent), EXIT_CLEAN));

  // Refusal 1 -- a declared root that is not there.
  withTree({}, (dir) => {
    rmSync(join(dir, '.github/actions'), { recursive: true, force: true });
    expect('REFUSE missing root', run(dir, {}, silent), EXIT_REFUSED);
  });

  // Refusal 2 -- a live probe that stopped matching (the matcher went dark).
  withTree({ 'scripts/pr-labels.mjs': 'export const ok = 1;\n' }, (dir) => {
    expect('REFUSE probe stopped matching', run(dir, {}, silent), EXIT_REFUSED);
  });

  // Refusal 3 -- an allowlist entry with no stated reason. Assertion 3.
  withTree(RED_CASES['gh api -X PUT'], (dir) => {
    const noReason = [{ path: '.github/workflows/w.yml', rule: 'endpoint', reason: 'too short' }];
    expect('REFUSE allowlist entry without a reason', run(dir, { allowlist: noReason }, silent), EXIT_REFUSED);
    const noRule = [{ path: '.github/workflows/w.yml', rule: 'whatever', reason: 'a'.repeat(MIN_REASON_LENGTH) }];
    expect('REFUSE allowlist entry with no valid rule', run(dir, { allowlist: noRule }, silent), EXIT_REFUSED);
  });

  // Refusal 4 -- a corpus with no `uses:` pin at all is not this repo.
  withTree({ '.github/workflows/pr-automation.yml': `${PROBE_PROSE_YAML}\n`, '.github/workflows/other.yml': 'on: push\n' }, (dir) => {
    rmSync(join(dir, '.github/actions/setup-pnpm/action.yml'), { force: true });
    mkdirSync(join(dir, '.github/actions/keep'), { recursive: true });
    expect('REFUSE zero uses: pins', run(dir, {}, silent), EXIT_REFUSED);
  });

  // A REASONED allowlist entry does clear a real violation -- the hatch works.
  withTree(RED_CASES['gh api -X PUT'], (dir) => {
    const reasoned = [
      {
        path: '.github/workflows/w.yml',
        rule: /** @type {'endpoint'} */ ('endpoint'),
        reason: 'fixture: a deliberate exception recorded with a real sentence explaining itself.'
      }
    ];
    expect('ALLOWLIST with a reason clears the finding', run(dir, { allowlist: reasoned }, silent), EXIT_CLEAN);
  });

  // The rule-owning list is exactly one entry -- it must not become a second allowlist.
  expect('RULE_OWNING_FILES is pinned at one entry', RULE_OWNING_FILES.length, 1);
  expect('RULE_OWNING_FILES names this file', RULE_OWNING_FILES[0], 'scripts/check-whole-set-label-write.mjs');

  // Both banned actions carry a source-read reason, so the roster cannot grow by rumour.
  for (const [action, why] of WHOLE_SET_ACTIONS) {
    if (typeof why === 'string' && why.length >= 60) continue;
    failures.push(`WHOLE_SET_ACTIONS['${action}'] has no source-read reason`);
  }

  // The checked-in allowlist itself passes the reason rule.
  for (const [index, entry] of ALLOWLIST.entries()) {
    if (typeof entry.reason === 'string' && entry.reason.trim().length >= MIN_REASON_LENGTH) continue;
    failures.push(`ALLOWLIST[${index}] (${entry.path}) states no reason`);
  }

  if (failures.length > 0) {
    console.error(`\n✗ check-whole-set-label-write --self-test -- ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error('');
    return 1;
  }
  const cases = Object.keys(RED_CASES).length + Object.keys(GREEN_CASES).length;
  console.log(`✓ check-whole-set-label-write --self-test: all cases pass (${cases} fixture trees + 5 refusals + 1 allowlist hatch)`);
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  else if (argv.includes('--list')) list();
  else process.exit(run());
}

#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pr-labels (#10703) -- this repo's automation writes a PR's labels
 * ADDITIVELY, and never as a whole set.
 *
 *   node scripts/pr-labels.mjs --self-test   # prove the matcher, the bucketer
 *                                            #   and the write PLANS (lint + CI)
 *   node scripts/pr-labels.mjs --size        # write this PR's size/* label
 *   node scripts/pr-labels.mjs --paths       # write this PR's path labels
 *   node scripts/pr-labels.mjs --size --dry-run   # print the plan, write nothing
 *
 * ## The defect this replaces
 *
 * `PUT /issues/{n}/labels` REPLACES a PR's whole label set. Every whole-set
 * write is therefore a read-modify-write across a network round trip, and any
 * label that lands between the read and the PUT is destroyed -- silently, with
 * an `unlabeled` event nobody is watching for.
 *
 * Both label writers this file replaces did exactly that, read out of their
 * pinned sources rather than inferred from their docs:
 *
 *   * codelytv/pr-size-labeler@v1.10.4 -- src/github.sh:68-91
 *     (`github::add_label_to_pr`): GETs the PR, greps its OWN size family out
 *     of the result, appends the new size label, then
 *     `curl -X PUT .../issues/$pr_number/labels` with the whole set. No
 *     mitigation of any kind: the window is the entire round trip.
 *   * actions/labeler@v7.0.0 -- src/labeler.ts:56,111-133 plus
 *     src/api/set-labels.ts: snapshots `preexistingLabels` at run start, unions
 *     in the config matches, re-reads the live label list once and carries
 *     forward whatever appeared in between, then calls
 *     `client.rest.issues.setLabels` -- which IS the PUT. The re-read NARROWS
 *     the window to [re-read .. PUT]; it does not close it.
 *
 * Measured loss on PR #10698 (timeline API, `labeled`/`unlabeled` events):
 *
 *   09:05:29Z  labeled    skip-changeset  claude[bot]          (additive POST, HTTP 200)
 *   09:05:30Z  unlabeled  skip-changeset  github-actions[bot]  <-- the size labeler's PUT
 *   09:05:30Z  labeled    size/l          github-actions[bot]
 *   09:05:42Z  labeled    ci/cd           github-actions[bot]
 *   09:06:03Z  labeled    skip-changeset  claude[bot]          (re-applied after read-back)
 *
 * `skip-changeset` is the exemption for a PR that publishes nothing, so its
 * erasure makes `changeset-check` demand a changeset from a PR that
 * legitimately has none. The same shape cost #5533 its exemption too, that time
 * to the path labeler's PUT of `{size/m, tests}`.
 *
 * ## The fix, and why it is a fix rather than a narrowing
 *
 * Only three label verbs exist, and exactly one of them is destructive:
 *
 *   POST   /issues/{n}/labels          adds the named labels. Touches nothing else.
 *   DELETE /issues/{n}/labels/{name}   removes ONE label, BY NAME.
 *   PUT    /issues/{n}/labels          replaces the whole set. Destructive.
 *
 * Neither POST nor DELETE carries a label this writer does not name, so neither
 * can destroy a concurrent writer's label -- at any interleaving, with no
 * ordering constraint between the writers, and with no window to narrow. That
 * is the difference between this and every configuration change that came
 * before it: correctness here does not depend on timing at all.
 *
 * The plan builders below are PURE and are asserted by `--self-test` to emit
 * only POST and DELETE. That assertion is the contract this file exists for; if
 * a future edit reaches for a whole-set write, the self-test goes red before
 * the write ever reaches a PR.
 *
 * ## What is deliberately preserved from the retired actions
 *
 *   * The size buckets compare with `<`, NOT `<=` -- `labeler.sh:50-60` uses
 *     `[ "$total" -lt "$max" ]`. A 10-line PR is `size/s`, not `size/xs`. The
 *     thresholds arrive in the same env names the action's inputs used, so the
 *     workflow diff is auditable value-for-value.
 *   * `files_to_ignore` is a space-separated list matched against the WHOLE
 *     path, the way `[[ $filename == $pattern ]]` did in github.sh:36.
 *   * Path labels are never removed, matching `sync-labels: false`. The path
 *     half issues POST only -- it has no DELETE at all.
 *   * The size family IS owned by this writer, so a stale `size/*` is removed
 *     by a targeted DELETE naming exactly that label. codelytv did the same
 *     thing by grepping the family out of its PUT payload; the difference is
 *     that its version also carried -- and could drop -- every bystander label.
 *
 * One behaviour deliberately DIVERGES: github.sh:23 reads
 * `pulls/{n}/files?per_page=100` and never paginates ("NOTE: this code is not
 * resilient to changes w/ > 100 files"), so a 400-file PR was sized off its
 * first 100 files. This paginates. A PR over 100 files may therefore get a
 * larger, and correct, size label than it used to.
 *
 * ## The labeler.yml subset, and why unsupported syntax is a hard error
 *
 * `actions/labeler` evaluates `.github/labeler.yml` with minimatch. This does
 * not embed minimatch (the job that runs it does a bare checkout and installs
 * no dependencies), so it implements the subset the config actually uses and
 * REFUSES everything else with a non-zero exit. Silent mis-evaluation of a
 * pattern nobody re-read is the failure mode worth engineering against: a
 * refusal is a red job with the offending line quoted, while a permissive
 * matcher that guesses wrong just mislabels PRs forever.
 *
 * Supported: `*`, `?`, `**` as a whole path segment, and literals -- with
 * `dot: true` semantics, which is what actions/labeler v7 defaults to
 * (action.yml `dot: default true`), so no dotfile special case exists.
 * Refused: brace expansion, character classes, extglob, and negation.
 * Refused config keys: anything but `changed-files` / `any-glob-to-any-file`.
 *
 * `--self-test` parses the REAL checked-in `.github/labeler.yml`, so a config
 * that drifts outside the subset fails the lint gate rather than a PR run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = new URL('..', import.meta.url);
const DEFAULT_LABELER_CONFIG = fileURLToPath(new URL('.github/labeler.yml', REPO_ROOT));

/** The one verb this file must never emit. Named once so the self-test can quote it. */
const FORBIDDEN_VERB = 'PUT';

class ConfigError extends Error {}

// ---------------------------------------------------------------------------
// Glob matching -- the minimatch subset, with `dot: true` semantics.
// ---------------------------------------------------------------------------

/**
 * Characters that mean something to minimatch and nothing here. Refusing them
 * is the whole point: see the header. `\\` is refused too, because a pattern
 * that escapes a metacharacter is a pattern that expected the metacharacter to
 * be live.
 */
const REFUSED_GLOB_CHARS = new Set(['{', '}', '[', ']', '(', ')', '!', '+', '@', '|', '\\']);

/** Regex-special characters that survive as literals in a glob segment. */
const REGEX_SPECIALS = /[.^$]/g;

/**
 * Compile ONE path segment (no `/`) to a regular expression source.
 * Throws ConfigError on any syntax outside the supported subset.
 */
export function segmentToRegExpSource(segment, pattern) {
  let source = '';
  for (const ch of segment) {
    if (REFUSED_GLOB_CHARS.has(ch)) {
      throw new ConfigError(
        `glob '${pattern}' uses '${ch}', which is minimatch syntax this repo's ` +
          `label matcher does not implement (see scripts/pr-labels.mjs). ` +
          `Rewrite the pattern with only '*', '?', '**' and literals, or extend the matcher.`
      );
    }
    if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += ch.replace(REGEX_SPECIALS, (c) => `\\${c}`);
  }
  return source;
}

/**
 * Match one POSIX-ish path against one glob.
 *
 * `**` is only special as a WHOLE segment, where it matches zero or more path
 * segments. So the pattern `content/` + `**` + `/` + `*` matches `content/a.md`
 * (zero segments) as well as `content/a/b.md`, and a leading `**` segment lets
 * the pattern `**` + `/` + `*.md` match a root-level `README.md`. That
 * zero-segment case is the one a naive implementation gets wrong, and it is
 * pinned in the self-test. (Those patterns are spelled as concatenations
 * because the literal sequence would close this comment block -- do NOT
 * "fix" it with an invisible separator character, which is unsearchable.)
 */
export function matchGlob(pattern, filePath) {
  const pat = pattern.split('/');
  const parts = filePath.split('/');

  // Compile once per call site; patterns are few and paths are many, so the
  // cache below keeps this from recompiling per file.
  const compiled = pat.map((seg) => (seg === '**' ? '**' : new RegExp(`^${segmentToRegExpSource(seg, pattern)}$`)));

  const seen = new Set();
  const walk = (i, j) => {
    const key = i * (parts.length + 1) + j;
    if (seen.has(key)) return false;
    seen.add(key);

    if (i === compiled.length) return j === parts.length;
    if (compiled[i] === '**') {
      for (let k = j; k <= parts.length; k += 1) {
        if (walk(i + 1, k)) return true;
      }
      return false;
    }
    if (j === parts.length) return false;
    if (!compiled[i].test(parts[j])) return false;
    return walk(i + 1, j + 1);
  };

  return walk(0, 0);
}

// ---------------------------------------------------------------------------
// Size bucketing -- codelytv/pr-size-labeler src/labeler.sh:50-60, verbatim.
// ---------------------------------------------------------------------------

/**
 * @param {number} total additions + deletions across the non-ignored files
 * @param {Array<{max: number|null, label: string}>} buckets ordered ascending;
 *        the final entry carries `max: null` and is the fallthrough (xl).
 */
export function sizeLabelFor(total, buckets) {
  for (const bucket of buckets) {
    // `-lt`, not `-le`. A PR of exactly `xs_max_size` lines is NOT xs.
    if (bucket.max !== null && total < bucket.max) return bucket.label;
  }
  const fallthrough = buckets[buckets.length - 1];
  if (!fallthrough || fallthrough.max !== null) {
    throw new ConfigError('size buckets must end with a max-less fallthrough bucket');
  }
  return fallthrough.label;
}

/** Total modifications, mirroring github.sh:5-52 with pagination added. */
export function totalModifications(files, filesToIgnore) {
  let total = 0;
  for (const file of files) {
    const ignored = filesToIgnore.some((pattern) => matchGlob(pattern, file.filename));
    if (ignored) continue;
    total += (file.additions ?? 0) + (file.deletions ?? 0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// The labeler.yml subset parser.
// ---------------------------------------------------------------------------

const SUPPORTED_MATCHER = 'any-glob-to-any-file';
const SUPPORTED_SELECTOR = 'changed-files';

/** Strip one layer of matching quotes from a scalar, if present. */
function unquote(raw) {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    if ((first === "'" || first === '"') && value[value.length - 1] === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse the labeler config into `Map<label, string[]>` of globs.
 *
 * A restricted, line-oriented reader for exactly the shape this repo's config
 * uses. Every line it does not recognise is a hard error naming the line
 * number -- see the header for why guessing is the worse failure.
 */
export function parseLabelerConfig(text, source = '<config>') {
  const labels = new Map();
  let current = null;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const where = `${source}:${i + 1}`;
    const withoutComment = line.replace(/^\s*#.*$/, '');
    if (withoutComment.trim() === '') continue;

    const indent = line.length - line.trimStart().length;
    const body = line.trim();

    if (indent === 0) {
      const m = /^(.+?):$/.exec(body);
      if (!m) throw new ConfigError(`${where}: expected a top-level '<label>:' entry, got: ${line}`);
      const label = unquote(m[1]);
      if (labels.has(label)) throw new ConfigError(`${where}: duplicate label '${label}'`);
      current = [];
      labels.set(label, current);
      continue;
    }

    if (current === null) throw new ConfigError(`${where}: indented line before any label: ${line}`);

    if (body === `- ${SUPPORTED_SELECTOR}:`) continue;
    if (body === `- ${SUPPORTED_MATCHER}:`) continue;

    if (/^-\s*[a-z-]+:$/.test(body)) {
      const key = /^-\s*([a-z-]+):$/.exec(body)[1];
      throw new ConfigError(
        `${where}: key '${key}' is not implemented by this repo's label matcher ` +
          `(scripts/pr-labels.mjs supports '${SUPPORTED_SELECTOR}' and '${SUPPORTED_MATCHER}' only). ` +
          `Extend the matcher before using it, so the label it produces is the label CI computes.`
      );
    }

    const globMatch = /^-\s+(.+)$/.exec(body);
    if (!globMatch) throw new ConfigError(`${where}: expected a '- <glob>' list item, got: ${line}`);
    const glob = unquote(globMatch[1]);
    if (glob === '') throw new ConfigError(`${where}: empty glob`);
    // Compile eagerly so an unsupported pattern is refused HERE, naming its
    // line, rather than at match time against some incidental file path.
    for (const segment of glob.split('/')) {
      if (segment !== '**') segmentToRegExpSource(segment, glob);
    }
    current.push(glob);
  }

  for (const [label, globs] of labels) {
    if (globs.length === 0) throw new ConfigError(`${source}: label '${label}' declares no globs`);
  }
  return labels;
}

/** The labels whose config matches at least one changed file. */
export function labelsForFiles(config, filenames) {
  const matched = [];
  for (const [label, globs] of config) {
    if (globs.some((glob) => filenames.some((name) => matchGlob(glob, name)))) matched.push(label);
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Write PLANS. Pure functions -- this is the part the self-test pins.
// ---------------------------------------------------------------------------

/**
 * @returns {Array<{method: 'POST'|'DELETE', path: string, body?: object, why: string}>}
 */
export function planSizeWrites({ prNumber, target, family, current }) {
  const plan = [];
  const present = new Set(current);

  // POST FIRST, DELETE SECOND, and the order is load-bearing: reversed, the PR
  // spends the gap between the two calls with NO size label, and a failure
  // between them leaves it that way until the next push. This way the correct
  // label is on the PR before anything is taken off it.
  if (!present.has(target)) {
    plan.push({
      method: 'POST',
      path: `/issues/${prNumber}/labels`,
      body: { labels: [target] },
      why: `add the computed size label '${target}'`
    });
  }

  for (const label of family) {
    if (label !== target && present.has(label)) {
      plan.push({
        method: 'DELETE',
        path: `/issues/${prNumber}/labels/${encodeURIComponent(label)}`,
        why: `retire the stale size label '${label}' -- named explicitly, so no bystander label is at risk`
      });
    }
  }
  return plan;
}

/** Path labels are add-only: `sync-labels: false` never removed one. */
export function planPathWrites({ prNumber, matched, current }) {
  const present = new Set(current);
  const toAdd = matched.filter((label) => !present.has(label));
  if (toAdd.length === 0) return [];
  return [
    {
      method: 'POST',
      path: `/issues/${prNumber}/labels`,
      body: { labels: toAdd },
      why: `add path label(s) ${toAdd.join(', ')}`
    }
  ];
}

// ---------------------------------------------------------------------------
// GitHub REST plumbing.
// ---------------------------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`pr-labels: ${name} is required but empty.`);
    process.exit(1);
  }
  return value;
}

async function ghRequest(method, path, body) {
  const apiUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const repo = requireEnv('GITHUB_REPOSITORY');
  const token = requireEnv('GITHUB_TOKEN');
  const url = `${apiUrl}/repos/${repo}${path}`;

  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });

      // A DELETE of a label a concurrent writer already removed is a 404, and
      // it is a SUCCESS for our purposes: the post-condition we wanted (that
      // label is not on this PR) holds. Retrying or failing here would turn a
      // benign interleaving into a red job.
      if (method === 'DELETE' && response.status === 404) return null;

      if (response.ok) return response.status === 204 ? null : await response.json();

      const text = await response.text();
      lastError = new Error(`${method} ${url} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
      // 4xx other than 429 will not get better by trying again.
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
  }
  throw lastError ?? new Error(`${method} ${url} failed`);
}

async function listPullFiles(prNumber) {
  const files = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await ghRequest('GET', `/pulls/${prNumber}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files;
}

async function listCurrentLabels(prNumber) {
  const labels = await ghRequest('GET', `/issues/${prNumber}/labels?per_page=100`);
  return Array.isArray(labels) ? labels.map((l) => l.name) : [];
}

async function runPlan(plan, dryRun) {
  if (plan.length === 0) {
    console.log('pr-labels: nothing to write.');
    return;
  }
  for (const step of plan) {
    if (step.method === FORBIDDEN_VERB) {
      // Unreachable via the builders above; this is the runtime half of the
      // invariant the self-test asserts statically.
      throw new Error(`pr-labels: refusing to issue a whole-set ${FORBIDDEN_VERB} (${step.path}).`);
    }
    console.log(`pr-labels: ${step.method} ${step.path} -- ${step.why}`);
    if (!dryRun) await ghRequest(step.method, step.path, step.body);
  }
}

// ---------------------------------------------------------------------------
// Modes.
// ---------------------------------------------------------------------------

function sizeBucketsFromEnv() {
  const buckets = [
    { max: Number(requireEnv('XS_MAX_SIZE')), label: requireEnv('XS_LABEL') },
    { max: Number(requireEnv('S_MAX_SIZE')), label: requireEnv('S_LABEL') },
    { max: Number(requireEnv('M_MAX_SIZE')), label: requireEnv('M_LABEL') },
    { max: Number(requireEnv('L_MAX_SIZE')), label: requireEnv('L_LABEL') },
    { max: null, label: requireEnv('XL_LABEL') }
  ];
  for (const bucket of buckets) {
    if (bucket.max !== null && !Number.isFinite(bucket.max)) {
      throw new ConfigError(`size threshold for '${bucket.label}' is not a number`);
    }
  }
  return buckets;
}

async function runSize(dryRun) {
  const prNumber = requireEnv('PR_NUMBER');
  const buckets = sizeBucketsFromEnv();
  const filesToIgnore = (process.env.FILES_TO_IGNORE || '').split(/\s+/).filter(Boolean);

  const files = await listPullFiles(prNumber);
  const total = totalModifications(files, filesToIgnore);
  const target = sizeLabelFor(total, buckets);
  console.log(
    `pr-labels: ${files.length} changed file(s); ` +
      `total modifications (additions + deletions, ignoring ${filesToIgnore.join(' ') || '(none)'}): ${total} -> ${target}`
  );

  const current = await listCurrentLabels(prNumber);
  console.log(`pr-labels: labels on PR #${prNumber} right now: ${current.join(', ') || '(none)'}`);
  const plan = planSizeWrites({
    prNumber,
    target,
    family: buckets.map((b) => b.label),
    current
  });
  await runPlan(plan, dryRun);
}

async function runPaths(dryRun) {
  const prNumber = requireEnv('PR_NUMBER');
  const configPath = process.env.LABELER_CONFIG || DEFAULT_LABELER_CONFIG;
  const config = parseLabelerConfig(readFileSync(configPath, 'utf8'), configPath);

  const files = await listPullFiles(prNumber);
  const filenames = files.map((f) => f.filename);
  const matched = labelsForFiles(config, filenames);
  console.log(`pr-labels: ${filenames.length} changed file(s) match: ${matched.join(', ') || '(none)'}`);

  const current = await listCurrentLabels(prNumber);
  console.log(`pr-labels: labels on PR #${prNumber} right now: ${current.join(', ') || '(none)'}`);
  await runPlan(planPathWrites({ prNumber, matched, current }), dryRun);
}

// ---------------------------------------------------------------------------
// Self-test.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
  };
  const throws = (name, fn, needle) => {
    try {
      fn();
      failures.push(`${name}: expected a ConfigError, none thrown`);
    } catch (error) {
      if (!(error instanceof ConfigError)) failures.push(`${name}: threw ${error.name}, expected ConfigError`);
      else if (needle && !error.message.includes(needle)) {
        failures.push(`${name}: message did not mention '${needle}': ${error.message}`);
      }
    }
  };

  // --- glob matching, including the zero-segment `**` case -----------------
  check('** matches zero segments', matchGlob('content/**/*', 'content/a.md'), true);
  check('** matches many segments', matchGlob('content/**/*', 'content/a/b/c.md'), true);
  check('** does not match the bare prefix', matchGlob('content/**/*', 'content'), false);
  check('leading ** matches a root file', matchGlob('**/*.md', 'README.md'), true);
  check('leading ** matches a nested file', matchGlob('**/*.md', 'a/b/README.md'), true);
  check('dot dirs match (dot:true)', matchGlob('**/*.md', '.github/NOTES.md'), true);
  check('* does not cross a separator', matchGlob('packages/*', 'packages/spec/src/x.ts'), false);
  check('? matches one char', matchGlob('a?.ts', 'ab.ts'), true);
  check('? does not match two', matchGlob('a?.ts', 'abc.ts'), false);
  check('a literal dot is literal', matchGlob('package.json', 'packageXjson'), false);
  check('extension anchoring', matchGlob('**/*.test.ts', 'packages/core/src/a.test.ts'), true);
  check('extension anchoring rejects', matchGlob('**/*.test.ts', 'packages/core/src/a.testXts'), false);
  check('exact root file', matchGlob('pnpm-lock.yaml', 'pnpm-lock.yaml'), true);
  check('exact root file is not a suffix match', matchGlob('pnpm-lock.yaml', 'packages/x/pnpm-lock.yaml'), false);

  throws('brace expansion is refused', () => matchGlob('src/*.{ts,js}', 'src/a.ts'), '{');
  throws('character class is refused', () => matchGlob('src/[ab].ts', 'src/a.ts'), '[');
  throws('negation is refused', () => matchGlob('!src/a.ts', 'src/a.ts'), '!');
  throws('extglob is refused', () => matchGlob('src/+(a|b).ts', 'src/a.ts'), '+');

  // --- size bucketing: `<`, not `<=` --------------------------------------
  const buckets = [
    { max: 10, label: 'size/xs' },
    { max: 100, label: 'size/s' },
    { max: 500, label: 'size/m' },
    { max: 1000, label: 'size/l' },
    { max: null, label: 'size/xl' }
  ];
  check('0 lines', sizeLabelFor(0, buckets), 'size/xs');
  check('9 lines', sizeLabelFor(9, buckets), 'size/xs');
  check('10 lines is s, not xs', sizeLabelFor(10, buckets), 'size/s');
  check('99 lines', sizeLabelFor(99, buckets), 'size/s');
  check('100 lines is m', sizeLabelFor(100, buckets), 'size/m');
  check('499 lines', sizeLabelFor(499, buckets), 'size/m');
  check('500 lines is l', sizeLabelFor(500, buckets), 'size/l');
  check('999 lines', sizeLabelFor(999, buckets), 'size/l');
  check('1000 lines is xl', sizeLabelFor(1000, buckets), 'size/xl');

  check(
    'ignored files do not count',
    totalModifications(
      [
        { filename: 'pnpm-lock.yaml', additions: 900, deletions: 900 },
        { filename: 'packages/spec/src/a.ts', additions: 3, deletions: 4 }
      ],
      ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']
    ),
    7
  );

  // --- the write plans: POST and DELETE only ------------------------------
  const sizePlan = planSizeWrites({
    prNumber: 42,
    target: 'size/l',
    family: ['size/xs', 'size/s', 'size/m', 'size/l', 'size/xl'],
    current: ['skip-changeset', 'size/m', 'ci/cd']
  });
  check('size plan verbs', sizePlan.map((s) => s.method), ['POST', 'DELETE']);
  check('size plan adds the target additively', sizePlan[0].path, '/issues/42/labels');
  check('size plan POST body carries ONLY the target', sizePlan[0].body, { labels: ['size/l'] });
  check('size plan deletes the stale label BY NAME', sizePlan[1].path, '/issues/42/labels/size%2Fm');
  check(
    'size plan never names a bystander label',
    sizePlan.some((s) => JSON.stringify(s).includes('skip-changeset')),
    false
  );
  check(
    'size plan is a no-op when the label is already right',
    planSizeWrites({ prNumber: 42, target: 'size/l', family: ['size/l', 'size/m'], current: ['size/l'] }),
    []
  );

  const pathPlan = planPathWrites({ prNumber: 42, matched: ['ci/cd', 'tooling'], current: ['ci/cd', 'skip-changeset'] });
  check('path plan verbs', pathPlan.map((s) => s.method), ['POST']);
  check('path plan adds only what is missing', pathPlan[0].body, { labels: ['tooling'] });
  check(
    'path plan is a no-op when nothing is new',
    planPathWrites({ prNumber: 42, matched: ['ci/cd'], current: ['ci/cd'] }),
    []
  );

  // The invariant this whole file exists to hold. Every plan any input can
  // produce must be free of the destructive verb.
  const everyPlan = [
    ...sizePlan,
    ...pathPlan,
    ...planSizeWrites({ prNumber: 1, target: 'size/xs', family: ['size/xs', 'size/xl'], current: ['size/xl', 'x'] }),
    ...planPathWrites({ prNumber: 1, matched: ['a', 'b'], current: [] })
  ];
  check(
    `no plan emits a whole-set ${FORBIDDEN_VERB}`,
    everyPlan.filter((s) => s.method === FORBIDDEN_VERB),
    []
  );
  check(
    'every planned path is scoped to this PR',
    everyPlan.every((s) => /^\/issues\/\d+\/labels(\/|$)/.test(s.path)),
    true
  );

  // --- the #10698 interleaving, replayed ----------------------------------
  // The defect as a TEST rather than a paragraph. `applyPlan` models what the
  // three verbs do to a label set server-side; the PUT branch exists only so
  // the retired behaviour can be replayed next to the new one.
  const applyPlan = (labels, plan) => {
    let set = [...labels];
    for (const step of plan) {
      if (step.method === 'POST') set = [...new Set([...set, ...step.body.labels])];
      else if (step.method === 'DELETE') {
        const name = decodeURIComponent(step.path.slice(step.path.indexOf('/labels/') + '/labels/'.length));
        set = set.filter((l) => l !== name);
      } else if (step.method === FORBIDDEN_VERB) set = [...step.body.labels];
    }
    return set;
  };

  // The interleaving that actually happened: the size job read the label set
  // BEFORE the seat's `skip-changeset` POST landed, so it read an empty set;
  // one second later its write hit a PR that by then carried the label.
  const FAMILY = ['size/xs', 'size/s', 'size/m', 'size/l', 'size/xl'];
  const staleRead = [];
  const liveSet = ['skip-changeset'];

  // Transcribed from github.sh:68-91 -- take the read, drop its OWN family,
  // append the new size label, PUT the whole thing.
  const retiredPlan = [
    {
      method: FORBIDDEN_VERB,
      path: '/issues/10698/labels',
      body: { labels: [...staleRead.filter((l) => !FAMILY.includes(l)), 'size/l'] },
      why: 'the retired whole-set write'
    }
  ];
  check('the retired whole-set PUT destroys the concurrent label', applyPlan(liveSet, retiredPlan), ['size/l']);
  check(
    'the additive plan preserves it at the SAME interleaving',
    applyPlan(liveSet, planSizeWrites({ prNumber: 10698, target: 'size/l', family: FAMILY, current: staleRead })),
    ['skip-changeset', 'size/l']
  );
  // And with the stalest read imaginable -- one that predates a label the PR
  // has since gained AND still carries a size label the PR has since lost.
  check(
    'the additive plan is correct from an arbitrarily stale read',
    applyPlan(['skip-changeset', 'size/m'], planSizeWrites({
      prNumber: 10698,
      target: 'size/l',
      family: FAMILY,
      current: ['size/m']
    })),
    ['skip-changeset', 'size/l']
  );

  // --- config parsing ------------------------------------------------------
  const parsed = parseLabelerConfig(
    ["# a comment", "'documentation':", '  - changed-files:', '    - any-glob-to-any-file: ', "      - 'content/**/*'", "      - '**/*.md'", '', "'tests':", '  - changed-files:', '    - any-glob-to-any-file:', "      - '**/*.test.ts'"].join('\n'),
    'fixture.yml'
  );
  check('parses two labels', [...parsed.keys()], ['documentation', 'tests']);
  check('parses globs', parsed.get('documentation'), ['content/**/*', '**/*.md']);
  check(
    'matches through the parsed config',
    labelsForFiles(parsed, ['content/docs/a.mdx', 'packages/core/src/a.test.ts']),
    ['documentation', 'tests']
  );

  throws(
    'an unimplemented matcher key is refused',
    () => parseLabelerConfig(["'x':", '  - changed-files:', '    - all-globs-to-all-files:', "      - 'a/**'"].join('\n')),
    'all-globs-to-all-files'
  );
  throws(
    'a base-branch selector is refused',
    () => parseLabelerConfig(["'x':", '  - base-branch:', "      - 'main'"].join('\n')),
    'base-branch'
  );
  throws('a label with no globs is refused', () => parseLabelerConfig("'x':\n"), 'declares no globs');

  // --- the REAL config, so drift fails lint rather than a PR run -----------
  try {
    const realConfig = parseLabelerConfig(readFileSync(DEFAULT_LABELER_CONFIG, 'utf8'), DEFAULT_LABELER_CONFIG);
    if (realConfig.size === 0) failures.push('the checked-in .github/labeler.yml parsed to zero labels');
    // Prove the parsed config still classifies this repo's own files. These are
    // real tracked paths; if a rename makes one wrong, that is worth a red.
    check(
      'the real config labels a workflow edit',
      labelsForFiles(realConfig, ['.github/workflows/pr-automation.yml']).includes('ci/cd'),
      true
    );
    check(
      'the real config labels a scripts-only edit as tooling-free',
      labelsForFiles(realConfig, ['scripts/pr-labels.mjs']),
      []
    );
  } catch (error) {
    failures.push(`the checked-in .github/labeler.yml is outside the supported subset: ${error.message}`);
  }

  if (failures.length > 0) {
    console.error(`pr-labels --self-test: ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    console.error('\nVERDICT: pr-labels self-test FAILED');
    process.exit(1);
  }
  console.log('VERDICT: pr-labels self-test PASSED');
}

// ---------------------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');

  if (args.has('--self-test')) {
    selfTest();
    return;
  }
  if (args.has('--size')) {
    await runSize(dryRun);
    return;
  }
  if (args.has('--paths')) {
    await runPaths(dryRun);
    return;
  }
  console.error('usage: node scripts/pr-labels.mjs [--self-test | --size | --paths] [--dry-run]');
  process.exit(1);
}

// Only drive the CLI when this file IS the entry point. Importing it (the
// self-test harness, or an ad-hoc check against a real PR's file list) must not
// fire a mode off `process.argv` that belongs to the importer.
//
// `isEntrypoint` is the ONE sanctioned predicate for this in `scripts/**`, and
// hand-typing the comparison is what check:entry-guard exists to stop. Node
// resolves symlinks for the module graph but leaves `process.argv[1]` as the
// caller typed it, so a hand-typed guard answers `false` through a symlink and
// the script then does NOTHING -- exit 0, no output, which a caller reading the
// status reads as success.
if (isEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`pr-labels: ${error.message}`);
    process.exit(1);
  });
}

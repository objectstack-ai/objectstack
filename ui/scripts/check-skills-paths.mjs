#!/usr/bin/env node
/**
 * Every in-repo path an agent skill guide states in a backtick code span must
 * exist on disk.
 *
 * Run:  node scripts/check-skills-paths.mjs   (also `pnpm check:skills-paths`)
 *       node scripts/check-skills-paths.mjs --list   # every candidate + verdict
 * Exit: 0 = every stated path resolves (or is baselined), 1 = one does not, or
 *       the baseline below has gone stale
 *
 * ## The gap this closes (objectui#3735)
 *
 * The guides under `skills/objectui/` are a direct INPUT to every agent that
 * writes code in this repo, and their prose gives in-repo paths as coordinates:
 * "the five contexts live in ...", "declare the route in ...". Nothing checked
 * that any of those paths existed.
 *
 * `scripts/check-doc-links.mjs` does not reach them twice over. Its `SCAN_ROOTS`
 * table (see that file) lists `content/docs`, `examples`, three root markdown
 * files, `docs` and the package READMEs — no `skills` row. And it judges
 * MARKDOWN LINKS; a bare path inside a code span is not a link, so widening its
 * scan roots alone would still have seen none of this.
 *
 * The cost was paid twice before this gate existed, both times found by eye
 * while reading:
 *
 *   - #3713 / PR #3729 — the directory-tree and metadata-registry sections of
 *     `skills/objectui/guides/console-development.md`.
 *   - #3730 / PR #3734 — the same file's Key contexts (5 rows), Key hooks
 *     (7 rows) and UnifiedSidebar sections: 13 real symbols given at
 *     coordinates that do not exist.
 *
 * This failure mode is expensive out of proportion to its size, and the reason
 * is worth stating: the SYMBOL is usually real and only the path is wrong, so an
 * agent does not get a compile error — it gets "file not found" from a `Read`,
 * assumes its own search was clumsy, and spends a full lap re-locating something
 * the guide claimed to have located for it. It also recurs by construction: the
 * app-shell extraction commits (`c1e105793`, `28ffe4033`, `b279d80d6`,
 * `cccdf84d7`) moved code with nothing anywhere to say the guides had gone
 * stale.
 *
 * ## What counts as a stated path, and what deliberately does not
 *
 * Measured on `main@6422aa891`, over the 18 markdown files under `skills`:
 * 91 backtick tokens open with one of `PATH_PREFIXES` and contain no
 * whitespace. Of those, 5 are patterns rather than paths and 86 are literal
 * assertions — 85 resolve, 1 does not, and that one is a deliberate negative
 * sentence (the sole baseline entry). So the signal-to-noise ratio is what makes
 * this checkable at all: one exemption for 86 assertions.
 *
 * Re-measured on `main@0614b6df1` across both roots (objectui#7358): 20 files,
 * 92 tokens, 4 patterns, 88 literal assertions — 87 resolve, 1 does not, and it
 * is the SAME deliberate negative sentence, now stated from
 * `.claude/skills/objectui-contributor/guides/console-development.md`. The ratio
 * held across a 3.3x widening of the checked surface: one exemption for 88
 * assertions.
 *
 * Three exclusions, each a rule rather than a baseline entry, because none of
 * them is a claim that a file exists:
 *
 *   1. **Whitespace.** A span containing a space is prose, or a command line, or
 *      a type — not a path. (PR #3856 added a self-check command line to
 *      `console-development.md` in exactly this shape; it is out of scope by
 *      this rule alone, with no entry needed anywhere.)
 *   2. **Patterns.** A token carrying a glob metacharacter or a placeholder
 *      segment is a shape, not a location: the guides legitimately write the
 *      protected-primitive glob under `packages/components/src/ui`, the guide
 *      glob under `content/docs/guide`, and a Zod-schema path with a
 *      placeholder domain segment. `existsSync` on any of them is meaningless.
 *      See `PATTERN_RE`.
 *   3. **Fenced blocks.** Only inline code spans in PROSE are read. A fence is a
 *      worked example, and a tutorial fence may legitimately name a file the
 *      reader is about to create. Measured: this removes 0 tokens from today's
 *      tree, so it buys nothing yet and is a scope statement for later — the
 *      inverse boundary `check-doc-links.mjs` draws for itself, and for the same
 *      reason (that file's `stripCode` section spells it out).
 *
 * ## The scan surface is a decision too (objectui#7358)
 *
 * `SCAN_ROOTS` holds `skills` and `.claude/skills`. It was one string, `skills`,
 * until objectui#7251 moved the two contributor-only files — the 49-coordinate
 * `console-development.md` and `no-touch-zones.md` — into
 * `.claude/skills/objectui-contributor/`, because they address a maintainer of
 * this repo rather than a customer of the published bundle. The move was
 * correct and the gate did not notice it: 55 of 93 assertions, 59%, left the
 * checked surface in one commit with nothing turning red, because the gate
 * simply stopped looking. Both files stayed green the whole time.
 *
 * Widening it was its own change, with the measurement re-run as this docblock
 * demands below:
 *
 *   |                         | before | after |
 *   |-------------------------|--------|-------|
 *   | files scanned           | 16     | 20    |
 *   | stated paths checked    | 27     | 88    |
 *   | `console-development.md`| —      | 49    |
 *   | `no-touch-zones.md`     | —      | 6     |
 *   | `objectui-contributor/SKILL.md` | — | 5 |
 *   | `verify/SKILL.md`       | —      | 1     |
 *
 * The batch of red it brought was exactly one token, and it was not rot: the
 * deliberate negative sentence in `console-development.md`'s Key contexts
 * section ("there is no `apps/console/src/context/` directory at all"), which
 * held the sole baseline entry before the move and holds it again under its new
 * key. The other 60 coordinates in the two moved guides all resolved on
 * arrival — they were maintained by hand through #3713 and #3730 and had not
 * yet gone stale, which is the case FOR gating them, not against.
 *
 * The lesson the widening itself taught is in `main()`: a whole-surface floor
 * cannot see a root that stopped being read. Emptiness is judged per root now.
 *
 * ## The prefix allow-list is a decision, not an accident
 *
 * `PATH_PREFIXES` holds the five top-level directories the finding measured.
 * This repo has eleven: `docs`, `e2e`, `eslint-rules`, `public` and `patches`
 * are deliberately NOT in the list today. That was measured too, so a later
 * widening starts from a number instead of a guess: adding all five moves the
 * reading from 86 to 88 checked assertions, both new ones resolve, and nothing
 * turns red. Cheap — but it is a separate decision from this gate's existence,
 * and `check-doc-links.mjs` learned the discipline the hard way (#3479 / #3490 /
 * #3545: every scan-surface widening arrives with its own batch of red to
 * clear). Widen it on purpose, with the measurement re-run, not as a rider.
 *
 * Two near-misses that the pattern rule catches today by luck rather than by
 * design, recorded so the next reader is not surprised: the guides cite the
 * SIBLING framework repo's `packages/spec/src` and `packages/platform-objects`
 * trees, neither of which exists in objectui. Both are spelled with a wildcard
 * or a placeholder, so rule 2 removes them. A cross-repo path spelled literally
 * would be a false red here, and the baseline — with its `reason` field — is
 * where that gets recorded if it ever happens.
 *
 * ## Existence only, not kind
 *
 * `existsSync`, deliberately: a trailing slash is not required to resolve to a
 * directory, nor a `.tsx` suffix to a file. The defect class is "this
 * coordinate does not exist", and stretching the gate to judge kind would add a
 * second, weaker claim to every green.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * The scan surface: markdown under each of these directories, relative to the
 * repo root.
 *
 * A LIST since objectui#7358, and the list is the point — see "The scan surface
 * is a decision too" above for the widening's measurement. `main()` judges each
 * root SEPARATELY for emptiness, so a root that stops matching is red on its own
 * rather than hidden behind the other root's healthy count.
 */
export const SCAN_ROOTS = ['skills', '.claude/skills'];

/** Where the exemptions live. A ratchet — see `readBaseline`. */
export const BASELINE_FILE = 'scripts/skills-path-baseline.json';

/**
 * Top-level directories whose name at the start of a code span means "a path in
 * this repository". See the docblock section above before adding one.
 */
export const PATH_PREFIXES = ['apps', 'packages', 'examples', 'scripts', 'content'];

const PREFIX_RE = new RegExp(`^(${PATH_PREFIXES.join('|')})/`);

/**
 * A shape rather than a location: glob metacharacters, an angle-bracket or
 * brace placeholder segment, a shell variable, or an elided middle. None of
 * these can be handed to `existsSync` and mean anything.
 */
const PATTERN_RE = /[*?[\]{}<>$]|\.\.\./;

/** Opening or closing fence, matched the way `check-doc-links.mjs` matches it. */
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

/** An inline code span. Multi-backtick delimiters included, contents captured. */
const INLINE_CODE_RE = /(`+)([^`\n]*)\1/g;

/**
 * `file token` — the baseline's identity for one exemption.
 *
 * A SPACE joins them, and that is checkable rather than lucky: a candidate token
 * is rejected outright if it contains whitespace, and no path under `skills`
 * has a space in it either. (Not a NUL, and not any other control byte: one raw
 * U+0000 makes grep classify this whole file as binary — see
 * `scripts/check-control-bytes.mjs`, which would also fail on it.)
 */
const keyOf = (file, token) => `${file} ${token}`;

/** Every markdown file under `dir`, recursively. Absolute paths, sorted. */
export function markdownFiles(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files; // caller decides whether a missing surface is an error
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, files);
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

/**
 * Path-shaped tokens stated in one markdown file's prose.
 *
 * @returns `{ line, token, pattern }[]` — `pattern: true` marks the tokens rule
 *          2 above excludes. They are returned rather than dropped so `--list`
 *          and the tests can see what the extractor classified, instead of
 *          having to infer it from an absence.
 */
export function extractPathTokens(source) {
  /** @type {{ line: number, token: string, pattern: boolean }[]} */
  const found = [];
  let openFence = null;

  source.split('\n').forEach((line, index) => {
    const fence = FENCE_RE.exec(line);

    if (openFence) {
      const closes =
        fence && fence[1][0] === openFence[0] && fence[1].length >= openFence.length && fence[2].trim() === '';
      if (closes) openFence = null;
      return;
    }
    if (fence) {
      openFence = fence[1];
      return;
    }

    for (const match of line.matchAll(INLINE_CODE_RE)) {
      const token = match[2];
      if (!token || /\s/.test(token) || !PREFIX_RE.test(token)) continue;
      found.push({ line: index + 1, token, pattern: PATTERN_RE.test(token) });
    }
  });

  return found;
}

/**
 * The exemption list.
 *
 * A RATCHET, not an escape hatch, and `scan()` enforces that in BOTH directions:
 * an entry whose path has appeared on disk is as red as a new dead path (the
 * prose now says something false), and so is an entry the scan never met (the
 * sentence was rewritten or the file renamed, so the entry is dead weight).
 * Without the second direction a baseline degrades into a skip-list nobody dares
 * delete from; without the first it silently licenses a claim that has become
 * wrong. `KNOWN_OFFENDERS` in `check-control-bytes.mjs` and
 * `scripts/i18n-call-site-key-baseline.json` are the two in-repo precedents.
 */
export function readBaseline(root) {
  const file = path.join(root, BASELINE_FILE);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { allowedMissing: parsed.allowedMissing ?? {} };
}

/** Every `file token` key the baseline declares. */
export function baselineKeys(baseline) {
  return Object.entries(baseline.allowedMissing).flatMap(([file, tokens]) =>
    Object.keys(tokens).map((token) => keyOf(file, token)),
  );
}

/**
 * The one scan. `main()`, `--list` and the test suite all go through here, so
 * the tests exercise the real code path rather than a parallel imitation.
 *
 * Reads the directories, not `git ls-files`: the surface is "markdown on disk
 * under each of `SCAN_ROOTS`", which lets the tests run the real `scan()` over a
 * fixture tree with no git repository in it.
 *
 * `perRoot` carries the same three numbers per scan root. The totals alone
 * cannot answer "is every root still being read?" — the reading that motivated
 * objectui#7358 was a comfortable 27/27 across 16 files while a second tree of
 * 55 assertions sat unscanned — so the breakdown is part of the result, not a
 * `--list` nicety.
 *
 * @param root      directory to treat as the repository root
 * @param baseline  `{ allowedMissing: { [file]: { [token]: { reason, issue } } } }`
 */
export function scan(root, baseline = readBaseline(root)) {

  /** Dead paths nobody declared. Red. */
  const missing = [];
  /** Declared dead paths, still dead. Green, but reported. */
  const exempt = [];
  /** Declared dead paths that now exist — the prose is now wrong. Red. */
  const staleNowExists = [];
  /** Tokens rule 2 excluded. Reported by `--list` only. */
  const patterns = [];
  /** One `{ root, files, checked, resolved }` row per scan root. */
  const perRoot = [];
  const seen = new Set();
  let files = 0;
  let checked = 0;
  let resolved = 0;

  for (const scanRoot of SCAN_ROOTS) {
    const rootFiles = markdownFiles(path.join(root, scanRoot));
    const checkedBefore = checked;
    const resolvedBefore = resolved;

    for (const full of rootFiles) {
      const file = path.relative(root, full);
      for (const hit of extractPathTokens(readFileSync(full, 'utf8'))) {
        if (hit.pattern) {
          patterns.push({ file, ...hit });
          continue;
        }
        checked++;

        const entry = baseline.allowedMissing[file]?.[hit.token];
        if (entry) seen.add(keyOf(file, hit.token));
        const record = { file, line: hit.line, token: hit.token };

        if (existsSync(path.join(root, hit.token))) {
          resolved++;
          if (entry) staleNowExists.push({ ...record, ...entry });
          continue;
        }
        if (entry) {
          exempt.push({ ...record, ...entry });
          continue;
        }
        missing.push(record);
      }
    }

    files += rootFiles.length;
    perRoot.push({
      root: scanRoot,
      files: rootFiles.length,
      checked: checked - checkedBefore,
      resolved: resolved - resolvedBefore,
    });
  }

  /** Declared exemptions the scan never met. Red. */
  const staleUnseen = baselineKeys(baseline).filter((key) => !seen.has(key));

  return { missing, exempt, staleNowExists, staleUnseen, patterns, perRoot, files, checked, resolved };
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

const describe = (r) => `${r.file}:${r.line} — ${r.token}`;

function main() {
  const root = repoRoot();
  const result = scan(root);
  const { missing, exempt, staleNowExists, staleUnseen } = result;

  // The empty-verdict trap: a broken extractor, a renamed scan root or a moved
  // guide tree would satisfy every assertion above by finding nothing at all.
  // A gate that passes because it looked at zero files is not a gate.
  //
  // PER ROOT since objectui#7358, which is the failure that made the widening
  // worth its own change: the contributor guides left `skills/` for
  // `.claude/skills/`, and a whole-surface test stayed green on the 16 files
  // still under `skills` while 55 of 93 assertions had quietly stopped being
  // checked. Summed over roots, "one root reads nothing" is invisible; per root
  // it is the loudest line in the output. A root that scans nothing is either a
  // move nobody threaded through here or a root that should be deleted from
  // SCAN_ROOTS — both are decisions, neither is a pass.
  const emptyRoots = result.perRoot.filter((r) => r.files === 0 || r.checked === 0);
  if (emptyRoots.length > 0) {
    const rows = emptyRoots
      .map((r) => `    • ${r.root}/ — ${r.files} markdown file(s), ${r.checked} path assertion(s)`)
      .join('\n');
    console.error(
      `❌  check-skills-paths: ${emptyRoots.length} of ${result.perRoot.length} scan root(s) judged nothing:\n\n${rows}\n\n` +
        `Nothing to judge means this gate reports OK for the wrong reason. Either that\n` +
        `surface moved (see SCAN_ROOTS) or the extractor stopped matching (see\n` +
        `extractPathTokens and PATH_PREFIXES). objectui#3735 measured 18 files and\n` +
        `86 assertions under skills/ on main@6422aa891, and objectui#7358 measured\n` +
        `20 files and 88 assertions across both roots, so a reading of zero for any\n` +
        `root is a broken gate, not a clean tree.`,
    );
    process.exit(1);
  }

  if (missing.length === 0 && staleNowExists.length === 0 && staleUnseen.length === 0) {
    const waived = exempt.length ? `; ${exempt.length} baselined` : '';
    console.log(
      `✅  check-skills-paths: OK (${result.resolved}/${result.checked} stated path(s) resolve across ` +
        `${result.files} guide file(s)${waived}).`,
    );
    // Per root, always — a total is not evidence that every root was read.
    for (const r of result.perRoot) {
      console.log(`    ${r.root}/ — ${r.resolved}/${r.checked} resolve across ${r.files} file(s)`);
    }
    process.exit(0);
  }

  if (missing.length > 0) {
    const phrase = missing.length === 1 ? 'stated path does' : 'stated paths do';
    console.error(`❌  check-skills-paths: ${missing.length} ${phrase} not exist\n`);
    for (const r of missing) console.error(`    • ${describe(r)}`);
    console.error(`
These are coordinates an agent will follow. The symbol named next to one of them
is usually real and only the location is wrong, so nobody gets a compile error —
they get "file not found" from a Read and spend a lap re-locating it (#3713,
#3730 were 13+ of these in one guide).

Fix the prose. If the path is deliberately named as NOT existing — a sentence
whose whole point is "there is no such directory" — add it to
${BASELINE_FILE} with a reason, and expect the gate to
go red again the day that path appears on disk.`);
  }

  if (staleNowExists.length > 0) {
    const phrase = staleNowExists.length === 1 ? 'baselined path now EXISTS' : 'baselined paths now EXIST';
    console.error(`\n❌  check-skills-paths: ${staleNowExists.length} ${phrase} on disk:\n`);
    for (const r of staleNowExists) console.error(`    • ${describe(r)}  [${r.issue}] ${r.reason}`);
    console.error(`
The exemption said this path does not exist and the prose was written around
that. It exists now, so the sentence is wrong — fix the prose first, then delete
the entry from ${BASELINE_FILE}.`);
  }

  if (staleUnseen.length > 0) {
    const phrase = staleUnseen.length === 1 ? 'baseline entry' : 'baseline entries';
    console.error(`\n❌  check-skills-paths: ${staleUnseen.length} ${phrase} the scan never met:\n`);
    for (const key of staleUnseen) console.error(`    • ${key}`);
    console.error(`
Written as "file token". The guide no longer states that path — the sentence was
rewritten, or the file moved. Delete the entry from ${BASELINE_FILE}: an
exemption nobody removes is how a baseline turns into a permanent skip-list.`);
  }

  process.exit(1);
}

// Run only when invoked directly — the test suite imports `scan()` and the
// extractor from here and must not trigger a repo scan (or a `process.exit`) on
// import. Same guard shape as `scripts/check-control-bytes.mjs`.
const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  if (process.argv.includes('--list')) {
    const result = scan(repoRoot());
    for (const r of result.patterns) console.log(`pattern    ${describe(r)}`);
    for (const r of result.exempt) console.log(`baselined  ${describe(r)}  [${r.issue}]`);
    for (const r of result.missing) console.log(`MISSING    ${describe(r)}`);
    console.log(
      `\n${result.files} file(s), ${result.checked} assertion(s) checked ` +
        `(${result.resolved} resolve, ${result.exempt.length} baselined), ` +
        `${result.patterns.length} pattern(s) excluded.`,
    );
    for (const r of result.perRoot) {
      console.log(`  ${r.root}/ — ${r.files} file(s), ${r.checked} checked, ${r.resolved} resolve`);
    }
  } else {
    main();
  }
}

#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-doc-frontmatter (#10493) -- every page under `content/docs/` carries a
 * leading `---` block the DOCS BUILD'S OWN parser can read, and types the two
 * keys `pageSchema` types.
 *
 *   node scripts/check-doc-frontmatter.mjs              # judge the checked-in corpus
 *   node scripts/check-doc-frontmatter.mjs --list       # every page and what it declares
 *   node scripts/check-doc-frontmatter.mjs --self-test  # prove the battery can go red
 *
 * ## The gap this closes
 *
 * A page landed whose frontmatter `description` was an unquoted YAML scalar
 * containing `apis: `. YAML reads the colon-plus-space as the start of a nested
 * mapping, so the block does not parse:
 *
 *   content/docs/api/declarative-endpoints.mdx
 *   YAMLParseError: Nested mappings are not allowed in compact mappings
 *     at line 2, column 14
 *
 * Every local gate passed on that file. `check:doc-anchors` reads these pages
 * line by line and DELIBERATELY avoids the block -- its helper's docblock is
 * "Blank out a leading YAML frontmatter block, preserving line count" -- which
 * is right for heading ids and means the closest thing to a frontmatter reader
 * is the thing that erases it. The only owner of "this frontmatter parses" was
 * `Build Docs`: a full `next build` on a 30-minute-timeout runner, which exists
 * only in CI and is path-filtered besides. A 30 ms parse names the defect
 * exactly; paying for it with a site build on the merge gate is the whole cost
 * of the loop for a one-character-class fix.
 *
 * The trigger is ordinary prose. Any `description` naming a metadata key
 * (`apis:`, `fields:`, `views:`) or writing any `word: word` reproduces it, and
 * documentation about a metadata platform is the corpus most likely to write a
 * colon.
 *
 * ## The population, and the number the card could not reproduce
 *
 * THE WHOLE CORPUS: `content/docs/**\/*.mdx`, generated `references/**`
 * included. 403 pages at the tip this landed on -- 189 hand-written, 214
 * generated.
 *
 * The card's sketch proposed `affected-docs.mjs --all`, which is that set MINUS
 * `references/**`. That is the right population for the question it answers --
 * "which hand-written pages must a human re-read for accuracy", where a
 * generated page is correctly excluded because you fix the GENERATOR, not the
 * page. It is the wrong population here, for one measured reason: what has no
 * owner below `Build Docs` is every page `Build Docs` parses, and
 * `apps/docs/source.config.ts` points fumadocs at `content/docs` with no
 * `references` exclusion. Scoping to the hand-written half would leave 214 of
 * 403 pages -- 53% of the corpus -- with exactly the gap this gate exists to
 * close. Generated pages are if anything the higher risk: their `description`
 * is produced from `packages/spec` prose that no human proofreads, and the
 * trigger is a colon.
 *
 * The card's own measurement agrees with that reading, which is worth recording
 * because the number reconciles with nothing on `main`. The card reports
 * "396/396 parse clean". No commit of `main` has ever had 396 `.mdx` under
 * `content/docs`. It was measured on the PR branch that MOTIVATED the card:
 * `main` at that branch's base carried 395, the branch added
 * `content/docs/api/declarative-endpoints.mdx`, and 395 + 1 = 396 -- references
 * INCLUDED (the hand-written count in that window was 181). So the card's
 * measured population was already the whole corpus; only its sketch line,
 * borrowed from a neighbouring tool, said otherwise.
 *
 * ## The two keys, and why they are the build's contract rather than a schema
 *
 * `fumadocs-core/source/schema` -- the `pageSchema` `apps/docs/source.config.ts`
 * hands to `defineDocs` -- declares:
 *
 *   title:       z.string()             // REQUIRED
 *   description: z.string().optional()  // optional, but typed WHEN PRESENT
 *
 * So this gate asserts exactly that and nothing more:
 *
 *   - `title` must be present and a string;
 *   - `description`, WHEN PRESENT, must be a string.
 *
 * It deliberately does NOT require `description` to be present, though all 403
 * pages declare one today. The build does not require it, so requiring it would
 * be a rule invented here -- the schema growth the card's triage ruled out.
 * `icon`, `full` and `_openapi` are likewise `pageSchema`'s and likewise not
 * asserted, and unknown keys pass because `pageSchema` is not `.strict()`.
 *
 * The type half is not decoration. A parse-only gate is blind to the shape one
 * character away from the defect above, measured with this same parser:
 *
 *   description: Expose ... an apis: endpoint   -> THROWS  (the card's defect)
 *   description:                                -> parses, yields an OBJECT
 *     apis: thing                                  -> `Build Docs` fails on zod
 *   title: 42                                   -> parses, yields a NUMBER
 *
 * Both survivors are red `Build Docs` runs 30 minutes later, for the same
 * reason and with the same fix. And a page with NO frontmatter at all reaches
 * the build as `{}` (the extractor returns an empty object rather than
 * throwing), so it too fails only on `title` -- which is why an absent block is
 * reported here by name instead of as a missing key.
 *
 * ## It reads the build's own reader, not an imitation of one
 *
 * `fumadocs-core/dist/content/md/frontmatter.js` is eleven lines:
 *
 *   const regex = /^---\r?\n(.+?)\r?\n---\r?\n?/s;
 *   ... output.data = parse(match[1]) ?? {};
 *
 * with `parse` from `yaml`. `FRONTMATTER_RE` below is that regex, and `parse`
 * below is that import -- `yaml` is a root devDependency at the same major the
 * build resolves. Both halves are copied rather than approximated on purpose: a
 * gate that extracted the block differently would be answering a question about
 * a string the build never sees. The two subtleties that carries, both pinned
 * in the self-test: the match is anchored at byte 0, so a block preceded by a
 * blank line is NOT frontmatter to the build either; and `.+?` is non-greedy,
 * so a later `---` horizontal rule cannot extend the block.
 *
 * ## Refusals -- what this gate does instead of reporting a clean zero
 *
 * #7484 is the precedent the card names: a documentation invariant CI reported
 * `[200] OK` on until someone wrote a script for it. The failure mode that
 * reproduces it here is a gate that walks NOTHING and prints OK, so every state
 * in which the corpus was not actually read is exit 1 naming what could not be
 * read, never a quiet pass (#4690):
 *
 *   - the docs root does not resolve;
 *   - the walk resolves to ZERO pages (an empty tree, or one holding no `.mdx`);
 *   - any entry cannot be read -- a dangling symlink, a directory where a page
 *     should be, a permission error.
 *
 * Every `.mdx`-named entry is a read candidate and `readFileSync` is the sole
 * authority on whether it can be read; nothing is skipped on the strength of a
 * dirent type. That is what keeps an unreadable page from leaving the count
 * quietly one smaller, which is the same "not measured, reported as measured
 * and clean" shape one level down.
 *
 * ## Wiring
 *
 * Invoked from `.github/workflows/lint.yml` as `node scripts/...` directly,
 * both legs, rather than through a `pnpm check:*` alias: that alias belongs in
 * root `package.json`, declared territory of the @changesets/cli v3 migration
 * lane (#9465) while it runs. The self-test asserts that wiring against the
 * workflow text -- a gate that exists and is not scheduled is the same dormant
 * shape from the other side.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, parseDocument } from 'yaml';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');

/** The corpus. `apps/docs/source.config.ts` points fumadocs at exactly this. */
export const DOCS_DIR = join(REPO_ROOT, 'content/docs');

/** The generated half, reported separately so the verdict says what it read. */
export const GENERATED_PREFIX = 'references/';

/**
 * `fumadocs-core/dist/content/md/frontmatter.js`, verbatim. Anchored at byte 0
 * and non-greedy -- see the header for what each of those decides.
 */
export const FRONTMATTER_RE = /^---\r?\n(.+?)\r?\n---\r?\n?/s;

/**
 * The file line the frontmatter BODY starts on. `FRONTMATTER_RE` can only match
 * at byte 0 and consumes `---` plus one newline first, so the body's line 1 is
 * always the file's line 2 -- which is the whole offset between the parser's
 * coordinates and the ones a reader clicks.
 */
export const FRONTMATTER_BODY_FIRST_LINE = 2;

/** The version of the parser actually resolved, for the verdict line. */
export function parserVersion() {
  try {
    return createRequire(import.meta.url)('yaml/package.json').version;
  } catch {
    return '(version unreadable)';
  }
}

/**
 * A refusal: a state in which the corpus was not read, so no verdict about it
 * is available. Distinct from a violation, which is a verdict.
 */
export class Unread extends Error {
  constructor(message) {
    super(message);
    this.name = 'Unread';
  }
}

/**
 * Every `.mdx` under `dir`, repo-relative and sorted.
 *
 * An entry named `*.mdx` is a READ CANDIDATE whatever its dirent type says, so
 * a symlink -- live, dangling, or pointing at a directory -- reaches
 * `readFileSync` rather than being dropped by a type test. Dropping it would
 * make an unreadable page indistinguishable from a page that is not there.
 */
export function collectPages(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Unread(`cannot read the directory ${rel(dir)}: ${err.code ?? err.message}`);
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.name.endsWith('.mdx')) {
      out.push(p);
      continue;
    }
    if (entry.isDirectory()) collectPages(p, out);
  }
  return out.sort();
}

/** A path as this repo spells it, for messages. */
export function rel(p) {
  const r = relative(REPO_ROOT, p);
  return r.startsWith('..') ? p : r;
}

/** Newlines in `s` -- how a byte offset becomes a line offset. */
function newlines(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * The FILE line a top-level frontmatter key sits on, or `null` when the key is
 * not there. Located from the parsed document rather than by searching text, so
 * a key that also appears inside a value cannot be mistaken for the declaration.
 */
export function fileLineOfKey(body, key) {
  let doc;
  try {
    doc = parseDocument(body);
  } catch {
    return null;
  }
  const items = doc?.contents?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const k = item?.key;
    if (k?.value === key && Array.isArray(k.range)) {
      return FRONTMATTER_BODY_FIRST_LINE + newlines(body.slice(0, k.range[0]));
    }
  }
  return null;
}

/**
 * Judge one page's SOURCE TEXT. Returns `{ violations, data }`.
 *
 * Exported so the self-test drives the real judge over fixture sources rather
 * than over whatever this tree happens to contain today -- a battery that can
 * only be observed passing proves nothing about whether it can go red.
 *
 * Each violation is `{ kind, line, col, what, detail }`. `line`/`col` are FILE
 * coordinates; a parser message quoted in `detail` keeps the parser's own
 * body-relative ones, and `formatViolation` says so rather than silently
 * presenting two numbering schemes as one.
 */
export function judgeSource(source) {
  const match = FRONTMATTER_RE.exec(source);

  if (!match) {
    return {
      data: {},
      violations: [
        {
          kind: 'frontmatter-missing',
          line: 1,
          col: 1,
          what: 'no leading `---` frontmatter block',
          detail:
            'the docs build extracts frontmatter with an anchored regex and yields `{}` when it does not match, ' +
            'so this page reaches `pageSchema` with no `title` and fails the site build. ' +
            'A block must start at byte 0, hold at least one line, and close with `---`.',
        },
      ],
    };
  }

  const body = match[1];

  let data;
  try {
    data = parse(body) ?? {};
  } catch (err) {
    const pos = Array.isArray(err.linePos) ? err.linePos[0] : null;
    return {
      data: null,
      violations: [
        {
          kind: 'frontmatter-parse',
          line: pos ? FRONTMATTER_BODY_FIRST_LINE + (pos.line - 1) : 1,
          col: pos ? pos.col : 1,
          what: 'frontmatter does not parse',
          detail: `${err.name ?? 'Error'}${err.code ? ` [${err.code}]` : ''}: ${err.message}`,
          fromParser: true,
        },
      ],
    };
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      data: null,
      violations: [
        {
          kind: 'frontmatter-not-a-mapping',
          line: FRONTMATTER_BODY_FIRST_LINE,
          col: 1,
          what: `frontmatter parses to ${Array.isArray(data) ? 'an array' : typeof data}, not a mapping`,
          detail: '`pageSchema` is a z.object, so anything that is not a mapping fails the site build.',
        },
      ],
    };
  }

  const violations = [];

  // `pageSchema.title: z.string()` -- required, and typed.
  if (!('title' in data)) {
    violations.push({
      kind: 'title-missing',
      line: 1,
      col: 1,
      what: 'no `title` in frontmatter',
      detail: '`pageSchema` declares `title: z.string()`, so a page without one fails the site build.',
    });
  } else if (typeof data.title !== 'string') {
    violations.push({
      kind: 'title-not-a-string',
      line: fileLineOfKey(body, 'title') ?? FRONTMATTER_BODY_FIRST_LINE,
      col: 1,
      what: `\`title\` parses to ${describe(data.title)}, not a string`,
      detail:
        '`pageSchema` declares `title: z.string()`. YAML types an unquoted scalar by its shape, ' +
        'so quote it to keep it a string.',
    });
  }

  // `pageSchema.description: z.string().optional()` -- typed WHEN PRESENT.
  // Presence is deliberately NOT asserted: the build does not require it, and a
  // rule the build does not have is one invented here.
  if ('description' in data && typeof data.description !== 'string') {
    violations.push({
      kind: 'description-not-a-string',
      line: fileLineOfKey(body, 'description') ?? FRONTMATTER_BODY_FIRST_LINE,
      col: 1,
      what: `\`description\` parses to ${describe(data.description)}, not a string`,
      detail:
        '`pageSchema` declares `description: z.string().optional()`. A `word: word` inside an unquoted ' +
        'description that YAML can read as a nested mapping yields an object here rather than throwing -- ' +
        'the shape one character away from the parse failure this gate was written for. Quote the scalar.',
    });
  }

  return { data, violations };
}

/** What a value IS, for a message that has to be actionable. */
function describe(v) {
  if (v === null) return 'null (an empty value)';
  if (Array.isArray(v)) return 'an array';
  if (v instanceof Date) return 'a date';
  if (typeof v === 'object') return 'an object (a nested mapping)';
  return `a ${typeof v}`;
}

/**
 * Walk `docsDir` and judge every page. Throws `Unread` -- never returns a
 * verdict -- for any state in which the corpus was not actually read.
 */
export function judgeTree(docsDir = DOCS_DIR) {
  const pages = collectPages(docsDir);

  if (pages.length === 0) {
    throw new Unread(
      `walked ${rel(docsDir)} and found ZERO .mdx pages, so nothing was verified -- refusing to report a pass. ` +
        'A gate that walks nothing and prints OK is the defect this one was written to close (#7484 / #4690).',
    );
  }

  const findings = [];
  let generated = 0;
  let handwritten = 0;
  let withDescription = 0;

  for (const page of pages) {
    const r = rel(page);
    if (relative(docsDir, page).startsWith(GENERATED_PREFIX)) generated++;
    else handwritten++;

    let source;
    try {
      source = readFileSync(page, 'utf8');
    } catch (err) {
      throw new Unread(
        `cannot read ${r}: ${err.code ?? err.message} -- refusing to report a pass over a corpus one page short.`,
      );
    }

    const { data, violations } = judgeSource(source);
    if (data && typeof data === 'object' && 'description' in data) withDescription++;
    for (const v of violations) findings.push({ ...v, file: r });
  }

  return { pages: pages.length, generated, handwritten, withDescription, findings };
}

/** One violation, as the terminal should show it. */
export function formatViolation(v) {
  const lines = [`✗ ${v.file}:${v.line}:${v.col} — ${v.what}`];
  for (const l of String(v.detail).split('\n')) lines.push(`    ${l}`.trimEnd());
  if (v.fromParser) {
    lines.push(
      '    (the parser numbers the frontmatter BODY; the path above numbers the FILE — ' +
        `the body begins on file line ${FRONTMATTER_BODY_FIRST_LINE})`,
    );
  }
  return lines.join('\n');
}

/** The live run. */
export function main(docsDir = DOCS_DIR) {
  const list = process.argv.includes('--list');

  let report;
  try {
    report = judgeTree(docsDir);
  } catch (err) {
    if (!(err instanceof Unread)) throw err;
    console.error(`✗ check-doc-frontmatter: ${err.message}`);
    return 1;
  }

  if (list) {
    for (const page of collectPages(docsDir)) {
      const { data, violations } = judgeSource(readFileSync(page, 'utf8'));
      const title = data && typeof data.title === 'string' ? JSON.stringify(data.title) : '(none)';
      const desc = data && typeof data.description === 'string' ? 'description' : '—';
      console.log(`${violations.length ? '✗' : '·'} ${rel(page)}  title=${title}  ${desc}`);
    }
  }

  if (report.findings.length > 0) {
    console.error(
      `✗ check-doc-frontmatter: ${report.findings.length} problem(s) across ${report.pages} page(s) under ${rel(docsDir)}\n`,
    );
    for (const v of report.findings) console.error(`${formatViolation(v)}\n`);
    console.error(
      'Frontmatter is parsed by the site build with the same parser used here, so each of these is a red ' +
        '`Build Docs` — a full `next build` — reporting it 30 minutes later.',
    );
    return 1;
  }

  console.log(
    `✓ check-doc-frontmatter: ${report.pages} page(s) under ${rel(docsDir)} parse with yaml@${parserVersion()}, ` +
      `the parser the docs build resolves — ${report.handwritten} hand-written + ${report.generated} generated under ` +
      `${GENERATED_PREFIX}. \`title\` present and a string on all ${report.pages}; \`description\` a string on all ` +
      `${report.withDescription} that declare one (presence not required — \`pageSchema\` marks it optional).`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test -- the battery observed going RED, plus REAL unreadable trees
// ---------------------------------------------------------------------------

/**
 * Two halves, and neither substitutes for the other.
 *
 * The SOURCE half drives `judgeSource` over fixture text, including the exact
 * `description` that motivated this gate, so every violation kind is observed
 * firing rather than trusted by reading.
 *
 * The TREE half builds real directories on disk -- an empty one, one holding no
 * pages, a dangling symlink, a directory wearing a page's name -- because the
 * assertion that matters most here is that an unread corpus REFUSES. A model of
 * an empty directory would pass against a gate that reports OK on everything,
 * which is the one outcome this battery exists to exclude.
 *
 * A third leg cross-checks the extraction against the docs build's OWN
 * extractor, resolved from `apps/docs`. It is what keeps the copied regex from
 * drifting into a private idea of where a page's frontmatter starts. If that
 * module cannot be resolved the leg FAILS -- it does not skip; a leg that
 * silently opts out is the same dormant shape one level up.
 */
export async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (ok, what) => {
    checked++;
    if (!ok) failures.push(what);
  };

  // The two `main()` probes below print a real verdict. Swallow it: this
  // battery's own output is the only thing a reader should have to interpret,
  // and a gate's failure text scrolling past inside a PASSING self-test is how
  // a green run gets read as a red one.
  const quietly = (fn) => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.log = log;
      console.error = error;
    }
  };

  const page = (body, rest = '\nBody text.\n') => `---\n${body}\n---\n${rest}`;
  const kinds = (src) => judgeSource(src).violations.map((v) => v.kind);
  const only = (src) => {
    const v = judgeSource(src).violations;
    return v.length === 1 ? v[0] : null;
  };

  // ── (1) the corpus's ordinary shape is CLEAN ─────────────────────────────
  assert(kinds(page('title: A\ndescription: B')).length === 0, 'a well-formed page is clean');
  assert(
    kinds('---\r\ntitle: A\r\ndescription: B\r\n---\r\nBody\r\n').length === 0,
    'CRLF line endings are clean -- the extractor tolerates them and so must this',
  );
  assert(
    kinds(page('title: A\ndescription: B', '\nText\n\n---\n\nMore text after a horizontal rule\n')).length === 0,
    'a later `---` horizontal rule does not extend the block (the regex is non-greedy)',
  );
  assert(
    kinds(page('title: A\ndescription: B\nicon: Box\nfull: true\ncustom_key: whatever')).length === 0,
    'unknown keys pass -- `pageSchema` is not .strict(), so rejecting them would be a rule invented here',
  );
  assert(
    kinds(page('title: A')).length === 0,
    'a page with NO description is clean -- `pageSchema` marks it optional, and requiring it would be schema growth',
  );

  // ── (2) THE defect, verbatim ─────────────────────────────────────────────
  // The `description` that reached `Build Docs` on the card, character for
  // character. Everything else in this battery is a generalisation of it.
  const THE_DEFECT = page(
    'title: Declarative Endpoints\n' +
      'description: Expose your app to systems outside the platform by declaring an apis: endpoint as metadata.',
  );
  const defect = only(THE_DEFECT);
  assert(defect?.kind === 'frontmatter-parse', `the card's own description is a parse failure -- got ${defect?.kind}`);
  assert(
    defect?.detail.includes('Nested mappings are not allowed in compact mappings'),
    "the parser's OWN message is reported, not a paraphrase of it",
  );
  assert(defect?.detail.includes('BLOCK_AS_IMPLICIT_KEY'), "the parser's error code is reported");
  assert(
    defect?.line === 3 && defect?.col === 14,
    `the FILE line is reported: the defect is on file line 3 (parser says body line 2) -- got ${defect?.line}:${defect?.col}`,
  );
  assert(
    formatViolation({ ...defect, file: 'p.mdx' }).includes('the body begins on file line 2'),
    'a parser-sourced violation says which of the two numbering schemes is which',
  );

  // ── (3) other ways the block fails to parse ──────────────────────────────
  assert(kinds(page('title: A\n\tdescription: B'))[0] === 'frontmatter-parse', 'a tab as indentation is a parse failure');
  assert(kinds(page('title: A\n  description: B'))[0] === 'frontmatter-parse', 'a stray indent is a parse failure');
  assert(kinds(page('- a\n- b'))[0] === 'frontmatter-not-a-mapping', 'a sequence where a mapping belongs is named as such');

  // ── (4) the block that is not there ──────────────────────────────────────
  assert(kinds('# A page with no frontmatter\n')[0] === 'frontmatter-missing', 'no block at all is named directly');
  assert(kinds('---\n---\nBody\n')[0] === 'frontmatter-missing', 'an EMPTY block does not match the extractor either');
  assert(
    kinds('\n---\ntitle: A\n---\nBody\n')[0] === 'frontmatter-missing',
    'a block preceded by a blank line is not frontmatter -- the extractor is anchored at byte 0',
  );

  // ── (5) the two keys `pageSchema` types ──────────────────────────────────
  assert(kinds(page('description: B'))[0] === 'title-missing', 'a missing title is caught');
  const numTitle = only(page('title: 42\ndescription: B'));
  assert(numTitle?.kind === 'title-not-a-string', 'an unquoted numeric title is caught');
  assert(numTitle?.what.includes('a number'), `the message says what it IS -- got ${numTitle?.what}`);
  assert(numTitle?.line === 2, `the offending key's FILE line is reported -- got ${numTitle?.line}`);
  const nullTitle = only(page('title:\ndescription: B'));
  assert(nullTitle?.kind === 'title-not-a-string' && nullTitle.what.includes('null'), 'an empty title is caught');
  assert(only(page('title: true\ndescription: B'))?.what.includes('a boolean'), 'an unquoted boolean title is caught');

  // THE shape a parse-only gate is blind to: one character from the defect in
  // (2), it PARSES, and `Build Docs` fails on zod thirty minutes later.
  const objDesc = only(page('title: A\ndescription:\n  apis: thing'));
  assert(objDesc?.kind === 'description-not-a-string', 'a description that parses to a nested mapping is caught');
  assert(objDesc?.what.includes('nested mapping'), `the message names the shape -- got ${objDesc?.what}`);
  assert(objDesc?.line === 3, `the description key's FILE line is reported -- got ${objDesc?.line}`);
  assert(
    only(page('title: A\ndescription:\n  - one\n  - two'))?.what.includes('an array'),
    'a description that parses to a sequence is caught',
  );

  // Two independent problems are reported together, not one at a time.
  assert(kinds(page('title: 1\ndescription: [x]')).length === 2, 'both key violations are reported in one pass');

  // ── (6) REFUSALS, against real directories ───────────────────────────────
  const { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmp = mkdtempSync(join(tmpdir(), 'doc-frontmatter-'));
  const refuses = (dir, why) => {
    try {
      judgeTree(dir);
      return null;
    } catch (err) {
      return err instanceof Unread ? err.message : `threw ${err?.name}: ${err?.message} (${why})`;
    }
  };
  try {
    const absent = join(tmp, 'no-such-docs-dir');
    const msg1 = refuses(absent);
    assert(msg1?.includes('cannot read the directory'), `a root that does not resolve ⇒ REFUSAL -- got ${msg1}`);

    const empty = join(tmp, 'empty');
    mkdirSync(empty);
    const msg2 = refuses(empty);
    assert(
      msg2?.includes('ZERO .mdx pages') && msg2.includes('refusing to report a pass'),
      `an empty tree ⇒ REFUSAL, never an empty allow-list -- got ${msg2}`,
    );

    // The sneakier zero: the tree is populated, just not with pages.
    const noPages = join(tmp, 'no-pages');
    mkdirSync(join(noPages, 'guides'), { recursive: true });
    writeFileSync(join(noPages, 'meta.json'), '{}\n');
    writeFileSync(join(noPages, 'guides', 'notes.md'), '# not an mdx page\n');
    const msg3 = refuses(noPages);
    assert(msg3?.includes('ZERO .mdx pages'), `a tree with no .mdx ⇒ REFUSAL -- got ${msg3}`);

    // An entry named like a page that cannot be read. Both shapes reach
    // `readFileSync` because nothing is dropped on a dirent type.
    const dangling = join(tmp, 'dangling');
    mkdirSync(dangling);
    writeFileSync(join(dangling, 'ok.mdx'), page('title: A\ndescription: B'));
    symlinkSync(join(dangling, 'nowhere'), join(dangling, 'gone.mdx'));
    const msg4 = refuses(dangling);
    assert(
      msg4?.includes('gone.mdx') && msg4.includes('one page short'),
      `a dangling symlink named like a page ⇒ REFUSAL naming it -- got ${msg4}`,
    );

    const asDir = join(tmp, 'as-dir');
    mkdirSync(join(asDir, 'real'), { recursive: true });
    writeFileSync(join(asDir, 'ok.mdx'), page('title: A\ndescription: B'));
    symlinkSync(join(asDir, 'real'), join(asDir, 'page.mdx'));
    const msg5 = refuses(asDir);
    assert(msg5?.includes('page.mdx'), `a directory wearing a page's name ⇒ REFUSAL naming it -- got ${msg5}`);

    // ...and the same walk, over a tree it CAN read, returns a real verdict.
    // Without this the five assertions above are also satisfied by a gate that
    // refuses unconditionally.
    const good = join(tmp, 'good');
    mkdirSync(join(good, 'references', 'objects'), { recursive: true });
    writeFileSync(join(good, 'index.mdx'), page('title: Home\ndescription: D'));
    writeFileSync(join(good, 'guide.mdx'), page('title: Guide'));
    writeFileSync(join(good, 'references', 'objects', 'gen.mdx'), page('title: Gen\ndescription: D'));
    const verdict = judgeTree(good);
    assert(verdict.findings.length === 0, `a readable clean tree ⇒ a verdict, not a refusal -- got ${JSON.stringify(verdict.findings)}`);
    assert(verdict.pages === 3 && verdict.handwritten === 2 && verdict.generated === 1,
      `the verdict counts hand-written and generated separately -- got ${JSON.stringify(verdict)}`);
    assert(verdict.withDescription === 2, `the verdict counts pages declaring a description -- got ${verdict.withDescription}`);

    // A bad page in a readable tree is a VIOLATION carrying its file, not a refusal.
    writeFileSync(join(good, 'bad.mdx'), THE_DEFECT);
    const red = judgeTree(good);
    assert(
      red.findings.length === 1 && red.findings[0].file.endsWith('bad.mdx') && red.findings[0].kind === 'frontmatter-parse',
      `a bad page in a readable tree is a violation naming the file -- got ${JSON.stringify(red.findings)}`,
    );
    assert(quietly(() => main(good)) === 1, 'main() exits non-zero on a violation');
    assert(quietly(() => main(join(tmp, 'empty'))) === 1, 'main() exits non-zero on a refusal rather than throwing');

    // ── (7) the extraction agrees with the docs build's OWN extractor ──────
    const { createRequire: cr } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    let extract = null;
    let resolveError = null;
    try {
      const req = cr(join(REPO_ROOT, 'apps/docs/package.json'));
      const mod = await import(pathToFileURL(req.resolve('fumadocs-core/content/md/frontmatter')).href);
      extract = mod.frontmatter;
    } catch (err) {
      resolveError = err?.message ?? String(err);
    }
    assert(
      typeof extract === 'function',
      `the docs build's own extractor must be readable from apps/docs, or this gate cannot be shown to read ` +
        `what the build reads -- ${resolveError}`,
    );
    if (typeof extract === 'function') {
      const corpus = [
        page('title: A\ndescription: B'),
        page('title: A'),
        page('title: A\ndescription: B', '\nText\n\n---\n\nAfter a rule\n'),
        '\n---\ntitle: A\n---\nBody\n',
        '# no frontmatter\n',
        '---\n---\nBody\n',
        page('title: A\ndescription:\n  apis: thing'),
        page('title: 42'),
      ];
      for (const src of corpus) {
        const mine = judgeSource(src);
        const theirs = extract(src).data ?? {};
        assert(
          JSON.stringify(mine.data) === JSON.stringify(theirs),
          `this gate and fumadocs read the same frontmatter -- ${JSON.stringify(mine.data)} vs ${JSON.stringify(theirs)}`,
        );
      }
      let threw = false;
      try {
        extract(THE_DEFECT);
      } catch {
        threw = true;
      }
      assert(threw, "the build's extractor throws on the card's page too -- this gate is not inventing a failure");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── (8) WIRING: the gate and its self-test really run in CI ──────────────
  // A gate that exists and is not scheduled is the same dormant shape from the
  // other side. Asserted against the workflow text, not remembered.
  const SELF = 'scripts/check-doc-frontmatter.mjs';
  let lint = null;
  try {
    lint = readFileSync(join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8');
  } catch (err) {
    failures.push(`cannot read .github/workflows/lint.yml to verify wiring: ${err.code ?? err.message}`);
  }
  if (lint !== null) {
    assert(lint.includes(`node ${SELF}\n`), `wiring: lint.yml invokes ${SELF} (no root package.json alias -- #9465 fence)`);
    assert(lint.includes(`node ${SELF} --self-test`), 'wiring: lint.yml runs the --self-test leg too');
  }

  if (failures.length > 0) {
    console.error(`✗ check-doc-frontmatter --self-test — ${failures.length} of ${checked} assertion(s) failed\n`);
    for (const f of failures) console.error(`  • ${f}`);
    return 1;
  }
  console.log(
    `✓ check-doc-frontmatter --self-test: ${checked} assertions — the card's own description observed failing with ` +
      `the parser's message and the FILE line, every other violation kind observed firing, five REFUSALS over real ` +
      `directories (absent root, empty tree, a tree holding no pages, a dangling symlink, a directory wearing a ` +
      `page's name) each proved against a readable tree that still returns a verdict, main() returning 1 rather ` +
      `than throwing on both a violation and a refusal, extraction cross-checked against the docs build's own ` +
      `extractor, and the CI wiring read out of lint.yml.`,
  );
  return 0;
}

// The CLI dispatch is guarded so that IMPORTING this module is inert: the
// judging functions are exported so another tree can be judged, and a module
// that ran its gate on import would silently judge THIS repo instead and print
// a verdict about the wrong subject (`check:entry-guard`).
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(await selfTest());
  process.exit(main());
}

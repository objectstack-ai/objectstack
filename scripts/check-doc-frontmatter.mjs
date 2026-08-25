#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-doc-frontmatter (#10493, #10754) -- every page under EVERY content root
 * `apps/docs/source.config.ts` hands to `defineDocs` carries a leading `---`
 * block the DOCS BUILD'S OWN parser can read, and types the keys that root's
 * OWN schema types.
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
 * ## Two roots, and why the floor is PER ROOT (#10754)
 *
 * `apps/docs/source.config.ts` calls `defineDocs` TWICE. The second call points
 * fumadocs at `content/blog` with `blogSchema`, so `next build` parses those
 * pages with the same extractor and the same `yaml`, and an unquoted
 * `description` holding a colon there is the identical defect -- reaching the
 * identical 30-minute `next build` before anything says so. The first version of
 * this gate walked `content/docs` alone, so the second root was owned by nothing
 * below `Build Docs`.
 *
 * `ROOTS` below is that list, and each entry carries its OWN floor. That is the
 * whole difficulty of the second root, and it is one line of arithmetic:
 *
 *   a UNION count of 403 + 3 is satisfied by 403 + 0.
 *
 * An empty `content/blog` would hide behind the docs root's count, the gate
 * would print a cheerful total, and CI would report coverage the run does not
 * have -- STRICTLY WORSE than not walking the blog at all, because the first
 * state is visible and the second is not. So the floor lives inside
 * `judgeRoot`, which never sees another root, and `judgeAll` collects refusals
 * instead of summing pages. A populated root cannot satisfy an empty root's
 * floor because it is never offered the chance to.
 *
 * `scripts/check-doc-authoring.mjs` reached the same conclusion from the other
 * side and states it in one sentence worth copying: "A total floor is held up by
 * whichever root still has files while another empties". Same invariant, same
 * house shape -- refusal names the root.
 *
 * The floor is 1, deliberately, and it is NOT a ratchet against a recorded
 * high-water mark: `content/blog` holds 3 pages today and a legitimate deletion
 * must not become an argument with a number. It answers exactly one question --
 * "was this root read at all" -- per root.
 *
 * ## The blog root's contract, and the one key it deliberately does not assert
 *
 * `blogSchema` is `pageSchema.extend({ author, date, tags })`, so the blog root
 * inherits both keys above and adds three. Asserting only the inherited pair
 * would leave three of five typed keys unowned on a root this gate claims to
 * cover -- a smaller copy of the coverage-it-does-not-have failure the per-root
 * floor exists to prevent. So each ROOT declares its own key contract, and two
 * of the three extras are asserted:
 *
 *   author: z.string().optional()           -> a string WHEN PRESENT
 *   tags:   z.array(z.string()).optional()  -> an array of strings WHEN PRESENT
 *   date:   z.coerce.string().optional()    -> NOT ASSERTED
 *
 * `date` is not an omission. Measured against the zod the docs app resolves
 * (zod@4.4.3), `z.coerce.string()` accepts every value YAML can produce:
 *
 *   42 -> "42"     true -> "true"     null -> "null"
 *   {a: 1} -> "[object Object]"       ["x"] -> "x"       a Date -> its toString
 *
 * There is no value a frontmatter `date` can hold that the build rejects, so any
 * assertion about it would be a rule invented here rather than the build's --
 * the same line this gate already draws by not requiring `description` to be
 * present. The self-test pins `date` as declared-and-deliberately-unasserted, so
 * a fourth key landing in `blogSchema` fails the battery instead of arriving
 * silently unowned.
 *
 * `tags` is not decoration either: the natural way to get it wrong is ordinary
 * prose, exactly like the colon.
 *
 *   tags: [ai, architecture]   -> an array of strings, clean
 *   tags: ai, architecture     -> one STRING, and a red `Build Docs`
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
 * in which A ROOT was not actually read is exit 1 naming THAT ROOT, never a
 * quiet pass (#4690):
 *
 *   - the root does not resolve;
 *   - the walk resolves to fewer than that root's own floor -- an empty tree, or
 *     one holding no `.mdx`;
 *   - any entry cannot be read -- a dangling symlink, a directory where a page
 *     should be, a permission error;
 *   - `ROOTS` itself is empty, which is every root evaporating at once.
 *
 * Each of those is judged with one root in hand and no knowledge of the others,
 * and a refusal on one root does not suppress the verdict on another: a run over
 * a clean `content/docs` and an emptied `content/blog` prints the docs verdict,
 * prints the blog REFUSAL, and exits 1. Reading that output is how you tell this
 * gate from the union it must not be.
 *
 * Every `.mdx`-named entry is a read candidate and `readFileSync` is the sole
 * authority on whether it can be read; nothing is skipped on the strength of a
 * dirent type. That is what keeps an unreadable page from leaving the count
 * quietly one smaller, which is the same "not measured, reported as measured
 * and clean" shape one level down.
 *
 * ## Wiring
 *
 * Invoked from `.github/workflows/lint.yml` as `node scripts/...` directly, both
 * legs, rather than through a `pnpm check:*` alias: see the GATE INVOCATION
 * IDIOM note at the top of that file, which states the reasons once. It is NOT
 * because root `package.json` is off limits -- that reading of the #9465 fence
 * is false, and the note carries the fence's verbatim scope so this docblock
 * does not have to: restating it is how the wrong reading spread (#10894).
 * The self-test asserts that wiring against the workflow text -- a gate that
 * exists and is not scheduled is the same dormant shape from the other side.
 *
 * Adding the second root needed NO workflow edit: the step already invokes this
 * script, and `ROOTS` is read from here. `lint.yml` is the repo's busiest file
 * and a second step would have been a third concurrent edit of it.
 *
 * ## The list is pinned to `source.config.ts`, so a THIRD root cannot arrive unowned
 *
 * This card exists because a root was added to `source.config.ts` and nothing
 * downstream noticed. Fixing the instance without closing the class would leave
 * the next `defineDocs` call in exactly the same position, so the self-test
 * parses `apps/docs/source.config.ts` and asserts SET EQUALITY between the
 * `dir:` of every `defineDocs` call there and the `dir` of every entry here --
 * plus a count cross-check, so a call spelled in a way the parser cannot see
 * fails the battery instead of reading as zero extra roots.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDependency } from './import-prerequisite.mjs';
const { parse, parseDocument } = await requireDependency('yaml', () => import('yaml'), import.meta.url);

import { isEntrypoint } from './invoked-as.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');

// ---------------------------------------------------------------------------
// The key contracts -- one per schema `source.config.ts` hands to `defineDocs`
// ---------------------------------------------------------------------------

/** A key the schema types as a string. */
const AS_STRING = {
  typeKind: 'not-a-string',
  expected: 'a string',
  is: (v) => typeof v === 'string',
};

/** A key the schema types as `z.array(z.string())`. */
const AS_STRING_ARRAY = {
  typeKind: 'not-an-array-of-strings',
  expected: 'an array of strings',
  is: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
};

/**
 * `fumadocs-core/source/schema`'s `pageSchema` -- the schema `defineDocs` gets
 * for `content/docs`, and the base `blogSchema` extends.
 *
 *   title:       z.string()             // REQUIRED
 *   description: z.string().optional()  // optional, but typed WHEN PRESENT
 *
 * `icon`, `full` and `_openapi` are likewise `pageSchema`'s and likewise not
 * asserted, and unknown keys pass because `pageSchema` is not `.strict()`.
 */
export const PAGE_KEYS = [
  {
    key: 'title',
    required: true,
    ...AS_STRING,
    detailMissing: '`pageSchema` declares `title: z.string()`, so a page without one fails the site build.',
    detailType:
      '`pageSchema` declares `title: z.string()`. YAML types an unquoted scalar by its shape, ' +
      'so quote it to keep it a string.',
  },
  {
    // Presence is deliberately NOT asserted: the build does not require it, and
    // a rule the build does not have is one invented here.
    key: 'description',
    required: false,
    ...AS_STRING,
    detailType:
      '`pageSchema` declares `description: z.string().optional()`. A `word: word` inside an unquoted ' +
      'description that YAML can read as a nested mapping yields an object here rather than throwing -- ' +
      'the shape one character away from the parse failure this gate was written for. Quote the scalar.',
  },
];

/**
 * `blogSchema` = `pageSchema.extend({ author, date, tags })`. Two of the three
 * extras are typed in a way a frontmatter value can violate; see the header for
 * the measurement that puts `date` in `BLOG_KEYS_UNASSERTED` instead.
 */
export const BLOG_KEYS = [
  ...PAGE_KEYS,
  {
    key: 'author',
    required: false,
    ...AS_STRING,
    detailType:
      '`blogSchema` declares `author: z.string().optional()`. YAML types an unquoted scalar by its ' +
      'shape, so quote it to keep it a string.',
  },
  {
    key: 'tags',
    required: false,
    ...AS_STRING_ARRAY,
    detailType:
      '`blogSchema` declares `tags: z.array(z.string()).optional()`. `tags: a, b` is ONE unquoted ' +
      'scalar to YAML, not two items -- write the flow sequence `tags: [a, b]` or a block sequence.',
  },
];

/**
 * Keys a root's schema declares that this gate deliberately does NOT assert,
 * with the reason. Pinned by the self-test against `source.config.ts`, so the
 * list is a decision on the record rather than a gap.
 */
export const BLOG_KEYS_UNASSERTED = [
  {
    key: 'date',
    why:
      '`z.coerce.string().optional()` stringifies its input before validating, so every value YAML ' +
      'can produce is accepted (42, true, null, a mapping, a sequence -- measured against zod@4.4.3). ' +
      'There is no frontmatter `date` the build rejects, so any assertion here would be ours, not the build\'s.',
  },
];

// ---------------------------------------------------------------------------
// The roots -- each with its OWN floor
// ---------------------------------------------------------------------------

/**
 * Every content root `apps/docs/source.config.ts` hands to `defineDocs`.
 *
 * `minPages` is per root ON PURPOSE and the header argues why at length: a union
 * count of 403 + 3 is satisfied by 403 + 0, so an emptied `content/blog` would
 * be covered by the docs root and CI would report coverage the run does not
 * have. `judgeRoot` is handed one entry and can see no other, which is what
 * makes that structurally impossible rather than merely intended.
 *
 * The self-test pins this list against `source.config.ts` -- a third
 * `defineDocs` call cannot arrive unowned.
 */
export const ROOTS = [
  {
    name: 'docs',
    dir: join(REPO_ROOT, 'content/docs'),
    configExport: 'docs',
    schemaName: 'pageSchema',
    keys: PAGE_KEYS,
    unasserted: [],
    /** The generated half, reported separately so the verdict says what it read. */
    generatedPrefix: 'references/',
    minPages: 1,
  },
  {
    name: 'blog',
    dir: join(REPO_ROOT, 'content/blog'),
    configExport: 'blog',
    schemaName: 'blogSchema',
    keys: BLOG_KEYS,
    unasserted: BLOG_KEYS_UNASSERTED,
    /** No generated half: nothing writes into `content/blog`. */
    generatedPrefix: null,
    minPages: 1,
  },
];

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
 * Judge one page's SOURCE TEXT against `keys`. Returns `{ violations, data }`.
 *
 * `keys` is the contract of the ROOT the page came from -- `PAGE_KEYS` for
 * `content/docs`, `BLOG_KEYS` for `content/blog`. Everything above the key loop
 * is the extraction, which is the build's own and therefore the same for every
 * root; only the key contract differs.
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
export function judgeSource(source, keys = PAGE_KEYS) {
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

  for (const spec of keys) {
    if (!(spec.key in data)) {
      // An optional key that is absent is not a finding: the schema marks it
      // optional, and requiring it would be a rule invented here.
      if (spec.required) {
        violations.push({
          kind: `${spec.key}-missing`,
          line: 1,
          col: 1,
          what: `no \`${spec.key}\` in frontmatter`,
          detail: spec.detailMissing,
        });
      }
      continue;
    }
    const value = data[spec.key];
    if (!spec.is(value)) {
      violations.push({
        kind: `${spec.key}-${spec.typeKind}`,
        line: fileLineOfKey(body, spec.key) ?? FRONTMATTER_BODY_FIRST_LINE,
        col: 1,
        what: `\`${spec.key}\` parses to ${describeAgainst(spec, value)}, not ${spec.expected}`,
        detail: spec.detailType,
      });
    }
  }

  return { data, violations };
}

/**
 * What a value IS, said against what the key EXPECTED.
 *
 * For an array-of-strings key an array is not enough information -- `tags: [1]`
 * and `tags: [a]` are both "an array" -- so the offending item is named.
 */
function describeAgainst(spec, v) {
  if (spec.typeKind === AS_STRING_ARRAY.typeKind && Array.isArray(v)) {
    const i = v.findIndex((x) => typeof x !== 'string');
    if (i !== -1) return `an array whose item ${i + 1} is ${describe(v[i])}`;
  }
  return describe(v);
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
 * Walk ONE root and judge every page in it. Throws `Unread` -- never returns a
 * verdict -- for any state in which THAT ROOT was not actually read.
 *
 * This function is handed one root and is given no way to see another. That is
 * the mechanism behind the per-root floor rather than a convention about it: it
 * cannot let a populated root satisfy an empty root's floor because it is never
 * offered the other root's count. `judgeAll` keeps it that way by collecting
 * refusals instead of summing pages.
 */
export function judgeRoot(root) {
  const pages = collectPages(root.dir);

  if (pages.length < root.minPages) {
    throw new Unread(
      `the \`${root.name}\` root: walked ${rel(root.dir)} and found ${pages.length} .mdx page(s), below its own ` +
        `floor of ${root.minPages} -- so this root was not verified and no other root's count can stand in for it. ` +
        'A gate that walks nothing and prints OK is the defect this one was written to close (#7484 / #4690).',
    );
  }

  const findings = [];
  let generated = 0;
  let handwritten = 0;
  /** How many pages declare each key -- the verdict says what it actually read. */
  const declared = new Map(root.keys.map((k) => [k.key, 0]));

  for (const page of pages) {
    const r = rel(page);
    if (root.generatedPrefix && relative(root.dir, page).startsWith(root.generatedPrefix)) generated++;
    else handwritten++;

    let source;
    try {
      source = readFileSync(page, 'utf8');
    } catch (err) {
      throw new Unread(
        `the \`${root.name}\` root: cannot read ${r}: ${err.code ?? err.message} -- refusing to report a pass ` +
          'over a corpus one page short.',
      );
    }

    const { data, violations } = judgeSource(source, root.keys);
    if (data && typeof data === 'object') {
      for (const spec of root.keys) if (spec.key in data) declared.set(spec.key, declared.get(spec.key) + 1);
    }
    for (const v of violations) findings.push({ ...v, file: r });
  }

  return { pages: pages.length, generated, handwritten, declared, findings };
}

/**
 * Judge every declared root, INDEPENDENTLY. Returns `{ reports, refusals }`.
 *
 * Nothing here adds two roots' page counts together, and a refusal on one root
 * does not stop the others from being judged: a run over a clean `content/docs`
 * and an emptied `content/blog` yields one report and one refusal, which is the
 * output that distinguishes this from the union it must not be.
 *
 * An empty `ROOTS` is itself a refusal -- every root evaporating at once is the
 * same "not measured, reported as measured" shape one level up.
 */
export function judgeAll(roots = ROOTS) {
  const reports = [];
  const refusals = [];

  if (!Array.isArray(roots) || roots.length === 0) {
    refusals.push({
      root: null,
      message:
        'no content roots are declared, so nothing was verified -- refusing to report a pass. `ROOTS` must ' +
        'mirror every `defineDocs` call in apps/docs/source.config.ts.',
    });
    return { reports, refusals };
  }

  for (const root of roots) {
    try {
      reports.push({ root, ...judgeRoot(root) });
    } catch (err) {
      if (!(err instanceof Unread)) throw err;
      refusals.push({ root, message: err.message });
    }
  }

  return { reports, refusals };
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

/** One root's verdict line -- what it read, per key, in that root's own terms. */
function formatRootVerdict(report) {
  const { root } = report;
  const split = root.generatedPrefix
    ? ` — ${report.handwritten} hand-written + ${report.generated} generated under ${root.generatedPrefix}`
    : '';
  const keys = root.keys.map((spec) =>
    spec.required
      ? `\`${spec.key}\` present and ${spec.expected} on all ${report.pages}`
      : `\`${spec.key}\` ${spec.expected} on the ${report.declared.get(spec.key)} that declare one`,
  );
  const unasserted = root.unasserted.length
    ? ` Not asserted: ${root.unasserted.map((u) => `\`${u.key}\``).join(', ')} — see the header.`
    : '';
  return (
    `✓ ${rel(root.dir)} (${root.schemaName}, floor ${root.minPages}): ${report.pages} page(s) parse with ` +
    `yaml@${parserVersion()}, the parser the docs build resolves${split}. ${keys.join('; ')} ` +
    `(presence of an optional key is not required — the schema marks it optional).${unasserted}`
  );
}

/** The live run. */
export function main(roots = ROOTS) {
  const list = process.argv.includes('--list');
  const { reports, refusals } = judgeAll(roots);

  if (list) {
    for (const { root } of reports) {
      console.log(`# ${rel(root.dir)}`);
      for (const page of collectPages(root.dir)) {
        const { data, violations } = judgeSource(readFileSync(page, 'utf8'), root.keys);
        const title = data && typeof data.title === 'string' ? JSON.stringify(data.title) : '(none)';
        const desc = data && typeof data.description === 'string' ? 'description' : '—';
        console.log(`${violations.length ? '✗' : '·'} ${rel(page)}  title=${title}  ${desc}`);
      }
    }
  }

  // Refusals first, and never netted against another root's verdict. A root
  // that WAS read still prints its verdict below, so the output shows exactly
  // which roots were covered and which were not -- the whole point of #10754.
  if (refusals.length > 0) {
    for (const r of refusals) console.error(`✗ check-doc-frontmatter: ${r.message}`);
    for (const report of reports) console.error(formatRootVerdict(report));
    console.error(
      `\n${refusals.length} of ${roots.length} declared root(s) could not be verified. Each root carries its own ` +
        "floor precisely so a populated root cannot report coverage on an empty one's behalf.",
    );
    return 1;
  }

  const findings = reports.flatMap((r) => r.findings.map((v) => ({ ...v, root: r.root })));
  if (findings.length > 0) {
    const scanned = reports.reduce((n, r) => n + r.pages, 0);
    console.error(
      `✗ check-doc-frontmatter: ${findings.length} problem(s) across ${scanned} page(s) in ` +
        `${reports.map((r) => rel(r.root.dir)).join(' + ')}\n`,
    );
    for (const v of findings) console.error(`${formatViolation(v)}\n`);
    console.error(
      'Frontmatter is parsed by the site build with the same parser used here, so each of these is a red ' +
        '`Build Docs` — a full `next build` — reporting it 30 minutes later.',
    );
    return 1;
  }

  for (const report of reports) console.log(formatRootVerdict(report));
  console.log(
    `✓ check-doc-frontmatter: ${reports.length} content root(s) verified, each against its own floor — ` +
      `${reports.map((r) => `${rel(r.root.dir)} ${r.pages}`).join(', ')}.`,
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
 * The TREE half also carries this gate's central assertion (#10754): two real
 * roots, one of them emptied, judged together. The refusal must name the empty
 * root while the populated one still returns its own clean verdict -- and the
 * populated one is deliberately given TWELVE pages, so the run is observed
 * refusing while the global count is comfortably positive. That is the single
 * observation a naive two-root union cannot reproduce, and both declaration
 * orders are checked so the result cannot come from a fold's accumulator.
 *
 * A third leg cross-checks the extraction against the docs build's OWN
 * extractor, resolved from `apps/docs`. It is what keeps the copied regex from
 * drifting into a private idea of where a page's frontmatter starts. If that
 * module cannot be resolved the leg FAILS -- it does not skip; a leg that
 * silently opts out is the same dormant shape one level up.
 *
 * A fourth leg pins `ROOTS` and the blog key contract against
 * `apps/docs/source.config.ts` itself. The gap this gate closes was created by
 * adding a `defineDocs` call, so a third one -- or a fourth `blogSchema` key --
 * must fail this battery rather than arrive unowned.
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
  /** A root descriptor over a temp dir -- the real shape `ROOTS` holds. */
  const rootAt = (dir, over = {}) => ({
    name: 'tmp',
    dir,
    configExport: 'tmp',
    schemaName: 'pageSchema',
    keys: PAGE_KEYS,
    unasserted: [],
    generatedPrefix: 'references/',
    minPages: 1,
    ...over,
  });
  const refuses = (dir, why) => {
    try {
      judgeRoot(rootAt(dir));
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
      msg2?.includes('found 0 .mdx page(s), below its own floor of 1') && msg2.includes("no other root's count"),
      `an empty tree ⇒ REFUSAL naming its OWN floor, never an empty allow-list -- got ${msg2}`,
    );

    // The sneakier zero: the tree is populated, just not with pages.
    const noPages = join(tmp, 'no-pages');
    mkdirSync(join(noPages, 'guides'), { recursive: true });
    writeFileSync(join(noPages, 'meta.json'), '{}\n');
    writeFileSync(join(noPages, 'guides', 'notes.md'), '# not an mdx page\n');
    const msg3 = refuses(noPages);
    assert(msg3?.includes('below its own floor'), `a tree with no .mdx ⇒ REFUSAL -- got ${msg3}`);

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
    const verdict = judgeRoot(rootAt(good));
    assert(verdict.findings.length === 0, `a readable clean tree ⇒ a verdict, not a refusal -- got ${JSON.stringify(verdict.findings)}`);
    assert(verdict.pages === 3 && verdict.handwritten === 2 && verdict.generated === 1,
      `the verdict counts hand-written and generated separately -- got ${verdict.pages}/${verdict.handwritten}/${verdict.generated}`);
    assert(verdict.declared.get('description') === 2, `the verdict counts pages declaring a description -- got ${verdict.declared.get('description')}`);
    // A root with no generated half counts every page as hand-written rather
    // than reporting a `references/` split it does not have.
    const noSplit = judgeRoot(rootAt(good, { generatedPrefix: null }));
    assert(noSplit.handwritten === 3 && noSplit.generated === 0,
      `a root with no generated prefix reports no split -- got ${noSplit.handwritten}/${noSplit.generated}`);

    // A bad page in a readable tree is a VIOLATION carrying its file, not a refusal.
    writeFileSync(join(good, 'bad.mdx'), THE_DEFECT);
    const red = judgeRoot(rootAt(good));
    assert(
      red.findings.length === 1 && red.findings[0].file.endsWith('bad.mdx') && red.findings[0].kind === 'frontmatter-parse',
      `a bad page in a readable tree is a violation naming the file -- got ${JSON.stringify(red.findings)}`,
    );
    assert(quietly(() => main([rootAt(good)])) === 1, 'main() exits non-zero on a violation');
    assert(
      quietly(() => main([rootAt(join(tmp, 'empty'))])) === 1,
      'main() exits non-zero on a refusal rather than throwing',
    );

    // ── (6b) THE per-root floor: an empty root refuses ON ITS OWN ─────────
    // #10754's whole acceptance bar, and it is one line of arithmetic: a union
    // count of 403 + 3 is satisfied by 403 + 0. So it is asserted as
    // arithmetic rather than as intent -- the surviving root is deliberately
    // LARGE, and the assertion below records that the run refused while the
    // global count was 12. A union gate is green in exactly that state.
    const rootA = join(tmp, 'root-a'); // stands in for content/docs
    const rootB = join(tmp, 'root-b'); // stands in for content/blog
    mkdirSync(rootA);
    mkdirSync(rootB);
    for (let i = 0; i < 12; i++) writeFileSync(join(rootA, `p${i}.mdx`), page('title: A\ndescription: B'));
    writeFileSync(join(rootB, 'post.mdx'), page('title: P\ndescription: D'));
    const pair = () => [rootAt(rootA, { name: 'a' }), rootAt(rootB, { name: 'b' })];

    const both = judgeAll(pair());
    assert(
      both.refusals.length === 0 && both.reports.length === 2 && both.reports.every((r) => r.findings.length === 0),
      `two populated roots ⇒ two verdicts and no refusal -- got ${both.reports.length}/${both.refusals.length}`,
    );
    assert(quietly(() => main(pair())) === 0, 'main() exits 0 when every root meets its own floor');

    // Empty ONE root. The other keeps 12 pages, which is the union's blind spot.
    rmSync(join(rootB, 'post.mdx'));
    const emptied = judgeAll(pair());
    assert(emptied.refusals.length === 1, `emptying one root ⇒ exactly one refusal -- got ${emptied.refusals.length}`);
    assert(
      emptied.refusals[0].root?.name === 'b' && emptied.refusals[0].message.includes('root-b'),
      `the refusal NAMES the root that was not read -- got ${emptied.refusals[0]?.message}`,
    );
    assert(
      emptied.reports.length === 1 && emptied.reports[0].root.name === 'a' && emptied.reports[0].findings.length === 0,
      'the OTHER root still returns its own clean verdict -- a refusal is per root, not a whole-run abort',
    );
    // The negative control that separates this from the naive union: at the
    // moment of that refusal, 12 pages HAD been read across the declared roots.
    assert(
      emptied.reports[0].pages === 12,
      `the refusal stands while the global count is 12 -- got ${emptied.reports[0].pages}`,
    );
    assert(quietly(() => main(pair())) === 1, 'main() exits 1 on the empty root though 12 pages were read');

    // ...and with the roles swapped, so the verdict cannot depend on the order
    // roots are declared in (a fold that carried a running total would).
    const swapped = judgeAll([rootAt(rootB, { name: 'b' }), rootAt(rootA, { name: 'a' })]);
    assert(
      swapped.refusals.length === 1 && swapped.refusals[0].root?.name === 'b' && swapped.reports.length === 1,
      'the empty root refuses whichever position it is declared in',
    );

    // Every root evaporating at once is a refusal too, not a vacuous pass.
    const none = judgeAll([]);
    assert(
      none.refusals.length === 1 && none.reports.length === 0 && none.refusals[0].message.includes('no content roots'),
      `an empty ROOTS list ⇒ REFUSAL -- got ${JSON.stringify(none.refusals)}`,
    );
    assert(quietly(() => main([])) === 1, 'main() refuses when no roots are declared at all');

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

  // ── (9) the blog root's OWN keys, each observed firing ──────────────────
  const bkinds = (s) => judgeSource(s, BLOG_KEYS).violations.map((v) => v.kind);
  const bonly = (s) => {
    const v = judgeSource(s, BLOG_KEYS).violations;
    return v.length === 1 ? v[0] : null;
  };

  assert(
    bkinds(
      page('title: A\ndescription: B\nauthor: ObjectStack Team\ndate: 2026-07-17\ntags: [ai, architecture]'),
    ).length === 0,
    "a real content/blog frontmatter shape is clean under the blog root's contract",
  );
  const badAuthor = bonly(page('title: A\nauthor: 42'));
  assert(badAuthor?.kind === 'author-not-a-string', `an unquoted numeric author is caught -- got ${badAuthor?.kind}`);

  // The way `tags` is actually got wrong: prose. YAML reads it as ONE scalar.
  const badTags = bonly(page('title: A\ntags: ai, architecture'));
  assert(
    badTags?.kind === 'tags-not-an-array-of-strings',
    `tags written as prose is one string, and is caught -- got ${badTags?.kind}`,
  );
  assert(badTags?.what.includes('a string'), `the message says what it IS -- got ${badTags?.what}`);
  const badItem = bonly(page('title: A\ntags: [ai, 42]'));
  assert(
    badItem?.kind === 'tags-not-an-array-of-strings' && badItem.what.includes('item 2 is a number'),
    `a non-string ITEM is named by position, not reported as "an array" -- got ${badItem?.what}`,
  );

  // `date` is declared-and-deliberately-unasserted: `z.coerce.string()` accepts
  // every one of these, so asserting any of them would be a rule invented here.
  for (const d of ['date: 2026-07-17', 'date: 42', 'date: true', 'date:', 'date:\n  y: 1']) {
    assert(bkinds(page(`title: A\n${d}`)).length === 0, `\`date\` is not asserted -- ${JSON.stringify(d)}`);
  }

  // The widening must not leak the blog's keys onto the docs root.
  assert(
    judgeSource(page('title: A\ntags: ai, architecture'), PAGE_KEYS).violations.length === 0,
    'the blog keys stay on the blog root -- PAGE_KEYS is what `content/docs` is still judged against',
  );

  // ── (10) ROOTS is pinned to `apps/docs/source.config.ts` ────────────────
  // This card exists because a root was added there and nothing noticed. The
  // parity below is what stops a THIRD one arriving unowned.
  let config = null;
  try {
    config = readFileSync(join(REPO_ROOT, 'apps/docs/source.config.ts'), 'utf8');
  } catch (err) {
    failures.push(`cannot read apps/docs/source.config.ts to verify ROOTS: ${err.code ?? err.message}`);
  }
  if (config !== null) {
    const dirs = [...config.matchAll(/dir:\s*path\.resolve\(\s*process\.cwd\(\)\s*,\s*'([^']+)'\s*\)/g)].map((m) =>
      m[1].replace(/^\.\.\/\.\.\//, ''),
    );
    const calls = (config.match(/defineDocs\(/g) ?? []).length;
    // A source scan sees only the spellings it knows, and an unseen call would
    // read as "no extra root" -- silently. So the count is the positive control.
    assert(
      calls > 0 && calls === dirs.length,
      `every defineDocs call's dir is readable here -- ${calls} call(s), ${dirs.length} dir(s) parsed`,
    );
    const declaredDirs = JSON.stringify(ROOTS.map((r) => rel(r.dir)).sort());
    assert(
      JSON.stringify(dirs.slice().sort()) === declaredDirs,
      `ROOTS mirrors every defineDocs root -- config ${JSON.stringify(dirs.slice().sort())} vs ROOTS ${declaredDirs}`,
    );
    assert(/schema:\s*pageSchema/.test(config), 'the docs root is still handed `pageSchema` unextended');

    const ext = /const blogSchema = pageSchema\.extend\(\{([\s\S]*?)\}\);/.exec(config);
    assert(ext !== null, 'blogSchema is still `pageSchema.extend({ ... })`, which is what BLOG_KEYS mirrors');
    if (ext) {
      const extKeys = [...new Set([...ext[1].matchAll(/^\s+(\w+):/gm)].map((m) => m[1]))].sort();
      const blogRoot = ROOTS.find((r) => r.name === 'blog');
      const accounted = [
        ...blogRoot.keys.filter((k) => !PAGE_KEYS.includes(k)).map((k) => k.key),
        ...blogRoot.unasserted.map((u) => u.key),
      ].sort();
      assert(
        JSON.stringify(extKeys) === JSON.stringify(accounted),
        `every blogSchema extension key is asserted or explicitly unasserted -- config ${JSON.stringify(extKeys)} ` +
          `vs accounted ${JSON.stringify(accounted)}`,
      );
    }
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
    assert(lint.includes(`node ${SELF}\n`), `wiring: lint.yml invokes ${SELF} directly (lint.yml's GATE INVOCATION IDIOM note, not a package.json fence)`);
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
      `page's name) each proved against a readable tree that still returns a verdict, the PER-ROOT floor observed ` +
      `refusing an emptied root in both declaration orders while a sibling root's 12 pages stayed green (the one ` +
      `observation a naive union cannot reproduce) and an empty ROOTS refusing too, the blog root's \`author\` and ` +
      `\`tags\` observed firing with \`date\` pinned as deliberately unasserted, main() returning 1 rather ` +
      `than throwing on both a violation and a refusal, extraction cross-checked against the docs build's own ` +
      `extractor, ROOTS pinned against every defineDocs call in source.config.ts, and the CI wiring read out of ` +
      `lint.yml.`,
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

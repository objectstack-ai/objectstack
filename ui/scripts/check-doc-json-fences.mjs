#!/usr/bin/env node
/**
 * Every fenced `json` / `jsonc` NODE DOCUMENT on this gate's scan surface —
 * `content/docs`, every package's own `README.md`, the root `README.md` and
 * the published skill bundle `skills/objectui/**` (`SCAN_SURFACE`) — must pass
 * the STRICT AUTHORING FACE — `StrictAnyComponentSchema`, the face `objectui
 * validate` and `objectui check` judge an authored document with.
 *
 * Run:  node scripts/check-doc-json-fences.mjs          (also `pnpm check:doc-json`)
 *       node scripts/check-doc-json-fences.mjs --list   (also print every fence and
 *                                                        the bucket it fell in)
 * Exit: 0 = every judged node document is accepted or carries a declaration the
 *       face confirms, every declaration is attached and needed, and the
 *       harness proved itself on its own controls.
 *       1 = THE GATE RAN AND FOUND ERRORS. A node document is refused, or a
 *       declaration is stale, dangling or unexplained. Everything printed above
 *       the summary is a verdict about a document.
 *       2 = THE GATE COULD NOT RUN, so nothing printed above is a verdict about
 *       any document: `@object-ui/types` is not built, the JSONC reader cannot
 *       be resolved, a control failed, or the enumeration came back empty or
 *       without one of its legs' anchor pages. Fix the tree and re-run. Never
 *       read this as a documentation defect, and never as a pass.
 *
 * The three codes are the sibling gate's (`scripts/check-doc-snippet-types.mjs`,
 * its "Why could not run is its own exit code" section), for the same reason.
 *
 * ## Why this exists (objectui#5250)
 *
 * The ts/tsx snippet gate reads `ts` / `tsx` / `typescript` fences and nothing
 * else, so a `json` fence was checked by nothing: objectui#5229 taught
 * `"validation": { … }` on an `input` node in `content/docs/blocks/forms.mdx`
 * while every shipped tool was green. And a gate that parsed those fences
 * against the TOLERANT face would have caught nothing either, because
 * `BaseSchemaCore` is `.passthrough()`. The maintainer ruling on objectui#5250
 * (2026-09-04, decision batch #25, option 2) ordered both halves, in this order:
 * "each node schema gets a derived strict variant; `objectui validate` and the
 * doc-snippet gates run **strict**", and "a JSON-fence gate (option 1) is then
 * built **on top of** the strict face — ⛔ not before it". The strict face is
 * objectui#8345; `objectui validate` / `objectui check` moved onto it in slice A
 * (`validateAuthoredDocument`, `packages/cli/src/utils/authoring-face.ts`).
 * This gate is that ruling's JSON-fence slice.
 *
 * ## One authority: the face the CLI imports, built
 *
 * The verdict here is `StrictAnyComponentSchema.safeParse(document).success`,
 * read from `@object-ui/types`' BUILT `./zod` entry — the module
 * `@object-ui/cli` resolves at runtime for `validateAuthoredDocument`, whose
 * whole body is that same call. So a document this gate accepts is a document
 * `objectui validate` accepts, and the reverse, by construction rather than by
 * a second copy of the rule. `scripts/__tests__/check-doc-json-fences.test.ts`
 * pins the agreement by running the CLI's own door over the same corpus.
 *
 * The tolerant face (`AnyComponentSchema`) is read too, for the WORDS only: a
 * refusal it does not share is reported as "strict-only — every reason is an
 * undeclared key". It decides nothing.
 *
 * ⛔ Not from `src/`. The repository's root `tsconfig.json` maps
 * `@object-ui/types` to source, which is one inherited config away from judging
 * the docs against a face nobody installs; the RESOLUTION control below prints
 * the resolved file and refuses one outside the package's `dist/`. The
 * workflow (`repo-gates.yml`, objectui#12214) runs this gate after it has built
 * every package plus the snippet gate's `--build-filter` closure, which carries
 * `@object-ui/types`.
 *
 * ## The scan surface, declared once (objectui#12131)
 *
 * `SCAN_SURFACE` below is everything this gate reads: one leg per entry, in
 * walk order, and the summary prints it leg by leg with the pages each leg
 * collected. Four legs:
 *
 *   1. every `.mdx` / `.md` page under `content/docs` — the population
 *      objectui#5250's measurement priced;
 *   2. every package's own `README.md`, `packages/NAME/README.md`;
 *   3. the root `README.md`;
 *   4. every `.md` page under `skills/objectui/` — the published skill bundle
 *      (objectui#12204).
 *
 * Leg 4 is a governed, published surface whose fences belong to its owner
 * (objectui#12135), and it joined on that owner's ruling: the json/jsonc
 * examples there are the ones a customer's agent copies through
 * `npx skills add`, and `scripts/check-skill-examples.mjs` holds them to PARSE
 * only — it judges no validity. That gate's opt-in line sits directly above
 * every one of those fences; how a declaration for THIS gate coexists with it
 * is `SKILL_OPT_IN_LINE` below. The leg collects `.md` only, which is what the
 * bundle is made of and what the sibling gate's walk of the same tree
 * collects, so the two gates read the same pages there. `.claude/skills/**`,
 * the internal agent tooling, is not this leg and stays off the surface.
 *
 * Legs 2 and 3 are the published READMEs, and they joined because this gate
 * was green while three README examples were refused by `objectui validate`
 * (objectui#12131): the root README's form and dashboard, and a table in
 * `packages/plugin-dashboard/README.md`. That card's first phase repaired the
 * three; these legs keep them covered. Both legs are IMPORTED from
 * `check-doc-component-types.mjs` (`PACKAGE_READMES` / `packageReadmePages`,
 * `ROOT_PAGES`) rather than spelled again here: they are the README legs the
 * doc-gate family already walks, so this gate reads the READMEs its siblings
 * read, and a change to the family's legs moves this gate with them.
 *
 * Why a package's OWN README and not every `README*.md` in the tree: the own
 * README is the page published with the package — npm packs it whatever
 * `files` says, and `vsce publish` makes the VS Code extension's its
 * Marketplace page, so a `private` flag is not a "not published" predicate. A
 * README below a package root is published only when the package's `files`
 * reaches it. When objectui#12131 measured that with `npm pack --dry-run` per
 * package, none did — a dated reading, ⛔ not re-derived by this gate. So the
 * deliberately refused `onCardMove` example in `README-KANBAN.md`, under
 * `packages/components/src/renderers/complex/`, stays off the surface with no
 * marker. If that page ever ships, it joins and owes a `doc-json: fragment`
 * declaration.
 *
 * ⛔ Off the surface on purpose, and not to be widened onto as a side effect:
 * `docs/audits/**` — point-in-time records, not teaching surfaces; triage on
 * objectui#12131 kept them out of this scan, and a block inside a record is
 * not this gate's to repair. CHANGELOGs and `.changeset/` are history.
 *
 * ## What a "node document" is — the population, stated
 *
 * The predicate `scripts/measure-strict-authoring-face.mjs` measured the
 * programme with (objectui#7581), with two corrections, both toward reading
 * MORE:
 *
 *   1. a fence whose language (the first token of its info string,
 *      case-insensitive) is `json` or `jsonc`;
 *   2. whose body parses — `json` with `JSON.parse`, the reader `objectui
 *      validate` uses; `jsonc` with `jsonc-parser` and the options `objectui
 *      check` reads a `.json` file with (comments, trailing commas). ⚠️
 *      Correction one: the measurement read `jsonc` with `JSON.parse` too, so
 *      every `jsonc` fence carrying a comment fell out of its population while
 *      teaching keys like any other;
 *   3. into a plain object with a string `type`;
 *   4. whose `type` names an arm of `AnyComponentSchema` (walked through its
 *      unions and lazies, by the `type` literals each object arm declares).
 *
 * ⚠️ Correction two: a fence inside a blockquote is read, its quote prefix
 * stripped the way the sibling gate strips it. The measurement's scanner did
 * not see quoted fences at all.
 *
 * Everything else is NOT JUDGED, and is counted rather than skipped in silence:
 * the summary prints each bucket (not JSON · not an object · no string `type` ·
 * a `type` no node schema declares, with the types), and `--list` prints every
 * fence with its bucket. A `type` no arm declares is refused by the tolerant
 * face as well; whether a `type` literal names a registered component is
 * `scripts/check-doc-component-types.mjs`'s question, not this gate's.
 *
 * ## The rule for fragments: a declaration the face confirms
 *
 * A node document that is deliberately not a complete, valid one — a
 * deliberately refused example that shows the error, an excerpt whose required
 * keys the page elides, an object whose `type` happens to collide with a node
 * type but is not a node — must be DECLARED by a marker line immediately above
 * its fence, at the fence's own quote depth, carrying a written reason. The two
 * spellings are quoted in `FRAGMENT_MARKER_EXAMPLES` (a block comment cannot
 * quote them). The keyword is `fragment` for every kind, as in the sibling
 * gate; the reason says which kind. ⛔ The namespace is `doc-json:`, not
 * `doc-snippet:`, on purpose: the sibling gate reports a `doc-snippet:` marker
 * that sits above anything but a ts/tsx fence as stale, so one spelling cannot
 * serve both gates without coupling them.
 *
 * "Immediately above" has exactly one allowance (objectui#12204): a fence whose
 * directly-above line is `check-skill-examples.mjs`'s opt-in line is declared
 * by the line directly above THAT one — declaration, opt-in line, fence, three
 * contiguous lines at one quote depth. That gate requires its line to be
 * directly above the fence (its header: an orphan is a failure), only one line
 * can be, and its rule is not this gate's to loosen. The walk steps over that
 * one line and nothing else: a declaration separated from its fence by a blank
 * line, prose, or a second opt-in line on that path is dangling, and the
 * three-line shape is pinned in both directions by the test file.
 *
 * A declaration is never taken on trust. It is re-judged on every run:
 *
 *   - the fence below it must be a node document the strict face REFUSES. A
 *     declaration on a fence the face accepts, or on a fence that is not a node
 *     document at all, exempts nothing and is reported as stale — so the list
 *     of declarations can only shrink, never accrete;
 *   - a marker with no fence directly below it is reported as dangling;
 *   - a reason shorter than the sibling gate's minimum is not a declaration;
 *   - a reason that claims the fence was checked is refused, by the sibling
 *     gate's own `VERIFICATION_CLAIM` (objectui#7505): a declared fence is not
 *     judged for its verdict, so a claim about it cannot be re-verified.
 *
 * ## Controls — a probe that cannot fail is not a probe
 *
 * Run on every invocation, before any verdict about a document:
 *
 *   RESOLUTION  the face module resolves inside `packages/types/dist/`, and the
 *               resolved file is printed.
 *   REFUSES     a document carrying one undeclared key MUST be refused by the
 *               strict face and accepted by the tolerant one. A face that
 *               accepts it is the passthrough face, and every green below
 *               would be the objectui#5250 green this gate exists to end.
 *   ACCEPTS     a declared-only document MUST be accepted. A harness broken the
 *               other way reds every page at once and reads as "the docs are
 *               full of defects".
 *   ANTI-IDLE   the walk must judge at least one node document, and EVERY leg
 *               of `SCAN_SURFACE` carries an `anchor` page that must contribute
 *               one: `ANCHOR_DOCUMENT` — the page objectui#5229 was found on —
 *               for `content/docs`, and for each README leg a README
 *               objectui#12131 repaired. An enumeration that collapsed (a moved
 *               root, a leg that stopped collecting, a broken language filter, a
 *               scanner that stopped seeing fences) exits 2 instead of printing
 *               a green over nothing. A leg that collects no page cannot hand in
 *               its anchor, so a README leg that silently judged zero READMEs is
 *               this control failing, not a green.
 *
 * ## What this gate does NOT answer
 *
 *   1. Whether a ts/tsx snippet compiles — `scripts/check-doc-snippet-types.mjs`.
 *   2. Whether a `type` literal names a registered component —
 *      `scripts/check-doc-component-types.mjs`.
 *   3. Whether a `${…}` sits on a key `SchemaRenderer` evaluates —
 *      `scripts/check-doc-expression-carriage.mjs` (report-only).
 *   4. ⚠️ Any page off `SCAN_SURFACE`. The `apps/<app>/docs` trees, the root
 *      `docs/` tree (`docs/audits/**` included, deliberately — see "The scan
 *      surface"), a README below a package root, the READMEs under `apps/`,
 *      `examples/` and `patches/`, `.claude/skills/**`, CHANGELOGs and
 *      `.changeset/` are NOT READ here, and nothing about them is claimed by a
 *      green run. Widening is a change of `SCAN_SURFACE` and of the pages it
 *      would then read.
 *   5. Whether a key the face DECLARES is read by a renderer. A declared key
 *      nothing reads passes here; that is the declaration side's question.
 *   6. Whether a json/jsonc fence under `skills/objectui/` PARSES and keeps its
 *      opt-in population — `scripts/check-skill-examples.mjs`, whose marker,
 *      floor and adjacency rule this gate reads past and never judges.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MIN_REASON_LENGTH,
  VERIFICATION_CLAIM,
  isBlankAtDepth,
  quoteDepthOf,
  stripQuotePrefix,
} from './check-doc-snippet-types.mjs';
import { PACKAGE_READMES, ROOT_PAGES, packageReadmePages } from './check-doc-component-types.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { closesFence, openFence } from './markdown-fence-scan.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Configuration ────────────────────────────────────────────────────────────

/** The content tree — the first leg of `SCAN_SURFACE`. */
export const DOCS_ROOT = 'content/docs';

/** Page extensions collected under `DOCS_ROOT` — both, as the sibling gate collects. */
export const DOC_EXTENSIONS = ['.mdx', '.md'];

/** The fence languages read. Matched against the first info token, lower-cased. */
export const JSON_FENCE_LANGUAGES = new Set(['json', 'jsonc']);

/**
 * The `content/docs` leg's anchor: a page that must contribute at least one
 * judged node document on every run — the page objectui#5229 was found on. If
 * it stops holding one (moved, renamed, or its fences rewritten away), name
 * another; ⛔ never delete the control.
 */
export const ANCHOR_DOCUMENT = 'content/docs/blocks/forms.mdx';

/** The published skill bundle — the fourth leg of `SCAN_SURFACE` (objectui#12204). */
export const SKILLS_ROOT = 'skills/objectui';

/**
 * Page extensions collected under `SKILLS_ROOT`: `.md` only — the bundle's own
 * format, and what `check-skill-examples.mjs` collects on the same tree, so the
 * two gates read the same pages there (see the header, "The scan surface").
 */
export const SKILL_PAGE_EXTENSIONS = ['.md'];

/**
 * The skills leg's anchor: a page that must contribute at least one judged node
 * document on every run. `rules/protocol.md` is the bundle's protocol rule page
 * and carries complete node documents beside its deliberate counter-examples.
 * If it stops holding one, name another page on the same leg; ⛔ never delete
 * the control.
 */
export const SKILLS_ANCHOR = 'skills/objectui/rules/protocol.md';

/**
 * `check-skill-examples.mjs`'s opt-in line (its `MARKER`), which that gate
 * requires DIRECTLY above every json/jsonc fence it reads under `skills/`, and
 * which every such fence under `SKILLS_ROOT` carries. Only one line can be
 * directly above a fence, so where this line is, a declaration for this gate
 * sits directly above it and `scanJsonFences` steps over exactly this one line
 * — the header's "Immediately above has exactly one allowance".
 *
 * Spelled here rather than imported, on purpose: an import would couple how
 * this gate attaches a declaration to the sibling's module (and its
 * `typescript` import), and a re-spelling there would move this gate's
 * attachment rule without anyone opening this file. The test file pins the two
 * spellings equal, so a drift is a red test rather than a silent detachment of
 * every declaration under the bundle.
 */
export const SKILL_OPT_IN_LINE = '<!-- os:check -->';

const toPosix = (root, abs) => relative(root, abs).split(sep).join('/');

/** Every page under `root/dir` with one of `extensions`, repo-relative and POSIX-separated, in a stable order. */
function pagesUnder(root, dir, extensions) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d).sort()) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (extensions.some((ext) => entry.endsWith(ext))) out.push(toPosix(root, p));
    }
  };
  const top = join(root, dir);
  if (existsSync(top)) walk(top);
  return out;
}

/**
 * The scan surface, one leg per entry, in walk order — the header's "The scan
 * surface, declared once" (objectui#12131). Each leg says what it reads
 * (`leg`, the words the summary prints), lists its pages repo-relative
 * (`pages(root)`), and names the page that must contribute a judged node
 * document on every real run (`anchor`, the ANTI-IDLE control). The README
 * legs come from `check-doc-component-types.mjs`, the family's one spelling of
 * them, in the slot its siblings walk them: package READMEs before the root
 * pages.
 *
 * Both README anchors are pages objectui#12131 repaired. If one stops holding a
 * node document, name another page on the same leg; ⛔ never delete the control.
 * The skills leg (objectui#12204) walks `SKILLS_ROOT` the way the first leg
 * walks `DOCS_ROOT`, last, after the READMEs.
 */
export const SCAN_SURFACE = Object.freeze([
  Object.freeze({
    leg: `every ${DOC_EXTENSIONS.join(' / ')} page under ${DOCS_ROOT}/`,
    anchor: ANCHOR_DOCUMENT,
    pages: (root) => pagesUnder(root, DOCS_ROOT, DOC_EXTENSIONS),
  }),
  Object.freeze({
    leg: `every ${PACKAGE_READMES.dir}/NAME/${PACKAGE_READMES.name}`,
    anchor: 'packages/plugin-dashboard/README.md',
    pages: (root) => packageReadmePages(root).map((abs) => toPosix(root, abs)),
  }),
  Object.freeze({
    leg: `the root ${ROOT_PAGES.join(', ')}`,
    anchor: 'README.md',
    pages: (root) => ROOT_PAGES.filter((name) => existsSync(join(root, name))),
  }),
  Object.freeze({
    leg: `every ${SKILL_PAGE_EXTENSIONS.join(' / ')} page under ${SKILLS_ROOT}/`,
    anchor: SKILLS_ANCHOR,
    pages: (root) => pagesUnder(root, SKILLS_ROOT, SKILL_PAGE_EXTENSIONS),
  }),
]);

/** Every leg's anchor — what `analyze` checks by default. */
export const SURFACE_ANCHORS = Object.freeze(SCAN_SURFACE.map((l) => l.anchor));

/** The package and entry the face is read from — the one `@object-ui/cli` imports. */
export const FACE_PACKAGE_DIR = 'packages/types';
export const FACE_ENTRY = './zod';

/** The package whose dependency `jsonc-parser` is — the reader `objectui check` uses. */
export const JSONC_READER_OWNER = 'packages/cli';

export const EXIT_CODES = {
  /** Every judged node document passed, every declaration held, the controls held. */
  verified: 0,
  /** The gate RAN. A document or a declaration is at fault — a verdict was read. */
  documentsFailed: 1,
  /** The gate COULD NOT RUN. Nothing it printed is a verdict about a document. */
  couldNotRun: 2,
};

/**
 * The declaration a deliberate fragment carries; see `FRAGMENT_MARKER_EXAMPLES`.
 * Matched against the line with its blockquote markers stripped.
 */
export const FRAGMENT_MARKER =
  /^[ \t]*(?:\{\/\*|<!--)[ \t]*doc-json:[ \t]*fragment[ \t]*(?:—|--|-|:)[ \t]*(.+?)[ \t]*(?:\*\/\}|-->)[ \t]*$/;

/** The marker, spelled out: the MDX expression comment, then the HTML comment. */
export const FRAGMENT_MARKER_EXAMPLES = [
  '{/* doc-json: fragment — why this fence is not a complete, valid node document */}',
  '<!-- doc-json: fragment — why this fence is not a complete, valid node document -->',
];

/** The REFUSES control: one undeclared key on a declared-only node. */
export const REFUSED_CONTROL = { type: 'button', label: 'Save', thisKeyIsDeclaredNowhere: true };
/** The ACCEPTS control: the same node, declared keys only. */
export const ACCEPTED_CONTROL = { type: 'button', label: 'Save' };

// ── Scanning ─────────────────────────────────────────────────────────────────

/** Each leg of `SCAN_SURFACE` with the pages it collects under `root`. */
export function surfaceLegs(root = repoRoot) {
  return SCAN_SURFACE.map(({ leg, anchor, pages }) => ({ leg, anchor, pages: pages(root) }));
}

/** Every page in the scan set, repo-relative and POSIX-separated, in a stable order. */
export function listDocuments(root = repoRoot) {
  return surfaceLegs(root).flatMap((l) => l.pages);
}

/**
 * Every json/jsonc fence in one page, with the marker that declares it, and
 * every marker in the page. Fences are opened and closed by
 * `markdown-fence-scan.mjs` — the one answer to "is this a fence" — read
 * through the quote prefix of the line that opened them, so a fence inside a
 * callout is collected with its `>` stripped from every body line.
 *
 * A marker declares the fence whose opener is the nearest non-blank line below
 * it AT THE SAME QUOTE DEPTH (a bare `>` spacer counts as blank), the sibling
 * gate's attachment rule — with one allowance: when the line directly above a
 * fence is `SKILL_OPT_IN_LINE` at the fence's depth, the walk steps over that
 * one line and reads the line directly above it, and ONLY that line (no
 * blank-line walk on this path). Three contiguous lines, or nothing.
 */
const isSkillOptInAt = (line, depth) => quoteDepthOf(line) === depth && stripQuotePrefix(line, depth).trim() === SKILL_OPT_IN_LINE;

export function scanJsonFences(source) {
  const lines = source.split('\n');
  const fences = [];
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const markerDepth = quoteDepthOf(lines[i]);
    const marker = FRAGMENT_MARKER.exec(stripQuotePrefix(lines[i], markerDepth));
    if (marker) markers.push({ line: i + 1, depth: markerDepth, reason: marker[1].trim(), consumed: false });

    const depth = quoteDepthOf(lines[i]);
    const open = openFence(stripQuotePrefix(lines[i], depth));
    if (!open) continue;
    let close = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (closesFence(stripQuotePrefix(lines[j], depth), open)) {
        close = j;
        break;
      }
    }
    const language = open.lang.toLowerCase();
    if (JSON_FENCE_LANGUAGES.has(language)) {
      let k = i - 1;
      if (k >= 0 && isSkillOptInAt(lines[k], depth)) k -= 1;
      else while (k >= 0 && isBlankAtDepth(lines[k], depth)) k--;
      const above = k >= 0 ? markers.find((m) => m.line === k + 1 && m.depth === depth) : undefined;
      if (above) above.consumed = true;
      fences.push({
        fenceLine: i + 1,
        language,
        quoteDepth: depth,
        body: lines
          .slice(i + 1, close)
          .map((line) => stripQuotePrefix(line, depth))
          .join('\n'),
        fragmentReason: above ? above.reason : null,
      });
    }
    i = close;
  }
  return { fences, markers };
}

// ── Classification ───────────────────────────────────────────────────────────

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The `type` literals one schema declares, or `null` when it declares none. */
function typeLiterals(schema) {
  const def = schema?._zod?.def;
  if (!def) return null;
  if (def.type === 'literal') return def.values.filter((v) => typeof v === 'string');
  if (def.type === 'enum') return Object.values(def.entries).filter((v) => typeof v === 'string');
  if (def.type === 'union') {
    const out = [];
    for (const option of def.options) {
      const literals = typeLiterals(option);
      if (!literals) return null;
      out.push(...literals);
    }
    return out;
  }
  return null;
}

/**
 * The node types the face declares: every `type` literal of every object arm
 * of `AnyComponentSchema`, walked through nested unions and lazies.
 */
export function nodeTypesOf(anyComponentSchema) {
  const types = new Set();
  const visit = (schema, depth) => {
    const def = schema?._zod?.def;
    if (!def || depth > 8) return;
    if (def.type === 'union') {
      for (const option of def.options) visit(option, depth + 1);
      return;
    }
    if (def.type === 'lazy') {
      let inner;
      try {
        inner = def.getter();
      } catch {
        return;
      }
      visit(inner, depth + 1);
      return;
    }
    if (def.type !== 'object') return;
    for (const t of typeLiterals(def.shape?.type) ?? []) types.add(t);
  };
  visit(anyComponentSchema, 0);
  return types;
}

/**
 * Which bucket one fence falls in. `parseJsonc` is `jsonc-parser`'s `parse`;
 * the options are the ones `objectui check` reads a `.json` file with.
 *
 * @returns {{ kind: 'notJson' | 'notAnObject' | 'noTypeKey' | 'unresolvedType' | 'document', type?: string, value?: unknown }}
 */
export function classifyFence(fence, { nodeTypes, parseJsonc }) {
  let value;
  if (fence.language === 'jsonc') {
    const errors = [];
    value = parseJsonc(fence.body, errors, { allowTrailingComma: true });
    if (errors.length > 0 || value === undefined) return { kind: 'notJson' };
  } else {
    try {
      value = JSON.parse(fence.body);
    } catch {
      return { kind: 'notJson' };
    }
  }
  if (!isPlainObject(value)) return { kind: 'notAnObject' };
  if (typeof value.type !== 'string') return { kind: 'noTypeKey' };
  if (!nodeTypes.has(value.type)) return { kind: 'unresolvedType', type: value.type };
  return { kind: 'document', type: value.type, value };
}

// ── Reading a refusal ────────────────────────────────────────────────────────

const formatPath = (path) => (path.length > 0 ? path.join(' → ') : '(root)');

/** An arm whose only complaint is the base type of the value — the primitives a slot admits. */
const isShapeMismatchOnly = (leaves) =>
  leaves.every((l) => l.code === 'invalid_type' && /received (array|object|string|number|boolean)/.test(l.message));

/**
 * The issues worth printing, flattened. A union issue (`Invalid input`) says
 * nothing on its own, so it is replaced by the issues of the arm the value
 * comes closest to fitting: arms that only refuse the value's base type are
 * set aside, and the arm with the fewest remaining issues is shown. Words
 * only — the verdict is `success`, never this list.
 */
export function readableIssues(issues, prefix = []) {
  const out = [];
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? [])];
    if (issue.code === 'invalid_union' && Array.isArray(issue.errors) && issue.errors.length > 0) {
      const arms = issue.errors.map((arm) => readableIssues(arm, path));
      const informative = arms.filter((leaves) => !isShapeMismatchOnly(leaves));
      const best = (informative.length > 0 ? informative : arms).sort((a, b) => a.length - b.length)[0];
      out.push(...best);
      continue;
    }
    out.push({ code: issue.code, path, message: String(issue.message ?? ''), keys: issue.keys });
  }
  return out;
}

/** One printed line per issue: an undeclared key by name, anything else by its message. */
export function describeIssue(issue) {
  if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
    const keys = issue.keys.map((k) => `"${k}"`).join(', ');
    return `at ${formatPath(issue.path)}: undeclared key${issue.keys.length === 1 ? '' : 's'} ${keys}`;
  }
  const message = issue.message.length > 220 ? `${issue.message.slice(0, 217)}...` : issue.message;
  return `at ${formatPath(issue.path)}: ${message}`;
}

// ── The analysis ─────────────────────────────────────────────────────────────

/**
 * Judge every json/jsonc fence on the scan surface.
 *
 * `judge(document)` is the strict verdict (`{ success, error? }`); `tolerant`
 * is the tolerant face's, read for words only. Both are injected so the test
 * suite can hand in the CLI's own door and the source face. `anchors` defaults
 * to every leg's anchor; `anchors: null` switches the anchor control off, for a
 * fixture tree that has no anchor page.
 *
 * @param {{
 *   root?: string,
 *   judge: (doc: unknown) => { success: boolean, error?: { issues: any[] } },
 *   tolerant?: (doc: unknown) => { success: boolean },
 *   nodeTypes: Set<string>,
 *   parseJsonc: (text: string, errors: unknown[], options: object) => unknown,
 *   anchors?: readonly string[] | null,
 * }} options
 */
export function analyze({ root = repoRoot, judge, tolerant, nodeTypes, parseJsonc, anchors = SURFACE_ANCHORS }) {
  const findings = [];
  const preconditions = [];
  const legs = surfaceLegs(root);
  const documents = legs.flatMap((l) => l.pages);
  const buckets = { notJson: [], notAnObject: [], noTypeKey: [], unresolvedType: [] };
  const judged = [];
  const accepted = [];
  const declared = [];
  const refused = [];
  let fenceCount = 0;

  for (const doc of documents) {
    const { fences, markers } = scanJsonFences(readFileSync(join(root, doc), 'utf8'));
    fenceCount += fences.length;
    for (const marker of markers) {
      if (!marker.consumed) {
        findings.push({
          reason: 'dangling-fragment-marker',
          site: `${doc}:${marker.line}`,
          detail: 'a `doc-json: fragment` marker must sit immediately above the json/jsonc fence it declares — or immediately above the one `os:check` opt-in line that is itself immediately above the fence; nothing else may stand between',
        });
      }
    }
    for (const fence of fences) {
      const site = `${doc}:${fence.fenceLine}`;
      const c = classifyFence(fence, { nodeTypes, parseJsonc });
      if (fence.fragmentReason !== null) {
        if (fence.fragmentReason.length < MIN_REASON_LENGTH) {
          findings.push({ reason: 'unexplained-fragment', site, detail: 'a fragment declaration must say why the fence is not a complete, valid node document' });
        }
        const claim = VERIFICATION_CLAIM.exec(fence.fragmentReason);
        if (claim) {
          findings.push({
            reason: 'verification-claim-on-fragment',
            site,
            detail: `a declared fence is not judged for its verdict, so this gate cannot re-verify "${claim[0]}" on any later commit. Say why the fence is not a complete document without asserting it was checked.`,
          });
        }
      }
      if (c.kind !== 'document') {
        buckets[c.kind].push({ site, type: c.type });
        if (fence.fragmentReason !== null) {
          findings.push({ reason: 'stale-fragment-marker', site, detail: 'this fence is not a node document, so nothing judges it and the declaration exempts nothing — delete the marker' });
        }
        continue;
      }
      const verdict = judge(c.value);
      const entry = { site, doc, type: c.type, value: c.value };
      judged.push(entry);
      if (verdict.success) {
        if (fence.fragmentReason !== null) {
          findings.push({ reason: 'stale-fragment-marker', site, detail: `the strict face ACCEPTS this \`${c.type}\` node, so it is a complete document and the declaration exempts nothing — delete the marker` });
        } else accepted.push(entry);
        continue;
      }
      if (fence.fragmentReason !== null) {
        declared.push({ ...entry, reason: fence.fragmentReason });
        continue;
      }
      const strictOnly = tolerant ? tolerant(c.value).success === true : null;
      refused.push(entry);
      findings.push({
        reason: 'refused',
        site,
        detail:
          `the strict authoring face refuses this \`${c.type}\` node` +
          (strictOnly === true
            ? ' (the tolerant face accepts it, so every reason is a key no schema declares)'
            : strictOnly === false
              ? ' (the tolerant face refuses it too)'
              : ''),
        issues: readableIssues(verdict.error?.issues ?? []).map(describeIssue),
      });
    }
  }

  if (documents.length === 0) {
    preconditions.push({ reason: 'empty-enumeration', site: 'SCAN_SURFACE', detail: 'no page was found on any leg of the scan surface' });
  } else if (judged.length === 0) {
    preconditions.push({ reason: 'nothing-judged', site: 'SCAN_SURFACE', detail: 'the walk judged no node document at all — the enumeration collapsed, so a green here would be over nothing' });
  }
  for (const anchor of anchors ?? []) {
    if (!judged.some((j) => j.doc === anchor)) {
      preconditions.push({ reason: 'anchor-unread', site: anchor, detail: 'the anchor page contributed no judged node document — its leg, the scanner, the language filter or the page has moved; name another anchor on the same leg, never delete the control' });
    }
  }

  return { legs, documents, fenceCount, buckets, judged, accepted, declared, refused, findings, preconditions };
}

// ── Loading the face and the reader ──────────────────────────────────────────

/** The built face's file, from the face package's own `exports` — `null` when unbuilt. */
export function resolveFaceFile(root = repoRoot) {
  const manifest = JSON.parse(readFileSync(join(root, FACE_PACKAGE_DIR, 'package.json'), 'utf8'));
  const entry = manifest.exports?.[FACE_ENTRY];
  const target = typeof entry === 'string' ? entry : entry?.import ?? entry?.default;
  if (typeof target !== 'string') return { file: null, detail: `${FACE_PACKAGE_DIR}/package.json declares no importable \`${FACE_ENTRY}\` entry` };
  const file = join(root, FACE_PACKAGE_DIR, target);
  return { file, detail: null };
}

/** The controls, against the loaded faces. Each failure is a reason the run could not be read. */
export function controlFailures({ judge, tolerant, nodeTypes }) {
  const failures = [];
  if (!nodeTypes.has(REFUSED_CONTROL.type)) failures.push(`the node-type walk does not reach \`${REFUSED_CONTROL.type}\` — it read ${nodeTypes.size} type(s)`);
  if (judge(REFUSED_CONTROL).success) failures.push('REFUSES: the strict face accepted a document carrying an undeclared key — it is the passthrough face');
  if (tolerant && !tolerant(REFUSED_CONTROL).success) failures.push('REFUSES: the tolerant face refused the control document — the control no longer isolates the undeclared key; pick another');
  if (!judge(ACCEPTED_CONTROL).success) failures.push('ACCEPTS: the strict face refused a declared-only document — the harness is broken in the other direction');
  return failures;
}

function printFindingList(items) {
  for (const f of items) {
    console.error(`  ❌  ${f.site} — ${f.detail}`);
    for (const line of f.issues ?? []) console.error(`        ${line}`);
  }
}

export async function main(argv = process.argv.slice(2), root = repoRoot) {
  const list = argv.includes('--list');

  const { file: faceFile, detail: faceDetail } = resolveFaceFile(root);
  if (!faceFile || !existsSync(faceFile)) {
    console.error(
      `⛔  check-doc-json-fences could not run: the strict authoring face is not built (${faceDetail ?? faceFile}).\n` +
        '    Build it, then re-run:  pnpm --filter @object-ui/types build\n' +
        '    Nothing above is a verdict about any document.',
    );
    return EXIT_CODES.couldNotRun;
  }
  const faceRelative = relative(root, faceFile).split(sep).join('/');
  if (!faceRelative.startsWith(`${FACE_PACKAGE_DIR}/dist/`)) {
    console.error(`⛔  RESOLUTION: the face resolved to ${faceRelative}, outside ${FACE_PACKAGE_DIR}/dist/ — refusing to judge the docs against it.`);
    return EXIT_CODES.couldNotRun;
  }

  let face;
  let parseJsonc;
  try {
    face = await import(pathToFileURL(faceFile).href);
    parseJsonc = createRequire(join(root, JSONC_READER_OWNER, 'package.json'))('jsonc-parser').parse;
  } catch (error) {
    console.error(`⛔  check-doc-json-fences could not run: ${String(error?.message ?? error).split('\n')[0]}`);
    return EXIT_CODES.couldNotRun;
  }
  if (!face.StrictAnyComponentSchema || !face.AnyComponentSchema || typeof parseJsonc !== 'function') {
    console.error('⛔  check-doc-json-fences could not run: the face module exports no StrictAnyComponentSchema / AnyComponentSchema, or jsonc-parser has no parse.');
    return EXIT_CODES.couldNotRun;
  }

  const judge = (doc) => face.StrictAnyComponentSchema.safeParse(doc);
  const tolerant = (doc) => face.AnyComponentSchema.safeParse(doc);
  const nodeTypes = nodeTypesOf(face.AnyComponentSchema);

  const failures = controlFailures({ judge, tolerant, nodeTypes });
  if (failures.length > 0) {
    console.error('⛔  check-doc-json-fences could not run — a control failed, so no verdict below would mean anything:');
    for (const f of failures) console.error(`    ${f}`);
    return EXIT_CODES.couldNotRun;
  }

  const r = analyze({ root, judge, tolerant, nodeTypes, parseJsonc });

  if (list) {
    for (const j of r.accepted) console.log(`  accepted        ${j.site}  ${j.type}`);
    for (const j of r.declared) console.log(`  declared        ${j.site}  ${j.type}  — ${j.reason}`);
    for (const j of r.refused) console.log(`  refused         ${j.site}  ${j.type}`);
    for (const [bucket, items] of Object.entries(r.buckets)) {
      for (const item of items) console.log(`  ${bucket.padEnd(15)} ${item.site}${item.type ? `  ${item.type}` : ''}`);
    }
  }

  if (r.findings.length > 0) {
    console.error(`\n❌  JSON doc fences: ${r.findings.length} finding(s) — the strict authoring face is the face \`objectui validate\` judges with.`);
    printFindingList(r.findings);
  }

  const unresolvedTypes = [...new Set(r.buckets.unresolvedType.map((b) => b.type))].sort();
  const unreadAnchors = new Set(r.preconditions.filter((p) => p.reason === 'anchor-unread').map((p) => p.site));
  console.log(
    [
      '',
      `JSON doc fences — strict authoring face: ${faceRelative} (StrictAnyComponentSchema, the face \`objectui validate\` and \`objectui check\` judge with)`,
      `  scan surface: ${r.legs.map((l) => `${l.leg} (${l.pages.length} page(s))`).join(' · ')} — ${r.documents.length} page(s), ${r.fenceCount} json/jsonc fence(s)`,
      `  judged node documents: ${r.judged.length} — ${r.accepted.length} accepted, ${r.declared.length} declared fragment(s) the face refuses as declared, ${r.refused.length} refused`,
      `  not judged: ${r.buckets.notJson.length} not JSON · ${r.buckets.notAnObject.length} not an object · ${r.buckets.noTypeKey.length} without a string \`type\` · ${r.buckets.unresolvedType.length} with a \`type\` no node schema declares${unresolvedTypes.length ? ` (${unresolvedTypes.join(', ')})` : ''}`,
      `  controls: RESOLUTION, REFUSES, ACCEPTS hold over ${nodeTypes.size} node type(s); anchors ${SURFACE_ANCHORS.map((a) => `${a} ${unreadAnchors.has(a) ? 'NOT read' : 'read'}`).join(', ')}`,
      `  NOT read: every page off that surface — docs/audits/**, .claude/skills/**, CHANGELOGs, .changeset/ and READMEs below a package root among them (see this script's header) — a green run claims nothing about them`,
    ].join('\n'),
  );

  if (r.preconditions.length > 0) {
    console.error('\n⛔  check-doc-json-fences could not produce a verdict — the enumeration failed its own controls:');
    printFindingList(r.preconditions);
    return EXIT_CODES.couldNotRun;
  }
  if (r.findings.length > 0) {
    console.error(
      `\n    Fix the document: remove a key no schema declares, or replace it with the declared key its renderer reads.` +
        `\n    A fence that is deliberately not a complete, valid node document is declared on the line above it` +
        `\n    (above the \`${SKILL_OPT_IN_LINE.replace(/<!--\s*|\s*-->/g, '')}\` opt-in line where a fence under ${SKILLS_ROOT}/ carries one):` +
        `\n      ${FRAGMENT_MARKER_EXAMPLES[0]}\n      ${FRAGMENT_MARKER_EXAMPLES[1]}`,
    );
    return EXIT_CODES.documentsFailed;
  }
  console.log('✅  Every judged JSON node document on the scan surface passes the strict authoring face.');
  return EXIT_CODES.verified;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main());
}

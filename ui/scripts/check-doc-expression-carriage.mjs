#!/usr/bin/env node
/**
 * Every `${…}` a json fence authors on a node must sit on a channel
 * `SchemaRenderer` actually evaluates. REPORT-ONLY: it prints a census and never
 * fails the build on its findings.
 *
 * The scan surface is EXACTLY the one `check:doc-types`
 * (`check-doc-component-types.mjs`) walks — `content/docs`, every
 * `apps/<app>/docs` tree, each package's own `README.md` and the root pages it
 * names — and it is that surface by IMPORT rather than by copy; see "The scan
 * surface" below.
 *
 * Run:  node scripts/check-doc-expression-carriage.mjs
 *       node scripts/check-doc-expression-carriage.mjs --list       every fence, parsed or not
 *       node scripts/check-doc-expression-carriage.mjs --self-test  the controls alone
 * Exit: 0 = the census ran, whatever it found. 1 = the INSTRUMENT is broken —
 *       a derivation returned nothing, the spec artifact is missing, the
 *       strict `json` contract could not be imported, or a built-in control
 *       failed. Never 1 for a finding; see "Report-only" below.
 *
 * ## The hole this measures (objectui#7851)
 *
 * A json fence in these pages can author ANY key at all on a node and no gate
 * objects. Only the `type` string is judged:
 *
 *   - `check-doc-component-types` scans these pages and judges every `type`
 *     literal. Its own header states the exclusion in as many words: "NOT in
 *     scope, deliberately: whether the snippet's OTHER keys are read by the
 *     renderer the type resolves to."
 *   - `check-doc-snippet-types` covers these pages too, but type-checks `ts` /
 *     `tsx` blocks only. A json fence is never compiled against anything.
 *
 * ⇒ Between them the `type` is checked, the ts/tsx is checked, and the json
 * fence bodies are unchecked. Four cards of exactly that shape were each found
 * by a human or an agent re-reading a page, never by CI: objectui#7418
 * (`guide/expressions.md` authored `${…}` on six keys with no carriage row —
 * one of them, `badge.text`, is not a `BadgeSchema` key at all and rendered an
 * EMPTY badge), objectui#7440, objectui#7444, objectui#7838.
 *
 * ## What this answers, and the half it does NOT
 *
 * This file answers the EXPRESSION half only: *is this key evaluated?* It is
 * the cheap half, and the only one derivable from an artifact today. The wider
 * half — is this key READ BACK by the renderer the type resolves to, which is
 * what objectui#7440 and objectui#7444 are — needs the per-renderer read-point
 * contract `check-doc-component-types` names as the missing piece. ⛔ Do not
 * read a green census here as "the fences are correct"; read it as "no fence
 * authors an expression on a channel nothing evaluates".
 *
 * ## Report-only, and what would justify flipping it
 *
 * The 2026-09-06 dispatch ruling on objectui#7851: this class has four known
 * members and three of them are OPEN, so a blocking gate would go red on other
 * people's cards the day it landed and turn one card into four. The census IS
 * the deliverable — how many fences exist, how many carry an uncarried
 * expression, and on which pages — and that number is what decides later
 * whether the corpus gets cleaned first or a ledger gets built. ⛔ This file
 * does not make that decision.
 *
 * Same posture as `check-changeset-overwrite.mjs`, and the same boundary:
 * report-only means it declines to fail on its FINDINGS, never that it passes
 * without looking (objectstack#4928, objectui#4690). A broken derivation, an
 * unreadable input or a failed control is exit 1 — a gate that runs, goes
 * green and looked at nothing is the counterfeit this whole file guards
 * against, so it is exactly the thing that must be loud.
 *
 * ## Where the evaluated-channel universe comes from — derived, never a list
 *
 * A hand-typed list of "keys the renderer evaluates" would be a second dialect
 * of a declaration that already exists twice over, and it would rot silently in
 * the direction that produces FALSE FINDINGS on correct docs. So both halves
 * are re-derived on every run, and each one fails the gate rather than
 * shrinking if it stops matching:
 *
 *   CARRIAGE  `expressionBindableTextKeysFor(type)` out of the BUILT
 *             `@objectstack/spec` artifact — the same lookup
 *             `packages/react/src/SchemaRenderer.tsx` consumes. Read from the
 *             artifact rather than from prose or a table, which is the
 *             derivation objectui#7418 established and its triage seat asked
 *             every later reader to repeat rather than copy: the spec version
 *             moves.
 *   CHANNELS  the four legs `SchemaRenderer` evaluates, read off that file's
 *             own call sites — `evaluator.evaluate(newSchema.<key>)` (the
 *             `content` leg), `isConfigBag(newSchema.<key>)` (the `properties`
 *             and `props` bags), and
 *             `evaluate{Visibility,Enablement}Predicate(newSchema.<key>, …)`
 *             (the eight condition keys). Read from `run`-shaped call sites,
 *             never from the surrounding comments: that file's prose names
 *             `visibleOn`, `disabled` and the bags many times over, and a scan
 *             of the raw text would be describing its own docblocks.
 *
 * A node's carried set is the union of the two, and a node whose `type` has no
 * carriage row simply gets the channel keys — which is the point: `badge`,
 * `progress`, `input` and `list` carry NOTHING, so every `${…}` those nodes
 * author outside `content`, the bags and the condition keys is a finding.
 *
 * ## The parse surface is reported, because it is this instrument's blind spot
 *
 * A fence this file cannot parse is a fence it says nothing about, and a census
 * that reports only its hits hides how much it never read. So every run prints
 * `parsed` and `unparsed` PER FENCE LANGUAGE (`json` and `jsonc` today) and
 * names every unparsed fence with its file, its opening line, its language and
 * the parse error; `--list` prints the whole inventory, parsed and unparsed
 * alike. Whether that list is empty on the real tree is not claimed here: the
 * pin 'has no blind spot on the corpus it ships against' in this file's test
 * re-derives it on every run.
 *
 * The two languages are held to DIFFERENT contracts (objectui#10943, see the
 * next section). A `json` fence is parsed STRICTLY, with none of what follows.
 * A `jsonc` fence — and only a `jsonc` fence among the judged — gets four
 * tolerances beyond `JSON.parse`, all of them REMOVALS of non-data or an
 * envelope around it. None of them can invent a key:
 *
 *   1. Line comments and block comments outside strings. The pages annotate
 *      their examples this way.
 *   2. Raw newlines and tabs inside strings, re-escaped. These pages write
 *      multi-line ternaries inside a single `${…}` string.
 *   3. Trailing commas before `}` / `]`.
 *   4. Elision markers, in the three spellings the corpus uses — a bare `...`
 *      or `…` token, and a `"..."` STRING standing in a member position (never
 *      one in a value position, which is a real placeholder value, e.g.
 *      `"placeholder": "..."`).
 *
 * Plus one retry, not a tolerance: a fence that is an object BODY rather than
 * an object (`"dependencies": { … }`, a package.json excerpt) is retried
 * wrapped in braces. Like the four tolerances, it runs for `jsonc` and never
 * for `json`. The fences the blind-spot measurement reads (every language this
 * gate does not judge, below) go through the same tolerant path, because that
 * leg only asks whether a body holds a typed node; ⛔ it judges nothing.
 *
 * ## `json` is strict and `jsonc` is annotated: one contract with the skills tree
 *
 * objectui#10943, ruled A on that card on 2026-09-28. The maintainer named it
 * as an exception under 「新增门禁默认否」: a strength increase of this census's
 * one existing pin, not a new gate. A `json` fence is what a reader copies into a
 * metadata file, so it is parsed with `parseJsonFence` from
 * `check-skill-examples.mjs`: `JSON.parse` and nothing else. That is the contract
 * the skills tree already holds its examples to. The function is IMPORTED
 * rather than re-spelled, so the two doc trees hold one `json` / `jsonc`
 * contract rather than two that agree today. No tolerance, no object-body retry
 * and no multi-document split applies to `json`. A `json` fence that needs one
 * of them is not JSON, and the remedy is 「retag as `jsonc` if the example
 * needs comments or trailing commas」, or else fixing the fence.
 * `UNPARSED_PRESCRIPTIONS` below holds that sentence, and the CLI and the pin
 * both print it from there.
 *
 * What changed is WHO gets red, not the posture below. The CLI still exits 0
 * on anything it reads in a page. The blocking half is the test pin that was
 * already there, 'has no blind spot on the corpus it ships against', which
 * asserts the unparsed list is empty. Before objectui#10943, a `json` fence with
 * a comment or a trailing comma parsed through the tolerances and never reached
 * that list. Now it does, so the pull request that adds one goes red.
 *
 * ⛔ Not generalised here, by the same ruling: the `jsonc` tolerance list is
 * not widened, and no other fence language gains a parse check.
 *
 * ⚠️ The import is a guarded dynamic `import()`, not a static one, and for a
 * measured reason. `check-skill-examples.mjs` imports `typescript` and
 * `check-doc-snippet-types.mjs` at load. In a checkout with no install, a
 * static import fails at module LINK, before the CLI can print its "A failure,
 * not a skip" line, and the orphan pin in this file's test then reads a
 * module-resolution stack trace instead. So the failure is held until
 * `requireJsonContract` raises it, inside the same instrument check that
 * reports a missing `@objectstack/spec`.
 *
 * And one normalization that is NOT on the judged path at all — `toJsonDialect`,
 * which de-dialects a JS object literal (unquoted keys, single-quoted strings)
 * so the BLIND-SPOT measurement can ask its question of that spelling too
 * (objectui#8334). ⛔ It never runs on a judged fence: `analyze` reaches it only
 * from the `!fence.scanned` branch, so the judged population is byte-for-byte
 * what it was before that card. ⛔ And it is emphatically NOT a step toward
 * adding `plaintext` to `JSON_FENCE_LANGUAGES` — that was considered and
 * REJECTED by content on PR objectui#8324, because `plaintext` is not a JSON
 * dialect and admitting it lets every future JSON-in-plaintext block through
 * unjudged. The fix for a blind measurement is to make it see, not to make the
 * census swallow what it cannot judge.
 *
 * ## What it does not see, stated so nobody mistakes it for coverage
 *
 *   - A `${…}` inside an ARRAY on a node key (`"items": ["${a}"]`). Only string
 *     values directly on a node are judged.
 *   - A `${…}` in an object with no string `type`. Without a type there is no
 *     carriage row to judge against, and guessing one is how a gate produces
 *     false findings in both directions at once.
 *   - Anything outside a `json` / `jsonc` fence on the scan surface. The
 *     `ts`/`tsx` blocks are `check-doc-snippet-types`' surface and are left to
 *     it; ⛔ this file changes no other gate's population. The LANGUAGE SET is its
 *     own blind spot and is measured rather than asserted: every run prints the
 *     per-language counts, and every fence in a language this gate does not scan
 *     is still read, purely to report whether it holds a typed node.
 *     ⚠️ objectui#8334: "read" used to mean `JSON.parse`, and that made the
 *     measurement blind to the JS OBJECT-LITERAL spelling — a fence authoring a
 *     real node tree with unquoted keys landed in NEITHER the judged population
 *     nor the blind-spot list, and the summary printed `none` over it. Both
 *     spellings are asked now; see `toJsonDialect`. ⛔ This did not widen the
 *     census: the judged population is still `json` / `jsonc` and nothing else.
 *   - The repository-root `docs/` tree, and therefore `docs/ARCHITECTURE.md` —
 *     objectui#7838's site. ⚠️ objectui#7878 was filed expecting this widening to
 *     reach that file; it does not, and the card's premise was corrected before
 *     dispatch rather than after. NO doc gate walks the root `docs/` tree
 *     (objectui#7856 is the open question about it): `check-doc-component-types`
 *     names `docs/**` in its own exclusion list, `check-readme-exports` reports
 *     `0 outside any package`, and `lint:root` ignores it. Widening onto a tree
 *     no sibling gate reads is a different decision from joining the surface
 *     three of them already share, and it is #7856's to make, not this file's.
 *
 * ## The scan surface — imported from `check:doc-types`, never re-declared
 *
 * objectui#7878. This census landed (PR objectui#7868) pointed at `content/docs`
 * alone while its two sibling doc gates had already been widened, by
 * objectui#6600 and objectui#7115, onto the per-app docs trees and the root
 * pages. That is the objectui#7115 geometry rebuilt one gate over: the root
 * `README.md` fell BETWEEN two gates' surfaces and taught an unregistered type
 * four times for as long as the example existed, for exactly one reason —
 * nothing read the file.
 *
 * So the surface is not re-declared here. `APP_DOCS`, `appDocsDirs`,
 * `PACKAGE_READMES`, `packageReadmePages` and `ROOT_PAGES` are IMPORTED from
 * `check-doc-component-types.mjs`, which makes the two walks the same object
 * rather than arrays a test hopes are equal.
 *
 * ⚠️ objectui#7896's fourth leg (`packages/NAME/README.md`, landed by
 * objectui#8115) is why the import alone is not the whole coupling. The surface
 * pin below rebuilds its expected document list FROM THESE CONSTANTS and compares
 * it against this census's own walk — so a leg added to that gate and NOT taken
 * here moves neither side, and the pin stays GREEN while the two surfaces
 * diverge. That is objectui#7115's geometry a third time, rebuilt inside the pin
 * written to prevent it. ⇒ A leg added there is owed a leg here, in the same
 * change, and `SURFACE_LABEL` is owed its name. The
 * three gates that carry copies of these constants do so for a stated reason that
 * does not apply here — importing `check-doc-snippet-types.mjs` pulls in its
 * `import ts from 'typescript'` at load, and `check-doc-fence-languages`' whole
 * value is running with no install. `check-doc-component-types.mjs` imports
 * node built-ins and `invoked-as.mjs`, the same four this file already imports,
 * so the copy would buy nothing and cost a pin. (`regenerate-known-schema-types`
 * already imports that module for the same reason.)
 *
 * `DOCS_ROOT` is the one leg still spelled here, because that gate declares it
 * `const` rather than `export const`; `check-doc-expression-carriage.test.ts`
 * pins this file's copy against that file's source text.
 *
 * ⚠️ Widening a scan surface is the change that can be GREEN ABOUT NOTHING, so
 * the widening is measured rather than asserted: the test pins that every leg of
 * the walk actually reaches a file, and the census prints the file count beside
 * the surface it walked.
 *
 * ## ⚠️ A hit is a CANDIDATE, not a verdict — `type` is not one vocabulary
 *
 * `check-doc-component-types` measured this and wrote it down: across the corpus
 * there are at least SEVEN distinct vocabularies that all spell the key `type` —
 * SDUI component keys, action schemas, block schemas, theme and report schemas,
 * field and JSON-Schema types, validation rules, nav and feed items. A node from
 * another vocabulary is judged here against a carriage map that does not govern
 * it, and can be reported while being perfectly correct. One of today's hits is
 * exactly that: `content/docs/api/schema-reference.md`'s `ActionSchema` example
 * authors a `${…}` on `condition`, which the ACTION runner's own gate evaluates,
 * not `SchemaRenderer`'s node channels.
 *
 * ⛔ The obvious fix — classify by the enclosing key path — was BUILT and
 * MEASURED by that gate before being rejected, because it does not converge:
 * `items` carries nav entries on one page and renderable children on another, so
 * any global parent-key rule is a silent false GREEN on one of them, and a
 * misclassifying discriminator is worse than none because its mistakes are
 * invisible in both directions. That ruling is inherited here rather than
 * re-litigated, and report-only is what makes inheriting it safe: a candidate a
 * human reads costs a minute, and nothing is blocked while the corpus is read.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_DOCS,
  appDocsDirs,
  PACKAGE_READMES,
  packageReadmePages,
  ROOT_PAGES,
} from './check-doc-component-types.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { closesFence, openFence } from './markdown-fence-scan.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

// ── The strict `json` contract, imported (objectui#10943) ─────────────────────

/**
 * `parseJsonFence` from `check-skill-examples.mjs`, the one reading of "a `json`
 * fence parses" in this repository. It is held here rather than imported
 * statically for the reason the header gives: that module loads `typescript` at
 * import time, and a static import would turn an uninstalled checkout's loud
 * instrument failure into a module-resolution stack trace.
 *
 * One `const` DECLARATION, and not a top-level `try`: `check:entry-guard`
 * refuses a statement that runs on import in a file that exports, and a
 * rejected `import()` settles into `error` here instead of throwing.
 */
const jsonContractLoad = await import('./check-skill-examples.mjs').then(
  (module) => ({ parseJsonFence: module.parseJsonFence, error: null }),
  (error) => ({ parseJsonFence: null, error }),
);

/**
 * The imported contract, or a loud failure. ⛔ Never a fallback: judging a
 * `json` fence with anything but the skills tree's parser is how the two doc
 * trees would drift back into two contracts.
 */
export function requireJsonContract() {
  if (typeof jsonContractLoad.parseJsonFence === 'function') return jsonContractLoad.parseJsonFence;
  const cause = jsonContractLoad.error instanceof Error ? ` (${jsonContractLoad.error.message})` : '';
  throw new Error(
    `the strict \`json\` contract, \`parseJsonFence\` in scripts/check-skill-examples.mjs, could not be ` +
      `imported${cause}. Run \`pnpm install\` first. This gate does not judge a \`json\` fence with a ` +
      'parser of its own.',
  );
}

/**
 * The remedy for an unparsed fence, by language. The census CLI and the pin in
 * this file's test both print it from here, so the two cannot prescribe
 * different fixes.
 *
 * The two entries are two different things. A `json` entry is a DOCS DEFECT:
 * the fence is not JSON, and its remedy is the sentence objectui#10943 ruled. A
 * `jsonc` entry is this instrument's BLIND SPOT: a spelling the tolerances do
 * not cover. Its remedy is the one this pin carried before that card.
 */
export const UNPARSED_PRESCRIPTIONS = {
  json:
    'retag as `jsonc` if the example needs comments or trailing commas; otherwise fix the fence. A `json` ' +
    'fence is parsed STRICTLY (`JSON.parse` and nothing else, the contract `parseJsonFence` in ' +
    'scripts/check-skill-examples.mjs holds the skills tree to), because it is what a reader copies into ' +
    'a metadata file',
  jsonc:
    'teach `sanitizeFence` the spelling (see the tolerances in scripts/check-doc-expression-carriage.mjs’s ' +
    'header), or fix the fence if it is simply malformed',
};

/** The prescription for one unparsed fence. Only `json` is strict; every other language is `jsonc`'s case. */
export function unparsedPrescription(lang) {
  return lang === 'json' ? UNPARSED_PRESCRIPTIONS.json : UNPARSED_PRESCRIPTIONS.jsonc;
}

/**
 * The guide tree, the first leg of the walk. Spelled here because
 * `check-doc-component-types.mjs` declares its own `DOCS_ROOT` as a plain `const`
 * — the other two legs are imported from it, and the test pins this string
 * against that file's source so the three legs cannot drift apart.
 */
export const DOCS_ROOT = 'content/docs';

/**
 * The other three legs of `check:doc-types`' surface, re-exported so this file's
 * scan surface is readable from one place and pinnable as ONE object rather than
 * as arrays that agree today.
 *
 * `PACKAGE_READMES` / `packageReadmePages` joined with objectui#7896's fourth leg
 * (landed by objectui#8115). ⚠️ That leg is the reason the import form matters
 * rather than being a style preference: the surface pin in this file's test
 * rebuilds the expected document list FROM THESE CONSTANTS, so a leg added to
 * `check-doc-component-types.mjs` alone moves neither side of that comparison and
 * the pin stays GREEN while the two walks diverge — objectui#7115's defect, in
 * the instrument built to prevent it. Importing the constants is what makes the
 * two walks one object; taking the leg here is what makes them one SURFACE.
 */
export { APP_DOCS, appDocsDirs, PACKAGE_READMES, packageReadmePages, ROOT_PAGES };

/**
 * The surface in one phrase, so the printed summary and this file's prose cannot
 * describe different walks. The app-docs leg is spelled with a GLOB STAR rather
 * than with an angle-bracket placeholder: this string is quoted into pull-request
 * bodies and issue comments, and GitHub's body sanitizer eats tag-shaped
 * fragments (AGENTS.md, "GitHub 会改写你写进 issue/PR 正文的字节").
 */
export const SURFACE_LABEL =
  `${DOCS_ROOT}, ${APP_DOCS.dir}/*/${APP_DOCS.subdir}, ` +
  `${PACKAGE_READMES.dir}/*/${PACKAGE_READMES.name} and ${ROOT_PAGES.join(', ')}`;

/** The renderer whose evaluation legs define "carried". */
export const RENDERER_SOURCE = 'packages/react/src/SchemaRenderer.tsx';
/** Fence info strings whose body is a JSON document. */
export const JSON_FENCE_LANGUAGES = ['json', 'jsonc'];

const DOC_EXTENSIONS = ['.md', '.mdx'];

// ── The evaluated-channel universe ───────────────────────────────────────────

/**
 * The keys `SchemaRenderer` evaluates on every node, whatever its type, read off
 * that file's own call sites.
 *
 * Three shapes, because the renderer has three: a direct evaluate on a named
 * key, a config bag whose entries are all evaluated, and a predicate leg. The
 * carriage loop is deliberately NOT matched here — it indexes with a computed
 * key (`newSchema[key]`) because its keys come from the spec, which is the
 * other half of the derivation.
 *
 * Every group must match something. A rename upstream that silently emptied one
 * would narrow "carried" and turn correct documentation into findings, so an
 * empty group throws rather than reporting a smaller universe.
 */
export function deriveChannels(root = repoRoot) {
  const abs = join(root, RENDERER_SOURCE);
  if (!existsSync(abs)) {
    throw new Error(
      `${RENDERER_SOURCE} is not in this checkout, so the evaluated channels cannot be derived. ` +
        'Refusing to census against a guessed universe.',
    );
  }
  const source = readFileSync(abs, 'utf8');
  const collect = (pattern, label) => {
    const found = [...source.matchAll(pattern)].map((m) => m[1]);
    if (found.length === 0) {
      throw new Error(
        `the ${label} derivation matched nothing in ${RENDERER_SOURCE}. The call sites it reads have ` +
          'been renamed or removed; teach this derivation the new shape rather than letting the ' +
          'evaluated-channel universe shrink silently.',
      );
    }
    return [...new Set(found)].sort();
  };

  const direct = collect(/evaluator\.evaluate\(newSchema\.([A-Za-z_$][\w$]*)\)/g, 'direct-evaluate');
  const bags = collect(/isConfigBag\(newSchema\.([A-Za-z_$][\w$]*)\)/g, 'config-bag');
  const conditions = collect(
    /evaluate(?:Visibility|Enablement)Predicate\(newSchema\.([A-Za-z_$][\w$]*)\s*,/g,
    'condition-predicate',
  );

  return { direct, bags, conditions, all: [...new Set([...direct, ...bags, ...conditions])].sort() };
}

/**
 * The per-type carriage map, from the BUILT spec artifact.
 *
 * Not from the card that found this class, not from a table in a doc, and not
 * from `packages/types`: the lookup the renderer imports is the only answer that
 * cannot be stale, and it is versioned with the installed package.
 */
export async function loadCarriage() {
  let spec;
  try {
    spec = await import('@objectstack/spec/ui');
  } catch (error) {
    throw new Error(
      `the built @objectstack/spec artifact could not be imported (${error.message}). ` +
        'Run `pnpm install` first — without it there is no carriage map, and a census against an ' +
        'empty map would report every documented expression as uncarried.',
    );
  }
  const lookup = spec.expressionBindableTextKeysFor;
  if (typeof lookup !== 'function') {
    throw new Error(
      '@objectstack/spec/ui no longer exports `expressionBindableTextKeysFor`. That lookup IS the ' +
        'carriage map; teach this gate its replacement rather than defaulting to "carries nothing".',
    );
  }
  let version = 'unknown';
  try {
    const pkg = fileURLToPath(import.meta.resolve('@objectstack/spec/package.json'));
    version = JSON.parse(readFileSync(pkg, 'utf8')).version ?? 'unknown';
  } catch {
    // The version is printed for the record, never load-bearing.
  }
  return { keysFor: (type) => lookup(type) ?? [], version };
}

// ── Fence extraction ─────────────────────────────────────────────────────────

/**
 * One tree. The three skipped names are `check-doc-component-types`' own
 * exclusions, carried over so "exactly the surface that gate walks" is true of
 * the traversal and not only of the roots. They change nothing under
 * `content/docs` today — that tree holds no `node_modules`, `dist` or dot-entry —
 * and they are what keeps the answer stable if an app docs tree ever grows one.
 */
function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walkFiles(abs, out);
    else if (DOC_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(abs);
  }
  return out;
}

/**
 * Every document on the scan surface, absolute, in a stable order: the guide
 * tree, then each `apps/<app>/docs` tree, then each package's own README, then
 * the root pages by name.
 *
 * ⚠️ The order is not cosmetic. The package-README leg sits BEFORE the root pages
 * because that is the slot `check-doc-component-types.scanDocs` and the fence
 * guard's walk both append it in, and element-by-element comparability across the
 * three lists is what their coupling pins compare.
 *
 * A root page that does not resolve is DROPPED rather than fatal, which is the
 * same bargain `check-doc-component-types.scanDocs` strikes and for the same
 * reason — the fixture trees this file's tests build have no root README, and a
 * throwaway tree must stay scannable. ⚠️ The consequence is that a `ROOT_PAGES`
 * name going dangling would shrink this census SILENTLY. This gate is
 * report-only and its exit codes are not this card's to move (objectui#7878), so
 * the guard lives in the test instead: `check-doc-expression-carriage.test.ts`
 * pins that every leg of this walk reaches at least one real file.
 */
export function listDocuments(root) {
  const files = walkFiles(join(root, DOCS_ROOT));
  for (const dir of appDocsDirs(root)) files.push(...walkFiles(dir));
  files.push(...packageReadmePages(root));
  files.push(...ROOT_PAGES.map((name) => join(root, name)).filter((abs) => existsSync(abs)));
  return files;
}

/**
 * Comments out, raw newlines re-escaped, elision markers dropped — tolerances 1,
 * 2 and 4 of the four the header lists. All three are string-aware: a `//`
 * inside `"https://…"` is data, and so is a `"..."` in a value position.
 */
export function sanitizeFence(source) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (ch === '.' && source.slice(i, i + 3) === '...') {
      i += 2;
      continue;
    }
    if (ch === '…') continue;
    out += ch;
  }
  // Elisions first: removing one leaves the comma that introduced it, and that
  // trailing comma is what the next pass is for.
  return dropTrailingCommas(dropElisionStrings(out));
}

/** Tolerance 3, string-aware: `,` immediately before `}` or `]`. */
function dropTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The last spelling of tolerance 4: an elision written AS a string, standing
 * where a member should be — `{ "type": "kanban", "..." }`. The dots survive the
 * scan above because they are inside a string, which is correct: the position is
 * what makes this one an elision. A dotted string after `:` is a real value
 * (`"placeholder": "..."`) and is left alone, which is why the preceding
 * `{` / `[` / `,` is part of the match rather than a lookbehind on nothing.
 */
function dropElisionStrings(text) {
  return text.replace(
    /([{[,])(\s*)"(?:\.{2,}|…+)"(\s*)(?=[,}\]])/g,
    (_m, open, before, after) => `${open}${before}${after}`,
  );
}

/** Every top-level JSON value in a fence, so a fence holding several parses. */
export function splitTopLevel(text) {
  const values = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let junk = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      if (depth === 0) junk += ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && start >= 0) {
        values.push(text.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) return { values, reason: 'unbalanced-brace' };
      continue;
    }
    if (depth === 0 && !/[\s,]/.test(ch)) junk += ch;
  }
  if (depth !== 0) return { values, reason: 'unterminated-brace' };
  if (values.length === 0) return { values, reason: 'no-json-value' };
  return { values, reason: junk.trim() === '' ? null : 'text-outside-any-value' };
}

/**
 * Parse one fence body. `lang` is the fence's info string, and it picks the
 * contract (objectui#10943):
 *
 *   `json`          STRICT: the imported `parseJsonFence`, which is `JSON.parse`
 *                   and nothing else. No tolerance, no object-body retry and no
 *                   multi-document split.
 *   anything else   `jsonc`, and the unscanned languages the blind-spot leg
 *                   measures: the four tolerances and the object-BODY retry the
 *                   header describes, exactly as before that card.
 */
export function parseFence(body, lang) {
  // Every return carries the same four fields. A result whose SHAPE depends on
  // the outcome makes every caller — this file's own census and the pins in
  // `scripts/__tests__` alike — narrow a union before it can read `values`, and
  // `tsconfig.scripts.json` type-checks those pins.
  const failed = (reason) => ({ ok: false, reason, values: [], wrapped: false });

  if (lang === 'json') {
    const error = requireJsonContract()(body, 'json');
    if (error !== null) return failed(`invalid-json: ${error}`);
    // The contract has just accepted this exact body, and its `json` branch IS
    // `JSON.parse(body)`. Parsing again only reads the value out; it cannot
    // disagree with the verdict.
    return { ok: true, reason: null, values: [JSON.parse(body)], wrapped: false };
  }

  const attempt = (text) => {
    const { values, reason } = splitTopLevel(text);
    if (reason) return failed(reason);
    const parsed = [];
    for (const value of values) {
      try {
        parsed.push(JSON.parse(value));
      } catch (error) {
        return failed(`invalid-json: ${error.message}`);
      }
    }
    return { ok: true, reason: null, values: parsed, wrapped: false };
  };

  const sanitized = sanitizeFence(body);
  const first = attempt(sanitized);
  if (first.ok) return first;
  // A fence that is an object BODY rather than an object.
  const wrapped = attempt(`{${sanitized}}`);
  return wrapped.ok ? { ...wrapped, wrapped: true } : first;
}

/**
 * The JS OBJECT-LITERAL dialect, normalized to JSON — for the BLIND-SPOT
 * MEASUREMENT ONLY (objectui#8334). ⛔ Never on the judged path: `analyze` still
 * judges `fence.scanned` fences and nothing else, and this function is not
 * reachable from that branch.
 *
 * The blind-spot leg asks one question — *does this unscanned fence hold a typed
 * node?* — and before this existed it could only ask it of a body that survived
 * `JSON.parse`. A page authoring a real node tree the way JavaScript spells it
 * (unquoted keys, single-quoted strings) answered NOTHING, was counted in neither
 * the judged population nor the blind-spot list, and the summary then printed
 * `Dialect blind spot: none` over a class it could not see. That is the worst
 * shape a detector takes: full coverage reported precisely where there is none.
 *
 * Two REMOVALS of dialect, nothing else — like the four tolerances above, ⛔
 * neither can invent a key:
 *
 *   1. Single-quoted strings become double-quoted, with any interior `"`
 *      escaped. A quote character is re-spelled; no member is added or dropped.
 *   2. A bare identifier in a MEMBER position — immediately after `{` or `,` and
 *      followed by `:` — is quoted. The position is what makes it a key, which is
 *      the same predicate `dropElisionStrings` uses; an identifier anywhere else
 *      (a bare `string` in `type: string;`) is left alone and goes on failing to
 *      parse, which is how a TS `interface` body stays OUT of this measurement.
 *
 * The pass is comment-aware for the same reason `sanitizeFence` is: an
 * apostrophe inside `// don't` would otherwise open a string and corrupt the rest
 * of the body. Comments are dropped here rather than deferred, so the text handed
 * on is already free of them.
 */
export function toJsonDialect(source) {
  let out = '';
  let quote = null;
  let escaped = false;
  // The last significant character outside a string, which is what makes an
  // identifier a KEY rather than a value: only `{` and `,` introduce a member.
  let prev = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === quote) {
        out += '"';
        quote = null;
        continue;
      }
      // A `"` inside a single-quoted string is data; re-spelling the delimiter
      // would otherwise end the string early and change what the body says.
      if (quote === "'" && ch === '"') {
        out += '\\"';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += '"';
      prev = '"';
      continue;
    }
    if (/[A-Za-z_$]/.test(ch) && (prev === '{' || prev === ',')) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
      let k = j;
      while (k < source.length && /\s/.test(source[k])) k++;
      if (source[k] === ':') {
        out += `"${source.slice(i, j)}"`;
        i = j - 1;
        prev = 'x';
        continue;
      }
    }
    out += ch;
    if (!/\s/.test(ch)) prev = ch;
  }
  return out;
}

/**
 * `parseFence`, asked of the object-literal dialect. Same parser, same
 * tolerances, same "a fence that is an object BODY" retry — the ONE difference is
 * that the body is de-dialected first, so the blind-spot leg asks its question of
 * both spellings instead of only the one that happens to be JSON.
 *
 * No language is passed, so this is the tolerant path: the leg measures
 * unscanned fences and judges none of them (objectui#10943 left it untouched).
 */
export function parseFenceDialect(body) {
  return parseFence(toJsonDialect(body));
}

/** Every `json` / `jsonc` fence on the scan surface, parsed or not. */
export function scanFences(root) {
  const files = listDocuments(root);
  const fences = [];
  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    const lines = readFileSync(abs, 'utf8').split('\n');
    let open = null;
    let body = [];
    for (let i = 0; i < lines.length; i++) {
      // ⛔ Never re-spell the fence predicate here. `markdown-fence-scan.mjs` is
      // its one authority, and it is one because the local spelling this line
      // used to hold read a four-backtick opener as a three-backtick fence in a
      // language named with a leading backtick, which then counted two phantom
      // fences as successfully parsed (objectui#9194).
      if (open) {
        if (closesFence(lines[i], open)) {
          const scanned = JSON_FENCE_LANGUAGES.includes(open.lang);
          fences.push({
            file: rel,
            line: open.line,
            lang: open.lang,
            body,
            scanned,
            // A fence outside the scanned languages is parsed too, but only to
            // MEASURE the dialect blind spot below — it is never judged. The
            // language picks the contract: strict for `json`, the tolerances for
            // everything else (objectui#10943).
            ...parseFence(body.join('\n'), open.lang),
          });
          open = null;
          body = [];
          continue;
        }
      } else {
        const opened = openFence(lines[i]);
        if (opened) {
          open = { ...opened, lang: (opened.lang || 'plaintext').toLowerCase(), line: i + 1 };
          continue;
        }
      }
      if (open) body.push(lines[i]);
    }
    if (open) {
      // An unclosed fence read the rest of the file as code. Report it as
      // unparsed rather than guessing where it ended.
      fences.push({
        file: rel,
        line: open.line,
        lang: open.lang,
        body,
        scanned: JSON_FENCE_LANGUAGES.includes(open.lang),
        ok: false,
        reason: 'unterminated-fence',
        values: [],
        wrapped: false,
      });
    }
  }
  return { files: files.length, documents: files.map((abs) => relative(root, abs).split(sep).join('/')), fences };
}

// ── The judgement ────────────────────────────────────────────────────────────

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const holdsExpression = (value) => typeof value === 'string' && value.includes('${');

/**
 * Every node — a plain object with a string `type` — reachable from a parsed
 * fence value, in document order.
 */
export function collectNodes(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return out;
  }
  if (!isPlainObject(value)) return out;
  if (typeof value.type === 'string') out.push(value);
  for (const child of Object.values(value)) collectNodes(child, out);
  return out;
}

/**
 * The line a finding should point at: the first line in this fence spelling
 * `"<key>"` alongside a `${`, each line claimed once so repeats advance instead
 * of all pointing at the first.
 */
function locate(fence, key, claimed) {
  for (let i = 0; i < fence.body.length; i++) {
    if (claimed.has(i)) continue;
    if (fence.body[i].includes(`"${key}"`) && fence.body[i].includes('${')) {
      claimed.add(i);
      return fence.line + 1 + i;
    }
  }
  return fence.line;
}

/**
 * The census. `channels` and `carriage` are injected so the controls below can
 * run the same judgement over a fixture without a second implementation of it.
 */
export function analyze(root, { channels, carriage }) {
  const scan = scanFences(root);
  const judged = scan.fences.filter((fence) => fence.scanned);
  const counters = {
    files: scan.files,
    fences: judged.length,
    parsed: 0,
    unparsed: 0,
    wrapped: 0,
    nodes: 0,
    expressionSites: 0,
    carried: 0,
  };
  /** Per fence language, so the next reader can see which dialects were read. */
  const byLanguage = new Map();
  const bump = (lang, field) => {
    const row = byLanguage.get(lang) ?? { fences: 0, parsed: 0, unparsed: 0 };
    row[field]++;
    byLanguage.set(lang, row);
  };
  const sites = [];
  const unparsed = [];
  const inventory = [];
  /**
   * The DIALECT blind spot: a fence outside the scanned languages whose body
   * holds a typed node. Counted, never judged — a `jsonc` spelling was invisible
   * to an earlier draft of this gate, and the way that was found was a human
   * reading a page, which is the detection mechanism this whole card exists to
   * replace.
   *
   * ⚠️ objectui#8334: this leg used to require `fence.ok` — a strict JSON parse —
   * which made the measurement whose job is to report what the census cannot see
   * blind to the JS OBJECT-LITERAL spelling. Such a fence was counted in neither
   * the judged population nor here, and the summary printed `none` over it. Both
   * spellings are asked the same question now; the DIALECT is recorded so the
   * reader can tell the two apart.
   */
  const unscannedJsonLike = [];

  for (const fence of scan.fences) {
    if (!fence.scanned) {
      // ⛔ Measurement only. The judged population is `fence.scanned` and is not
      // reached from this branch — widening the census is explicitly NOT the fix
      // for objectui#8334, and ⛔ `plaintext` is still not a JSON dialect.
      const dialect = fence.ok ? 'json' : 'object-literal';
      const jsonLike = fence.ok ? fence : parseFenceDialect(fence.body.join('\n'));
      if (jsonLike.ok && jsonLike.values.some((value) => collectNodes(value).length > 0)) {
        unscannedJsonLike.push({ file: fence.file, line: fence.line, lang: fence.lang, dialect });
      }
      continue;
    }
    inventory.push({ file: fence.file, line: fence.line, lang: fence.lang, ok: fence.ok });
    bump(fence.lang, 'fences');
    bump(fence.lang, fence.ok ? 'parsed' : 'unparsed');
    if (!fence.ok) {
      counters.unparsed++;
      // File, opening line, language and the parse error: the language is what
      // decides which remedy applies (`unparsedPrescription`, objectui#10943).
      unparsed.push({ file: fence.file, line: fence.line, lang: fence.lang, reason: fence.reason });
      continue;
    }
    counters.parsed++;
    if (fence.wrapped) counters.wrapped++;
    const claimed = new Set();
    for (const value of fence.values) {
      for (const node of collectNodes(value)) {
        counters.nodes++;
        const rows = carriage.keysFor(node.type);
        const carried = new Set([...channels.all, ...rows]);
        for (const [key, raw] of Object.entries(node)) {
          if (!holdsExpression(raw)) continue;
          counters.expressionSites++;
          if (carried.has(key)) {
            counters.carried++;
            continue;
          }
          sites.push({
            file: fence.file,
            line: locate(fence, key, claimed),
            fence: fence.line,
            type: node.type,
            key,
            value: raw.replace(/\s+/g, ' ').trim(),
            rows,
          });
        }
      }
    }
  }

  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.key.localeCompare(b.key));
  const languages = [...byLanguage.entries()].sort((a, b) => b[1].fences - a[1].fences).map(([lang, row]) => ({ lang, ...row }));
  return { counters, documents: scan.documents, sites, unparsed, fences: inventory, languages, unscannedJsonLike };
}

// ── Controls: the gate proves it can see, on every run ────────────────────────

/**
 * A gate that runs, goes green and looked at nothing is the counterfeit this
 * class of check produces most easily, so the instrument is exercised in BOTH
 * directions before the real census, on every run rather than once in a PR.
 *
 * The positive fixture is `guide/expressions.md`'s Status Badge block exactly as
 * it stood before PR #7847 repaired it: `badge` carries nothing, so both
 * `text` and `variant` are findings — and `text` is not even a `BadgeSchema`
 * key, which is how that site rendered an empty badge. The negative fixture is
 * the repaired shape plus the two channels that always carry, and must report
 * nothing.
 */
export const CONTROL_FIXTURES = {
  positive: `{
  "type": "badge",
  "text": "\${status}",
  "variant": "\${status === 'active' ? 'success' : 'warning'}",
  "visibleOn": "\${status !== null}"
}`,
  negative: `{
  "type": "card",
  "title": "\${item.name}",
  "description": "\${item.role}",
  "content": "\${greeting}",
  "properties": { "className": "\${theme.card}" },
  "visibleOn": "\${item.active}"
}`,
  /**
   * The DIALECT controls (objectui#8334). The positive fixture is the shape the
   * corpus actually uses — `content/docs/components/complex/filter-ui.mdx:10`,
   * trimmed — a real node tree spelled as a JS object literal. The negative is a
   * TS `interface` BODY, which is what the great majority of these pages'
   * ```plaintext fences hold and which must stay OUT of the measurement: it
   * declares types, it does not author a node.
   */
  dialectPositive: `{
  type: 'filter-ui',
  layout: 'popover',
  filters: [
    { field: 'name', label: 'Name', type: 'text', placeholder: "Search name" }
  ]
}`,
  dialectNegative: `interface FilterUIProps {
  type: 'filter-ui';
  layout?: 'popover' | 'inline';
  showApply?: boolean;
}`,
};

export function runControls({ channels, carriage }) {
  const judge = (source) => {
    // Both fixtures are strict JSON, judged the way the census judges a `json`
    // fence, so every run also exercises the imported contract (objectui#10943).
    const parsed = parseFence(source, 'json');
    if (!parsed.ok) return { failed: `the fixture did not parse: ${parsed.reason}` };
    const found = [];
    for (const value of parsed.values) {
      for (const node of collectNodes(value)) {
        const carried = new Set([...channels.all, ...carriage.keysFor(node.type)]);
        for (const [key, raw] of Object.entries(node)) {
          if (holdsExpression(raw) && !carried.has(key)) found.push(key);
        }
      }
    }
    return { found: found.sort() };
  };

  const positive = judge(CONTROL_FIXTURES.positive);
  const negative = judge(CONTROL_FIXTURES.negative);
  const failures = [];
  if (positive.failed) failures.push(`positive control: ${positive.failed}`);
  else if (positive.found.join(',') !== 'text,variant') {
    failures.push(
      `positive control: expected the two uncarried badge keys [text, variant], got ` +
        `[${positive.found.join(', ')}]. The instrument cannot see the site objectui#7418 repaired.`,
    );
  }
  if (negative.failed) failures.push(`negative control: ${negative.failed}`);
  else if (negative.found.length > 0) {
    failures.push(
      `negative control: a clean node reported [${negative.found.join(', ')}]. The instrument is ` +
        'reporting carried channels as findings, which is a false-positive gate.',
    );
  }

  /**
   * The DIALECT leg's own two-sided control (objectui#8334), run on every run for
   * the reason the whole file exists: `Dialect blind spot: none` is a sentence
   * about coverage, and a measurement that has silently stopped matching prints
   * that sentence and looks identical to a clean corpus. ⛔ Per counter, not one
   * total — a leg that sees the object literal but has stopped rejecting
   * interface bodies is broken in the direction that produces false findings, and
   * the reverse is broken in the direction that produces a false green.
   */
  const dialectNodes = (source) => {
    const parsed = parseFenceDialect(source);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, nodes: [] };
    return { ok: true, reason: null, nodes: parsed.values.flatMap((value) => collectNodes(value)) };
  };
  const dialectPositive = dialectNodes(CONTROL_FIXTURES.dialectPositive);
  const dialectNegative = dialectNodes(CONTROL_FIXTURES.dialectNegative);
  const dialectTypes = dialectPositive.nodes.map((node) => node.type).sort();
  if (!dialectPositive.ok) {
    failures.push(
      `dialect positive control: the object-literal fixture did not normalize (${dialectPositive.reason}). ` +
        'The blind-spot leg cannot see the class objectui#8334 filed, and this run would have printed ' +
        '"Dialect blind spot: none" over it.',
    );
  } else if (dialectTypes.join(',') !== 'filter-ui,text') {
    failures.push(
      `dialect positive control: expected the two typed nodes [filter-ui, text], got ` +
        `[${dialectTypes.join(', ')}]. The object-literal measurement has stopped matching the shape the ` +
        'corpus actually uses, so its zero would be a blindness, not a clean corpus.',
    );
  }
  if (dialectNegative.ok && dialectNegative.nodes.length > 0) {
    failures.push(
      `dialect negative control: a TS \`interface\` body reported ` +
        `[${dialectNegative.nodes.map((node) => node.type).join(', ')}] as typed node(s). The dialect leg is ` +
        'reading type DECLARATIONS as authored nodes, which floods the blind-spot list with false entries.',
    );
  }

  return {
    positive: positive.found ?? [],
    negative: negative.found ?? [],
    dialectPositive: dialectTypes,
    dialectNegative: dialectNegative.ok ? dialectNegative.nodes.map((node) => node.type) : [],
    failures,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (isEntrypoint(import.meta.url)) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? repoRoot);
  const selfTestOnly = process.argv.includes('--self-test');
  const list = process.argv.includes('--list');

  let channels;
  let carriage;
  try {
    channels = deriveChannels();
    carriage = await loadCarriage();
    // objectui#10943: the strict `json` contract is an input like the two above,
    // and a missing one is the same loud instrument failure, never a skip.
    requireJsonContract();
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    A failure, not a skip: report-only means this gate declines to fail on its FINDINGS,\n' +
        '    never that it passes without looking (objectstack#4928, objectui#4690).',
    );
    process.exit(1);
  }

  const controls = runControls({ channels, carriage });
  console.log(
    `Evaluated channels, derived from ${RENDERER_SOURCE}: ` +
      `content=[${channels.direct.join(', ')}] bags=[${channels.bags.join(', ')}] ` +
      `conditions=[${channels.conditions.join(', ')}]`,
  );
  console.log(`Carriage map: @objectstack/spec@${carriage.version}'s expressionBindableTextKeysFor.`);
  console.log(
    `Controls: positive fixture reported [${controls.positive.join(', ')}] (expected text, variant); ` +
      `negative fixture reported ${controls.negative.length === 0 ? 'nothing' : `[${controls.negative.join(', ')}]`} ` +
      '(expected nothing).',
  );
  console.log(
    `Dialect controls: the object-literal fixture yielded [${controls.dialectPositive.join(', ')}] ` +
      '(expected filter-ui, text); the TS interface body yielded ' +
      `${controls.dialectNegative.length === 0 ? 'nothing' : `[${controls.dialectNegative.join(', ')}]`} ` +
      '(expected nothing).',
  );
  if (controls.failures.length > 0) {
    console.error(`\n❌  The instrument failed its own controls:\n${controls.failures.map((f) => `      ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('✅  Controls pass: this gate can see the class it is looking for, and does not cry wolf.');
  if (selfTestOnly) process.exit(0);

  let census;
  try {
    census = analyze(root, { channels, carriage });
  } catch (error) {
    console.error(`❌  The census could not read its inputs: ${error.message}`);
    process.exit(1);
  }

  const { counters, sites, unparsed, languages, unscannedJsonLike } = census;
  console.log(
    `\nScanned ${counters.files} file(s) across ${SURFACE_LABEL}: ` +
      `${counters.fences} ${JSON_FENCE_LANGUAGES.join('/')} fence(s), ` +
      `${counters.parsed} parsed, ${counters.unparsed} UNPARSED` +
      (counters.wrapped > 0 ? ` (${counters.wrapped} parsed as an object body)` : '') +
      `.\n` +
      `${counters.nodes} node(s) with a string \`type\`; ` +
      `${counters.expressionSites} \${…} site(s) on those nodes, ${counters.carried} of them carried.`,
  );

  // Per fence language, because the SET of languages is its own blind spot and it
  // has already bitten once: a `jsonc` spelling three teaching blocks use was
  // invisible to an earlier draft, and the way that was found was a human reading
  // the page. A column per dialect is what lets the next reader see at a glance
  // whether another one is being missed.
  console.log(
    `By fence language: ${languages
      .map((row) => `${row.lang} ${row.fences} (${row.parsed} parsed, ${row.unparsed} unparsed)`)
      .join('; ')}`,
  );
  // objectui#8334: BOTH spellings, counted separately. The `none` branch used to
  // be reachable while an entire dialect was invisible to the measurement behind
  // it, which is a detector reporting full coverage precisely where it has none.
  const byDialect = (name) => unscannedJsonLike.filter((fence) => fence.dialect === name).length;
  if (unscannedJsonLike.length === 0) {
    console.log(
      `✅  Dialect blind spot: none — no fence OUTSIDE ${JSON_FENCE_LANGUAGES.join('/')} holds a typed node, ` +
        'in EITHER the strict-JSON or the\n    JS object-literal spelling. Both were asked; the dialect ' +
        'controls above are what make this line readable.',
    );
  } else {
    console.log(
      `\n⚠️  ${unscannedJsonLike.length} fence(s) outside ${JSON_FENCE_LANGUAGES.join('/')} hold a typed node ` +
        `(${byDialect('json')} as strict JSON, ${byDialect('object-literal')} as a JS object literal).\n` +
        '    NOT judged, and ⛔ NOT a request to widen the census: `plaintext` is not a JSON dialect, and\n' +
        '    admitting it would let every future JSON-in-plaintext block through UNJUDGED (rejected by\n' +
        '    content on PR objectui#8324). This list is the coverage line telling the truth about what the\n' +
        '    census does not read — repair a page by retagging it ```json, or leave it and know the number:',
    );
    for (const fence of unscannedJsonLike) {
      console.log(`      ${fence.file}:${fence.line}  (${fence.lang}, ${fence.dialect})`);
    }
  }

  // The blind spot is printed on every run, in both directions. A census that
  // reports only its hits hides how much it never looked at, and "0 unparsed" is
  // the sentence that makes "only N sites" mean something.
  if (counters.unparsed === 0) {
    console.log('✅  Blind spot: none — every fence above was parsed and judged.');
  } else {
    // objectui#10943: two different things share this list, so they are printed
    // apart, each with its own remedy. A `json` entry is a fence that is not JSON.
    // Any other entry is a spelling the tolerances cannot read.
    const notJson = unparsed.filter((fence) => fence.lang === 'json');
    const blind = unparsed.filter((fence) => fence.lang !== 'json');
    if (notJson.length > 0) {
      console.log(
        `\n⚠️  ${notJson.length} \`json\` fence(s) are not JSON. \`json\` is parsed STRICTLY, with no tolerance ` +
          '(objectui#10943):',
      );
      for (const fence of notJson) console.log(`      ${fence.file}:${fence.line}  (json)  ${fence.reason}`);
      console.log(`    Remedy: ${unparsedPrescription('json')}.`);
    }
    if (blind.length > 0) {
      console.log(
        `\n⚠️  ${blind.length} fence(s) this gate could NOT read — its blind spot, printed because a\n` +
          '    census that reports only its hits hides how much it never looked at:',
      );
      for (const fence of blind) console.log(`      ${fence.file}:${fence.line}  (${fence.lang})  ${fence.reason}`);
      console.log(`    Remedy: ${unparsedPrescription('jsonc')}.`);
    }
  }
  if (list) {
    console.log('\nEvery fence, in document order:');
    for (const fence of census.fences) {
      console.log(`      ${fence.ok ? '  parsed' : 'UNPARSED'}  ${fence.file}:${fence.line}  (${fence.lang})`);
    }
  }

  if (sites.length === 0) {
    console.log('\n✅  No documented json fence authors ${…} on a key nothing evaluates.');
    process.exit(0);
  }

  const byFile = new Map();
  for (const site of sites) byFile.set(site.file, [...(byFile.get(site.file) ?? []), site]);

  console.log(
    `\n⚠️  ${sites.length} site(s) in ${byFile.size} page(s) author \${…} on a key nothing evaluates:\n`,
  );
  for (const [file, hits] of byFile) {
    console.log(`      ${file}`);
    for (const hit of hits) {
      console.log(
        `        :${hit.line}  ${hit.type}.${hit.key}  ` +
          `(carriage rows for \`${hit.type}\`: ${hit.rows.length === 0 ? 'none' : hit.rows.join(', ')})`,
      );
      console.log(`                 ${hit.value.length > 96 ? `${hit.value.slice(0, 93)}...` : hit.value}`);
    }
  }

  console.log(`
    What a hit means: \`SchemaRenderer\` evaluates exactly four channels — \`content\`,
    the carriage keys for the node's own type, the \`properties\` and \`props\` bags, and
    the condition keys. An expression written anywhere else reaches the renderer as the
    characters the author typed, so the page teaches a form that cannot work.

    \u26a0\ufe0f Read the passage before repairing: a hit is a CANDIDATE, not a verdict.
    \`type\` is at least seven vocabularies in these pages (measured by
    check-doc-component-types), and a node from another one — an ActionSchema, a field
    declaration, a nav item — is judged here against a carriage map that does not govern
    it. That gate built the obvious discriminator and rejected it as non-convergent; this
    one inherits the ruling, which is affordable precisely because it blocks nothing.

    Two repairs, chosen by what the passage teaches, never one blanket rule (the
    2026-09-01 ruling on objectui#7115, fork B — 「文档教现实」):
      - the passage is DEMONSTRATING binding  -> move it onto a channel that carries
        (a \`text\` node's \`content\` is evaluated on every type; or a real carriage key
        on the same node; or the \`properties\` bag);
      - the expression is incidental          -> author a literal, and say in prose which
        row is missing.
    ⛔ Adding a carriage row for the key is fork A and was rejected: that widens an
    authoring surface and is a maintainer decision, not a docs fix.

    Report-only: this gate does not fail the build on the findings above. Three cards of
    this class are open (objectui#7440, #7444, #7838) and each one fixes its own sites;
    see the header of scripts/check-doc-expression-carriage.mjs for why the census is the
    deliverable and what would justify flipping this to blocking.`);
  process.exit(0);
}

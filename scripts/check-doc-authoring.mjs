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
//   node scripts/check-doc-authoring.mjs --self-test
//
// ## Scope (#4913)
//
// `.claude/` is in scope for the same reason `skills/` is, and more so: the
// published `skills/` corpus is what AI authors *apps* from, while `.claude/`
// (skills, agent definitions, workflows) is the operating manual every agent
// session loads and copies from. A bare literal taught there is copied into app
// code by the next agent that reads it. The root was `['skills', 'content']`
// until #4913 — top-level `skills/` only — so nothing checked the corpus the
// agents themselves read. The root is `.claude`, not `.claude/skills`, so the
// next subdirectory added under it is covered on arrival rather than missed the
// same way twice.
//
// ## `docs/` is corpus too — but not all of it (#4929)
//
// #4916 fixed one direction (a root declared but no longer resolvable). This is
// the symmetric one: a directory that really exists, really teaches metadata
// authoring, and was simply never declared. `docs/` was that directory —
// `docs/notes/crm-development-standards.mdx` alone carries 16 ts blocks, and
// ADR-0010 / 0015 / 0017 / 0057 plus `docs/design/permission-model.md` all show
// `defineX(...)` calls. AGENTS.md Prime Directive #13 sends every agent to grep
// the ADRs before changing behaviour under them, so a bare literal in an ADR is
// copied into app code exactly the way one in `skills/` is. It was added while
// the corpus was still at zero violations: that window is the cheapest possible
// moment to take a directory in, and once it closes the same decision becomes an
// argument about either rewriting history or granting an exemption.
//
// Three subtrees are exempt **by path** below. They are process records, not
// corpus — read the SKIP_PATHS comment for why that is a permanent exemption and
// not a backlog item.
//
// The root is `docs`, not the three live subdirectories, for the same reason
// #4913 took `.claude` rather than `.claude/skills`: a new subdirectory under it
// is covered on arrival instead of being missed the same way twice. That also
// covers the hand-written top-level guides (`docs/protocol-upgrade-guide.md`,
// `docs/upgrading-to-11.md`, …), which are live instructions to the reader and
// belong in scope.
//
// ## Dead roots are a hard error (#4916)
//
// `collectFiles()` used to walk each root inside `try { ... } catch {}`. Rename,
// move or delete any one of them and the ENOENT was swallowed in place: the scan
// finished the *remaining* roots and printed `✓ ... N files clean`, exit 0. From
// outside, "every root is clean" and "one root was never opened" are the
// same output with a smaller N, and nobody reads N. So every ROOT is now resolved
// at startup and an unresolvable one fails the gate **by name**. There is no
// optional root and no empty catch — see `assertRootsResolvable` for why a
// whitelist would be the wrong shape here rather than merely unnecessary.
//
// ## A scan that finds nothing is a hard error too (#4932)
//
// #4916 closed one spelling of the evaporation: the ROOT no longer resolves.
// This closes the other, which that assertion cannot see — the root resolves and
// the corpus is no longer inside it. A subtree moves out, a `SKIP_PATHS` entry
// widens, an authoring convention changes the extension: the root is still a
// directory, so `assertRootsResolvable` is satisfied, the walk returns fewer
// files, and the printed count drops in silence. `✓ 362 files clean` and
// `✓ 0 files clean` are the same sentence to every reader and the same exit code
// to CI — which is all of #4932: the count was printed and never asserted.
//
// The floor is PER ROOT, not on the total. A total floor is held up by whichever
// root still has files while another empties (`.claude` alone keeps it positive),
// and "part of the corpus was read" is precisely the verdict this gate must not
// resolve in the corpus's favour. It is a floor of one file per declared root,
// derived from the walk that just ran — deliberately NOT a ratchet against a
// recorded high-water mark, which would have to be maintained and would turn
// every legitimate deletion into an argument with a number.
//
// It lives in `collectFiles`, not in `main`, so the self-test drives the
// invariant itself rather than a proxy for it.
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { parseSourceFile } from './ts-parse.mjs';

// `typescript` is resolved rather than imported at module top so this gate's
// two Markdown rules keep working in a checkout where it is absent; Rule 3 asks
// for it at the moment it scans, and says so by name if it cannot be had.
const requireFromHere = createRequire(import.meta.url);

const ROOTS = ['.claude', 'docs', 'skills', 'content'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'references']);
// Whole subtrees skipped by path, not by directory name — a bare name would also
// skip a legitimately-named directory anywhere else in the corpus.
//
// `.claude/worktrees/` is where an agent's per-task git worktree lands in the
// environments that keep them inside the repo (it is gitignored, and AGENTS.md
// Prime Directive #11 makes one per task). This walker is `readdirSync`, not
// `git ls-files`, so .gitignore does not exclude it: without this entry the scan
// descends into a FULL SECOND COPY of the repository per parallel agent, which
// is both slow and — worse — reports violations that belong to some other
// branch's working tree. A gate whose failures are not about your change is a
// gate people learn to ignore.
//
// `docs/audits`, `docs/handoff` and `docs/plans` are the historical exemption
// (#4929) — NOT an oversight, and NOT a backlog item to shrink later. They are
// dated, one-shot process records: an audit report, a handoff note, a plan
// written on a particular day about the state of the repo on that day. Nothing
// in them is offered to the reader as "author it this way"; they are evidence of
// what was true then. Putting them in scope would subject a two-month-old
// handoff to today's lint permanently, and the only two ways out of that red are
// to edit the record — which falsifies it — or to add the exemption anyway, one
// argument later. The rest of `docs/` is live instruction and stays in scope, so
// the line is "does this document tell you how to write metadata now?", not
// "is it under docs/?". A doc that starts as a plan and becomes the standing
// guide should be moved out of `docs/plans` rather than exempted in place.
//
// (If one of these directories is ever renamed the skip silently stops matching
// and its files enter the scan — a loud red, not a silent hole, which is the
// safe direction for a stale entry to fail in.)
const SKIP_PATHS = new Set([
  '.claude/worktrees',
  'docs/audits',
  'docs/handoff',
  'docs/plans',
]);
// Generated from spec/frontmatter — not hand-authored, don't police.
const SKIP_FILES = new Set(['content/docs/ai/skills-reference.mdx']);

/**
 * ROOTS above, written in the subtree spelling `scripts/pm/dispatch-gates.mjs`
 * compares in. Provenance ONLY: nothing in this gate reads this list, and the
 * scan behaves exactly as it did without it.
 *
 * ## The gap this closes (#9964's declaration pattern, sixth instance)
 *
 * That tool builds every dispatch's gate list by scanning each gate's own source
 * for the path literals it operates on, and "looks like a path" there means
 * "carries a separator" — or names a top-level DOTTED directory, which is the
 * one arm that saved `.claude`. So three of the four ROOTS were bare words that
 * never became a hint, while `SKIP_PATHS` below spells its entries with
 * separators, and those DID.
 *
 * The result was a declaration almost exactly inverted. Measured on `main` at
 * 9dd192d48b, this gate's whole hint set was:
 *
 *   .claude                                  the one live root the dotted-dir
 *                                            arm admitted —  6 of 389 files
 *   .claude/worktrees, docs/audits,          the exemptions, i.e. subtrees it
 *   docs/handoff, docs/plans,                deliberately does NOT read
 *   content/docs/ai/skills-reference.mdx
 *
 * — five of its six declared paths were exclusions, and 383 of its 389 walked
 * files (98.5%) were declared by nothing at all. `docs/**`, `skills/**` and
 * `content/**` below are what close that; `.claude/**` is redundant with the
 * bare `.claude` the extractor already takes, and is kept so the declaration is
 * uniform across ROOTS rather than depending on which arm happened to admit
 * which root.
 *
 * That is worse than declaring nothing, and worse in the direction that hides
 * it: the residue line still PRINTED gate names, so the row read as "declared,
 * just not relevant to you". A card editing `docs/qa/platform-checklist/` — a
 * file this gate does read — derived an EMPTY union and met this REQUIRED gate
 * (lint.yml, `Doc/skill authoring guard`) as red CI instead of as a local
 * command. That is the cost this file's own header opens with, one level up:
 * a check that reported on a corpus nobody could see it was reading.
 *
 * ## Why the subtree spelling, and not a wider extractor
 *
 * `hintCovers` refuses a bare single-segment literal (`docs`) as too generic BY
 * DESIGN, and that refusal is measured rather than incidental: teaching the
 * extractor to accept bare top-level directory words was priced at +139084
 * fabricated (gate, file) pairs, because `packages`, `apps` and `examples` are
 * path COMPONENTS in dozens of gates that never read those roots. A declared
 * subtree is a different claim from a bare word — an author stating what the
 * gate reads, in the syntax the repo uses for that everywhere else — and the
 * glob collapse reduces each of these back to one ROOTS entry and to nothing
 * else.
 *
 * ## Why the ROOT, and not the live subtrees under it (the SKIP_PATHS question)
 *
 * `hintCovers` has no way to SUBTRACT: hints are positive containment, so
 * "`docs/**` except `docs/plans`" is not expressible. The exempt subtrees are
 * therefore claimed by this declaration, and that is a DELIBERATE, bounded
 * residual rather than an oversight — pinned as such in the self-test, so it
 * cannot silently grow past the exemptions it is accounted for.
 *
 * Declaring the live subtrees instead was considered and refused on three
 * grounds. It does not remove the residual (`SKIP_PATHS` spells those paths as
 * module-body literals, so they stay hints whatever this list says — only
 * unquoting them the way `DEFAULT_BASE_REF` is assembled would, at the cost of
 * obscuring this file's most safety-critical constant). It contradicts the
 * reason the ROOT is `docs` and not its three live subdirectories, argued at
 * the top of this file: a new subdirectory is covered on arrival instead of
 * being missed the same way twice — and a declaration that has to be extended
 * by hand is the same silent narrowing, one tool over. And it strands the
 * twelve hand-written top-level guides (`docs/protocol-upgrade-guide.md`,
 * `docs/upgrading-to-11.md`, …), which are files rather than a subtree and
 * would have to be enumerated one literal each.
 *
 * The residual is also not new: those four subtrees derive this gate TODAY, via
 * the `SKIP_PATHS` literals. This declaration subsumes those hints and adds
 * nothing to that side while closing all 389 files of the missing side.
 *
 * What the precedent does draw a line at is claiming a tree the ROOTS do not
 * reach at all, and the self-test in `scripts/pm/dispatch-gates.mjs` pins that
 * negative half against the real extractor — the load-bearing direction for a
 * declaration this broad, since a gate named on EVERY card is the louder
 * version of naming none. Carve-outs INSIDE a walked root are the tolerated
 * case there: `check:role-word` declares `skills/**` while skipping every
 * `references/` directory under it, and `check:slot-lookup-ratchet` declares
 * the whole of `packages/**`.
 *
 * ## Provenance, never a lookup key
 *
 * The glob form appearing in ROOTS would send `walk()` at a directory that does
 * not exist — since #4916 a hard refusal rather than a silent skip, but one
 * that fails naming the wrong problem. The self-test pins both halves.
 */
const ROOT_WATCH_HINTS = ['.claude/**', 'docs/**', 'skills/**', 'content/**'];

const DOMAINS = [
  'Datasource', 'Connector', 'Policy', 'SharingRule', 'Position', 'PermissionSet',
  'EmailTemplateDefinition', 'Report', 'Webhook', 'ObjectExtension', 'Cube',
  'Mapping', 'Theme', 'TranslationBundle', 'Page', 'Action',
].join('|');
const NS = '(?:UI\\.|Data\\.|System\\.|Security\\.|Identity\\.|Automation\\.|Integration\\.)?';
// The optional `Input` suffix is a LEGACY spelling as of protocol 17: ADR-0122
// phase 2 (#6083) moved the author state onto the bare name and retired every
// `XInput` synonym of it. The arm stays anyway — this gate reads the corpus that
// gets pasted into app code, where a sample carrying the retired spelling is
// still the anti-pattern AND now names a type that no longer exists.
const BARE = new RegExp(`^export const \\w+:\\s*${NS}(?:${DOMAINS})(?:Input)?\\s*=\\s*\\{`);
const FENCE_OPEN = /^```(?:ts|typescript|tsx)\s*$/;
const FENCE_CLOSE = /^```\s*$/;

// ── Rule 2: bare internal issue ids on the CUSTOMER-FACING surface ──────────
//
// Maintainer ruling 2026-08-23, on the finding that measured this: strip the
// internal issue-id references from the published catalog and gate their
// return. It rests on the standing ruling of 2026-08-12, verbatim and
// untranslated: 「处理 issue 时犯的错应该总结成经验,保留 issue id没有意义」.
//
// Why this rule is scoped to `skills/**` alone, and not to the other ROOTS.
// `.claude/` and `docs/` are read INSIDE this repo, by readers who have the
// tracker, `git log` and the ADRs — an id there resolves. `skills/**` ships to
// customer projects: it is loaded WHOLE into customer agent context windows, in
// codebases that have none of those. To that reader `#4286` is not a citation,
// it is a citation-SHAPED token that resolves to nothing — and it is billed to
// their context window every session, forever, which is the cost curve
// `scripts/check-skills-token-ratchet.mjs` prices. So the ban follows the
// audience, not the file type, and widening it to the internal roots would be a
// different decision needing its own ruling.
//
// ⚠️ The scan is DELIBERATELY not the `collectFiles()` walk above. That walk
// skips every `references/` directory (SKIP_DIRS), and the published catalog
// keeps hand-authored reference companions there —
// `skills/objectstack-data/references/data-hooks.md` alone carried 15 of these
// ids when the corpus was measured. Reusing the walk would have produced a gate
// that runs, passes, and cannot see a ninth of the population it exists to
// guard: the exact failure this file's header opens with, one rule over.
const PUBLISHED_SKILLS_ROOT = 'skills';

// There is deliberately NO exemption for the generated artifacts under
// `skills/**` (`references/_index.md`, `references/react-blocks.md`). The first
// cut carried one, because those files still held ids projected from TSDoc in
// `packages/spec/src/**`. Those source lines are stripped now, and an exemption
// over a surface that no longer needs one is where the next regeneration would
// smuggle one back in. A red here is fixed AT THE SPEC SOURCE, never by hand-
// editing the artifact — the failure text below prescribes exactly that.

// There is deliberately NO per-passage allowlist here, and adding one is not a
// remedy this gate offers.
//
// The first cut of this rule carried one, for a single passage: the published PM
// skill's CLI usage line, which read `/pm-dispatch #128 #131` and taught the
// command's argument grammar with two real-looking ids. Maintainer ruling
// 2026-08-25 took the other route — the line now reads `/pm-dispatch #<n> #<n>`,
// the same placeholder spelling the sibling `filed as #<n>:` site in that file
// already used. The `#` still teaches the argument grammar, the numbers stop
// impersonating a citation, and the exemption it needed disappears with it.
//
// That is the general shape, not a one-off: a passage that seems to need an
// example id needs a PLACEHOLDER instead. `#<n>` teaches the same syntax, is
// unmistakable to a customer reading it, and costs no exemption. A growable
// allowlist would have been the one place a genuine citation could come to rest
// — "it's an example" is exactly what the author of the next one would believe.

/**
 * A bare internal issue-id reference: `#` followed by 3–5 digits.
 *
 * The precision is carried by the TRAILING `(?![0-9A-Za-z])`, and it is load-
 * bearing rather than decorative — it is what keeps CSS hex colours out. The
 * catalog really contains `#6366f1`, `#4169E1` and `#3498db` in authored
 * examples, and a rule anchored only on the leading `#` reports all three. That
 * is not a hypothetical: the filing count for this cleanup was 92 and the true
 * population was 90, the difference being exactly the two hex colours in
 * `objectstack-ui/SKILL.md` that a `#[0-9]{3,5}` scan mistook for issue ids.
 * A gate that cries wolf on a colour literal is a gate authors route around.
 *
 * The same lookahead rejects 6-digit all-numeric colours (`#123456`), since the
 * sixth digit is a word character.
 *
 * `(?<![#&])` drops two more shapes that are not references: a markdown heading
 * whose text begins with digits (`###4286`), and an HTML numeric entity
 * (`&#8212;`).
 *
 * Deliberately NOT excluded is a leading word character, so the cross-repo
 * spelling `framework#3582` — which really occurred — is caught too.
 *
 * The three shapes named in review as must-not-fire need no special handling
 * and are pinned in the self-test anyway: version numbers (`v17`, `17.0.0`),
 * HTTP status codes (`400 INVALID_FIELD`) and array indices (`fields[0]`) carry
 * no `#` at all, and the ordinal `#1` in "the #1 authoring mistake" is one
 * digit, below the floor.
 */
const INTERNAL_ID_SOURCE = String.raw`(?<![#&])#[0-9]{3,5}(?![0-9A-Za-z])`;
/**
 * ⚠️ Carries the `g` flag, so it is STATEFUL: `.test()` / `.exec()` advance
 * `lastIndex` and the next call resumes mid-string. Only ever hand it to
 * `String#match`, which ignores `lastIndex` for a global pattern. Anything that
 * needs a predicate builds its own from {@link INTERNAL_ID_SOURCE}.
 */
const INTERNAL_ID = new RegExp(INTERNAL_ID_SOURCE, 'g');

// ── Rule 3: bare internal issue ids in SPEC REFUSAL MESSAGES ────────────────
//
// The same ruling as Rule 2, inherited to a third population by the triage of
// 2026-08-25: the customer-facing zod refusal `message:` strings in
// `packages/spec/src/**`. Rule 2's argument transfers unchanged and is if
// anything stronger here — a skill file is read by a customer's agent, while a
// refusal message is printed AT the customer, verbatim, the moment their
// metadata is rejected by `os validate` or a parse. Same audience, no tracker,
// same citation-shaped token resolving to nothing.
//
// ## Why this rule needs a PARSER and the other two do not
//
// The card that commissioned this shipped a census command —
// `git grep -nE "message:.*#[0-9]{3,5}" packages/spec/src` — and it found ONE
// of the sixteen literals actually in the population. Refusal prose in this
// tree is written as multi-line `'a ' + 'b ' + 'c'` chains, so `message:` and
// the id it carries land on different lines and no line-oriented pattern can
// see both. A line scan here would be the dormant gate this file's header opens
// with: running, green, and structurally unable to reach 15/16 of its subject.
//
// So the scan walks the AST and climbs OUT of the concatenation to ask what
// position the string occupies. `parseSourceFile` (scripts/ts-parse.mjs) is the
// only sanctioned way in — `check-parse-guard` reds on a raw
// `ts.createSourceFile` anywhere else under `scripts/**`, because a tree that
// failed to parse is returned looking exactly like one that had nothing to
// report.
//
// ## What counts as a message position
//
// Two spellings, both real in this tree:
//
//   1. a `message:` property — `ctx.addIssue({ message: … })`, a `.refine()`
//      options object, a publish-gate rejection record;
//   2. a POSITIONAL message argument to a zod validator —
//      `z.string().regex(RE, 'an inline label map is keyed by …')`. One member
//      of the founding population was spelled this way, so a property-only
//      matcher would have under-reported by exactly the shape it was written to
//      catch.
//
// ## The three ADJACENT populations, folded in by the 2026-08-26 triage
//
// This rule shipped holding `message:` alone, and named three neighbouring
// populations as deliberately out of scope pending a ruling: the `strictObject`
// unknown-key error-map options (`guidance` / `guidanceSets` / `history` /
// `aliases` / `retiredForms` / `surface`), the `retiredKey()` tombstone
// prescriptions, and `.describe()` docs prose. That ruling arrived as
// ruling-INHERITANCE rather than a new decision — the founding rationale is
// "the ban follows the audience, not the file type", and re-checking it against
// each bucket answers the question without a new maintainer call:
//
//   - `strictObject` guidance and tombstone prescriptions are the SAME audience
//     at the SAME moment as a refusal message. The `guidance` map is consulted
//     on `unrecognized_keys` and printed verbatim at the refusing author; a
//     tombstone prescription IS the parse error (`retiredKey` builds
//     `z.never({ error: () => guidance })`). Rule 2's argument transfers with
//     nothing changed.
//   - `.describe()` prose projects into `content/docs/references/**` and the
//     generated skill artifacts. A customer reading the docs site cannot
//     resolve an internal tracker id either, and the published-catalog slice of
//     this same population was already taken by Rule 2.
//
// **ADR ids and migration commands STAY.** AGENTS.md positively requires a
// tombstone prescription to carry a durable reference — "the FROM → TO mapping,
// the ADR the removal rests on, or the migration command" — and an ADR id is
// customer-resolvable in a way `#NNNN` is not. The issue id sitting BESIDE an
// ADR id is exactly the strippable half; the ADR id is what makes stripping it
// safe. A tombstone whose only reference is the issue id is a decision, not a
// mechanical edit, and is escalated rather than stripped silently.
//
// There is still NO exemption mechanism, in either direction: widening this
// rule meant widening the RECOGNISED POSITIONS below, exactly as this comment
// used to prescribe.
//
// ## The FOURTH population: text BUILT INSIDE A FUNCTION
//
// The three buckets above are positions a literal is WRITTEN at. A share of
// this tree's refusal prose is instead RETURNED BY A FUNCTION that occupies one
// of those positions — `error: (iss) => '…'` on a zod schema's options, a
// hoisted `const X = (key: string): string => '…'` referenced from `message:`
// or `retiredKey(X(…))`, a `$ZodErrorMap` const referenced from `error:`, a
// `(v): StrictObjectOptions => ({ history: '…' })` options factory. The climb
// terminated at `ArrowFunction` / `ReturnStatement` and returned `undefined`,
// so 28 literals carrying 32 tracker ids across 8 files sat outside every
// bucket while this rule reported `0 violations` over four populated ones. The
// gate was not wrong, it was SCOPED — and the scope boundary was invisible from
// its output.
//
// Maintainer ruling 2026-08-29, verbatim: 「同意」 — the inheritance REACHES
// refusal prose built inside `error: () =>` callbacks: same audience, same
// moment; the ban follows the audience, not the spelling.
//
// ⛔ The climb is NOT unconditional through function bodies. That version
// sweeps every string a helper happens to build, VALUES included, and a rule
// that reports values as prose is one authors get disabled. The rule here is
// exactly one sentence wide:
//
//   **A function is transparent to the climb only when the FUNCTION ITSELF
//   sits in a recognised customer-facing position.**
//
// which is decided by asking {@link customerTextPosition} the same question
// about the function node that it was asked about the literal. So:
//
//   - `error: (iss) => '…'`             — the function IS the `error` option.
//   - `const X = (k) => '…'` where `X`  — the function IS a text-sink const,
//     is a {@link collectTextSinkConsts}   the same fixed point the hoisted
//     sink                                 VALUE spelling already rides on.
//   - `(v): StrictObjectOptions => …`   — the function IS declared, by its own
//     with a STRICT_OPTION_KEYS key        return-type annotation, to build a
//     latched on the way up                strictObject options record.
//   - `const helper = () => 'x'` that   — NOT transparent. Its body stays
//     no recognised position consumes      unreachable, which is the whole
//                                          point of the three clauses above.
//
// Their literals are bucketed `functionBuilt` rather than folded into the
// bucket of the position the function occupies, and that is deliberate: the
// blindness floor is PER BUCKET, so folding them into `message` / `tombstone`
// would let this clause rot back to `undefined` while those buckets' DIRECT
// members held the floor up — the exact silence this population was found by.
//
// `error:` is also recognised as a position in its own right (zod 4 renamed the
// error-map option away from `message`); a plain string there is a `message`,
// since nothing was built in a function.
//
// ## Why the positions alone are not enough: the hoisted-const spelling
//
// A position-only matcher reads `guidance: { where: '…' }` and stops at the
// first `VariableDeclaration` it climbs into. That is most of this population
// walking free: the guidance maps are overwhelmingly HOISTED — declared once as
// `const TOOL_RETIRED_KEY_GUIDANCE = {…}` / `const NOTIFY_KEY_GUIDANCE = {…}`
// and referenced as `guidance: NOTIFY_KEY_GUIDANCE` — and so are whole refusal
// messages (`message: CREDENTIALS_REF_MONGO_URL_NO_USER_REFUSED`). That last
// shape is not a hypothetical about the new buckets: it was hiding FOUR ids
// from the `message:` rule itself, which had reported this population clean
// since the day it landed. A rule that reads only the literal's own position is
// blind to every sink whose text was given a name.
//
// So {@link collectTextSinkConsts} runs a per-file pass first: any module-local
// const whose contents flow into a recognised sink is itself a sink, to a fixed
// point (a const referenced by a const referenced by a `guidance:`). It is
// name-based within one module rather than a scope analysis — deliberately, and
// it errs toward INCLUSION, which is the safe direction for a rule whose
// failure mode is silence.
const SPEC_SOURCE_ROOT = 'packages/spec/src';

/**
 * `StrictObjectOptions` keys whose values are printed at the refusing author.
 *
 * Every one of these lands in the unknown-key error message built by
 * `strictObjectError` (packages/spec/src/shared/strict-object.ts): `surface`
 * names the surface in the opening sentence, `history` is the "what used to
 * happen silently" clause, and `aliases` / `guidance` / `guidanceSets` /
 * `retiredForms` are the per-key prescriptions appended as bullets.
 *
 * `extraKeys` is deliberately absent: it carries KEY NAMES for the "did you
 * mean" fallback, not prose, so including it would report identifiers as text.
 */
const STRICT_OPTION_KEYS = new Set([
  'surface', 'history', 'aliases', 'guidance', 'guidanceSets', 'retiredForms',
]);

/**
 * The calls that take a `StrictObjectOptions` in argument position 0.
 *
 * Anchored to the call rather than to the key names alone: `guidance` and
 * `history` are ordinary English words, and a rule that fired on any property
 * so named anywhere in the tree would report schema shapes and config records
 * as refusal prose. A const annotated `StrictObjectOptions` (or named
 * `*_STRICT_OPTIONS`) is the other recognised anchor — that is how the shared
 * visibility/editability option sets are written.
 */
const STRICT_OBJECT_CALLS = new Set(['strictObject', 'strictObjectError']);

/**
 * Calls whose argument 0 IS the customer-facing prescription.
 *
 * `retiredKey(guidance)` builds `z.never({ error: () => guidance })` plus a
 * `[REMOVED] …` describe, so its argument is printed at the author on parse AND
 * projected into the generated docs — both audiences from one literal.
 */
const TOMBSTONE_CALLS = new Set(['retiredKey']);

/**
 * Wrappers that pass their argument through unchanged, so the climb continues
 * rather than stopping. `Object.freeze({ … })` around a guidance table is the
 * measured case; a stop here would drop the whole table.
 */
const TRANSPARENT_CALLS = new Set(['freeze']);

/**
 * zod validators whose trailing positional argument is a refusal message.
 *
 * Deliberately a closed list rather than "any string argument in position > 0":
 * an open rule would flag `.default('draft')`, `.catch('')` and every other
 * VALUE argument, and a gate that reports values as prose is one authors route
 * around. Reaching for a spelling that is not here? Add it, and add a self-test
 * case in the same edit — an unrecognised spelling produces no flag, silently.
 */
const POSITIONAL_MESSAGE_CALLS = new Set([
  'refine', 'superRefine', 'check', 'regex', 'min', 'max', 'length',
  'startsWith', 'endsWith', 'includes', 'email', 'url', 'uuid', 'int',
  'positive', 'nonnegative', 'multipleOf', 'nonempty', 'gt', 'gte', 'lt', 'lte',
]);

const posix = (p) => p.split(sep).join('/');

function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    if (SKIP_PATHS.has(posix(p))) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.mdx?$/.test(e) && !SKIP_FILES.has(posix(p))) out.push(p);
  }
}

/** A declared ROOT that could not be resolved to a directory. Carries the names. */
class DeadRootError extends Error {
  constructor(dead) {
    super(`unresolvable ROOT(s): ${dead.map((d) => `${d.root} — ${d.reason}`).join('; ')}`);
    this.name = 'DeadRootError';
    this.dead = dead;
    /** @type {string[]} just the root names, for callers that only need to point. */
    this.roots = dead.map((d) => d.root);
  }
}

/**
 * Resolve every declared ROOT before scanning anything; throw naming the ones that
 * are not directories.
 *
 * Deliberately no whitelist / no "optional root" flag. A whitelist is the right
 * shape when a root is *legitimately* absent in some checkout form, and none of
 * these are: `.claude`, `docs`, `skills` and `content` are all git-tracked
 * directories with tracked files in them, so any checkout that can run
 * `pnpm check:doc-authoring` at the repo root has all of them. Adding an optional
 * marker "just in case" would hand the next author a supported way to silence this
 * failure (`optional: true`) instead of fixing the rename — which is the empty
 * `catch {}` again, only spelled politely. If a root ever does become legitimately
 * absent, that is a real decision: add the entry *with* its condition and a test,
 * don't relax the check.
 *
 * @throws {DeadRootError}
 */
function assertRootsResolvable(roots = ROOTS) {
  const dead = [];
  for (const root of roots) {
    let stat = null;
    try {
      stat = statSync(root);
    } catch (err) {
      dead.push({ root, reason: err?.code === 'ENOENT' ? 'does not exist' : `cannot be read (${err?.code ?? err})` });
      continue;
    }
    if (!stat.isDirectory()) dead.push({ root, reason: 'exists but is not a directory' });
  }
  if (dead.length) throw new DeadRootError(dead);
}

/**
 * A declared ROOT that resolved to a directory and yielded no file to scan.
 * Carries the names, and the total the run would otherwise have reported.
 */
class EmptyRootError extends Error {
  constructor(empty, total) {
    super(`ROOT(s) contributed no Markdown/MDX file: ${empty.join(', ')} (total scanned: ${total})`);
    this.name = 'EmptyRootError';
    /** @type {string[]} the roots that yielded nothing. */
    this.roots = empty;
    /** @type {number} files found across all roots — 0 when the whole scan evaporated. */
    this.total = total;
  }
}

/**
 * Every Markdown/MDX file in scope, relative to the current working directory.
 *
 * Nothing here is wrapped in a catch: an unreadable root fails loudly above, and an
 * error *inside* `walk` (a vanished file, a permission fault) means the corpus was
 * only partly read — which must not be reported as a clean scan either.
 *
 * Each root must also actually YIELD something (#4932). A root that resolves but
 * holds no Markdown is the same evaporation as a root that does not resolve, minus
 * the ENOENT that made the first kind detectable: the walk succeeds, the count
 * shrinks, and nothing in the output distinguishes "clean" from "never read".
 *
 * @throws {DeadRootError} a declared ROOT is not a directory.
 * @throws {EmptyRootError} a declared ROOT resolved but contributed no file.
 */
function collectFiles() {
  assertRootsResolvable();
  const files = [];
  const empty = [];
  for (const r of ROOTS) {
    const before = files.length;
    walk(r, files);
    if (files.length === before) empty.push(r);
  }
  if (empty.length) throw new EmptyRootError(empty, files.length);
  return files;
}

/**
 * Every Markdown file in the PUBLISHED catalog — generated artifacts included.
 *
 * Its own walk, for the reason argued at {@link PUBLISHED_SKILLS_ROOT}: the
 * `collectFiles()` walk skips `references/`, where both the hand-authored
 * companions and the generated `_index.md` files live.
 *
 * Empty is a hard error here for the same reason it is in `collectFiles`
 * (#4932): "the catalog is clean" and "the catalog was never opened" are the
 * same output and the same exit code, and this rule's whole job is to speak for
 * a corpus the author cannot see being read.
 *
 * @throws {DeadRootError} `skills/` is not a directory.
 * @throws {EmptyRootError} `skills/` yielded no Markdown file.
 */
function collectPublishedSkillFiles(root = PUBLISHED_SKILLS_ROOT) {
  assertRootsResolvable([root]);
  const files = [];
  // A dedicated walker, NOT the shared `walk()`. That one honours SKIP_DIRS,
  // whose `references` entry is correct for the bare-literal rule and wrong for
  // this one: `references/` is where the catalog's hand-authored companions
  // live. Reusing it green-lit a ninth of this rule's population unseen — the
  // self-test case above is the reverse proof, and it failed until this walker
  // existed.
  (function descend(dir) {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) descend(p);
      else if (/\.mdx?$/.test(e)) files.push(posix(p));
    }
  })(root);
  if (files.length === 0) throw new EmptyRootError([root], 0);
  return files.sort();
}

/** Bare internal issue-id references in one published file's source. */
function findIdViolations(source, file) {
  const out = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const ids = ln.match(INTERNAL_ID);
    if (ids) out.push({ file: posix(file), line: i + 1, ids, text: ln.trim() });
  }
  return out;
}

/**
 * Every non-test TypeScript source in the spec package.
 *
 * Test bodies are excluded on purpose and it is the one exclusion here: a test
 * asserting "this refusal names #5869" is read only by someone who has the
 * tracker, and the pin has to be able to quote whatever the message says. The
 * ban follows the audience, which is the same sentence Rule 2 is scoped by.
 *
 * @throws {DeadRootError} the root is not a directory.
 * @throws {EmptyRootError} the root yielded no source file — "the spec is
 *   clean" and "the spec was never opened" are otherwise the same output and
 *   the same exit code (#4932, one population over).
 */
function collectSpecSourceFiles(root = SPEC_SOURCE_ROOT) {
  assertRootsResolvable([root]);
  const files = [];
  (function descend(dir) {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) descend(p);
      else if (/\.m?ts$/.test(e) && !/\.(test|spec|bench)\.m?ts$/.test(e)) files.push(posix(p));
    }
  })(root);
  if (files.length === 0) throw new EmptyRootError([root], 0);
  return files.sort();
}

/** The callee's plain name, for `f(…)` and `x.f(…)` alike. */
function calleeName(call, ts) {
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) ? callee.name.getText() : callee.getText();
}

/** Is this node a function whose body could hold customer-facing prose? */
function isFunctionLike(n, ts) {
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n)
    || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
}

/**
 * The function a `return` belongs to, or `undefined` at module scope.
 *
 * Stops at a class or the source file rather than walking forever: a `return`
 * with no enclosing function is not a shape this tree has, and treating one as
 * transparent would be a climb with no boundary at all.
 */
function enclosingFunction(node, ts) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (isFunctionLike(cur, ts)) return cur;
    if (ts.isSourceFile(cur) || ts.isClassDeclaration(cur)) return undefined;
  }
  return undefined;
}

/**
 * Does this function DECLARE, by its own return-type annotation, that it builds
 * a `StrictObjectOptions` record?
 *
 * The same anchor {@link inStrictOptions} already trusts on a const
 * (`const X: StrictObjectOptions = …`), one indirection over: the shared
 * per-variant option factories in `ui/app.zod.ts` are written
 * `(variant): StrictObjectOptions => ({ surface, aliases, history })`, and
 * without this their `history` prose is written at a recognised KEY inside a
 * function nothing else identifies. Annotation-driven, never name-driven: a
 * factory that does not say what it returns is not taken at its word.
 */
function buildsStrictObjectOptions(fn, ts) {
  return !!fn && /\bStrictObjectOptions\b/.test(fn.type ? fn.type.getText() : '');
}

/**
 * Is this property assignment a `StrictObjectOptions` key, in a position where
 * the value is really printed at the author?
 *
 * Climbs from the property to whichever encloses it first: a
 * {@link STRICT_OBJECT_CALLS} call (the options are argument 0 — the shape is
 * argument 1, and a shape key that happens to be named `guidance` holds a zod
 * schema, not prose) or a `StrictObjectOptions`-typed / `*_STRICT_OPTIONS`
 * const, which is how the shared visibility and editability option sets are
 * written.
 *
 * The const's declared type is read through {@link declaredTypeText} — the same
 * helper {@link collectTextSinkConsts} uses — so the two type anchors in this
 * file cannot answer differently about the same declaration. They could before:
 * this one read `decl.type` alone and was blind to `… satisfies
 * StrictObjectOptions`, a spelling the tree already uses for the sibling type
 * (`WIDGET_GUIDANCE_SETS`, `ui/dashboard.zod.ts`), while its sibling anchor had
 * been widened and this one had not.
 *
 * That divergence was never visible in the VERDICT, and saying so is the point:
 * {@link collectTextSinkConsts} reaches the same prose by its own type anchor
 * plus the const→const closure, so a `satisfies`-spelled options table was
 * reported either way — measured, both spellings, before and after. What the
 * divergence cost was the REDUNDANCY. The spelling was carried by exactly one
 * mechanism, and the seed path through here — the one that reaches a guidance
 * table hoisted out of the options object — would not have compensated if that
 * one were ever narrowed. Which is why the case pinned in `--self-test` is on
 * this predicate rather than on a scan: end to end the two anchors are
 * indistinguishable, so a fixture would pass with this widening reverted.
 */
function inStrictOptions(prop, ts) {
  let cur = prop;
  for (let hops = 0; cur.parent && hops < 30; hops++) {
    const p = cur.parent;
    if (ts.isCallExpression(p)) {
      return STRICT_OBJECT_CALLS.has(calleeName(p, ts)) && p.arguments.indexOf(cur) === 0;
    }
    if (ts.isVariableDeclaration(p)) {
      const nm = p.name.getText();
      return /_STRICT_OPTIONS$/.test(nm) || /\bStrictObjectOptions\b/.test(declaredTypeText(p, ts));
    }
    // A function boundary. Transparent ONLY when the function declares itself
    // an options factory by its return-type annotation — the fourth-population
    // clause, kept as narrow here as it is in `customerTextPosition`.
    if (isFunctionLike(p, ts)) return buildsStrictObjectOptions(p, ts);
    if (ts.isReturnStatement(p)) return buildsStrictObjectOptions(enclosingFunction(p, ts), ts);
    cur = p;
  }
  return false;
}

/** Every identifier name mentioned anywhere inside an expression. */
function identifiersIn(node, ts, out = new Set()) {
  const visit = (n) => {
    if (ts.isIdentifier(n)) { out.add(n.text); return; }
    if (ts.isPropertyAccessExpression(n)) { visit(n.expression); return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/**
 * The type a const DECLARES, in either spelling TypeScript offers.
 *
 * `const X: T = …` and `const X = … satisfies T` are the same statement about
 * the same const, and this tree writes guidance tables both ways —
 * `COMPONENT_LEVEL_GUIDANCE: readonly KeySetGuidance[]` (`ui/component.zod.ts`)
 * and `WIDGET_GUIDANCE_SETS = […] as const satisfies readonly KeySetGuidance[]`
 * (`ui/dashboard.zod.ts`). A type anchor that reads only `decl.type` sees the
 * first and is silently blind to the second — and silence is the failure mode
 * this whole file exists to prevent. `as const` is walked THROUGH rather than
 * stopped at, because the `satisfies` sits outside it in that spelling.
 *
 * Both type anchors in this file route through here — {@link inStrictOptions}'s
 * const branch and {@link collectTextSinkConsts}'s — so "what type does this
 * const declare" has ONE answer. Two copies of the read is how the second one
 * came to be a spelling behind the first.
 *
 * The INITIALIZER is deliberately not searched for the type name: a local like
 * `new Set<KeySetGuidance>()` (`shared/suggestions.zod.ts`, inside the error
 * builder) mentions the type without being one, and reporting the runtime's own
 * bookkeeping as authoring prose is how a gate gets routed around. Pinned in
 * `--self-test`.
 */
function declaredTypeText(decl, ts) {
  if (decl.type) return decl.type.getText();
  const parts = [];
  let cur = decl.initializer;
  for (let hops = 0; cur && hops < 8; hops++) {
    if (!ts.isSatisfiesExpression(cur) && !ts.isAsExpression(cur)) break;
    parts.push(cur.type.getText());
    cur = cur.expression;
  }
  return parts.join(' ');
}

/**
 * Module-local const names whose CONTENTS reach a customer-facing sink.
 *
 * The blind spot this closes is argued in the Rule 3 header: the guidance maps
 * and a good share of the refusal messages are hoisted into a named const and
 * referenced from the sink, so a matcher that only reads a literal's own
 * position never reaches them. Seeded from every recognised sink, from the
 * naming conventions and from the TYPE anchors below, then closed to a FIXED
 * POINT so a const referenced by a const referenced by a `guidance:` is covered
 * too.
 *
 * ## The cross-module sink: a const whose only consumer is another file
 *
 * Seeding from in-file sinks alone leaves one shape unreachable BY
 * CONSTRUCTION. A guidance table declared in a shared module and handed to
 * `guidanceSets:` from OTHER files has no recognised anchor in its own file, so
 * the whole const walks free — measured live on
 * `SELECT_OPTION_EDITABILITY_GUIDANCE` (`shared/editability-boundary.ts`),
 * whose prescription is printed verbatim at a refusing author on both the
 * object-field face and the form-view face, and which this rule reported clean
 * from the day it landed. Its neighbour `EDITABILITY_BOUNDARY_GUIDANCE`, same
 * file and same shape, was reachable only by ACCIDENT: it happens to be
 * consumed in-module by a `StrictObjectOptions` const. The gap is a property of
 * the CONSUMPTION SITE, not of the const — so no amount of care at the
 * declaration would have avoided it.
 *
 * A const whose declared type is `KeySetGuidance` is therefore a sink in its own
 * right, on the same footing as `StrictObjectOptions`: the type exists solely to
 * be handed to `guidanceSets:`, and `strictUnknownKeyError` prints the
 * `prescription` it carries verbatim at the author. Anchoring on the TYPE rather
 * than on a named list of guidance modules closes the CLASS — a named list
 * would have to be edited again for the next shared guidance const, which is
 * this same blind spot moved one level up.
 *
 * Name-based within one module rather than a scope analysis, deliberately: a
 * shadowed local of the same name would be a false positive, which costs an
 * author one rewritten sentence, while the missing analysis costs silence — and
 * silence is the failure this whole file is a monument to.
 *
 * @returns {Map<string, string>} const name → the bucket it feeds.
 */
function collectTextSinkConsts(sf, ts) {
  const sinks = new Map();
  const decls = new Map();
  const seed = (expr, bucket) => {
    for (const id of identifiersIn(expr, ts)) if (!sinks.has(id)) sinks.set(id, bucket);
  };

  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      decls.set(n.name.text, n.initializer);
      if (/_RETIRED_KEY_GUIDANCE$/.test(n.name.text)) sinks.set(n.name.text, 'tombstone');
      const ty = declaredTypeText(n, ts);
      if (
        /_STRICT_OPTIONS$/.test(n.name.text)
        || /\bStrictObjectOptions\b/.test(ty)
        || /\bKeySetGuidance\b/.test(ty)
      ) {
        sinks.set(n.name.text, 'strictObject');
      }
    }
    if (ts.isPropertyAssignment(n)) {
      const name = n.name.getText();
      // `error:` is zod 4's spelling of the error-map option and seeds exactly
      // like `message:`. It is load-bearing rather than tidy: the credential
      // refusals in `data/driver/common.zod.ts` reach their sink ONLY through
      // `z.never({ error: () => INLINE_CREDENTIAL_REFUSED(key) })`, so without
      // this line that const is not a sink and its whole body stays invisible.
      if (name === 'message' || name === 'error') seed(n.initializer, 'message');
      else if (STRICT_OPTION_KEYS.has(name) && inStrictOptions(n, ts)) seed(n.initializer, 'strictObject');
    }
    if (ts.isCallExpression(n)) {
      const name = calleeName(n, ts);
      if (name === 'describe' && n.arguments[0]) seed(n.arguments[0], 'describe');
      if (TOMBSTONE_CALLS.has(name) && n.arguments[0]) seed(n.arguments[0], 'tombstone');
      if (POSITIONAL_MESSAGE_CALLS.has(name) && n.arguments.length > 1) {
        for (const a of n.arguments.slice(1)) seed(a, 'message');
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);

  // Close over const→const references. Bounded: the deepest real chain is two
  // hops, and an unbounded loop over a cyclic reference would not terminate.
  for (let pass = 0; pass < 8; pass++) {
    let grew = false;
    for (const [name, bucket] of [...sinks]) {
      const init = decls.get(name);
      if (!init) continue;
      for (const id of identifiersIn(init, ts)) {
        if (!sinks.has(id) && decls.has(id)) { sinks.set(id, bucket); grew = true; }
      }
    }
    if (!grew) break;
  }

  // An identifier that is not a declaration in THIS file is an import or a
  // parameter; its literals are not here to judge.
  for (const name of [...sinks.keys()]) if (!decls.has(name)) sinks.delete(name);
  return sinks;
}

/**
 * Does this string literal sit in a customer-facing text position?
 *
 * Climbs OUT through `+` concatenation, parentheses, conditionals and template
 * spans before asking — the whole reason this rule is an AST walk — and now
 * also through the object/array/`new Map([…])` structure a guidance table is
 * written in, so a nested prescription is reached rather than abandoned at its
 * own key.
 *
 * A function boundary is crossed only when the FUNCTION ITSELF sits in a
 * recognised position — decided by asking this same question about the function
 * node (see the "fourth population" section of the Rule 3 header). ⛔ Never an
 * unconditional climb through function bodies: that reports values as prose.
 *
 * @param {number} [fnDepth] how many function boundaries have been crossed
 *   already. A bound, not a belief: the deepest real chain in this tree is one
 *   (a literal in a const arrow referenced from a `message:`), and an
 *   unbounded recursion over a self-referential const would not terminate.
 * @returns {{where: string, bucket: string}|undefined}
 */
function customerTextPosition(node, ts, sinkConsts = new Map(), fnDepth = 0) {
  let cur = node;
  let strictKey;
  /**
   * The fourth population's clause: `fn` encloses the literal and the climb
   * wants to leave through it. Transparent only if `fn` is itself somewhere
   * customer-facing.
   */
  const throughFunction = (fn) => {
    if (!fn || fnDepth >= 4) return undefined;
    // An options FACTORY, declared as such by its own return type, once a
    // STRICT_OPTION_KEYS key has been latched on the way up.
    if (strictKey && buildsStrictObjectOptions(fn, ts)) {
      return { where: `strictObject ${strictKey} (built in a function)`, bucket: 'functionBuilt' };
    }
    const outer = customerTextPosition(fn, ts, sinkConsts, fnDepth + 1);
    return outer
      ? { where: `${outer.where} (built in a function)`, bucket: 'functionBuilt' }
      : undefined;
  };
  // A bound, not a belief: refusal prose in this tree reaches ~14 concatenated
  // operands, and an unbounded climb would walk to the SourceFile and start
  // reporting whole modules as messages. Raised from 60 with the structural
  // hops a nested guidance table adds.
  for (let hops = 0; cur.parent && hops < 90; hops++) {
    const p = cur.parent;
    if (
      (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken)
      || ts.isParenthesizedExpression(p)
      || ts.isConditionalExpression(p)
      || ts.isTemplateSpan(p)
      || ts.isTemplateExpression(p)
      || ts.isAsExpression(p)
      || ts.isSatisfiesExpression(p)
    ) { cur = p; continue; }

    if (ts.isPropertyAssignment(p) && p.initializer === cur) {
      const name = p.name.getText();
      if (name === 'message') return { where: 'message:', bucket: 'message' };
      // zod 4's spelling of the same option, printed at the same author in the
      // same breath. A plain string here IS a message; only text a FUNCTION
      // built gets the fourth population's own bucket, above.
      if (name === 'error') return { where: 'error:', bucket: 'message' };
      if (!strictKey && STRICT_OPTION_KEYS.has(name) && inStrictOptions(p, ts)) strictKey = name;
      cur = p; continue;
    }
    // The structure a guidance table is written in — keep climbing.
    if (
      ts.isObjectLiteralExpression(p)
      || ts.isArrayLiteralExpression(p)
      || ts.isSpreadAssignment(p)
      || ts.isShorthandPropertyAssignment(p)
      || ts.isNewExpression(p)
    ) { cur = p; continue; }

    if (ts.isCallExpression(p)) {
      const name = calleeName(p, ts);
      if (TRANSPARENT_CALLS.has(name)) { cur = p; continue; }
      const idx = p.arguments.indexOf(cur);
      if (name === 'describe' && idx === 0) return { where: '.describe()', bucket: 'describe' };
      if (TOMBSTONE_CALLS.has(name) && idx === 0) return { where: `${name}()`, bucket: 'tombstone' };
      if (STRICT_OBJECT_CALLS.has(name) && strictKey && idx === 0) {
        return { where: `strictObject ${strictKey}`, bucket: 'strictObject' };
      }
      return POSITIONAL_MESSAGE_CALLS.has(name) && idx > 0
        ? { where: `.${name}(…, message)`, bucket: 'message' }
        : undefined;
    }

    if (ts.isVariableDeclaration(p)) {
      const nm = p.name.getText();
      if (!sinkConsts.has(nm)) return undefined;
      return {
        where: `via ${nm}`,
        bucket: strictKey ? 'strictObject' : sinkConsts.get(nm),
      };
    }
    if (ts.isReturnStatement(p)) return throughFunction(enclosingFunction(p, ts));
    if (isFunctionLike(p, ts)) return throughFunction(p);
    cur = p;
  }
  return undefined;
}

/**
 * Customer-facing text in one spec source, and how many such strings were seen
 * at all — PER BUCKET.
 *
 * The second number is not decoration. This rule's population is expected to be
 * EMPTY in the steady state, so "no violations" is the same output as "the
 * detector no longer recognises how messages are spelled" — the failure this
 * whole file is a monument to. {@link main} asserts against it, so a detector
 * that has gone blind reds instead of congratulating itself.
 *
 * It is per-bucket for the same reason #4932's floor is per-ROOT and not on the
 * total: one populous bucket holds a total up while another empties, and "part
 * of the population was read" is precisely the verdict this rule must not
 * resolve in the corpus's favour. `.describe()` alone would keep a total
 * positive forever while the `guidance` matcher rotted.
 */
function findCustomerTextIdViolations(source, file, ts) {
  const out = [];
  const seen = { message: 0, strictObject: 0, tombstone: 0, describe: 0, functionBuilt: 0 };
  const sf = parseSourceFile(file, source);
  const sinkConsts = collectTextSinkConsts(sf, ts);
  const visit = (node) => {
    if (
      ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateExpression(node)
    ) {
      const pos = customerTextPosition(node, ts, sinkConsts);
      if (pos) {
        seen[pos.bucket] += 1;
        const text = node.getText(sf);
        const ids = text.match(INTERNAL_ID);
        if (ids) {
          out.push({
            file: posix(file),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            ids,
            where: pos.where,
            bucket: pos.bucket,
            text: text.length > 120 ? `${text.slice(0, 120)}…` : text,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return { violations: out, seen };
}

/** Bare metadata literals inside ts/tsx fenced blocks of one file's source. */
function findViolations(source, file) {
  const out = [];
  const lines = source.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!inBlock) { if (FENCE_OPEN.test(ln)) inBlock = true; continue; }
    if (FENCE_CLOSE.test(ln)) { inBlock = false; continue; }
    if (BARE.test(ln)) out.push({ file: posix(file), line: i + 1, text: ln.trim() });
  }
  return out;
}

// The reverse proof, made permanent (#4913). `.claude/` currently holds zero ts
// code blocks, so adding it to ROOTS leaves the gate green — which is exactly
// what "added it and it still cannot see the directory" looks like from outside.
// Five defects of that family closed in one week (#4690 / #4804 / #4835 / #4868
// / #4890): a gate running, green, and structurally unable to reach the thing it
// claims to check. So the wiring is asserted against a real temporary tree —
// walked with the real walker, from the real ROOTS — rather than only the regex.
function selfTest() {
  const bare = ['```ts', 'export const dashboard: Page = {', "  name: 'dashboard',", '};', '```'].join('\n');
  const bareNs = ['```tsx', 'export const settings: UI.PageInput = {', '};', '```'].join('\n');
  const wrapped = ['```ts', 'export const ok = definePage({', '});', '```'].join('\n');
  const jsFence = ['```js', 'export const dashboard: Page = {', '};', '```'].join('\n');
  const prose = ['Do not write `export const dashboard: Page = {` in app code.'].join('\n');

  const tree = {
    // The whole point of #4913: a violation here must be found.
    '.claude/skills/demo/SKILL.md': bare,
    '.claude/agents/os-dev.md': bareNs,
    // ...and one in another agent's worktree copy must NOT be, or every parallel
    // agent's in-flight branch becomes this gate's problem.
    '.claude/worktrees/other-agent/skills/demo/SKILL.md': bare,
    // #4929, both directions. The live `docs/` corpus is in scope...
    'docs/adr/0010-metadata-protection-model.md': bare,
    'docs/notes/crm-development-standards.mdx': bareNs,
    'docs/design/permission-model.md': wrapped,
    // ...including hand-written top-level guides, since the root is `docs`.
    'docs/protocol-upgrade-guide.md': bare,
    // ...and the dated process records are exempt by path. The SAME violating
    // body sits in each of these three: if the exemption ever stops matching,
    // these turn red and say so, instead of the pair of assertions below both
    // passing for the wrong reason.
    'docs/audits/2026-06-spec-audit.md': bare,
    'docs/handoff/2026-06-handoff.md': bare,
    'docs/plans/v18-rollout.md': bare,
    // Pre-existing roots keep working.
    'skills/legit/SKILL.md': wrapped,
    'content/docs/ui/pages.mdx': [jsFence, prose].join('\n\n'),
    // Not Markdown, and an explicitly exempt file.
    '.claude/settings.json': '{}',
    'content/docs/ai/skills-reference.mdx': bare,
  };

  const dir = mkdtempSync(join(tmpdir(), 'doc-authoring-selftest-'));
  const cwd = process.cwd();
  const failures = [];
  const expect = (label, got, want) => {
    if (got !== want) failures.push(`  ✗ self-test "${label}": expected ${want}, got ${got}`);
  };

  try {
    for (const [rel, body] of Object.entries(tree)) {
      const full = join(dir, ...rel.split('/'));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    process.chdir(dir);
    const files = collectFiles().map(posix);
    const violations = files.flatMap((f) => findViolations(readFileSync(f, 'utf8'), f));

    expect('.claude is walked', files.includes('.claude/skills/demo/SKILL.md'), true);
    expect('.claude is not limited to skills/', files.includes('.claude/agents/os-dev.md'), true);
    expect(
      '.claude/worktrees is skipped',
      files.some((f) => f.startsWith('.claude/worktrees/')),
      false,
    );
    expect('SKIP_FILES still applies', files.includes('content/docs/ai/skills-reference.mdx'), false);
    expect('markdown files collected', files.length, 8);
    expect('bare literal in .claude/skills is a violation', violations.some((v) => v.file === '.claude/skills/demo/SKILL.md'), true);
    expect('namespaced Input alias in .claude/agents is a violation', violations.some((v) => v.file === '.claude/agents/os-dev.md'), true);
    expect('defineX factory form passes', violations.some((v) => v.file === 'skills/legit/SKILL.md'), false);
    expect('non-ts fence and prose pass', violations.some((v) => v.file === 'content/docs/ui/pages.mdx'), false);

    // --- #4929: the live docs/ corpus is reachable, the process records are not. ---
    // Stated as two halves of one claim, because either half alone is satisfied by
    // a scope that is simply wrong in the other direction: "docs/adr is red" is
    // also true of a scope that swallows the whole of docs/, and "docs/handoff is
    // green" is also true of the pre-#4929 scope that never opened docs/ at all.
    expect('docs/adr is walked', files.includes('docs/adr/0010-metadata-protection-model.md'), true);
    expect('docs/notes is walked', files.includes('docs/notes/crm-development-standards.mdx'), true);
    expect('docs/design is walked', files.includes('docs/design/permission-model.md'), true);
    expect('top-level docs guides are walked', files.includes('docs/protocol-upgrade-guide.md'), true);
    expect('bare literal in docs/adr is a violation', violations.some((v) => v.file === 'docs/adr/0010-metadata-protection-model.md'), true);
    expect('namespaced Input alias in docs/notes is a violation', violations.some((v) => v.file === 'docs/notes/crm-development-standards.mdx'), true);
    expect('bare literal in a top-level docs guide is a violation', violations.some((v) => v.file === 'docs/protocol-upgrade-guide.md'), true);
    expect('defineX form in docs/design passes', violations.some((v) => v.file === 'docs/design/permission-model.md'), false);
    for (const exempt of ['docs/audits', 'docs/handoff', 'docs/plans']) {
      expect(`${exempt} is not walked`, files.some((f) => f.startsWith(`${exempt}/`)), false);
      expect(`${exempt} reports no violation`, violations.some((v) => v.file.startsWith(`${exempt}/`)), false);
    }

    expect('total violations', violations.length, 5);

    // --- Reverse proof for the dead-root hard error (#4916), made permanent. ---
    // Everything above ran green over a tree where all three roots resolve. That
    // observation is worth nothing on its own: the defect being fixed here is a
    // gate that goes green *because* it could not reach a root. So break one root
    // the way a rename breaks it in the real repo, require red, require the red to
    // name the root that died and not the survivors, then restore it and require
    // green again. Red-then-green, in the same run, every run.
    const renamedRoot = join(dir, '.claude-renamed-by-self-test');
    renameSync(join(dir, '.claude'), renamedRoot);
    let deadErr = null;
    try { collectFiles(); } catch (err) { deadErr = err; }
    renameSync(renamedRoot, join(dir, '.claude'));

    expect('a renamed ROOT throws instead of quietly scanning less', deadErr instanceof DeadRootError, true);
    expect('the failure names the dead root', deadErr?.roots?.join(',') ?? '<none>', '.claude');
    expect('the failure does not blame the surviving roots', /docs|skills|content/.test(deadErr?.message ?? ''), false);

    // A ROOT that exists but is not a directory is dead in the same way: the old
    // `catch {}` swallowed its ENOTDIR exactly as it swallowed ENOENT.
    renameSync(join(dir, 'skills'), join(dir, 'skills-renamed-by-self-test'));
    writeFileSync(join(dir, 'skills'), 'not a directory');
    let notDirErr = null;
    try { collectFiles(); } catch (err) { notDirErr = err; }
    rmSync(join(dir, 'skills'));
    renameSync(join(dir, 'skills-renamed-by-self-test'), join(dir, 'skills'));

    expect('a ROOT that is a file is dead too', notDirErr?.dead?.[0]?.reason ?? '<none>', 'exists but is not a directory');

    // ...and restoring both roots restores the green, so the red above was caused
    // by the broken root and nothing else.
    expect('restoring the roots makes the scan green again', collectFiles().length, files.length);

    // --- Reverse proof for the empty-scan hard error (#4932), same discipline. ---
    // The direction was decided before it was run: a root that resolves and yields
    // nothing must be RED, and the red must name that root only. This is the case
    // #4916's assertion cannot reach — nothing is renamed, nothing is unreadable,
    // the corpus is simply not there any more.
    const emptiedRoot = join(dir, 'skills', 'legit', 'SKILL.md');
    rmSync(emptiedRoot);
    let emptyErr = null;
    try { collectFiles(); } catch (err) { emptyErr = err; }
    writeFileSync(emptiedRoot, wrapped);

    expect('a root that resolves but yields nothing is red', emptyErr instanceof EmptyRootError, true);
    expect('the failure names the empty root', emptyErr?.roots?.join(',') ?? '<none>', 'skills');
    expect('the failure does not blame the populated roots', /\.claude|docs|content/.test(emptyErr?.roots?.join(',') ?? ''), false);
    // The other roots were still scanned, so the total proves the run was not
    // simply aborted: 8 files minus the one just removed.
    expect('the failure reports what the run did find', emptyErr?.total ?? -1, files.length - 1);
    expect('restoring the file makes the scan green again', collectFiles().length, files.length);

    // ...and the extreme the issue named: every root resolves, the whole scan
    // finds nothing, and the old code printed `✓ 0 files clean` and exited 0.
    const bare2 = mkdtempSync(join(tmpdir(), 'doc-authoring-selftest-empty-'));
    let allEmptyErr = null;
    try {
      for (const r of ROOTS) mkdirSync(join(bare2, r), { recursive: true });
      process.chdir(bare2);
      try { collectFiles(); } catch (err) { allEmptyErr = err; }
    } finally {
      process.chdir(dir);
      rmSync(bare2, { recursive: true, force: true });
    }
    expect('a scan that finds nothing at all is red, not "0 files clean"', allEmptyErr instanceof EmptyRootError, true);
    expect('every empty root is named', allEmptyErr?.roots?.join(',') ?? '<none>', ROOTS.join(','));
    expect('the zero total is reported', allEmptyErr?.total ?? -1, 0);

    // ── Rule 2: internal issue ids on the published surface ──────────────
    //
    // The red/green PAIR is the point. "Green on the real corpus" is what a
    // rule that cannot fire also looks like, so the planted id must be proven
    // to turn it red, and its removal proven to turn it green again, in the
    // same run, over the real collector.
    const idTree = {
      // The published surface — in scope, including a hand-authored companion
      // under references/, which the OTHER rule's walk skips entirely.
      'skills/objectstack-demo/SKILL.md': 'The `cursor` key was removed in protocol 17.',
      'skills/objectstack-demo/references/data-hooks.md': 'Hooks fire per row.',
      'skills/objectstack-demo/rules/indexing.md': '`type` was retired.',
      // Generated artifacts — IN scope and clean; their text comes from spec TSDoc.
      'skills/objectstack-demo/references/_index.md': 'Driver registry.',
      'skills/objectstack-ui/references/react-blocks.md': 'Converging on the metadata tier.',
      // The internal roots are NOT this rule's business.
      '.claude/agents/os-dev.md': 'Lesson learned while fixing #4286.',
      'docs/adr/0049-enforce-or-remove.md': 'Superseded by #5248.',
      'content/docs/protocol/query.mdx': 'See #4286 for the removal.',
    };
    const idDir = mkdtempSync(join(tmpdir(), 'doc-authoring-selftest-ids-'));
    try {
      for (const [rel, body] of Object.entries(idTree)) {
        const full = join(idDir, ...rel.split('/'));
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, body);
      }
      process.chdir(idDir);

      const scan = () => collectPublishedSkillFiles()
        .flatMap((f) => findIdViolations(readFileSync(f, 'utf8'), f));

      // GREEN: the corpus as stripped.
      expect('a clean published corpus is green', scan().length, 0);

      // Scope: the collector reaches references/, generated artifacts included.
      const seen = collectPublishedSkillFiles();
      expect('the id scan reaches hand-authored references/ (the other rule\'s walk does not)',
        seen.includes('skills/objectstack-demo/references/data-hooks.md'), true);
      expect('the generated references/_index.md is IN scope (no exemption)',
        seen.includes('skills/objectstack-demo/references/_index.md'), true);
      expect('the generated react-blocks contract page is IN scope (no exemption)',
        seen.includes('skills/objectstack-ui/references/react-blocks.md'), true);
      expect('the id scan does not reach .claude/', seen.some((f) => f.startsWith('.claude/')), false);
      expect('the id scan does not reach docs/', seen.some((f) => f.startsWith('docs/')), false);
      expect('the id scan does not reach content/', seen.some((f) => f.startsWith('content/')), false);

      // RED: plant one id in a published file — in prose...
      const planted = join(idDir, 'skills', 'objectstack-demo', 'SKILL.md');
      writeFileSync(planted, 'The `cursor` key was removed in protocol 17 (#4286).');
      let red = scan();
      expect('a planted id in published prose is RED', red.length, 1);
      expect('the red names the file', red[0]?.file, 'skills/objectstack-demo/SKILL.md');
      expect('the red names the id', red[0]?.ids?.join(','), '#4286');

      // ...and in a GENERATED artifact — listing the file proves collection,
      // this proves it is SCANNED, which is what dropping the exemption bought.
      const regen = join(idDir, 'skills', 'objectstack-demo', 'references', '_index.md');
      writeFileSync(planted, 'The `cursor` key was removed in protocol 17.');
      writeFileSync(regen, 'Driver registry (#4410).');
      red = scan();
      expect('an id a regeneration put back into a generated artifact is RED', red.length, 1);
      expect('the red names the generated file', red[0]?.file, 'skills/objectstack-demo/references/_index.md');
      writeFileSync(regen, 'Driver registry.');
      writeFileSync(planted, 'The `cursor` key was removed in protocol 17 (#4286).');

      // ...and in a comment inside a code fence, which is where half the
      // measured population lived.
      writeFileSync(planted, ['```ts', "  cursor: 'abc', // removed in #4286", '```'].join('\n'));
      expect('a planted id in a fenced code comment is RED too', scan().length, 1);

      // ...and in the cross-repo spelling, which carries no space.
      writeFileSync(planted, 'See framework#3582 for the token resolver.');
      expect('the `repo#NNNN` spelling is RED', scan().length, 1);

      // GREEN again, from the same collector — so the red above was the id and
      // nothing else about the tree.
      writeFileSync(planted, 'The `cursor` key was removed in protocol 17.');
      expect('removing the id makes it green again', scan().length, 0);

      // ── Precision: the shapes that must NEVER fire ──────────────────────
      // Each is a real spelling from the catalog. A gate that reds on any of
      // them is one authors learn to route around, which costs more than the
      // rule earns.
      const mustPass = [
        ['CSS hex colour, lowercase suffix', "color: '#6366f1'"],
        ['CSS hex colour, uppercase suffix', "color: '#4169E1'"],
        ['CSS hex colour, mid-string digits', "color: '#3498db'"],
        ['CSS hex colour, all-numeric', "color: '#123456'"],
        ['a version number', 'removed in spec 17.0.0, protocol 17, v16'],
        ['an HTTP status code', 'returns `400 INVALID_FIELD`, not 404'],
        ['an array index', 'read `searchableFields[0]` and `fields[12]`'],
        ['the ordinal "#1"', 'The #1 authoring mistake is a bare field ref.'],
        ['a markdown heading', '### 4286 things to know'],
        ['an HTML numeric entity', 'an em dash &#8212; here'],
        ['a two-digit id-shaped token', 'issue #42 is below the floor'],
        ['a six-digit run', 'the build id is #1234567'],
      ];
      for (const [label, body] of mustPass) {
        writeFileSync(planted, body);
        expect(`precision — ${label} does not fire`, scan().length, 0);
      }

      // The placeholder that replaced the one passage which used to need an
      // exemption (maintainer ruling 2026-08-25). It must PASS — otherwise the
      // remedy the failure text prescribes is itself a violation.
      mkdirSync(join(idDir, 'skills', 'objectstack-pm-dispatch'), { recursive: true });
      writeFileSync(
        join(idDir, 'skills', 'objectstack-pm-dispatch', 'SKILL.md'),
        ['```', '/pm-dispatch #<n> #<n>       # two named issues, nothing else', '```'].join('\n'),
      );
      writeFileSync(planted, 'The `cursor` key was removed in protocol 17.');
      expect('the `#<n>` placeholder — the prescribed remedy — passes', scan().length, 0);
      // ...and the real ids it replaced would NOT have, which is what makes the
      // rewrite load-bearing rather than cosmetic.
      writeFileSync(planted, '/pm-dispatch #128 #131       # two named issues');
      expect('the concrete ids it replaced are RED, with no exemption to reach for',
        scan().length, 1);
      writeFileSync(planted, 'The `cursor` key was removed in protocol 17.');

      // Empty is a hard error, not a pass (#4932), for this rule too.
      rmSync(join(idDir, 'skills'), { recursive: true, force: true });
      mkdirSync(join(idDir, 'skills'), { recursive: true });
      let idEmptyErr = null;
      try { collectPublishedSkillFiles(); } catch (err) { idEmptyErr = err; }
      expect('an empty published catalog is red, not "0 files clean"',
        idEmptyErr instanceof EmptyRootError, true);
    } finally {
      process.chdir(dir);
      rmSync(idDir, { recursive: true, force: true });
    }

    selfTestRule3(expect);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }

  // ── The dispatch-gates declaration (#9964's pattern, sixth instance) ───────
  //
  // Enforcement cannot hold any of these: the declaration is read by another
  // tool entirely, so a wrong or stale one runs green here forever and pays
  // itself out as a dev dispatched on a docs card with this REQUIRED gate
  // missing from the brief — which is exactly how it stood before this block.
  // Both sides are derived from ROOTS rather than re-spelled, so renaming or
  // widening a root cannot leave the declaration describing the old population.
  const separatorless = ROOTS.filter((r) => !r.includes('/'));
  expect('the declaration exists for every ROOT the hint extractor cannot see (a root with no '
    + 'path separator is refused as too generic, so it needs the subtree spelling)',
    separatorless.every((r) => ROOT_WATCH_HINTS.includes(`${r}/**`)), true);
  expect('and it declares no root this gate does not walk (a declaration that can drift from the '
    + 'scan is worse than none — it replaces a silent gate with a lying one)',
    ROOT_WATCH_HINTS.every((h) => ROOTS.includes(h.replace(/\/\*+$/, ''))), true);
  // Provenance, never a lookup key: the glob form appearing in ROOTS would send
  // `walk()` at a directory that does not exist. Since #4916 that is a hard
  // refusal rather than a silent skip, but it fails naming the wrong problem.
  expect('the declared form is NOT a ROOTS entry',
    ROOT_WATCH_HINTS.some((h) => ROOTS.includes(h)), false);
  // The residual, pinned rather than hidden. `hintCovers` is positive
  // containment with no way to subtract, so declaring a ROOT necessarily claims
  // the exempt subtrees carved out of it. That is accounted for — but only for
  // the exemptions themselves: every SKIP_PATHS entry must sit UNDER a declared
  // root, so a future exemption somewhere this declaration does not reach fails
  // here instead of quietly widening the over-claim.
  expect('every skipped subtree is one this declaration knowingly over-claims, and none is a '
    + 'surprise from outside the declared roots',
    [...SKIP_PATHS].every((p) => ROOTS.some((r) => p.startsWith(`${r}/`))), true);
  // The exemptions must stay a strict SUBSET of the walked roots: an entry that
  // WAS a whole root would mean the gate declares a population it never reads.
  expect('no exemption swallows a declared root whole',
    [...SKIP_PATHS].some((p) => ROOTS.includes(p)), false);

  // ── On the absence of a per-passage exemption ────────────────────────────
  //
  // This rule has none, and that is enforced from OUTSIDE this file rather than
  // asserted inside it. `scripts/check-ratchet-remedy-authority.mjs` sweeps every
  // gate's author-facing text for a remedy that expands a registry; the first cut
  // of this rule carried a one-entry allowlist and that gate turned it red, which
  // is how the maintainer's 2026-08-25 ruling for the `#<n>` placeholder arrived.
  // Reintroducing such a list — the natural way to silence a future red, one
  // plausible passage at a time — reds there again, on a gate this file cannot
  // vote in. That is a better guard than a self-referential assertion here, which
  // would be reading its own source to prove a claim about its own source.
  //
  // The behavioural half is pinned above: the concrete ids the placeholder
  // replaced are RED, with nothing to add them to.

  if (failures.length) {
    console.error(`\n✗ check-doc-authoring self-test failed:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  console.log('✓ check-doc-authoring self-test: scope wiring (.claude and the live docs/ corpus in, .claude/worktrees and docs/{audits,handoff,plans} out), detection, the dead-root hard error (red when a ROOT is renamed, green when restored), the empty-scan hard error (red when a root yields nothing and when the whole scan does, green when restored), the published-catalog internal-id rule (red on a planted id in prose, in a fenced comment and in the repo#NNNN spelling, green when removed; hex colours, version numbers, HTTP codes, array indices and the "#1" ordinal all pass; references/ reached, generated artifacts and the internal roots out; the `#<n>` placeholder passes while the concrete ids it replaced stay red, with no exemption to reach for), the spec customer-facing-text internal-id rule (red on an id planted on a LATER line of a concatenated message — the shape a line-oriented census cannot see, proven here — and in a template chain, a positional validator message, the repo#NNNN spelling, a nested strictObject `guidance` prescription, a HOISTED guidance const, a `KeySetGuidance` const consumed only CROSS-MODULE in both the annotated and the `as const satisfies` spelling, a HOISTED refusal message, a `retiredKey()` tombstone, `new Map` and `Object.freeze` guidance tables, `.describe()` prose, and the nested `guidance` of a whole options table written `satisfies StrictObjectOptions`; green when removed; an ADR id on a tombstone, a `.default()` VALUE, `history`/`guidance` outside a strictObject options position, `extraKeys` key names and an inferred local that merely MENTIONS `KeySetGuidance` all pass; test bodies out; the seen floor is PER BUCKET so one matcher rotting while the others carry the total still reds; and the two TYPE ANCHORS are pinned on the predicate itself — the annotation, `satisfies` and `as const satisfies` spellings all read as a strictObject options position while some other satisfied type does not, and the `*_STRICT_OPTIONS` NAME branch still fires where no type is written at all — which is the only place they can be told apart, since end to end they are redundant), the fourth population — customer-facing text BUILT INSIDE A FUNCTION (red on an id in an inline `error: () =>` callback, in a const the callback only dispatches to, inside a `message:` builder function, RETURNED from a tombstone-prescription builder, in a `: StrictObjectOptions` options factory, and in a plain `error:` string; ⛔ the body of an ordinary helper and a local inside a recognised factory stay unswept, because the climb crosses a function only when the FUNCTION sits in a recognised position; and `functionBuilt` carries its own blindness floor, since an unrecognised spelling produces no flag SILENTLY) and the dispatch-gates declaration (every separator-less ROOT declared as a subtree, nothing declared this gate does not walk, the over-claim bounded to SKIP_PATHS) all hold.');
}

/**
 * Rule 3's red/green battery, over a real temporary `packages/spec/src` tree.
 *
 * Same discipline as Rule 2's: green on a clean tree proves nothing on its own,
 * because a rule that CANNOT fire looks identical. Every claim below is a pair —
 * plant the id, require red; remove it, require green — and the multi-line
 * concatenation case is first because it is the one the commissioning card's
 * own census command could not see.
 */
function selfTestRule3(expect) {
  const ts = requireFromHere('typescript');
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'doc-authoring-selftest-msg-'));
  try {
    const write = (rel, body) => {
      const full = join(dir, ...rel.split('/'));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
      return full;
    };
    const CLEAN = [
      "import { z } from 'zod';",
      'export const S = z.object({ a: z.string() }).refine((v) => !!v.a, {',
      "  message: 'a is required — declare it or drop the block.',",
      '});',
    ].join('\n');
    // A test body carrying an id: in the tree, out of the population.
    write('packages/spec/src/ui/pin.test.ts',
      "expect(issue.message).toContain('400 INVALID_FILTER, #5869');");
    // A clean member of each of the FOUR folded-in buckets, so every bucket's
    // `seen` floor is satisfied on the green tree and the per-bucket blindness
    // assertion below has something to go blind ABOUT. Held as ONE const with
    // the fourth-population member last, so the two blindness cases below can
    // each drop exactly one bucket from the same baseline rather than each
    // carrying a hand-copied variant that drifts.
    const DOC_CLEAN_BASE = [
      "import { z } from 'zod';",
      "import { strictObject } from '../shared/strict-object';",
      "import { retiredKey } from '../shared/retired-key';",
      '/** TSDoc ids are a COMMENT, never a string literal — out of reach by construction. */',
      "export const D = z.string().describe('A machine name.');",
      'export const T = strictObject({',
      "  surface: 'this doc',",
      "  history: 'an unknown key here was dropped silently.',",
      "  guidance: { where: 'not a doc key — delete it.' },",
      '}, {',
      "  cursor: retiredKey('`cursor` was removed in protocol 17 (ADR-0049). Use `after`.'),",
      '});',
    ];
    // The fourth population, clean: prose BUILT INSIDE a function that itself
    // sits in a recognised position.
    const DOC_FUNCTION_BUILT = [
      'export const E = z.string({',
      "  error: () => 'a machine name is a string — quote it.',",
      '});',
    ];
    const DOC_CLEAN = [...DOC_CLEAN_BASE, ...DOC_FUNCTION_BUILT].join('\n');
    write('packages/spec/src/data/doc.ts', DOC_CLEAN);
    const target = write('packages/spec/src/ui/action.zod.ts', CLEAN);

    const scan = () => {
      let out = [];
      const seen = { message: 0, strictObject: 0, tombstone: 0, describe: 0, functionBuilt: 0 };
      for (const f of collectSpecSourceFiles()) {
        const r = findCustomerTextIdViolations(readFileSync(f, 'utf8'), f, ts);
        out = out.concat(r.violations);
        for (const b of Object.keys(seen)) seen[b] += r.seen[b];
      }
      return { violations: out, seen };
    };

    process.chdir(dir);

    // GREEN, and the detector is demonstrably NOT blind in ANY bucket. Reporting
    // the counts is the point — "0 violations" and "0 strings found" are the same
    // line to a reader who only checks the first, and a per-bucket floor is the
    // only shape that catches ONE matcher rotting while the others carry the total.
    let r = scan();
    expect('a clean spec tree is green', r.violations.length, 0);
    expect('the detector recognised a message string', r.seen.message >= 1, true);
    expect('the detector recognised a strictObject option string', r.seen.strictObject >= 1, true);
    expect('the detector recognised a tombstone prescription', r.seen.tombstone >= 1, true);
    expect('the detector recognised text built inside a function', r.seen.functionBuilt >= 1, true);
    expect('the detector recognised a `.describe()` string', r.seen.describe >= 1, true);

    // Scope: a test body is out, an ordinary source is in. Asserted as a pair
    // because either half alone is satisfied by a wrong scope in the other
    // direction.
    const scanned = collectSpecSourceFiles();
    expect('test bodies are not scanned', scanned.includes('packages/spec/src/ui/pin.test.ts'), false);
    expect('ordinary sources are scanned', scanned.includes('packages/spec/src/data/doc.ts'), true);
    expect('an ADR id on a tombstone does NOT fire — it is the durable reference AGENTS.md requires',
      r.violations.some((v) => v.file === 'packages/spec/src/data/doc.ts'), false);

    // RED #1 — the founding shape: `message:` and the id on DIFFERENT lines of a
    // `+` chain. This is what `git grep "message:.*#[0-9]{3,5}"` cannot see, and
    // the whole reason this rule parses instead of scanning lines.
    writeFileSync(target, [
      "import { z } from 'zod';",
      'export const S = z.object({ a: z.string() }).refine((v) => !!v.a, {',
      '  message:',
      "    'This pair declares two destinations for one success, so the doubled '",
      "    + 'declaration is refused at authoring time (#11519). Keep `onSuccess`.',",
      '});',
    ].join('\n'));
    r = scan();
    expect('an id on a later line of a concatenated message is RED', r.violations.length, 1);
    expect('the red names the file', r.violations[0]?.file, 'packages/spec/src/ui/action.zod.ts');
    expect('the red names the id', r.violations[0]?.ids?.join(','), '#11519');
    expect('the red names the position', r.violations[0]?.where, 'message:');
    // ...and the single-line grep the card shipped really cannot: proven here so
    // the claim in this file's header is a measurement, not a recollection.
    expect('the line-oriented census command misses it',
      /message:.*#[0-9]{3,5}/.test(readFileSync(target, 'utf8')), false);

    // RED #2 — a template literal, the other half of the real population.
    writeFileSync(target, [
      "import { z } from 'zod';",
      'export const S = z.object({ a: z.string() }).superRefine((v, ctx) => {',
      '  ctx.addIssue({',
      "    code: 'custom',",
      '    message:',
      '      `Operator "${v.a}" needs an ARRAY. `',
      '      + `The query path refuses it too (400 INVALID_FILTER, #5869).`,',
      '  });',
      '});',
    ].join('\n'));
    r = scan();
    expect('an id in a concatenated TEMPLATE message is RED', r.violations.length, 1);
    expect('the template red names the id', r.violations[0]?.ids?.join(','), '#5869');

    // RED #3 — the POSITIONAL spelling. One member of the founding population
    // was written this way, so a `message:`-only matcher under-reports by
    // exactly the shape it exists to catch.
    writeFileSync(target, [
      "import { z } from 'zod';",
      'export const S = z.record(z.string().regex(',
      '  /^[a-z]+$/,',
      "  'keyed by BCP-47 locale tags — never by `key`, the retired form (#5055)',",
      '), z.string());',
    ].join('\n'));
    r = scan();
    expect('an id in a positional validator message is RED', r.violations.length, 1);
    expect('the positional red names the position', r.violations[0]?.where, '.regex(…, message)');

    // RED #4 — the cross-repo spelling, which really occurs in this population
    // (`objectui#5933`, `cloud#687`).
    writeFileSync(target, [
      "import { z } from 'zod';",
      'export const S = z.object({ a: z.string() }).refine((v) => !!v.a, {',
      "  message: 'under the interim precedence (objectui#5933) the declared hop wins.',",
      '});',
    ].join('\n'));
    r = scan();
    expect('the `repo#NNNN` spelling is RED here too', r.violations.length, 1);

    // ── The three buckets folded in by the 2026-08-26 triage ────────────────
    //
    // Same discipline as everything above: each is a PAIR, and each is written
    // in the spelling the tree really uses — inline for the nested `guidance`
    // map, hoisted-const for the rest, because hoisting is what a
    // position-only matcher is blind to.

    // RED #5 — an inline `guidance` prescription, nested one key deep inside
    // the options object. The literal's own position is a property named
    // `where`; only the climb reaches `guidance`.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { strictObject } from '../shared/strict-object';",
      'export const S = strictObject({',
      "  surface: 'this action',",
      "  history: 'an unknown key here was dropped silently.',",
      '  guidance: {',
      "    where: '`where` has never been an action key (#4001). Delete it.',",
      '  },',
      "}, { name: z.string() });",
    ].join('\n'));
    r = scan();
    expect('an id in a nested strictObject `guidance` prescription is RED', r.violations.length, 1);
    expect('the guidance red names the position', r.violations[0]?.where, 'strictObject guidance');
    expect('the guidance red names the bucket', r.violations[0]?.bucket, 'strictObject');

    // RED #6 — the same prescription HOISTED into a named const, which is how
    // this tree overwhelmingly writes it. Without the sink-alias pass the climb
    // stops at the VariableDeclaration and this is silently clean.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { strictObject } from '../shared/strict-object';",
      'const ACTION_RETIRED_KEY_GUIDANCE = {',
      "  legacyMode: '`legacyMode` was removed in protocol 17 (#4286). Delete the key.',",
      '};',
      'export const S = strictObject({',
      "  surface: 'this action',",
      "  history: 'an unknown key here was dropped silently.',",
      '  guidance: ACTION_RETIRED_KEY_GUIDANCE,',
      "}, { name: z.string() });",
    ].join('\n'));
    r = scan();
    expect('an id in a HOISTED guidance const is RED (the spelling a position-only matcher misses)',
      r.violations.length, 1);
    expect('the hoisted red names the const it travelled through',
      r.violations[0]?.where, 'via ACTION_RETIRED_KEY_GUIDANCE');

    // RED #7 — a hoisted REFUSAL MESSAGE. Not a hypothetical about the new
    // buckets: this shape was hiding four ids from the `message:` rule itself,
    // which had reported its population clean since the day it landed.
    writeFileSync(target, [
      "import { z } from 'zod';",
      'const URL_NO_USER_REFUSED =',
      "  'this `config.url` names no user while `credentialsRef` binds a secret '",
      "  + '— a pair that cannot work as written (#9041).';",
      'export const S = z.object({ a: z.string() }).refine((v) => !!v.a, {',
      '  message: URL_NO_USER_REFUSED,',
      '});',
    ].join('\n'));
    r = scan();
    expect('an id in a HOISTED refusal message is RED', r.violations.length, 1);
    expect('the hoisted message red names its const', r.violations[0]?.where, 'via URL_NO_USER_REFUSED');
    expect('the hoisted message red is bucketed as a message', r.violations[0]?.bucket, 'message');

    // RED #8 — a `retiredKey()` tombstone prescription.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { retiredKey } from '../shared/retired-key';",
      'export const S = z.object({',
      "  cursor: retiredKey('`cursor` was removed in protocol 17 (#3894). Use `after`.'),",
      '});',
    ].join('\n'));
    r = scan();
    expect('an id in a `retiredKey()` prescription is RED', r.violations.length, 1);
    expect('the tombstone red names the position', r.violations[0]?.where, 'retiredKey()');
    expect('the tombstone red names the bucket', r.violations[0]?.bucket, 'tombstone');

    // RED #9 — a per-value prescription in a `new Map([[k, v]])`, and one in an
    // `Object.freeze({…})` table. Both are transparent structure the climb has
    // to pass through to reach the const that names them.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { strictObject } from '../shared/strict-object';",
      'const CHATTER_POSITION_RETIRED = new Map([',
      "  ['right', '`right` was removed in protocol 17 (#6176). Use `main`.'],",
      ']);',
      'const FROZEN_GUIDANCE = Object.freeze({',
      "  tenantId: '`tenantId` never scoped anything (#2377). Delete it.',",
      '});',
      'export const S = strictObject({',
      "  surface: 'this component',",
      "  history: 'an unknown key here was dropped silently.',",
      '  guidance: FROZEN_GUIDANCE,',
      '  retiredForms: CHATTER_POSITION_RETIRED,',
      "}, { name: z.string() });",
    ].join('\n'));
    r = scan();
    expect('ids inside `new Map([…])` and `Object.freeze({…})` guidance tables are RED',
      r.violations.length, 2);

    // RED #10 — `.describe()` docs prose, the third bucket.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "export const S = z.string().describe('Machine name. The alias was dropped in #4286.');",
    ].join('\n'));
    r = scan();
    expect('an id in `.describe()` prose is RED', r.violations.length, 1);
    expect('the describe red names the position', r.violations[0]?.where, '.describe()');
    expect('the describe red names the bucket', r.violations[0]?.bucket, 'describe');

    // RED #11 — the CROSS-MODULE guidance const. Typed `KeySetGuidance`,
    // exported, and consumed by NO sink in its own file: every anchor this pass
    // had before was in-file, so a shared guidance table handed to
    // `guidanceSets:` from other modules walked free while its prescription was
    // printed at refusing authors. Measured live on
    // `SELECT_OPTION_EDITABILITY_GUIDANCE`, which this rule reported clean from
    // the day it landed. Written here in the spelling the tree really uses —
    // the id on a LATER operand than the type annotation that anchors it.
    writeFileSync(target, [
      "import type { KeySetGuidance } from '../shared/suggestions.zod';",
      'export const OPTION_EDITABILITY_GUIDANCE: KeySetGuidance = {',
      "  name: 'OPTION_EDITABILITY_KEYS',",
      "  keys: ['disabled', 'readonly'],",
      '  prescription:',
      "    'Editability is not a per-OPTION concern — a deliberate boundary, not a '",
      "    + 'missing key (#8201): withdraw the option with `visibleWhen` instead.',",
      '};',
    ].join('\n'));
    r = scan();
    expect('an id in a `KeySetGuidance` const consumed only CROSS-MODULE is RED',
      r.violations.length, 1);
    expect('the cross-module red names the const it travelled through',
      r.violations[0]?.where, 'via OPTION_EDITABILITY_GUIDANCE');
    expect('the cross-module red is bucketed as a strictObject option',
      r.violations[0]?.bucket, 'strictObject');

    // RED #12 — the same const in the `as const satisfies` spelling, which this
    // tree also uses (`WIDGET_GUIDANCE_SETS`, `ui/dashboard.zod.ts`). A type
    // anchor reading only the ANNOTATION is blind to it, so the next shared
    // guidance const written the modern way would reopen RED #11's gap — the
    // same blind spot one spelling over.
    writeFileSync(target, [
      "import type { KeySetGuidance } from '../shared/suggestions.zod';",
      'export const OPTION_GUIDANCE_SETS = [',
      '  {',
      "    name: 'OPTION_EDITABILITY_KEYS',",
      "    keys: ['disabled'],",
      "    prescription: 'not a missing key (#8201) — withdraw the option instead.',",
      '  },',
      '] as const satisfies readonly KeySetGuidance[];',
    ].join('\n'));
    r = scan();
    expect('an id in an `as const satisfies readonly KeySetGuidance[]` const is RED',
      r.violations.length, 1);
    expect('the satisfies-spelling red names its const',
      r.violations[0]?.where, 'via OPTION_GUIDANCE_SETS');

    // RED #13 — a whole OPTIONS TABLE in the `satisfies StrictObjectOptions`
    // spelling, with the id one object deeper than the key that anchors it. The
    // const is deliberately NOT named `*_STRICT_OPTIONS`, so the name branch
    // cannot be what rescues it, and the prose is nested `guidance` rather than
    // a top-level string, so reaching it means the climb really arrived.
    //
    // ⚠️ What this case pins, and what it does NOT. It is RED on both sides of
    // the {@link inStrictOptions} widening: {@link collectTextSinkConsts} already
    // registers this const by its declared type, and {@link customerTextPosition}
    // resolves the string at `via NAV_ITEM_SURFACE` without ever consulting the
    // position test. So this is a REGRESSION pin on the class — the shape stays
    // reported — and NOT the reverse proof for the widening. The reverse proof is
    // the predicate battery below, because end to end the two anchors are
    // redundant and no fixture can tell them apart.
    writeFileSync(target, [
      "import type { StrictObjectOptions } from '../shared/strict-object';",
      'export const NAV_ITEM_SURFACE = {',
      "  surface: 'this navigation item',",
      '  guidance: {',
      "    legacyKey: '`legacyKey` was removed in protocol 17 (#13105). Delete it.',",
      '  },',
      '} satisfies StrictObjectOptions;',
    ].join('\n'));
    r = scan();
    expect('an id in the nested guidance of a `satisfies StrictObjectOptions` options table is RED',
      r.violations.length, 1);
    expect('the options-table red names the const it travelled through',
      r.violations[0]?.where, 'via NAV_ITEM_SURFACE');
    expect('the options-table red is bucketed as a strictObject option',
      r.violations[0]?.bucket, 'strictObject');

    // ── The TYPE ANCHORS, asserted on the PREDICATE ─────────────────────
    //
    // Not through a scan, and the reason is the whole point of this block: the
    // two anchors are REDUNDANT in the verdict, so a fixture written to prove
    // this one would pass with it reverted — a case reporting an anchor as
    // covered while proving only that its sibling still works. Measured: with
    // {@link collectTextSinkConsts} reverted to the annotation-only read, this
    // widening alone recovers the HOISTED shapes (a guidance table lifted out of
    // the options object, reached through the seed path here) and nothing else.
    //
    // Redundancy is the point rather than the excuse. The `satisfies` spelling
    // is carried by one mechanism today; two anchors that read a declaration the
    // same way is the property whose absence let one of them fall a spelling
    // behind in the first place, silently, with every gate green.
    const anchor = (head, tail) => {
      const sf = parseSourceFile('packages/spec/src/ui/anchor.zod.ts', [
        "import type { StrictObjectOptions } from '../shared/strict-object';",
        `export const ${head} = {`,
        "  surface: 'this navigation item',",
        "  guidance: { legacyKey: '`legacyKey` was removed in protocol 17. Delete it.' },",
        `}${tail};`,
      ].join('\n'));
      let prop;
      let decl;
      const walk = (n) => {
        if (!decl && ts.isVariableDeclaration(n)) decl = n;
        if (!prop && ts.isPropertyAssignment(n) && n.name.getText() === 'guidance') prop = n;
        ts.forEachChild(n, walk);
      };
      ts.forEachChild(sf, walk);
      return { prop, decl };
    };

    // [label, declaration head, trailing type expression, is a StrictObjectOptions position]
    const SPELLINGS = [
      ['the ANNOTATION', 'NAV_ITEM_SURFACE: StrictObjectOptions', '', true],
      ['`satisfies`', 'NAV_ITEM_SURFACE', ' satisfies StrictObjectOptions', true],
      ['`as const satisfies`, where the type sits OUTSIDE the `as`',
        'NAV_ITEM_SURFACE', ' as const satisfies StrictObjectOptions', true],
      ['some OTHER satisfied type', 'NAV_ITEM_SURFACE', ' satisfies Record<string, unknown>', false],
    ];
    // A battery that registered no cases is a battery that passes, which is the
    // failure this file is a monument to wearing a harness hat.
    expect('the spelling battery actually registered its cases', SPELLINGS.length, 4);
    for (const [label, head, tail, want] of SPELLINGS) {
      const { prop, decl } = anchor(head, tail);
      expect(`the position test reads ${label}`, inStrictOptions(prop, ts), want);
      expect(`...and BOTH type anchors agree about the same declaration — ${label}`,
        /\bStrictObjectOptions\b/.test(declaredTypeText(decl, ts)), want);
    }

    // The NAME branch is asserted apart from the four above, because it is the
    // half a type read cannot cover: no type is written here at all, so a
    // widening of the type read must leave it firing rather than absorb it.
    {
      const { prop, decl } = anchor('NAV_STRICT_OPTIONS', '');
      expect('the `*_STRICT_OPTIONS` NAME branch fires with no type written at all',
        inStrictOptions(prop, ts), true);
      expect('...and it is the NAME doing it — the type read is empty here, so the name branch '
        + 'is still load-bearing rather than shadowed by the widened type read',
        declaredTypeText(decl, ts), '');
    }

    // ── The FOURTH population: text BUILT INSIDE A FUNCTION ─────────────────
    //
    // Ruled 2026-08-29, verbatim 「同意」 — the inheritance reaches refusal prose
    // built inside `error: () =>` callbacks: same audience, same moment. Each
    // case below is the pair, and the negative cases at the end are the reason
    // the clause is written as "the FUNCTION must sit in a recognised position"
    // rather than "climb through function bodies".

    // RED #14 — the founding shape of this population: an `error:` error map
    // written inline as an arrow function, its prose in a `+` chain.
    writeFileSync(target, [
      "import { z } from 'zod';",
      'export const S = z.array(ParamSchema, {',
      '  error: (iss) => (',
      '    isObjectInput(iss)',
      "      ? '`params` is the parameter DEFINITION array, not a values map. '",
      "        + 'Use `bodyExtra: { … }` for a static request body (#5777). '",
      "        + 'Expected an array of ActionParam, received an object.'",
      '      : undefined',
      '  ),',
      '});',
    ].join('\n'));
    r = scan();
    expect('an id in an `error: () =>` callback is RED', r.violations.length, 1);
    expect('the error-callback red names the position', r.violations[0]?.where, 'error: (built in a function)');
    expect('the error-callback red gets its OWN bucket, not `message`',
      r.violations[0]?.bucket, 'functionBuilt');

    // RED #15 — the HOISTED spelling of the same thing, which is how most of
    // this tree writes it: the prose lives in a module const and the `error`
    // callback only DISPATCHES to it, so the literal is not lexically inside
    // any function at all. Without `error:` seeding the sink pass, this const
    // is not a sink and its whole body is silently clean.
    writeFileSync(target, [
      "import { z } from 'zod';",
      'const PREVIEW_RETIRED =',
      "  '`preview` was removed in @objectstack/spec 17.0.0 (#11846, ADR-0049) — '",
      "  + 'use `dev` for the same behaviour.';",
      "export const S = z.enum(['dev', 'prod'], {",
      "  error: (issue) => (issue.input === 'preview' ? PREVIEW_RETIRED : undefined),",
      '});',
    ].join('\n'));
    r = scan();
    expect('an id in a const DISPATCHED from an `error:` callback is RED', r.violations.length, 1);
    expect('the hoisted error-map red names its const', r.violations[0]?.where, 'via PREVIEW_RETIRED');

    // RED #16 — a message BUILDER function referenced from `message:`. The
    // literal sits in a function; the function is a text-sink const.
    writeFileSync(target, [
      "import { z } from 'zod';",
      'const INLINE_CREDENTIAL_REFUSED = (key: string): string =>',
      "  `\\`${key}\\` is a credential and is not accepted inline (#7990): bind a secret `",
      "  + 'with `credentialsRef` instead.';",
      'export const S = z.object({ a: z.string() }).refine((v) => !!v.a, {',
      "  message: INLINE_CREDENTIAL_REFUSED('password'),",
      '});',
    ].join('\n'));
    r = scan();
    expect('an id inside a message-BUILDER function is RED', r.violations.length, 1);
    expect('the builder red names the const it travelled through',
      r.violations[0]?.where, 'via INLINE_CREDENTIAL_REFUSED (built in a function)');

    // RED #17 — a builder whose result is a `retiredKey()` argument, and one
    // whose body ends in a `return` rather than a concise arrow body. The
    // `return` leg is a separate clause in the climb and was measured live.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { retiredKey } from '../shared/retired-key';",
      'const capRemoved = (key: string) => {',
      "  return `\\`DriverCapabilities.${key}\\` was removed in 17.0.0 (#4634, ADR-0049).`;",
      '};',
      'export const S = z.object({',
      "  joins: retiredKey(capRemoved('joins')),",
      '});',
    ].join('\n'));
    r = scan();
    expect('an id RETURNED from a tombstone-prescription builder is RED', r.violations.length, 1);
    expect('the return-leg red names the const it travelled through',
      r.violations[0]?.where, 'via capRemoved (built in a function)');

    // RED #18 — an options FACTORY declared by its return-type annotation. The
    // literal sits at a recognised strictObject key inside a function nothing
    // else identifies, so only the annotation makes it reachable.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { strictObject } from '../shared/strict-object';",
      "import type { StrictObjectOptions } from '../shared/strict-object';",
      'const navItemSurface = (variant: string): StrictObjectOptions => ({',
      '  surface: `this \\`${variant}\\` navigation item`,',
      "  history: 'Until #4001 these were dropped silently — the entry still parsed.',",
      '});',
      "export const S = strictObject(navItemSurface('object'), { name: z.string() });",
    ].join('\n'));
    r = scan();
    expect('an id in a `: StrictObjectOptions` options FACTORY is RED', r.violations.length, 1);
    expect('the options-factory red names the position',
      r.violations[0]?.where, 'strictObject history (built in a function)');

    // RED #19 — a plain STRING at `error:`, zod 4's spelling of `message:`.
    // Nothing was built in a function, so it is bucketed `message`.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "export const S = z.string({ error: 'a machine name is a string — quote it (#4286).' });",
    ].join('\n'));
    r = scan();
    expect('an id in a plain `error:` string is RED', r.violations.length, 1);
    expect('the plain `error:` red names the position', r.violations[0]?.where, 'error:');
    expect('a plain `error:` string is a MESSAGE, not function-built',
      r.violations[0]?.bucket, 'message');

    // ── Precision: what must NEVER fire ─────────────────────────────────────
    //
    // ⛔ The clause is NOT "climb through function bodies". These three are the
    // difference, and each is the shape an unconditional climb would sweep:
    // a helper building a VALUE, a plain local, and a comparison operand inside
    // a function that IS recognised. A rule that reports values as prose is one
    // authors get disabled (the false-positive lesson this file's Rule 3 header
    // carries), so these are pinned as hard as the reds above.

    writeFileSync(target, [
      "import { z } from 'zod';",
      '// An ordinary helper. Nothing customer-facing consumes it, so its body',
      '// must stay unreachable — this is the whole boundary.',
      "const slugFor = (kind: string) => `${kind}-#4286`;",
      "const legacyToken = () => 'tag#4286';",
      'export const S = z.object({ a: z.string().default(slugFor("x")) });',
      'export const T = legacyToken;',
    ].join('\n'));
    expect('precision — an ordinary helper\'s body is NOT swept', scan().violations.length, 0);

    // A function that IS recognised still only yields its recognised POSITIONS.
    // A local inside the factory, and a key that is not a STRICT_OPTION_KEY,
    // stay unreachable — crossing the function boundary does not turn the body
    // into one big text position.
    //
    // ⚠️ Deliberately NOT asserted here: a conditional or comparison operand
    // sitting UNDER a recognised key. The climb has passed through
    // `ConditionalExpression` since the rule was written, and this file errs
    // toward INCLUSION at a recognised position on purpose — the failure mode
    // it guards is silence. That is the pre-existing rule, unchanged by the
    // function clause, and pinning the opposite here would be pinning a claim
    // the rule does not make.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { strictObject } from '../shared/strict-object';",
      "import type { StrictObjectOptions } from '../shared/strict-object';",
      'const navItemSurface = (variant: string): StrictObjectOptions => {',
      "  const telemetryTag = `nav-${variant}-#4286`;",
      '  void telemetryTag;',
      '  return {',
      '    surface: `this \\`${variant}\\` navigation item`,',
      "    history: 'an unknown key here was dropped silently.',",
      "    extraKeys: ['legacyTag4286'],",
      '  };',
      '};',
      "export const S = strictObject(navItemSurface('object'), { name: z.string() });",
    ].join('\n'));
    expect('precision — a LOCAL inside a recognised options factory is not prose',
      scan().violations.length, 0);

    // ⭐ The self-test the ruling required IN THE SAME EDIT: an UNRECOGNISED
    // spelling produces NO FLAG, SILENTLY — so the only thing that can speak
    // for this population is its own `seen` floor. Prove that floor can fire
    // while every other bucket stays populated. Without this, a future edit
    // that returns `undefined` at the function boundary again reads as a clean
    // tree, which is exactly how these 28 literals went unseen.
    writeFileSync(target, CLEAN);
    // The same baseline MINUS its one function-built member — the tree an
    // unrecognised spelling leaves behind.
    write('packages/spec/src/data/doc.ts', DOC_CLEAN_BASE.join('\n'));
    r = scan();
    expect('the function-built bucket can go blind on its own (main reds on it)',
      r.seen.functionBuilt, 0);
    expect('...while the other four stay populated, so the zero above is about THAT clause',
      r.seen.message >= 1 && r.seen.strictObject >= 1
      && r.seen.tombstone >= 1 && r.seen.describe >= 1, true);
    write('packages/spec/src/data/doc.ts', DOC_CLEAN);   // restore the baseline

    // A validator's VALUE argument is not prose. `.min(3, …)` takes a message;
    // `.default('#4286')` does not, and an open "any string after position 0"
    // rule would report it.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "export const S = z.object({ a: z.string().default('#4286') });",
    ].join('\n'));
    expect('precision — a `.default()` VALUE is not a message', scan().violations.length, 0);

    // `guidance` and `history` are ordinary English words. A property so named
    // OUTSIDE a strictObject options position is a config record or a schema
    // shape, not refusal prose, and reporting it is how a gate gets routed
    // around. Both anchors are exercised: the wrong CALL, and the SHAPE
    // argument of the right call (argument 1, where a key named `guidance`
    // holds a zod schema rather than text).
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { strictObject } from '../shared/strict-object';",
      'export const Config = z.object({}).parse({',
      "  history: 'migrated from the old table in #4286',",
      "  guidance: { note: 'see #4286' },",
      '});',
      'export const S = strictObject({',
      "  surface: 'this action',",
      "  history: 'an unknown key here was dropped silently.',",
      '}, {',
      "  guidance: z.string().default('#4286'),",
      '});',
    ].join('\n'));
    expect('precision — `history`/`guidance` outside a strictObject options position do not fire',
      scan().violations.length, 0);

    // `extraKeys` carries KEY NAMES for the "did you mean" fallback, not prose.
    // It is deliberately absent from STRICT_OPTION_KEYS, and an author who adds
    // it there would start reporting identifiers as text.
    writeFileSync(target, [
      "import { z } from 'zod';",
      "import { strictObject } from '../shared/strict-object';",
      'export const S = strictObject({',
      "  surface: 'this action',",
      "  history: 'an unknown key here was dropped silently.',",
      "  extraKeys: ['tag4286'],",
      "}, { name: z.string() });",
    ].join('\n'));
    expect('precision — `extraKeys` is key names, not prose', scan().violations.length, 0);

    // A local that MENTIONS `KeySetGuidance` is not one. `shared/suggestions.zod.ts`
    // really writes `const firedSets = new Set<KeySetGuidance>()` inside the
    // error builder, so a type anchor that searched the initializer's text
    // instead of the DECLARED type would report the runtime's own bookkeeping
    // as authoring prose — and a gate that reports values as prose is one
    // authors route around.
    writeFileSync(target, [
      "import type { KeySetGuidance } from '../shared/suggestions.zod';",
      'export function fire(sets: readonly KeySetGuidance[]) {',
      '  const fired = new Set<KeySetGuidance>();',
      "  for (const s of sets) if (s.name === '#4286') fired.add(s);",
      '  return fired;',
      '}',
    ].join('\n'));
    expect('precision — an inferred local whose INITIALIZER mentions `KeySetGuidance` is not a sink',
      scan().violations.length, 0);

    // GREEN again from the same scan, so every red above was the id and nothing
    // else about the tree.
    writeFileSync(target, CLEAN);
    r = scan();
    expect('stripping the id makes it green again', r.violations.length, 0);
    expect('and the detector is still not blind', r.seen.message >= 1, true);

    // The blindness assertion itself must be able to fire, PER BUCKET. This is
    // the case a total floor cannot see: three buckets still populated, one
    // gone silent. Emptying only the `.describe()` bucket must still register
    // as blindness in that bucket while the others stay positive.
    write('packages/spec/src/data/doc.ts',
      [...DOC_CLEAN_BASE.filter((l) => !l.includes('.describe(')), ...DOC_FUNCTION_BUILT].join('\n'));
    r = scan();
    expect('one bucket can go blind while the others stay populated — describe', r.seen.describe, 0);
    expect('...and the surviving buckets really did stay positive (so the zero above is about '
      + 'that bucket, not an emptied tree)',
      r.seen.message >= 1 && r.seen.strictObject >= 1 && r.seen.tombstone >= 1
      && r.seen.functionBuilt >= 1, true);

    // ...and the whole-population version: no recognised string of any kind.
    writeFileSync(target, "export const S = 1;\n");
    write('packages/spec/src/data/doc.ts', "export const D = 2;\n");
    write('packages/spec/src/ui/pin.test.ts', "export const T = 3;\n");
    r = scan();
    expect('a tree with no recognised customer-facing string reports every bucket 0 (main reds)',
      Object.values(r.seen).reduce((a, b) => a + b, 0), 0);

    // Empty is a hard error, not a pass — same discipline as the other two rules.
    rmSync(join(dir, 'packages', 'spec', 'src'), { recursive: true, force: true });
    mkdirSync(join(dir, 'packages', 'spec', 'src'), { recursive: true });
    let emptyErr = null;
    try { collectSpecSourceFiles(); } catch (err) { emptyErr = err; }
    expect('an empty spec source root is red, not "0 files clean"',
      emptyErr instanceof EmptyRootError, true);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let files;
  try {
    files = collectFiles();
  } catch (err) {
    if (err instanceof DeadRootError) {
      console.error(`\n✗ doc authoring guard: declared ROOT(s) do not resolve, so the scan would have been silently narrower:\n`);
      for (const d of err.dead) console.error(`  ${d.root} — ${d.reason}`);
      console.error(
        `\nEvery entry in ROOTS (scripts/check-doc-authoring.mjs) must be a directory in the checkout,` +
        `\nand this check runs from the repo root. If a corpus directory was renamed or moved, update` +
        `\nROOTS to follow it; if it was deleted, remove the entry deliberately. Do NOT restore a` +
        `\ntolerant skip: this used to be \`catch {}\`, and a dead root simply shrank the reported file` +
        `\ncount while the gate kept printing green (#4916).\n`,
      );
      process.exit(1);
      return;
    }
    if (err instanceof EmptyRootError) {
      console.error(
        `\n✗ doc authoring guard: declared ROOT(s) resolved but contributed no Markdown/MDX file, so` +
        `\nthis run would have reported a clean corpus it never read:\n`,
      );
      for (const r of err.roots) console.error(`  ${r} — 0 files`);
      console.error(
        `\n${err.total} file(s) were found in total across all of ROOTS.` +
        `\n\nEvery entry in ROOTS (scripts/check-doc-authoring.mjs) must yield at least one .md/.mdx` +
        `\nfile. The root still being a directory is not enough — that is all #4916's check can see.` +
        `\nIf the corpus moved to a new directory, point ROOTS at it; if a subtree was deliberately` +
        `\nemptied or removed, remove its ROOT entry in the same change. Do NOT lower this to a total` +
        `\ncount: one populated root would then cover for every evaporated one, which is the silent` +
        `\nnarrowing this assertion exists to stop (#4932).\n`,
      );
      process.exit(1);
      return;
    }
    throw err;
  }
  const violations = files.flatMap((file) => findViolations(readFileSync(file, 'utf8'), file));

  let published;
  try {
    published = collectPublishedSkillFiles();
  } catch (err) {
    console.error(
      `\n✗ doc authoring guard: the published catalog (${PUBLISHED_SKILLS_ROOT}/) could not be`
      + `\nscanned for internal issue-id references, so this run cannot vouch for it:`
      + `\n\n  ${err.message}\n`,
    );
    process.exit(1);
    return;
  }
  const idViolations = published.flatMap((file) => findIdViolations(readFileSync(file, 'utf8'), file));

  const ts = requireFromHere('typescript');
  let specSources;
  try {
    specSources = collectSpecSourceFiles();
  } catch (err) {
    console.error(
      `\n✗ doc authoring guard: the spec source root (${SPEC_SOURCE_ROOT}/) could not be`
      + `\nscanned for internal issue-id references in refusal messages, so this run cannot`
      + `\nvouch for it:\n\n  ${err.message}\n`,
    );
    process.exit(1);
    return;
  }
  const messageIdViolations = [];
  const seenByBucket = { message: 0, strictObject: 0, tombstone: 0, describe: 0, functionBuilt: 0 };
  for (const file of specSources) {
    const r = findCustomerTextIdViolations(readFileSync(file, 'utf8'), file, ts);
    messageIdViolations.push(...r.violations);
    for (const b of Object.keys(seenByBucket)) seenByBucket[b] += r.seen[b];
  }
  const blindBuckets = Object.keys(seenByBucket).filter((b) => seenByBucket[b] === 0);
  const totalTextSeen = Object.values(seenByBucket).reduce((a, b) => a + b, 0);

  let failed = false;

  if (violations.length > 0) {
    failed = true;
    console.error(`\n✗ Bare metadata-literal authoring found in docs/skills (#2035). Use the defineX factory instead:\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.text}`);
    }
    console.error(`\n${violations.length} violation(s). Author via e.g. \`definePage({ ... })\` — a value import that fails loudly, validates at parse time, and is the one pattern AI should learn. See ADR-0059.\n`);
  }

  if (idViolations.length > 0) {
    failed = true;
    console.error(`\n✗ Internal issue-id reference(s) in the PUBLISHED skill catalog:\n`);
    for (const v of idViolations) {
      console.error(`  ${v.file}:${v.line}  ${v.ids.join(' ')}`);
      console.error(`    ${v.text}`);
    }
    console.error(
      `\n${idViolations.length} line(s). \`skills/**\` ships to customer projects and is loaded WHOLE`
      + `\ninto customer agent context windows. A reader there has no tracker, no \`git log\` and no`
      + `\nADRs, so \`#NNNN\` resolves to nothing for the audience actually paying for it — a`
      + `\ncitation-shaped token billed to every customer session, forever.`
      + `\n\nKeep the TEACHING, drop the citation. A sentence that exists only to cite an id goes`
      + `\nentirely; a sentence that teaches something keeps the lesson and loses the number`
      + `\n("removed in #4286" -> "removed in protocol 17", or just "removed"). Prefer a customer-`
      + `\nresolvable anchor where one exists — a protocol version, an ADR number, a lint rule id.`
      + `\n\nWriting a usage example that needs an issue number? Use the placeholder \`#<n>\`.`
      + `\nIt teaches the same syntax and is unmistakable to a customer reading it.`
      + `\n\nFlagged file says "Auto-generated — do not edit"? Then the id is not authored there:`
      + `\nit is projected from a \`.describe()\` / TSDoc string in \`packages/spec/src/**\`. Strip it`
      + `\nAT THE SOURCE and regenerate (\`gen:skill-refs\`, \`gen:react-blocks\`, \`gen:docs\`) — the`
      + `\nartifact is not exempt, because an exemption there is where the next one would land.`
      + `\n\nThere is no per-passage exemption to reach for, by design: this rule has none.`
      + `\n\nMaintainer ruling 2026-08-12, verbatim: 「处理 issue 时犯的错应该总结成经验,保留 issue id没有意义」\n`,
    );
  }

  if (blindBuckets.length > 0) {
    failed = true;
    console.error(
      `\n✗ doc authoring guard: ${specSources.length} spec source(s) were parsed and NOT ONE`
      + `\ncustomer-facing string was recognised in ${blindBuckets.length === 1 ? 'this position' : 'these positions'}:`
      + `\n\n  ${blindBuckets.join(', ')}`
      + `\n\nso "no violations" below would be a verdict on a population this run never located.`
      + `\n\nThat is the dormant-gate shape, not a clean tree: the spec really does declare refusal`
      + `\nprose, unknown-key guidance, tombstone prescriptions, \`.describe()\` docs AND prose built`
      + `\ninside \`error: () =>\` callbacks and message-builder functions, so a zero here means the`
      + `\nDETECTOR stopped matching how one of them is spelled — an options-object key renamed away`
      + `\nfrom \`message\`, a new validator helper, a \`strictObject\` wrapper under a new name, a`
      + `\nguidance table moved behind a helper \`customerTextPosition()\` does not climb through, or`
      + `\n— for \`functionBuilt\` — the function-boundary clause silently back to \`undefined\`.`
      + `\n\nThe floor is PER BUCKET and not on the total, deliberately: \`.describe()\` alone would`
      + `\nhold a total positive forever while the \`guidance\` matcher rotted unseen.`
      + `\n\nFix \`customerTextPosition()\` / \`collectTextSinkConsts()\` / STRICT_OPTION_KEYS /`
      + `\nSTRICT_OBJECT_CALLS / TOMBSTONE_CALLS / POSITIONAL_MESSAGE_CALLS in`
      + `\nscripts/check-doc-authoring.mjs and add the new spelling to --self-test in the same edit.`
      + `\nDo NOT delete this assertion: it is the only thing standing between this rule and a`
      + `\npermanent green.\n`,
    );
  }

  if (messageIdViolations.length > 0) {
    failed = true;
    console.error(`\n✗ Internal issue-id reference(s) in CUSTOMER-FACING spec text:\n`);
    for (const v of messageIdViolations) {
      console.error(`  ${v.file}:${v.line}  ${v.ids.join(' ')}  [${v.where}]`);
      console.error(`    ${v.text}`);
    }
    const byBucket = {};
    for (const v of messageIdViolations) byBucket[v.bucket] = (byBucket[v.bucket] ?? 0) + 1;
    console.error(
      `\n${messageIdViolations.length} string(s): `
      + `${Object.entries(byBucket).map(([b, n]) => `${b} ${n}`).join(' · ')}.`
      + `\n\nRefusal messages, unknown-key \`guidance\` and tombstone prescriptions are printed AT the`
      + `\ncustomer, verbatim, the moment their metadata is refused — by \`os validate\`, by a publish`
      + `\ngate, by a parse. \`.describe()\` prose projects into content/docs/references/** and the`
      + `\ngenerated skill artifacts. Neither reader has a tracker, \`git log\` or the ADRs, so`
      + `\n\`#NNNN\` is a citation-shaped token resolving to nothing — in the refusal case, in the one`
      + `\nplace they most need the sentence to be actionable.`
      + `\n\nStrip the id from the string; repair the sentence around it rather than rewriting it.`
      + `\nWhere the id was the whole parenthetical, the parenthetical goes with it. Where the`
      + `\nreference is genuinely load-bearing for an INTERNAL reader, move it to an adjacent \`//\``
      + `\ncomment; otherwise just remove it — git history keeps the anchor.`
      + `\n\n⛔ KEEP the customer-resolvable references: an ADR id, a protocol version, an error code`
      + `\n(\`400 INVALID_FILTER\` traces the runtime twin far better than the id beside it), and the`
      + `\nmigration command. AGENTS.md positively requires a tombstone prescription to carry a`
      + `\ndurable reference — "the FROM → TO mapping, the ADR the removal rests on, or the`
      + `\nmigration command" — so an issue id NEXT TO an ADR id is the strippable half, and a`
      + `\ntombstone whose ONLY reference is the issue id is escalated, never stripped bare.`
      + `\n\nA test twin pinning the old wording moves WITH the string — keep it pinning the new`
      + `\ntext, and add the negative pin (the text must not match an issue id).`
      + `\n\nThere is no per-string exemption to reach for, by design.`
      + `\n\nMaintainer ruling 2026-08-12, verbatim: 「处理 issue 时犯的错应该总结成经验,保留 issue id没有意义」\n`,
    );
  }

  if (failed) process.exit(1);

  console.log(`✓ doc authoring guard: ${files.length} files clean — no bare metadata literals.`);
  console.log(`✓ doc authoring guard: ${published.length} published skill files clean — no internal issue-id references.`);
  console.log(
    `✓ doc authoring guard: ${totalTextSeen} customer-facing string(s) across `
    + `${specSources.length} spec sources clean — no internal issue-id references `
    + `(message ${seenByBucket.message} · strictObject ${seenByBucket.strictObject} · `
    + `tombstone ${seenByBucket.tombstone} · describe ${seenByBucket.describe} · `
    + `functionBuilt ${seenByBucket.functionBuilt}).`,
  );
}

main();

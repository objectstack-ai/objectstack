// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The author-time rule registry — WHICH rules each authoring surface runs,
 * declared as data, with a written reason for every narrowing (#4409, #4463).
 *
 * Lives in `@objectstack/lint` (not the CLI) since #4463: the CLI is one
 * CONSUMER of this table, not its home. The runtime metadata write path
 * (`saveMetaItem` / `publishMetaItem` — the Studio, REST `/meta` and MCP door)
 * is the other, and it reads the same array through `./runtime.js`. That is the
 * whole point: a shared core plus N gates, never N rule engines.
 *
 * ## Why this exists
 *
 * Each of the three authoring commands grew its own import list and its own
 * call site per rule. Nothing connected them, so "which rules run here?" was
 * answerable only by reading three 800-line files and diffing them by eye — and
 * the answer drifted every time a rule landed. At the point this registry was
 * written, 23 of the 26 hand-wired rules ran on some strict subset of the three,
 * and nine of those could emit `severity: 'error'`. The worst direction was not
 * the obvious one: `os build` was the WEAKEST of the three gates, so it emitted
 * an artifact for stacks `os validate` or `os lint` refuses. A flow whose
 * expression approver does not parse (`approval-expression-invalid`, an `error`)
 * built and published green — only `os lint` stopped it, and CI usually runs the
 * other two.
 *
 * That failure mode had already been fixed four times, one instance at a time:
 * the reference-integrity suite (#3583 §5 D5), the four CLI-local authoring
 * lints that ran on `build` alone (#3782), `validateReadonlyFlowWrites` missing
 * from `lint` (#4384/#4394), and the wiring guard that followed (#4402). Each
 * repair removed an instance and left the MODE — a rule's command coverage was
 * whatever its author remembered to type, and forgetting was silent. This file
 * replaces "remembering" with a table, and the guard in
 * `authoring-rule-wiring.test.ts` makes a narrowing an explicit,
 * reasoned edit instead of an omission.
 *
 * ## The invariant
 *
 * **Any rule that can emit `error` runs on all three commands.** A gate is only
 * as strong as the weakest command an author or CI happens to run, so a gating
 * rule with partial coverage is not a stricter check — it is a coin flip.
 *
 * #4463 is the same sentence one layer out: the three commands are three doors
 * in ONE wall, and the runtime metadata write path is a fourth wall with no
 * door at all. A tenant editing in Studio, a REST `/meta` PUT and an MCP/AI
 * author all reach `saveMetaItem`, which ran a per-type Zod `safeParse` and
 * nothing else — so the very stack `os build` refuses walked in through the
 * only door most tenants have. {@link AuthoringRule.surfaces} is what makes
 * "which rules run at that door?" a table entry rather than a second wiring
 * list, and `authoring-rule-wiring.test.ts` ratchets it exactly as it ratchets
 * the three commands.
 *
 * An `advisory` rule (never emits `error`) MAY be scoped to fewer commands, but
 * only with a `scopeReason` recorded here. The distinction that matters is not
 * cost, it is consequence: a missing advisory costs the author a hint, a missing
 * gate ships broken metadata.
 *
 * Cost, as it turns out, argues for almost nothing. The heavy dependencies
 * (`typescript` ~9 MB, `sucrase` ~1.5 MB) are already lazy and load only when a
 * stack actually carries the metadata that needs them — a contract pinned by
 * `@objectstack/lint`'s `lazy-deps.test.ts`. `validateReactPageProps`, the
 * heaviest rule of the set, has run on all three commands as a suite member
 * since #4340 without anyone noticing a cost. So `os lint` stays light on the
 * stacks that do not use those surfaces, whether or not the rules are wired.
 *
 * ## Adding a rule
 *
 * Append one entry here. It reaches all three commands at once and nothing else
 * needs editing. Do NOT import the rule into a command file — the wiring guard
 * fails on a direct import, because that is precisely how a rule ends up running
 * on two commands out of three.
 *
 * Then answer the fourth-door question in the same edit: does it belong on
 * `surfaces: ['cli', 'runtime-publish']`? Say yes (with `runtimeTypes`) or say
 * why not (with `surfaceReason`). There is no third option — the guard rejects
 * an entry that answers neither, which is the whole mechanism: #4409 was
 * "nobody wrote down which commands", #4463 was "nobody wrote down which
 * doors", and both were invisible until someone measured.
 *
 * ## What is NOT in here
 *
 * This registry covers the rules the three commands SHARE. Two neighbouring
 * families are deliberately outside it, and the guard's ratchet lists them by
 * name so the boundary stays a decision rather than an oversight:
 *
 * - **`os lint`'s own style rubric** (snake_case names, missing labels, the
 *   data-model best-practice sweep, docs, i18n coverage). Its `error` severity
 *   is a LINT verdict, not a publish gate — `os build` has never rejected a
 *   camelCase object name and making it do so is a product decision, not a
 *   wiring fix.
 * - **Gates that need more than the stack** — the capability-provider preflight
 *   (reads `node_modules`), package docs (reads `src/docs/`), the access-matrix
 *   snapshot (reads/writes a file next to the config). They are I/O, not pure
 *   metadata rules, and each is wired where its input exists.
 */

// Imported per-module, never through `./index.js`: the barrel would make this
// file a cycle partner of its own package entry, and the runtime surface
// (`./runtime.js`) needs a graph it can reason about rule by rule.
import { validateStackExpressions } from './validate-expressions.js';
import { validateListViewMode } from './validate-list-view-mode.js';
import { validateFunctionalCompleteness } from './validate-functional-completeness.js';
import { validateManagedApiMethods } from './validate-managed-api-methods.js';
import { validateViewContainers } from './validate-view-containers.js';
import { validateWidgetBindings } from './validate-widget-bindings.js';
import { validateDashboardActionRefs } from './validate-dashboard-action-refs.js';
import { validateFilterTokens } from './validate-filter-tokens.js';
import { validatePresetComparands } from './validate-preset-comparands.js';
import { validateEmptyCombinators } from './validate-empty-combinators.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';
import { validateComponentProps } from './validate-component-props.js';
import { validateResponsiveStyles } from './validate-responsive-styles.js';
import { validateJsxPages } from './validate-jsx-pages.js';
import { validateReactPages } from './validate-react-pages.js';
import { validatePageSourceStyling } from './validate-page-source-styling.js';
import { validateCapabilityReferences } from './validate-capability-references.js';
import { validateFlowTriggerReadiness } from './validate-flow-trigger-readiness.js';
import { validateApprovalApprovers } from './validate-approval-approvers.js';
import { validateRecordTitle } from './validate-record-title.js';
import { validateSemanticRoles } from './validate-semantic-roles.js';
import { validateFormLayout } from './validate-form-layout.js';
import { validateSeedReplaySafety } from './validate-seed-replay-safety.js';
import { validateSeedStateMachine } from './validate-seed-state-machine.js';
import { validateVisibilityPredicates } from './validate-visibility-predicates.js';
import { validatePredicatePathRefs } from './validate-predicate-path-refs.js';
import { validateSecurityPosture, validateSecurityRoleWord } from './validate-security-posture.js';
import { validateOrgAxisRedLines } from './validate-org-axis-red-lines.js';
import { validateSharingRuleEnforceability } from './validate-sharing-rule-enforceability.js';
import { validateRlsPredicateEnforceability } from './validate-rls-predicate-enforceability.js';
import { validateRuleCompilability } from './validate-rule-compilability.js';
import { validateRuleSchemaFormats } from './validate-rule-schema-formats.js';
import { validateActionLocations } from './validate-action-locations.js';
import { lintFlowPatterns } from './lint-flow-patterns.js';
import { lintLivenessProperties } from './lint-liveness-properties.js';
import { lintAutonumberFormats } from './lint-autonumber-formats.js';
import { lintViewRefs } from './lint-view-refs.js';
import {
  lintUniqueDeclarations,
  lintUnscopedDeclaredIndexes,
  lintLegacyOrganizationComposites,
} from './data-model-rules.js';

type AnyRec = Record<string, unknown>;

// ─── Types ──────────────────────────────────────────────────────────

/** The three commands that hold a stack to the same author-time bar. */
export const AUTHORING_COMMANDS = ['validate', 'build', 'lint'] as const;
export type AuthoringCommand = (typeof AUTHORING_COMMANDS)[number];

/**
 * The authoring SURFACES this registry serves (#4463).
 *
 * - `cli` — `os validate` / `os build` / `os lint`. Which of the three is a
 *   separate axis ({@link AuthoringRule.commands}); every rule here runs on the
 *   `cli` surface, because that is where the registry was born.
 * - `runtime-publish` — the metadata write path's PUBLISH gate: a
 *   `state: 'active'` `saveMetaItem`, and the draft→active promotion in
 *   `publishMetaItem`. Studio saves, REST `/meta` item CRUD and MCP/AI
 *   authoring all funnel through those two, so wiring the surface once covers
 *   all three doors (the maintainer ruling on #4463: one shared core, one
 *   runtime gate, not a gate per surface).
 *
 * Draft saves are deliberately NOT a surface: a draft is allowed to be a
 * half-finished thing, and gating one would break the Studio editing loop for
 * no safety gain — the draft cannot execute until it is published, and
 * publishing runs this table (#4463 D1).
 */
export const AUTHORING_SURFACES = ['cli', 'runtime-publish'] as const;
export type AuthoringSurface = (typeof AUTHORING_SURFACES)[number];

/** `error` gates. `warning` advises. `info` is a suggestion (`os lint` grades it as one). */
export type AuthoringSeverity = 'error' | 'warning' | 'info';

/**
 * The one finding shape all three commands render. Rules whose own return type
 * predates it are adapted at their registry entry, so the commands hold one
 * type instead of a twenty-way union.
 */
export interface AuthoringFinding {
  severity: AuthoringSeverity;
  /** Stable diagnostic rule id (used by docs, allowlists and `--json` consumers). */
  rule: string;
  /** Human-readable location, e.g. `object "leave_request"`. */
  where: string;
  /** Config path, e.g. `objects[3].sharingModel`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

/**
 * `gating` = the rule can emit `severity: 'error'`, so it MUST run on all three
 * commands. `advisory` = it never does, and may be scoped with a reason.
 *
 * The claim is not taken on trust: the wiring guard reads each `advisory` rule's
 * own source and fails if it emits an `error`. That check is the reason the tier
 * is worth declaring — #3760 promoted a `lintFlowPatterns` rule from advisory to
 * gating, and nothing anywhere asked whether its command coverage should follow.
 */
export type AuthoringRuleTier = 'gating' | 'advisory';

/**
 * Which tier of the stack a rule reads.
 *
 * - `normalized` — the `normalizeStackInput` output, run before this package's
 *   caller had a chance to Zod-parse.
 * - `parsed` — the post-parse stack, where defaults are filled and shapes are
 *   settled.
 *
 * `os lint` never parses (it is the cheap pre-flight; a schema error is
 * `os validate`'s verdict to give), so it runs BOTH tiers on the normalized
 * stack. Every rule here is written to tolerate that — it is what `os lint`
 * already did for the reference-integrity suite and the security linter.
 *
 * ## What `normalized` does NOT buy, measured (#6073)
 *
 * This tier used to be justified as "the rules that need it check keys the
 * parse strips — a flat list view in `views: []`, `userFilters` on an object
 * list view, a `visibleOn` alias — by the time `result.data` exists the
 * evidence is gone". **All three of those examples were measured false**, each
 * for its own reason, and the pins live in `authoring-rule-input-tier.test.ts`:
 *
 *  1. `defineStack` — the documented and universal way a TS config declares a
 *     stack — PARSES at definition time, so for such a config the value every
 *     command hands this registry is already `result.data`: parse-time defaults
 *     filled (`flow.runAs === 'user'`), unknown keys resolved. Re-normalizing it
 *     cannot resurrect anything. That half was measured in #5693 and re-measured
 *     here.
 *  2. But nothing is lost, because since #4001 the two cited view schemas do not
 *     STRIP — they REFUSE. `ViewSchema` and `ObjectListViewSchema` are strict, so
 *     `defineStack` throws on the flat list view and on `quickFilters` /
 *     `userFilters: { element: 'tabs' }`, naming the same sites the rules name,
 *     one layer earlier and with the schema's own fix hint. Measured end to end:
 *     `os lint` and `os validate` on an example app carrying the flat view both
 *     refuse the config at LOAD, before any rule runs.
 *  3. The `visibleOn` alias never reaches this tier on ANY input shape: the
 *     ADR-0087 D2 conversion (`view-visibleOn-to-visibleWhen`,
 *     `page-component-visibility-to-visibleWhen`) folds it into `visibleWhen`
 *     INSIDE `normalizeStackInput` — one layer before the tier, not during the
 *     parse. #6318 acted on that: the alias-KEY rule this premise justified
 *     (`visibility-alias-deprecated`) was retired, since the D2 conversion
 *     notice already covers its whole evidence surface with better wording and
 *     a stated retirement window. The alias-KEY half of premise 3 is therefore
 *     no longer merely false — there is nothing left reading it.
 *
 * ## What it does buy, and why the tier stays
 *
 * The surviving reason is the one `validate-functional-completeness.ts` states
 * and the measurement confirms: a `normalized`-tier finding reaches the author
 * even when an unrelated schema error elsewhere would stop the parse. On the
 * raw (non-`defineStack`) path that is not theoretical — `os validate` stops at
 * the schema step and reports zero rule findings, while `os lint`, which never
 * parses, still names `view-container-shape` and
 * `list-view-filters-in-views-mode`. Plus the plain fact that `os lint` has no
 * parsed stack to give.
 *
 * So: read `normalized` as "does not REQUIRE a parsed stack", never as "is
 * guaranteed to see pre-parse evidence". A new rule whose only evidence is a key
 * a strict schema rejects is a rule that will never fire — put the diagnostic in
 * the schema instead, where #4001 already puts it.
 */
export type AuthoringRuleInputTier = 'normalized' | 'parsed';

/** Per-run inputs a rule may need beyond the stack itself. */
export interface AuthoringRuleContext {
  /** ADR-0080 SDUI component manifest, when the project ships one. */
  sduiManifest?: unknown;
  /**
   * [#9313] The singular metadata type of the per-write snapshot being judged
   * — set by the runtime publish gate (`runtime-gate.ts`) on every gated
   * write, ABSENT on the three CLI commands (`runAuthoringRules` never sets
   * it). Exists for the one entry that is itself a registry: the
   * reference-integrity suite dispatches its MEMBERS by this
   * (`ReferenceIntegrityRule.runtimeTypes`), because the entry-level
   * `runtimeTypes` can only say which writes reach the suite, not which
   * members can judge a partial per-write snapshot without inventing
   * findings. No other rule reads it, and none should without the same
   * argument.
   */
  runtimeWriteType?: string;
}

export interface AuthoringRule {
  /** The exported function's name — the id the wiring guard asserts on. */
  name: string;
  tier: AuthoringRuleTier;
  input: AuthoringRuleInputTier;
  /** Which commands run it. Must be all three when `tier` is `gating`. */
  commands: readonly AuthoringCommand[];
  /** Repo-relative path to the rule's implementation (the guard verifies the tier claim against it). */
  source: string;
  /** REQUIRED when `commands` is not all three: why this rule is scoped. */
  scopeReason?: string;
  /**
   * Which authoring surfaces run this rule (#4463). Always contains `'cli'`.
   *
   * Adding `'runtime-publish'` is what puts the rule on the metadata write
   * path's publish gate; {@link runtimeTypes} then says which metadata types'
   * writes it inspects. Leaving it off REQUIRES {@link surfaceReason} — the
   * same discipline `scopeReason` applies to the command axis, for the same
   * reason: the whole defect class #4409 and #4463 describe is coverage that
   * narrowed silently.
   */
  surfaces: readonly AuthoringSurface[];
  /**
   * REQUIRED when `surfaces` includes `'runtime-publish'`: the SINGULAR
   * metadata type names whose runtime write this rule inspects (e.g. `flow`).
   *
   * The runtime gate builds a per-write stack snapshot and only runs the rules
   * that declare the written type, which is #4463 D2 option (c) expressed as
   * data. Widening a rule to another type is a one-line edit here, not new
   * wiring at the gate.
   */
  runtimeTypes?: readonly string[];
  /** REQUIRED when `surfaces` omits `'runtime-publish'`: why the runtime gate does not run it. */
  surfaceReason?: string;
  run: (stack: AnyRec, ctx: AuthoringRuleContext) => readonly AuthoringFinding[];
}

/** Every command runs every rule unless an entry says otherwise. */
const ALL: readonly AuthoringCommand[] = AUTHORING_COMMANDS;

/** The CLI-only surface set — the default for a rule the runtime gate does not (yet) run. */
const CLI_ONLY: readonly AuthoringSurface[] = ['cli'];
/** Runs on both the three CLI commands and the runtime publish gate. */
const CLI_AND_RUNTIME: readonly AuthoringSurface[] = ['cli', 'runtime-publish'];

// ─── Why a rule is not on the runtime publish gate ──────────────────
//
// #4463's P1 slice deliberately wires ONE metadata type (`flow`) and the four
// rule families the issue named (flow / approval / expression / reference).
// Every other rule carries one of the reasons below rather than silence. They
// are shared constants because the reason really is the same for a group of
// rules — writing twenty near-identical sentences would hide which ones differ.

/**
 * The rule reads a stack-wide COLLECTION the per-write snapshot does not carry
 * (pages, dashboards, navigation, translations). The runtime universe can
 * answer these — it is strictly more complete than the CLI's single-package
 * view — but shipping a rule against a partial snapshot would invent findings
 * for metadata the tenant simply did not include in THIS write. A false 422 on
 * the only door a Studio tenant has is worse than the gap it would close.
 *
 * [#8309] The snapshot is widened by measurement, never wholesale: it now
 * carries `permissions` and `books` (`RuntimeStackContext` in
 * `runtime-gate.ts`) because the three cross-collection security rules were
 * measured inventing findings without them (38 phantom
 * `security-master-detail-ungranted` per-write vs 4 whole-stack, PR #7886),
 * and `datasets` (#7529) because `validateWidgetBindings` was measured
 * inventing 3 phantom `widget-dataset-unknown` errors on a legitimate
 * 3-widget board without it — so for a rule whose only missing collection is
 * one of those three, this reason no longer holds and widening it is a
 * `runtimeTypes` edit plus its own rollout decision. For every other
 * collection the sentence above stands.
 */
const RUNTIME_NEEDS_FULL_SNAPSHOT =
  'P2 (#4463): reads a stack-wide collection the per-write snapshot does not carry, so running it ' +
  'now would report the rest of the tenant\'s metadata as missing rather than judging this write.';

/**
 * The rule parses authored SOURCE (react/jsx page bodies, L2 JS hook/action
 * bodies) through `typescript` / `sucrase`. Those are exactly the dependencies
 * `lazy-deps.test.ts` keeps off the kernel boot path, and `@objectstack/lint`'s
 * runtime entry is guarded to load neither. Studio's page editor has its own
 * save-time compile path; this gate is not where that check belongs.
 */
const RUNTIME_HEAVY_SOURCE_PARSE =
  'Not runtime-safe: parses authored source through typescript/sucrase, the two dependencies the ' +
  'kernel boot path must never load (lazy-deps.test.ts). Studio compiles page source on its own path.';

/**
 * The rule judges an OBJECT/field declaration at `advisory` tier — it can
 * never refuse a write (`tier: 'advisory'` means it never emits `error`, and
 * `authoring-rule-wiring.test.ts` reads each advisory rule's own source to
 * keep that true).
 *
 * This constant used to hold the whole object-writes group back ("P1 gates
 * `flow` first and widens once the gate has real traffic"). #4716 split that
 * group by tier and crossed the five GATING object rules (2026-08-18
 * adjudication): the false-positive budget their crossing owed was exempted on
 * a measured 0 refusals across 75 real object declarations from two authoring
 * lineages — a LOWER BOUND, since every measured population is authored
 * config-file metadata — with a post-launch replay of stored `sys_metadata`
 * overlay rows as the standing audit of the exemption.
 *
 * What holds THIS tier back is not refusal risk but ADVISORY VOLUME: measured
 * on the platform's own 45 shipped object declarations, widening these six
 * rules adds ~8 advisories per object write (vs 0.10 per write on the
 * CI-swept examples), and since #4717 advisories render in Studio's designer
 * on every field edit. A designer that answers every save with eight warnings
 * teaches its authors — human and AI — to ignore the channel, and an ignored
 * advisory channel is worse than none because it reads as covered. Crossing
 * an advisory rule is therefore a UX/volume decision with its own card
 * (suppress by tier? collapse by rule? surface only on publish?), never a
 * bare `runtimeTypes` edit — the #4716 adjudication scoped it out by name.
 */
const RUNTIME_OBJECT_ADVISORY_VOLUME =
  'Advisory-tier object rule: it cannot refuse a write, and it is held off the runtime door for ' +
  'advisory VOLUME (~8 findings per object write measured on unswept metadata, rendered in Studio ' +
  'since #4717), not refusal risk. Crossing it is a UX decision with its own card (#4716).';

/**
 * `ExprIssue` is the one rule finding that carries no rule id of its own — it
 * predates the `{ rule, path, hint }` shape every other rule settled on. Given
 * one here so `os lint --json` and the docs can name it like any other.
 */
export const EXPRESSION_INVALID = 'expression-invalid';

// ─── The registry ───────────────────────────────────────────────────

/**
 * Every author-time rule the three commands share, in the order their findings
 * are reported.
 */
export const AUTHORING_RULES: readonly AuthoringRule[] = [
  // ADR-0032 §1a/1b — CEL predicates in actions/validations/flows/sharing/hooks
  // are parsed for syntax AND checked that each `record.<field>` resolves. This
  // is what catches a BARE field ref (`done` instead of `record.done`) that
  // would otherwise silently hide an action on every record (#2183/#2185).
  {
    name: 'validateStackExpressions',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-expressions.ts',
    // Runtime publish gate (#4463): the EXPRESSION family. On a flow write it
    // checks every script-node callable and every declared predicate the flow
    // carries, against the live object universe — the same parse `os build`
    // runs, now at the door Studio/REST/MCP authors actually use.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['flow'],
    run: (stack) =>
      validateStackExpressions(stack).map((i) => ({
        severity: i.severity ?? 'error',
        rule: EXPRESSION_INVALID,
        where: i.where,
        path: i.where,
        message: i.message,
        hint: `source: \`${i.source}\``,
      })),
  },
  // ADR-0053 — `userFilters`/`quickFilters` on an object list view ("views"
  // mode). NOT "silently dropped" any more: since #4001 `ObjectListViewSchema`
  // is strict and refuses `quickFilters` by name, and `ObjectUserFiltersSchema`
  // refuses `element: 'tabs'` by enum — measured under #6073, `defineStack`
  // THROWS on both. `normalized` here therefore means "needs no parsed stack"
  // (so `os lint`, which never parses, can run it), not "sees evidence the
  // parse would have eaten".
  {
    name: 'validateListViewMode',
    tier: 'gating',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-list-view-mode.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateListViewMode(stack),
  },
  // [ADR-0078] A Zod-VALID instance that silently does nothing: a `summary`
  // with no `summaryOperations`, a `lookup` with no `reference`, a `select`
  // with no `options`. Every key is one we know, so #4001's unknown-key
  // rejection cannot see it, and the liveness ledger cannot either (it is
  // per-property; the properties ARE live). This is the gate between them.
  //
  // `gating` because the error-severity shapes are fully inert — the field
  // reads 0 forever while authoring reports success, which is the failure the
  // ADR was written for (cloud#687). Pre-parse so the findings survive an
  // unrelated schema error elsewhere in the stack.
  {
    name: 'validateFunctionalCompleteness',
    tier: 'gating',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-functional-completeness.ts',
    // Runtime publish gate (#4716): the OBJECT write door — the five gating
    // object rules cross together under the 2026-08-18 adjudication. The
    // false-positive budget the crossing owed was exempted on a measured
    // 0 refusals / 75 real object declarations (authored config-file metadata,
    // so a lower bound — see RUNTIME_OBJECT_ADVISORY_VOLUME's note); the six
    // advisory-tier object rules deliberately do NOT ride.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['object'],
    run: (stack) => validateFunctionalCompleteness(stack),
  },
  // [#7521, via cloud#1225] A managed object advertising a generic write verb
  // in `enable.apiMethods` that its own resolved affordances refuse. Every key
  // is one we know and each is individually valid, so #4001's unknown-key
  // rejection and the Zod parse both pass it; the contradiction is only visible
  // when the two keys are read TOGETHER, which nothing did at authoring time.
  //
  // `gating` because the declaration is already false when it ships: objectql's
  // registry strips the verb at registration, so the metadata advertises an API
  // the product does not serve. That strip has been correct and silent — a
  // `console.warn` on every control-plane boot that went unread for the life of
  // a real divergence (`sys_environment`/`sys_package`). This entry is the
  // ruling's "close it where the author is"; boot stays warn-and-strip.
  //
  // Pre-parse: the predicate reads only authored keys, and the finding must
  // survive an unrelated schema error elsewhere in the stack.
  {
    name: 'validateManagedApiMethods',
    tier: 'gating',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-managed-api-methods.ts',
    // Runtime publish gate (#4716): a managed object advertising a verb its
    // own affordances refuse is exactly the contradiction a Studio/MCP author
    // can save today — the CLI sweep (#7934) never sees an overlay row.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['object'],
    run: (stack) => validateManagedApiMethods(stack),
  },
  // A view container in `views: []` that registers zero views: nothing appears
  // in the Console, and the schema step cannot tell it from an intentionally
  // empty one. The FLAT-list-view arm no longer needs this tier — `ViewSchema`
  // went strict at #4001, so `defineStack` now REFUSES `{ name, type, columns,
  // data }` by name with the wrap-it hint (measured under #6073); the arm that
  // still needs a rule is the all-slots-empty container, whose keys are all
  // declared and which survives the parse untouched.
  {
    name: 'validateViewContainers',
    tier: 'gating',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-view-containers.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateViewContainers(stack),
  },
  // ADR-0021 (#1719/#1721) — a widget's `dataset`/`dimensions`/`values` and its
  // chartConfig axis/series must resolve against the declared datasets.
  //
  // Runtime publish gate (#7529, maintainer-ruled 2026-08-12): a dashboard
  // widget bound to a dataset that resolves to nothing sailed through save AND
  // publish — this rule provably caught the body and was simply never invoked,
  // because `dashboard` was not a runtime-gated type. Option B: a DRAFT may
  // hold a forward reference; publishing refuses it with the key path named.
  // The snapshot carries `datasets` for exactly this rule (`RuntimeStackContext`
  // — without it every legitimate board reads as dangling, the 3-phantom
  // measurement). `surfaces` is per-RULE, so this flip puts all SIX of the
  // rule's error ids on the publish gate, not just `widget-dataset-unknown` —
  // ruled 2026-08-15: they are one coherent "this board cannot render"
  // reference-integrity class, and the ~6× wider accept-set narrowing was
  // accepted knowingly rather than splitting the dataset limb into its own
  // rule (traversal-duplication drift) or adding a per-finding-id surface
  // filter (registry machinery that weakens "delete a rule from the table and
  // enforcement stops in the same commit"). Warning-tier ids ride along on the
  // advisory channel and never block (#4463 P1).
  {
    name: 'validateWidgetBindings',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-widget-bindings.ts',
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['dashboard'],
    run: (stack) => validateWidgetBindings(stack),
  },
  // ADR-0049 / #3367 — a dashboard header action naming a dead target ships a
  // button that renders and refuses (or does nothing) on click: a `script`
  // target must name a defined action, a `modal` target must name a declared
  // page (objectstack#6739-A — a modal string target names a PAGE, only).
  // Unresolved `url` routes stay advisory.
  {
    name: 'validateDashboardActionRefs',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-dashboard-action-refs.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateDashboardActionRefs(stack),
  },
  // #3574 — a filter value like `{current_user}` resolves in no vocabulary,
  // reaches the data engine as a literal and matches nothing. The surface
  // renders empty with no error, and a silent zero is indistinguishable from a
  // genuine one at review time.
  {
    name: 'validateFilterTokens',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-filter-tokens.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateFilterTokens(stack),
  },
  // #8793 (the ruled C half of #8690) — a declared dashboard date-range preset
  // name (`last_30_days`, …) authored as a bare ORDERING comparand resolves in
  // no layer: the engine refuses it on a declared temporal field at query time
  // (INVALID_FILTER / 400, PR #8808), and anywhere else it compares as a
  // literal string. This is the authoring-time refusal the ruling shipped
  // alongside the engine door, judging the filter literal in isolation —
  // ordering positions only, all three authored filter shapes. Like
  // `validateEmptyCombinators` it needs NO resolution context, so
  // RUNTIME_NEEDS_FULL_SNAPSHOT does not apply and the runtime gate runs it
  // for every filter-carrying type the gate already maps: the write path is
  // the one door an AI author uses, and dashboards/views are where the preset
  // vocabulary is near enough to reach for.
  {
    name: 'validatePresetComparands',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-preset-comparands.ts',
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['dashboard', 'view', 'object', 'page', 'flow'],
    run: (stack) => validatePresetComparands(stack),
  },
  // #5330 — the LITERAL empty combinators (`$and: []`, `$or: []`, `$not: {}`,
  // `{}`). #5322 ruled their RUNTIME meaning to be the boolean identity, and
  // this rule does not touch it: it refuses the literal SPELLINGS at authoring
  // time with a per-shape prescription, which is Prime Directive #12's standard
  // shape (reject at the producer, never tolerate at the consumer) and #5240's
  // same-direction precedent one shape over.
  {
    name: 'validateEmptyCombinators',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-empty-combinators.ts',
    // The one type #4463's P1 slice opened, and the one this rule most needs:
    // a flow CRUD node's `config.filter` is where an empty combinator has the
    // largest blast radius, and the write path is the only door an AI author
    // uses. This rule needs NO resolution context at all — it judges the filter
    // literal in isolation — so RUNTIME_NEEDS_FULL_SNAPSHOT does not apply to
    // it, and widening to the other filter-carrying types (`object`, `view`,
    // `page`, `dashboard`) is a one-line `runtimeTypes` edit once #4463 P2
    // opens them at the gate. Making that call here would widen the gate's
    // dispatch surface on this rule's authority, which is P2's decision.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['flow'],
    run: (stack) => validateEmptyCombinators(stack),
  },
  // The reference-integrity suite (#3583 §5 D5) — itself a registry, of the
  // rules that answer "does this name resolve to anything?". It reached all
  // three commands before this file existed; it is an entry here so the two
  // registries compose instead of competing, and so its members are covered by
  // the same guard as everything else.
  {
    name: 'validateReferenceIntegrity',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/reference-integrity-suite.ts',
    // Runtime publish gate (#4463): the REFERENCE family. On a flow snapshot the
    // members that answer a flow question run (`validateFlowTemplatePaths`,
    // `validateFlowNodeWrites`, `validateReadonlyFlowWrites`,
    // `validateObjectReferences`); the page/nav/AI members see no such
    // collection in the snapshot and return nothing, and the two that would
    // load `typescript` need a hook/action/react body the snapshot never
    // carries — which is what `runtime-lazy-deps.test.ts` pins.
    //
    // [#9313] `view` joins, and the granularity decision #4463 P2 reserved is
    // taken HERE, in writing: the entry-level `runtimeTypes` says which WRITES
    // dispatch the suite, and the suite's own per-member `runtimeTypes`
    // (`ReferenceIntegrityRule`, default `['flow']`) says which MEMBERS judge
    // that snapshot — the gate passes the written type through
    // `ctx.runtimeWriteType`. A `view` write therefore reaches exactly the two
    // members that judge a list view's field references and resolve only
    // against the `objects` collection the snapshot carries
    // (`validateSearchableFields`, `validateSortableFields`). The whole suite
    // is NOT the right granularity for this door, measured not assumed:
    // `validateActionNameRefs` (error-tier) resolves a view's `rowActions[]` /
    // `bulkActions[]` against `stack.actions`, a collection no per-write
    // snapshot carries, so crossing it would refuse legitimate view writes for
    // every stack-level action they name — RUNTIME_NEEDS_FULL_SNAPSHOT's exact
    // sentence, on the hottest write type the gate has. Flow snapshots are
    // unchanged: every member keeps the default `flow` declaration.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['flow', 'view'],
    run: (stack, ctx) => validateReferenceIntegrity(stack, ctx),
  },
  // ADR-0078 / #5068 — the SDUI component-props gate. `PageComponent.properties`
  // is `z.record(z.string(), z.unknown())` and ADR-0089 D3a strictness does not
  // recurse into it, so until this entry existed the 31 typed prop schemas in
  // `ComponentPropsMap` were parsed by NOTHING (#4001 批 17's `no gate`
  // verdict): an undeclared or wrongly-typed prop parsed clean, was retained,
  // and reached objectui's renderer to be ignored there. This dispatches on
  // `type` and judges the bag; unregistered types are skipped, which is a
  // required semantic (`type` is an open union — the example corpus authors 87
  // nodes of 10 types this map does not carry).
  //
  // `normalized` for a reason worth stating, since the props bag survives the
  // Zod parse UNCHANGED and both tiers would otherwise carry the same data: the
  // ADR-0087 conversion layer runs inside `normalizeStackInput`, so a converted
  // alias (`page-header-subtitle-alias` rewrites `properties.description` →
  // `subtitle`) is already canonical here and is never reported as undeclared —
  // while a schema error elsewhere in the stack cannot take these findings down
  // with it.
  //
  // Advisory, deliberately, and this is the whole shape of #5068's first step:
  // wiring the parse is the precondition for enforcement, not the enforcement
  // (#5020, one surface over). The live corpus violates the declarations in two
  // places that are open contract questions — inline i18n label maps on three
  // published platform pages (#5728) and the record picker's declared-but-unread
  // `displayField` (#5775) — so gating today would fail the platform's own pages
  // to enforce declarations the platform does not keep. The error upgrade is a
  // separate step, once the warning-period inventory is empty.
  //
  // #5775 settled the record picker's half: `displayField` is retired in favour
  // of the `labelField` the renderer actually reads. Its claim that "the rest of
  // the keys the renderers honour are declared" did NOT hold — #6776 found five
  // more (`page:header` `recordChrome`/`showStar`/`showCopyId`,
  // `page:accordion.variant`, and the tab strip's visual style, whose declared
  // spelling `page:tabs.type` collided with the component node's own dispatch
  // key and so was unauthorable in the flat and JSX carriers). All five are
  // declared as of #6776, the last as the renamed `tabStyle`. What remains
  // before the error upgrade is #5728 and two page rewrites.
  {
    name: 'validateComponentProps',
    tier: 'advisory',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-component-props.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateComponentProps(stack),
  },
  // ADR-0065 — a styled node's responsiveStyles must be scopable (needs an
  // `id`), name real CSS properties + design tokens, and carry a `large` base.
  {
    name: 'validateResponsiveStyles',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-responsive-styles.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateResponsiveStyles(stack),
  },
  // ADR-0080 — a `kind:'jsx'` page's `source` is parsed (never executed) and
  // compiled to the SDUI tree at save time, so malformed source must fail loudly
  // here (ADR-0078) instead of being stored and breaking only at render.
  {
    name: 'validateJsxPages',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-jsx-pages.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_HEAVY_SOURCE_PARSE,
    run: (stack, ctx) =>
      validateJsxPages(stack, ctx.sduiManifest ? { manifest: ctx.sduiManifest as never } : {}),
  },
  // ADR-0081 — a `kind:'react'` page's `source` is real React executed at
  // render. Transpiled here (Sucrase, never executed) so a syntax error fails at
  // author time, not at render. Lazy: only a stack with such a page pays.
  {
    name: 'validateReactPages',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-react-pages.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_HEAVY_SOURCE_PARSE,
    run: (stack) => validateReactPages(stack),
  },
  // ADR-0065, source tier — Tailwind `className` in a `kind:'html'`/`'react'`
  // page silently no-ops (the build never scans authored metadata).
  {
    name: 'validatePageSourceStyling',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-page-source-styling.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validatePageSourceStyling(stack),
  },
  // ADR-0066 ⑨ — a `requiredPermissions` entry naming a capability registered
  // nowhere fails closed at runtime. Advisory: another installed package may
  // legitimately provide it.
  {
    name: 'validateCapabilityReferences',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-capability-references.ts',
    surfaces: CLI_ONLY,
    surfaceReason: 'P2 (#4463): the ONE rule the runtime universe makes strictly stronger — the advisory hedge ("another '
      + 'installed package may provide it") is decidable against the live capability registry, so it '
      + 'graduates from advisory to gating there rather than merely being ported. That promotion is a '
      + 'severity change on a published rule id and belongs in its own PR, not riding a wiring change.',
    run: (stack) => validateCapabilityReferences(stack),
  },
  // A flow that LOOKS armed and never launches — silently. Reads the pre-parse
  // tier so an author sees what they wrote.
  //
  // `gating` since #5762, which reviewed the file's rules as one family and
  // split them on a single question: is THIS STACK enough to know the flow is
  // dead? Four rules answer yes and emit `error` — a `config.timeRelative`
  // the spec's own `TimeRelativeTriggerSchema` refuses, one the engine's routing
  // predicate cannot route at all, a `record-*` triggerType outside the
  // closed token grammar `triggerTypeToHookEvents` maps, and (#6637) a
  // `type: 'record_change'` flow whose triggerType the engine's binding resolver
  // routes nowhere, silently demoting it to a manual flow. None of those verdicts
  // can be changed by installing a package, so there is no reading under which
  // the flow fires. `flow-trigger-unknown-object` deliberately stayed `warning`
  // (the object may come from another installed package — a hedge this rule
  // cannot decide), as did `flow-draft-status-ambiguous` (draft flows DO fire;
  // that one is ambiguity of intent, not a dead flow).
  {
    name: 'validateFlowTriggerReadiness',
    tier: 'gating',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-flow-trigger-readiness.ts',
    // Runtime publish gate (#4463): the FLOW family. Its `error` findings now
    // REFUSE a `state: 'active'` write (P1 gates on `error` only); the rules that
    // stayed `warning` keep being logged as advisories. The gate judges a
    // snapshot whose `flows` holds only the written item and subtracts the
    // baseline's findings, so this refuses the dead flow's own publish — never
    // another flow's save on account of a stored one.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['flow'],
    run: (stack) => validateFlowTriggerReadiness(stack),
  },
  // ADR-0090 D3 fallout — an approval `{ type: 'role' }` resolves against the
  // better-auth org-membership tier, not positions, so a position name authored
  // there routes the approval to nobody; and an expression approver that does
  // not parse can never resolve. The rule whose absence from `os build` and
  // `os validate` was #4409's worked example: it gates, and it ran on `os lint`
  // alone, so a broken approval flow built and published green.
  {
    name: 'validateApprovalApprovers',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-approval-approvers.ts',
    // Runtime publish gate (#4463): the APPROVAL family, and the issue's worked
    // example both times. #4409 fixed it for `os build`; a tenant saving the
    // same broken expression approver from Studio still sailed through, because
    // `approver.value` is just a string to Zod. It is not just a string here.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['flow'],
    run: (stack) => validateApprovalApprovers(stack),
  },
  // ADR-0079 — `titleFormat` is retired in favour of `nameField`, and an object
  // with no resolvable title ships records with no meaningful name. Advisory:
  // auto-provision and the `Record #<id>` floor keep it from ever being fatal.
  {
    name: 'validateRecordTitle',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-record-title.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_ADVISORY_VOLUME,
    run: (stack) => validateRecordTitle(stack),
  },
  // ADR-0085 — `stageField` / `highlightFields` / `Field.group` are pointers
  // into the object's field map; a dangling one is Zod-valid and silently inert
  // at render. Advisory: every consumer degrades gracefully.
  {
    name: 'validateSemanticRoles',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-semantic-roles.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_ADVISORY_VOLUME,
    run: (stack) => validateSemanticRoles(stack),
  },
  // #2578 / #4449 — a form section's field reference that resolves to nothing
  // (silently not rendered) and an absolute `colSpan` under a per-surface
  // derived column count. Advisory: the renderer skips the unknown field and
  // clamps the span, so nothing is broken — but each is almost certainly an
  // authoring mistake, and until #4449 this rule ran on no command at all.
  // Pure structured-metadata walk (no lazy dependency), so wiring it to all
  // three costs nothing measurable.
  {
    name: 'validateFormLayout',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-form-layout.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateFormLayout(stack),
  },
  // ADR-0078 Phase 3 (Tier-A `action-locations`) — an action that declares no
  // `locations` and that no view places by name renders on no surface at all.
  // objectui#3142 made that measurable: four renderers used to show an
  // undeclared action anyway, and now none does. Advisory: a view in another
  // installed package may be the one placing it, and `locations: []` (the
  // documented headless shape) is deliberately never flagged.
  {
    name: 'validateActionLocations',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-action-locations.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateActionLocations(stack),
  },
  // framework#3434 — seeds replay on every boot, so a `mode: 'insert'` dataset
  // duplicates its table on every restart.
  {
    name: 'validateSeedReplaySafety',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-seed-replay-safety.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateSeedReplaySafety(stack),
  },
  // framework#3433 follow-up — #3433 exempts seed writes from the
  // `state_machine` rule, so a seeded status the FSM does not declare is no
  // longer rejected at write time. Re-added at author time; advisory, because
  // the exemption itself is legitimate.
  {
    name: 'validateSeedStateMachine',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-seed-state-machine.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateSeedStateMachine(stack),
  },
  // ADR-0089 D3b — a mis-layered binding root, plus (#6128) the bare-identifier
  // gate and (#6253) the syntax gate. This entry used to read "pre-parse: the
  // schema folds `visibleOn`/`visibility` into `visibleWhen` during parse, so
  // the alias the author wrote is gone from `result.data`". Measured false at
  // #6073: the ADR-0087 D2 conversions do that fold INSIDE
  // `normalizeStackInput`, one layer BEFORE this tier, so on every spec-valid
  // alias site the alias-KEY rule reported zero here too.
  //
  // #6318 closed that: `visibility-alias-deprecated` was RETIRED rather than
  // re-anchored. Re-anchoring would have had to move this entry's input to a
  // pre-`normalizeStackInput` value that `runAuthoringRules` does not accept —
  // a change to this package's external input contract, and the maintainer's
  // call, not a rule file's. Retirement is ADR-0049 (declared ≠ enforced) and
  // costs no author a signal: the same D2 conversion already shouts through
  // `warnConversionNotice` in `defineStack`, naming the site, the conversion and
  // the protocol-16 retirement window — better wording than the rule ever had.
  //
  // Every rule left in the family judges the predicate's VALUE, and the value
  // moves into `visibleWhen` intact, so all three report normally on this tier.
  // The tier therefore stays `normalized` on its SURVIVING justification (a
  // finding still reaches the author when an unrelated schema error would stop
  // the parse — see `AuthoringRuleInputTier`), never on the retired
  // "pre-parse evidence" one.
  //
  // `gating` since #6128: `visibility-bare-identifier` emits `error`. The two
  // ADR-0089 rules stay advisory findings within it — the tier is a property of
  // the RULE FUNCTION (can it emit `error`?), and the per-finding severity is
  // what decides whether any given diagnostic gates, exactly as `lintFlowPatterns`
  // has worked since #3760. The promotion follows the #5762 precedent: a family
  // that gains an `error` finding moves its registry tier in the same edit.
  //
  // ─── The `views[]` visibility-predicate FAMILY at the runtime door (#7220) ───
  //
  // This entry and `validatePredicatePathRefs` below moved to `runtime-publish`
  // in ONE edit, on the maintainer's 2026-08-10 ruling, sequenced after #4717's
  // `advisories` channel landed (PR #7435). Before that move a `view` written
  // through Studio / REST `/meta` / MCP — the only door most tenants have, and
  // the door AI authors use — was judged by NONE of the family's rule ids (six
  // at the time of the move; seven since #7659 added
  // `predicate-rhs-path-shaped` inside the second entry).
  //
  // They move together on purpose, and the two entries carry one comment because
  // they are one wall: #7214's implementer wired its own rule here alone and then
  // REVERTED it, because a `view` refused for an unresolvable predicate PATH
  // while a predicate that does not parse at all walks through the same door is
  // less predictable than refusing neither. A half-wired wall is worse than an
  // unwired one, so `authoring-rule-wiring.test.ts` now pins the family property
  // directly: every id on this surface is gated at the runtime door, or none is.
  //
  // The previous `surfaceReason` on THIS entry was `RUNTIME_NEEDS_FULL_SNAPSHOT`,
  // and re-measuring it at move time found it false: both rule functions read
  // `stack.views` and `stack.pages` and NO other collection — never `objects` —
  // so the per-write snapshot the gate builds is not partial for them, it is
  // complete. (`pages` is simply absent on a `view` write, so the page half
  // contributes zero findings to both differential passes rather than inventing
  // any.) The reason was not describing this rule; it was the default a rule got
  // when nobody measured, which is the #4409/#4463 defect one layer in.
  //
  // Runtime input tier: the gate hands the rules the body as persisted, without
  // `normalizeStackInput`, so the ADR-0087 D2 alias fold does NOT run at this
  // door. That costs the family nothing — `validateVisibilityPredicates` reads
  // `visibleWhen ?? visibleOn ?? visibility` itself, canonical-first, precisely
  // so a caller handing it a raw authored object still gets a verdict.
  {
    name: 'validateVisibilityPredicates',
    tier: 'gating',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-visibility-predicates.ts',
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['view'],
    run: (stack) => validateVisibilityPredicates(stack),
  },
  // #7010 — the same predicate surface, one question further in. The three
  // ADR-0089 D3b rules above judge a predicate's SHAPE (does it parse, is it
  // rooted, is the root right for the layer) and never open the target schema,
  // so `data.tpye == 'formula'` passes all three and still resolves to nothing.
  // This rule resolves the PATH against the schema the form edits — the closed
  // `getMetadataTypeSchema` key set — and is therefore immune to the CEL
  // type-name blind spot that made #6248's gate structurally unable to catch
  // #6254's 16 bare `type ==` predicates.
  //
  // Scoped to schema-bound forms (`data: { provider: 'schema', schemaId }`);
  // the `record.*` layer is deliberately out of scope because an ObjectQL
  // object's addressable path set is NOT closed (lookup traversal, system
  // columns, formula outputs), and an `error` gate over an open set generates
  // false build errors. See the rule's module note.
  //
  // #7659 adds a THIRD id here, `predicate-rhs-path-shaped`, which is not a
  // resolution question at all: the metadata-admin renderer resolves paths only
  // on the LEFT of `==` / `!=` and hands the right side to its literal parser,
  // so `data.a == data.b` resolves both sides cleanly, passes the two rules
  // above, and still compares against the string "data.b" — a constant verdict.
  // It carries `error` on a dotted chain (no reading under which it worked) and
  // `warning` on a bare word (`status == active` compares as the text today, so
  // refusing it would fail a build over metadata that renders correctly). The
  // per-finding severity is what gates, exactly as `lintFlowPatterns` has worked
  // since #3760; the entry's `gating` tier is unchanged because it already was.
  {
    name: 'validatePredicatePathRefs',
    tier: 'gating',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-predicate-path-refs.ts',
    // The second half of the #7220 family move — see the block above the
    // `validateVisibilityPredicates` entry. This is the rule whose solo wiring
    // was reverted; it is wired now because its siblings are.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['view'],
    run: (stack) => validatePredicatePathRefs(stack),
  },
  // #1874 — flow authoring anti-patterns. Advisory by default; a finding marked
  // `error` gates. Three do today: `flow-runas-unscoped` (#3760 — metadata the
  // runtime REFUSES to execute), plus `flow-branch-label-unmatched` and
  // `flow-default-edge-with-condition` (#4414 — a declaration that is inert, so
  // the route silently differs from what the author wrote). The bar for
  // promoting one is stated at the top of `lint-flow-patterns.ts`.
  {
    name: 'lintFlowPatterns',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/lint-flow-patterns.ts',
    // Runtime publish gate (#4463): the FLOW family's anti-pattern half. Its
    // three `error` rules are the sharpest fit for a publish gate that exists —
    // `flow-runas-unscoped` is metadata the automation engine REFUSES to
    // execute, so publishing it can only ever produce a broken flow.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['flow'],
    run: (stack) =>
      lintFlowPatterns(stack).map((f) => ({
        severity: f.severity ?? 'warning',
        rule: f.rule,
        where: f.where,
        path: f.where,
        message: f.message,
        hint: f.hint,
      })),
  },
  // The spec-liveness loop on the author side: a property the ledger marks
  // dead-and-misleading or experimental is set hopefully and does nothing.
  // Ledger-driven (entries opt in via `authorWarn`), so it is high-signal and
  // never fatal.
  {
    name: 'lintLivenessProperties',
    tier: 'advisory',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/lint-liveness-properties.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_ADVISORY_VOLUME,
    run: (stack) =>
      lintLivenessProperties(stack).map((f) => ({
        severity: 'warning' as const,
        rule: f.rule,
        where: f.where,
        path: f.where,
        message: f.message,
        hint: f.hint,
      })),
  },
  // A format like `{plan_no}{000}` makes the referenced field part of the
  // counter scope, so it must exist and be set at create time. Unknown field →
  // broken (error); optional field → fragile (warning).
  {
    name: 'lintAutonumberFormats',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/lint-autonumber-formats.ts',
    // Runtime publish gate (#4716): an autonumber referencing a field the
    // object does not carry is broken from the first record; only the error
    // arm blocks — the optional-field arm is `warning` and rides the
    // advisory channel like every other non-error finding (#4463 P1).
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['object'],
    run: (stack) =>
      lintAutonumberFormats(stack).map((f) => ({
        severity: f.severity,
        rule: f.rule,
        where: f.where,
        path: f.where,
        message: f.message,
        hint: f.hint,
      })),
  },
  // #2554 — a `type:'form'` action target naming a missing or LIST view opens a
  // broken form at runtime; a list/form view-key collision silently renames one
  // view so references resolve to the OTHER. Both are broken.
  {
    name: 'lintViewRefs',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/lint-view-refs.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) =>
      lintViewRefs(stack).map((f) => ({
        severity: f.severity,
        rule: f.rule,
        where: f.where,
        path: f.where,
        message: f.message,
        hint: f.hint,
      })),
  },
  // ADR-0120 D5a — a declared index with bare `unique: true` states no scope
  // at all (`unique/unscoped-declared-index` — the #4986 trap). Fires on the
  // spelling alone, no tenancy inference; 17.x warns, protocol 18 rejects the
  // spelling (#5082).
  {
    name: 'lintUnscopedDeclaredIndexes',
    tier: 'advisory',
    input: 'parsed',
    commands: ['validate', 'build'],
    source: 'packages/lint/src/data-model-rules.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_ADVISORY_VOLUME,
    scopeReason:
      '`os lint` already reports this rule through `lintDataModel`, which calls it directly ahead of ' +
      'R10 in its best-practice sweep — registering it for `lint` as well would report every finding ' +
      'twice. This is coverage recorded, not coverage missing: all three commands report the rule.',
    run: (stack) =>
      lintUnscopedDeclaredIndexes(Array.isArray(stack.objects) ? (stack.objects as unknown[]) : []).map((f) => ({
        severity: f.severity === 'suggestion' ? ('info' as const) : f.severity,
        rule: f.rule,
        where: f.where,
        path: f.path,
        message: f.message,
        hint: f.fix ?? '',
      })),
  },
  // #3991 / ADR-0120 D5b — a column carrying BOTH a field-level `unique` and a
  // single-column declared unique index states two scopes of which at most one
  // takes effect (`unique/double-declaration`, the four-quadrant matrix).
  {
    name: 'lintUniqueDeclarations',
    tier: 'advisory',
    input: 'parsed',
    commands: ['validate', 'build'],
    source: 'packages/lint/src/data-model-rules.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_ADVISORY_VOLUME,
    scopeReason:
      "`os lint` already reports this rule through `lintDataModel`, which calls it directly as R10 of " +
      'its best-practice sweep — registering it for `lint` as well would report every finding twice. ' +
      'This is coverage recorded, not coverage missing: all three commands report the rule.',
    run: (stack) =>
      lintUniqueDeclarations(Array.isArray(stack.objects) ? (stack.objects as unknown[]) : []).map((f) => ({
        severity: f.severity === 'suggestion' ? ('info' as const) : f.severity,
        rule: f.rule,
        where: f.where,
        path: f.path,
        message: f.message,
        hint: f.fix ?? '',
      })),
  },
  // ADR-0120 D5c — a declared unique listing the organization column IS the
  // hand-written per-organization composite (S6). Advisory nudge toward the
  // `'organization'` respelling, which is also what closes its NULL hole
  // (#5030). Never auto-fixed: opting in is a real D4 tightening.
  {
    name: 'lintLegacyOrganizationComposites',
    tier: 'advisory',
    input: 'parsed',
    commands: ['validate', 'build'],
    source: 'packages/lint/src/data-model-rules.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_ADVISORY_VOLUME,
    scopeReason:
      '`os lint` already reports this rule through `lintDataModel`, which calls it directly alongside ' +
      'R10/R11 in its best-practice sweep — registering it for `lint` as well would report every finding ' +
      'twice. This is coverage recorded, not coverage missing: all three commands report the rule.',
    run: (stack) =>
      lintLegacyOrganizationComposites(Array.isArray(stack.objects) ? (stack.objects as unknown[]) : []).map((f) => ({
        severity: f.severity === 'suggestion' ? ('info' as const) : f.severity,
        rule: f.rule,
        where: f.where,
        path: f.path,
        message: f.message,
        hint: f.fix ?? '',
      })),
  },
  // ADR-0090 D7 — the security-domain publish linter. Every `error` rule mirrors
  // a runtime enforcement point (fail-closed OWD default, canonical enum, anchor
  // binding gate, vocabulary freeze), moving the failure from a runtime deny to
  // an author-time fix-it. Per ADR-0049 this is not advisory security.
  //
  // [#7576] The `surfaceReason` below is MEASURED. Its predecessor was not, and
  // was false in both halves — it read: "Already gated at this surface by a
  // DIFFERENT mechanism: plugin-security registers an ADR-0094 authoring gate on
  // `object` (`registerAuthoringGate`) that enforces the same OWD posture rules
  // on every runtime write. Running the linter here as well would double-report
  // one refusal in two vocabularies."
  //
  //  - COVERAGE. `object-posture-gate.ts` reads exactly `sharingModel` and
  //    `externalSharingModel` through a local `OWD_WIDTH`, and never touches
  //    `fields`, `permissions`, `books` or `data`. Of the THIRTEEN rule ids this
  //    block carries it covers ONE — `security-external-wider-than-internal`
  //    (its R2). The gate's other half, R1 (env-tighten-only, ADR-0086 D1),
  //    corresponds to no lint rule at all, so it is not coverage in the other
  //    direction either. Twelve rules were enforced at no runtime door while
  //    this field said they were.
  //  - DOUBLE-REPORTING. It cannot happen, and not by luck: `saveMetaItem` runs
  //    `assertRuntimeAuthoringRules` (this table, 422 `invalid_metadata`) BEFORE
  //    `runAuthoringGate` (the ADR-0094 gate, 403 `owd_external_wider`), and
  //    both refuse by THROWING. The first to fire ends the write, so an author
  //    sees one refusal, never two. The stated cost of moving was imaginary; the
  //    reason it has not moved is the measured one below.
  //
  // The move IS taken now — the #7891 programme's three slices, in order:
  //
  //  - #8307: the ADR-0091 seed pair crossed (`runtimeTypes: ['seed']`), with
  //    the isolation proof that the differential cancels every finding this
  //    function derives from the sibling collections.
  //  - #8309: the snapshot repair. The gate used to carry `objects` and
  //    nothing else, so the three cross-collection rules judged a universe
  //    missing the collection they compare against (measured: 38 phantom
  //    `security-master-detail-ungranted` per-write vs 4 whole-stack,
  //    PR #7886). `RuntimeStackContext` now carries `permissions`/`books` in
  //    BOTH differential passes and `TYPE_TO_STACK_KEY` maps both types.
  //  - #8310 slice 1: `runtimeTypes` gains `permission` + `book` (PR #8546).
  //    `object` measured DIRTY on that tree and was escalated, not forced.
  //  - #8310 slice 2 (this state): `object` crosses under the maintainer
  //    ruling recorded on #8310 (2026-08-13, 「接受你的全部建议」): an
  //    authored OWD is REQUIRED at the runtime object door — an object
  //    publish with no authored `sharingModel` is refused with the 422 lint
  //    envelope (`security-owd-unset`); absence is not a decision. The ~16
  //    objectql/rest suite files that relied on OWD-less publishes were
  //    repaired honestly (fixtures author their posture), and
  //    `meta-object-owd-gate.test.ts` re-pins the door ORDER: this table
  //    answers first (`saveMetaItem` runs it before `runAuthoringGate`), the
  //    ADR-0094-seam 403 doors answer for what passes lint. The same ruling
  //    retired the plugin gate's R2 `owd_external_wider` arm as a duplicate
  //    of this door (R1 env-tighten-only STAYS — no lint rule covers it);
  //    see `object-posture-gate.ts` and the ADR-0094 amendment.
  //
  // `security-role-word` is NOT in this entry any more — that is what the
  // `validateSecurityRoleWord` entry below records. It judges six collections
  // (objects, fields, actions, permission sets, positions, apps — plus books),
  // and `positions`/`apps` are neither carried by the per-write snapshot nor
  // mapped in `TYPE_TO_STACK_KEY`, so declaring `permission`/`book` on a
  // function that still contained it would have enforced ONE rule id for a
  // strict subset of its collections: a door where a permission set named
  // `role_manager` is refused and a position named `sales_role` walks through
  // — the #7220 failure this table refuses to build, in either direction. The
  // rule therefore stays behind WHOLE (#8310's explicit call), as its own
  // entry.
  //
  // This entry remains the rest of the D7 block (12 rule ids) as ONE
  // registration, not a per-rule split: the baseline/candidate differential is
  // what keeps a write of one declared type from leaking the other rules'
  // whole-stack findings — every finding derived from a sibling collection is
  // produced byte-identically in both passes and cancels in the diff. Only
  // findings the written item itself adds are attributed to the write.
  {
    name: 'validateSecurityPosture',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-security-posture.ts',
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['seed', 'permission', 'book', 'object'],
    run: (stack) => validateSecurityPosture(stack),
  },
  // [ADR-0090 D3 / #8310] The vocabulary freeze, split out of
  // `validateSecurityPosture` the day the rest of that block crossed the
  // runtime wall — so that it could stay behind WHOLE rather than cross for
  // three of the six collections it judges (#7220: one rule id must sit on ONE
  // side of the wall). The split is a surface boundary, not taste: the rule's
  // verdict and findings are byte-identical to before on every CLI command
  // (both entries run on all three), and the runtime door does not run it for
  // ANY type.
  //
  // The road to crossing is concrete and short, recorded here so the next
  // seat prices it correctly: carry `positions`/`apps` in
  // `RuntimeStackContext` + `CONTEXT_STACK_KEYS`, map both types in
  // `TYPE_TO_STACK_KEY` (both are `allowRuntimeCreate: true`, so the writes
  // are real), then declare `runtimeTypes: ['object', 'permission', 'book',
  // 'position', 'app']` on THIS entry — all six collections in one edit, the
  // #7220 discipline satisfied.
  {
    name: 'validateSecurityRoleWord',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-security-posture.ts',
    surfaces: CLI_ONLY,
    surfaceReason:
      'P2 (#4463)/#8310: judges six collections (objects, fields, actions, permission sets, ' +
      'positions, apps — plus books), and the per-write snapshot neither carries nor maps ' +
      'positions/apps. Wiring it for the mapped types alone would enforce one rule id for three of ' +
      'its six collections — the #7220 split (an object named sales_role refused while a position ' +
      'named sales_role walks through). It crosses whole — positions/apps carried, mapped and ' +
      'declared — or stays behind; it stays behind until that wiring exists.',
    run: (stack) => validateSecurityRoleWord(stack),
  },
  // ADR-0105 D6 — the org tree is a REPORTING dimension. An RLS policy or
  // sharing rule that walks it builds a second permission hierarchy (the
  // dual-hierarchy mistake ADR-0057 D5 retired) and cannot widen Layer 0 anyway,
  // so it grants nothing it appears to.
  {
    name: 'validateOrgAxisRedLines',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-org-axis-red-lines.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateOrgAxisRedLines(stack),
  },
  // #4698 / #9698 — the "declared but never read" gate, for the two fields of a
  // sharing rule where the predicate is EXACT rather than inferred.
  //
  //  - `condition` has a single runtime consumer
  //    (`bootstrapDeclaredSharingRules`) whose only use of the key is
  //    `compileCelToFilter(condition, { variables: {} })`; a condition that
  //    does not lower means the rule is SKIPPED at boot.
  //  - `object` decides whether the grant is refused outright: reconcile hands
  //    each row to `SharingService.grant`, whose ADR-0111 D7 pre-flight THROWS
  //    `SHARING_NOT_ENABLED` when the anchor's effective sharing model is
  //    `public` or it is a `controlled_by_parent` detail. Both are decidable
  //    from authored metadata; the other arms of that verdict (`owner_id`, the
  //    bypass set, federated anchors) are not, and are excluded by name.
  //
  // Either way the grant is declared and does not exist. The lint calls the
  // same compiler and mirrors the same verdict function, from the same inputs
  // — the verdict cannot drift from the consumers'. Gating for the ADR-0078
  // reason `SharingRuleSchema`'s own docblock states: the whole authorable
  // surface is enforced, and these were the fields where that sentence was not
  // yet true.
  {
    name: 'validateSharingRuleEnforceability',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-sharing-rule-enforceability.ts',
    surfaces: CLI_ONLY,
    surfaceReason:
      'P2 (#4463): a sharing rule is not a `flow`, and P1 gates `flow` alone. This entry used to add '
      + 'that the rule reads ONLY `stack.sharingRules[].condition` and needs no other collection, so '
      + 'crossing was a lone `runtimeTypes` edit. #9698 FALSIFIED that: the anchor arm resolves '
      + '`sharingRules[].object` against `stack.objects` to read the anchor\'s OWD, so the rule is now '
      + 'cross-collection. `objects` IS carried by the per-write snapshot (`CONTEXT_STACK_KEYS`, #8309), '
      + 'so the remaining gap is unchanged in SHAPE — the gate must accept a `sharing_rule` type and the '
      + 'snapshot must carry `sharingRules`, which it does not — but it is now TWO collections, not one. '
      + 'Crossing with `sharingRules` uncarried would enforce this id for zero of its inputs while the '
      + 'entry claimed the door (#7220). Recorded as pending rather than done, because a rule that has '
      + 'never run at a door should not claim it.',
    run: (stack) => validateSharingRuleEnforceability(stack),
  },
  // #4983 — the sibling surface of the rule above, and ADR-0056 D4's gate,
  // which had never been wired to anything: `isSupportedRlsExpression` existed
  // solely so an authoring command could reject a predicate the runtime drops,
  // and no authoring command called it. An unlowerable
  // `rowLevelSecurity[].using` is DROPPED by `RLSCompiler` and — when it is the
  // only applicable policy — replaced by `RLS_DENY_FILTER`, so the policy reads
  // as an authorization and behaves as a blanket refusal. Same construction as
  // the sharing-rule entry: the verdict is the runtime's own function, reached
  // through `@objectstack/formula` (where #4983 hoisted it), never a model of it.
  {
    name: 'validateRlsPredicateEnforceability',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-rls-predicate-enforceability.ts',
    surfaces: CLI_ONLY,
    surfaceReason:
      'The rule reads `stack.permissions[]`, which the per-write snapshot DOES carry since #8309 — '
      + 'the remaining gap is only the declaration: no `runtimeTypes` names `permission` here, and that '
      + 'flip is a rollout decision on #8310\'s axis, not a wiring fix. Recorded as pending rather than '
      + 'done, because a rule that has never run at a door should not claim it.',
    run: (stack) => validateRlsPredicateEnforceability(stack),
  },
  // #4762 — the same "declared but enforces nothing" question, for the two
  // STATIC artifacts an object validation rule carries. A `format` rule's
  // `regex` that `new RegExp(...)` throws on, and a `json_schema` rule's schema
  // ajv cannot compile, are both logged and SKIPPED on the write path
  // (`rule-validator.ts`), so the rule ships, lists, and protects nothing.
  // Neither needs a record to judge, so the authoring door is the right one:
  // rejecting a broken regex at RUNTIME instead would reject every write
  // touching that field for as long as the metadata is deployed (#4762's own
  // analysis — the runtime-backstop question stays open for the maintainer).
  // Gating for the `lint-flow-patterns.ts` bar: no reading of the metadata
  // behaves as written, because the rule does not run at all.
  {
    name: 'validateRuleCompilability',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-rule-compilability.ts',
    // Runtime publish gate (#4716): the rule loads ajv LAZILY, only when the
    // judged snapshot actually carries a `json_schema` validation — so an
    // ordinary object write (no `json_schema` anywhere) still loads no
    // compiler, which `runtime-lazy-deps.test.ts` pins in both directions.
    // The load it does take (~64 ms cold once, ~15 ms warm per publish
    // carrying such a rule) is the measured, adjudicated price of refusing a
    // validation rule that would otherwise ship compiled-by-nothing.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['object'],
    run: (stack) => validateRuleCompilability(stack),
  },
  // #5178 — the residual half of #5029, which registering `ajv-formats` does
  // NOT close: under `strict: false` a MISSPELLED format name (`emial`) is
  // logged once and DROPPED, so the rule compiles, ships, runs on every write
  // and enforces nothing for the keyword its author wrote — and the record is
  // accepted, which is the silent direction. Deliberately its own entry rather
  // than a third finding inside the rule above: that one's whole contract is
  // compiling in the runtime's exact environment, and a typo'd format compiles
  // there. This judges the format NAME against the registered set (enumerated
  // from the same ajv instance, never a hardcoded list) and compiles nothing,
  // so the #4762/#5029 compile parity is untouched — a judgement beside the
  // compile, not a divergent compile. Gating for the `lint-flow-patterns.ts`
  // bar: no reading of the metadata behaves as written.
  {
    name: 'validateRuleSchemaFormats',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-rule-schema-formats.ts',
    // Runtime publish gate (#4716): crosses with its compile sibling above —
    // the two judgements over one artifact stay on one side of the wall
    // (#7220's family discipline). Same lazy-ajv contract: the registered
    // format set is only enumerated once a schema actually names a format.
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['object'],
    run: (stack) => validateRuleSchemaFormats(stack),
  },
];

// ─── Runner ─────────────────────────────────────────────────────────

/** The stack tiers a command has in hand when it runs the registry. */
export interface AuthoringRuleRun extends AuthoringRuleContext {
  /** `normalizeStackInput` output — pre-Zod-parse. Always required. */
  normalized: AnyRec;
  /**
   * Post-Zod-parse stack. Omitted by `os lint`, which does not parse; `parsed`
   * rules then read `normalized` (see `AuthoringRuleInputTier`).
   */
  parsed?: AnyRec;
}

/** The rules `command` runs, in registry order. */
export function authoringRulesFor(command: AuthoringCommand): readonly AuthoringRule[] {
  return AUTHORING_RULES.filter((r) => r.commands.includes(command));
}

/**
 * Run every rule registered for `command` and return the concatenated findings
 * (empty = clean).
 *
 * Findings are collected across ALL rules rather than short-circuiting at the
 * first failing one. The commands used to exit at the first failing gate, which
 * meant an author with three unrelated problems fixed them in three round trips
 * and could not tell how deep the hole went. One report per run is also what
 * makes the three commands comparable: same rules, same order, same output.
 */
export function runAuthoringRules(command: AuthoringCommand, run: AuthoringRuleRun): AuthoringFinding[] {
  const findings: AuthoringFinding[] = [];
  const ctx: AuthoringRuleContext = { sduiManifest: run.sduiManifest };
  for (const rule of authoringRulesFor(command)) {
    const stack = rule.input === 'normalized' ? run.normalized : (run.parsed ?? run.normalized);
    findings.push(...rule.run(stack, ctx));
  }
  return findings;
}

/** Split findings into the gating set and the advisory set (`warning` + `info`). */
export function splitBySeverity(findings: readonly AuthoringFinding[]): {
  errors: AuthoringFinding[];
  advisories: AuthoringFinding[];
} {
  return {
    errors: findings.filter((f) => f.severity === 'error'),
    advisories: findings.filter((f) => f.severity !== 'error'),
  };
}

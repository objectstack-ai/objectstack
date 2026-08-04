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
import { validateViewContainers } from './validate-view-containers.js';
import { validateWidgetBindings } from './validate-widget-bindings.js';
import { validateDashboardActionRefs } from './validate-dashboard-action-refs.js';
import { validateFilterTokens } from './validate-filter-tokens.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';
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
import { validateSecurityPosture } from './validate-security-posture.js';
import { validateOrgAxisRedLines } from './validate-org-axis-red-lines.js';
import { validateSharingRuleEnforceability } from './validate-sharing-rule-enforceability.js';
import { validateRlsPredicateEnforceability } from './validate-rls-predicate-enforceability.js';
import { validateRuleCompilability } from './validate-rule-compilability.js';
import { validateActionLocations } from './validate-action-locations.js';
import { lintFlowPatterns } from './lint-flow-patterns.js';
import { lintLivenessProperties } from './lint-liveness-properties.js';
import { lintAutonumberFormats } from './lint-autonumber-formats.js';
import { lintViewRefs } from './lint-view-refs.js';
import { lintUniqueDeclarations } from './data-model-rules.js';

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
 * - `normalized` — the `normalizeStackInput` output, BEFORE the Zod parse. The
 *   rules that need it check keys the parse strips (a flat list view in
 *   `views: []`, `userFilters` on an object list view, a `visibleOn` alias): by
 *   the time `result.data` exists the evidence is gone.
 * - `parsed` — the post-parse stack, where defaults are filled and shapes are
 *   settled.
 *
 * `os lint` never parses (it is the cheap pre-flight; a schema error is
 * `os validate`'s verdict to give), so it runs BOTH tiers on the normalized
 * stack. Every rule here is written to tolerate that — it is what `os lint`
 * already did for the reference-integrity suite and the security linter.
 */
export type AuthoringRuleInputTier = 'normalized' | 'parsed';

/** Per-run inputs a rule may need beyond the stack itself. */
export interface AuthoringRuleContext {
  /** ADR-0080 SDUI component manifest, when the project ships one. */
  sduiManifest?: unknown;
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
 * (pages, dashboards, navigation, translations, seeds, permission sets). The
 * runtime universe can answer these — it is strictly more complete than the
 * CLI's single-package view — but building that snapshot is #4463 P2, and
 * shipping the rule against a partial snapshot would invent findings for
 * metadata the tenant simply did not include in THIS write. A false 422 on the
 * only door a Studio tenant has is worse than the gap it would close.
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
 * The rule judges an OBJECT/field declaration. Object writes are the hottest
 * metadata path there is (every Studio field edit) and the blast radius of a
 * wrong 422 there is the whole product, so P1 does not gate them — the issue's
 * own worked example, and every acceptance criterion on it, is a flow.
 */
const RUNTIME_OBJECT_WRITES_P2 =
  'P2 (#4463): judges an object/field declaration. Object writes are the hottest metadata path in ' +
  'the product, so P1 gates `flow` first and widens once the gate has real traffic behind it.';

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
  // mode) are silently dropped: `ObjectListViewSchema` omits them, so this must
  // read the pre-parse tier or the evidence is already gone.
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
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_WRITES_P2,
    run: (stack) => validateFunctionalCompleteness(stack),
  },
  // A flat list-view object in `views: []` parses to an EMPTY container
  // (ViewSchema strips unknown keys): the schema step passes, zero views
  // register, and the Console renders nothing. Pre-parse for the same reason.
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
  {
    name: 'validateWidgetBindings',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-widget-bindings.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateWidgetBindings(stack),
  },
  // ADR-0049 / #3367 — a header or widget action naming a `script`/`modal`
  // target that resolves to no defined action ships a button that renders and
  // silently does nothing on click. Unresolved `url` routes stay advisory.
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
    surfaces: CLI_AND_RUNTIME,
    runtimeTypes: ['flow'],
    run: (stack) => validateReferenceIntegrity(stack),
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
  // A record-change flow whose start-node objectName matches nothing never
  // fires — silently. Reads the pre-parse tier so an author sees what they
  // wrote. Advisory: the object may come from another installed package.
  {
    name: 'validateFlowTriggerReadiness',
    tier: 'advisory',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-flow-trigger-readiness.ts',
    // Runtime publish gate (#4463): the FLOW family. Advisory at this surface
    // too — its findings are logged, not thrown (P1 gates on `error` only; P2
    // puts advisories on the response for Studio to render).
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
    surfaceReason: RUNTIME_OBJECT_WRITES_P2,
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
    surfaceReason: RUNTIME_OBJECT_WRITES_P2,
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
  // ADR-0089 D3b — deprecated visibility aliases and a mis-layered binding root.
  // Pre-parse: the schema folds `visibleOn`/`visibility` into `visibleWhen`
  // during parse, so the alias the author wrote is gone from `result.data`.
  {
    name: 'validateVisibilityPredicates',
    tier: 'advisory',
    input: 'normalized',
    commands: ALL,
    source: 'packages/lint/src/validate-visibility-predicates.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_NEEDS_FULL_SNAPSHOT,
    run: (stack) => validateVisibilityPredicates(stack),
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
    surfaceReason: RUNTIME_OBJECT_WRITES_P2,
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
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_WRITES_P2,
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
  // #3991 — a column carrying BOTH a field-level `unique: true` and a
  // single-column declared unique index has two intents, of which exactly one
  // takes effect (the global index wins; the tenant composite is unreachable).
  {
    name: 'lintUniqueDeclarations',
    tier: 'advisory',
    input: 'parsed',
    commands: ['validate', 'build'],
    source: 'packages/lint/src/data-model-rules.ts',
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_WRITES_P2,
    scopeReason:
      "`os lint` already reports this rule through `lintDataModel`, which calls it directly as R10 of " +
      'its best-practice sweep — registering it for `lint` as well would report every finding twice. ' +
      'This is coverage recorded, not coverage missing: all three commands report the rule.',
    run: (stack) =>
      lintUniqueDeclarations(Array.isArray(stack.objects) ? (stack.objects as unknown[]) : []).map((f) => ({
        severity: f.severity === 'suggestion' ? ('info' as const) : f.severity,
        rule: f.rule,
        where: f.path,
        path: f.path,
        message: f.message,
        hint: f.fix ?? '',
      })),
  },
  // ADR-0090 D7 — the security-domain publish linter. Every `error` rule mirrors
  // a runtime enforcement point (fail-closed OWD default, canonical enum, anchor
  // binding gate, vocabulary freeze), moving the failure from a runtime deny to
  // an author-time fix-it. Per ADR-0049 this is not advisory security.
  {
    name: 'validateSecurityPosture',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-security-posture.ts',
    surfaces: CLI_ONLY,
    surfaceReason: 'Already gated at this surface by a DIFFERENT mechanism: plugin-security registers an ADR-0094 '
      + 'authoring gate on `object` (`registerAuthoringGate`) that enforces the same OWD posture rules on '
      + 'every runtime write. Running the linter here as well would double-report one refusal in two '
      + 'vocabularies. Consolidating the two onto this table is P2 (#4463), and is a merge, not a hole.',
    run: (stack) => validateSecurityPosture(stack),
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
  // #4698 — the "declared but never read" gate, for the one surface where the
  // predicate is EXACT rather than inferred. A sharing rule's `condition` has a
  // single runtime consumer (`bootstrapDeclaredSharingRules`) whose only use of
  // the key is `compileCelToFilter(condition, { variables: {} })`; a condition
  // that does not lower means the rule is SKIPPED at boot, so the grant is
  // declared and does not exist. The lint calls that same compiler, from the
  // same package, with the same options — the verdict cannot drift from the
  // consumer's. Gating for the ADR-0078 reason `SharingRuleSchema`'s own
  // docblock states: the whole authorable surface is enforced, and this was the
  // one field where that sentence was not yet true.
  {
    name: 'validateSharingRuleEnforceability',
    tier: 'gating',
    input: 'parsed',
    commands: ALL,
    source: 'packages/lint/src/validate-sharing-rule-enforceability.ts',
    surfaces: CLI_ONLY,
    surfaceReason:
      'P2 (#4463): a sharing rule is not a `flow`, and P1 gates `flow` alone. The rule itself is '
      + 'snapshot-safe — it reads ONLY `stack.sharingRules[].condition` and needs no other collection — '
      + 'so widening it here is a `runtimeTypes: [\'sharing_rule\']` edit once the gate accepts that type, '
      + 'not new wiring. Recorded as pending rather than done, because a rule that has never run at a '
      + 'door should not claim it.',
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
      'P2 (#4463): the rule reads `stack.permissions[]`, a stack-wide collection the per-write snapshot '
      + 'does not carry, and P1 gates `flow` alone. It is otherwise snapshot-ready — it needs no other '
      + 'collection — so widening it is a `runtimeTypes: [\'permission_set\']` edit once the gate builds '
      + 'that snapshot, not new wiring. Recorded as pending rather than done, because a rule that has '
      + 'never run at a door should not claim it.',
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
    surfaces: CLI_ONLY,
    surfaceReason: RUNTIME_OBJECT_WRITES_P2,
    run: (stack) => validateRuleCompilability(stack),
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

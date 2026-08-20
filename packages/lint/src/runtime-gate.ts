// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The RUNTIME publish gate over the author-time rule registry (#4463).
 *
 * ## The hole this closes
 *
 * #4409/#4445 put 26 author-time rules behind one table and made `os validate`,
 * `os build` and `os lint` run it by construction. All three are CLI commands.
 * The metadata WRITE path — Studio's designer, REST `/meta` item CRUD, an
 * MCP/AI author — reaches `saveMetaItem`, which ran a per-type Zod `safeParse`
 * and nothing else. Zero of the 26 rules ran there. For a tenant that is not
 * one weak door among four, it is the ONLY door: `os lint` cannot see a
 * `sys_metadata` overlay row at all, so there was no command they could run
 * instead.
 *
 * It also happens to be the door AI authors use. That is the axis the #4463
 * ruling weighted highest: metadata written by a model is exactly the metadata
 * most likely to be subtly wrong, and it was arriving through the one entrance
 * with no checks on it.
 *
 * ## Shape
 *
 * This module is a GATE, not a rule engine. It owns no judgement: every finding
 * it returns came from {@link AUTHORING_RULES}, the same array the three CLI
 * commands run. Delete a rule from that table and this gate stops enforcing it
 * in the same commit — which is the property the issue asked for, and the
 * reason a second "runtime rule list" was never on the table.
 *
 * ## Why it evaluates DIFFERENTIALLY
 *
 * The rules are `(stack) => findings`. A runtime write is one ITEM. The gate
 * therefore builds a per-write snapshot — the written item, plus the live
 * registry's objects as resolution context — and runs the rules TWICE: once on
 * the context alone, once with the item grafted in. Only findings the item
 * ADDED are attributable to this write.
 *
 * That is not defensive padding, it is the D4 requirement made structural:
 *
 * - a tenant's existing `sys_metadata` rows may already violate a rule that did
 *   not exist when they were written, and the read path must keep serving them
 *   (ADR-0087's asymmetry). Gating on the absolute finding set would make an
 *   unrelated legacy row block every future save;
 * - the context is resolution material, not subject matter. Without the
 *   subtraction, saving flow A would 422 because object B — untouched, already
 *   stored, possibly shipped in a package — has a bad predicate.
 *
 * The cost is two passes over a small in-memory snapshot, on a PUBLISH (not on
 * a draft autosave). That is the correct place to spend it.
 */

import {
  AUTHORING_RULES,
  type AuthoringFinding,
  type AuthoringRule,
  type AuthoringRuleContext,
} from './authoring-rules.js';
import { isSystemObject } from './validate-security-posture.js';

type AnyRec = Record<string, unknown>;

/**
 * The stack-key each gated metadata type occupies in a stack view.
 *
 * Only the types some rule declares in `runtimeTypes` need an entry; the guard
 * in `authoring-rule-wiring.test.ts` fails if a declared type is missing one,
 * so widening the gate cannot half-land.
 */
const TYPE_TO_STACK_KEY: Readonly<Record<string, string>> = {
  flow: 'flows',
  object: 'objects',
  view: 'views',
  action: 'actions',
  page: 'pages',
  dashboard: 'dashboards',
  agent: 'agents',
  hook: 'hooks',
  // [#7576] `data`, NOT `seeds`. The metadata TYPE is `seed`; the stack KEY that
  // holds seeds is `data` (`ObjectStackDefinitionSchema.data: z.array(SeedSchema)`)
  // — a stack has no `seeds` key at all, and `PLURAL_TO_SINGULAR` declares no
  // mapping onto one either.
  //
  // The wrong spelling was INERT rather than harmless, and it is the #4449 shape
  // one surface over: the wiring guard asks only that a declared type HAS a
  // mapping, never that the mapping names a key some rule reads. So it would
  // have stayed green while the gate built `{ objects, seeds: [item] }` for
  // every seed write and every rule reading `stack.data` saw nothing — wired,
  // and running on nothing, with `rulesRun` reporting the rules as having run.
  // Nothing declared `seed` in `runtimeTypes` at the time, so correcting it
  // changed no behaviour then; it was corrected here, with the measurement
  // that found it (#7576), rather than left for the rollout card to trip
  // over. The ADR-0091 seed pair now DOES declare `seed` (#8307), so this
  // mapping is load-bearing today, not merely inert-and-correct.
  seed: 'data',
  // [#8309] `permission`/`book` map ahead of their registration (#8310), the
  // same order `seed` arrived in: the mapping plus the enriched snapshot below
  // are this card's halves, and the `runtimeTypes` flip is deliberately NOT —
  // a mapping without a declaring rule is inert by construction (the gate
  // filters by `runtimeTypes` before it ever consults this table), while a
  // declaration without the mapping is the wired-onto-nothing state the wiring
  // guard refuses. Landing the mapping first keeps #8310 a registry data edit.
  permission: 'permissions',
  book: 'books',
};

/**
 * Everything the gate needs from the host runtime to build a snapshot.
 *
 * [#8309] Each key here doubles as the stack key the collection occupies in
 * the per-write snapshot — see {@link CONTEXT_STACK_KEYS}, which is derived
 * from this shape and keeps the two from drifting. The set is deliberately
 * BOUNDED to what the runtime-wired rules actually read (measured, not
 * projected): the three cross-collection security rules compare
 * objects × permissions × books, `validateWidgetBindings` resolves widget
 * bindings against datasets (#7529), and nothing on the runtime surface reads
 * `positions` / `apps` — so those are NOT carried. Widening the snapshot is a
 * one-key edit here plus a `CONTEXT_STACK_KEYS` entry, made when a rule that
 * reads the collection actually crosses the wall, never in advance.
 */
export interface RuntimeStackContext {
  /**
   * The live object declarations (registry + tenant overlay), as authored.
   *
   * Objects are the resolution universe almost every rule needs: `record.<field>`
   * in a CEL predicate, a flow node's target object, a template path. This is
   * where the runtime is strictly BETTER informed than `os lint`, which sees one
   * package's config file and has to hedge.
   */
  objects?: readonly unknown[];
  /**
   * The live permission-set declarations (stack key `permissions`).
   *
   * [#8309] The collection the three cross-collection security rules compare
   * against. Without it a per-write snapshot holds exactly ONE permission set
   * (the written item), so `security-master-detail-ungranted` reads every
   * detail object the tenant's OTHER sets grant as ungranted — measured as 38
   * phantom findings per-write vs 4 whole-stack over the shipped corpus
   * (PR #7886). `security-book-audience-unknown-set` needs the set NAMES to
   * resolve a book's `audience.permissionSet` for the same reason.
   */
  permissions?: readonly unknown[];
  /**
   * The live documentation-book declarations (stack key `books`).
   *
   * [#8309] Carried so a `book` write is judged with its siblings present and
   * replace-not-erase semantics apply to it (an updated book must not read as
   * a second book of the same name), and so book-derived findings cancel in
   * the differential for every other write type.
   */
  books?: readonly unknown[];
  /**
   * The live dataset declarations (stack key `datasets`).
   *
   * [#7529] The resolution universe `validateWidgetBindings` links a widget's
   * `dataset` / `dimensions` / `values` against. Without it a per-write
   * dashboard snapshot holds no datasets at all, so every widget on a fully
   * legitimate board reads as dangling — measured as 3 phantom
   * `widget-dataset-unknown` errors on a 3-widget board bound to a real
   * dataset, vs 0 with the collection carried (and the genuinely dangling
   * binding still yields exactly its 1 true error). Carrying it in BOTH
   * passes also cancels dataset-level findings (`measure-aggregate-incoherent`
   * is judged per dataset, independent of any widget) in the differential, so
   * a stored dataset's pre-existing condition is not this write's to answer
   * for (#4463 D4).
   */
  datasets?: readonly unknown[];
}

/**
 * Which package a write belongs to, and what that package is allowed to reach.
 *
 * [#9612] The maintainer's ruling, verbatim, is the product decision this type
 * exists for:
 *
 * > 大客户(420 个对象),就不应该出现在一个软件包中啊,这就是划分软件包的价值。
 * > 客户开发开发,校验是否也应该基于软件包
 * > 当然这里面要考虑系统对象
 *
 * A tenant that has grown to 420 objects is not ONE package — it is many — and
 * judging one package's write against all 420 is validating against the wrong
 * unit, not merely validating slowly. A package's declared `dependencies`
 * bound what it MAY reference, so `package + declared deps + platform/system`
 * is a closure the platform computes EXACTLY rather than estimates. That is
 * what separates this from "narrow to whatever the rule can be proven to
 * reach", which was considered and refused: a per-rule proof is a second
 * opinion that drifts the moment a rule changes.
 *
 * ⛔ Absent — or carrying a package whose dependency declaration cannot be
 * read — narrows NOTHING. The whole collection is handed over, exactly as
 * before. The fallback direction is deliberate and is the opposite of a size
 * threshold: an unknown provenance buys MORE validation input, never less, so
 * the gate never stops judging (the #9798 / #9261 / ADR-0110 D3 fail-open
 * shape this card was explicitly forbidden from re-creating).
 */
export interface RuntimePackageScope {
  /** The package the written item belongs to. */
  packageId: string;
  /**
   * Every OTHER package this one may reference — the transitive closure of the
   * written package's declared `dependencies`. Resolved by the host, which is
   * the side that holds the package registry; this module only reads the set.
   */
  dependencies: readonly string[];
}

/**
 * `objects` reduced to the written item's package closure (#9612).
 *
 * An object survives when ANY of these holds — the four limbs are the closure
 * the ruling names, and each one is load-bearing:
 *
 *  1. it is a **platform / system object** ({@link isSystemObject}, imported
 *     rather than re-decided). ⛔ Unconditional: a package legitimately
 *     references `sys_*` objects it never declares a dependency on, and a
 *     closure that dropped them would manufacture "unresolved reference"
 *     findings that describe nothing — the false-positive class PR #7886
 *     already paid for on the `permissions` collection;
 *  2. it carries **no package provenance** — a tenant-authored overlay row.
 *     Nothing declares what such a row may reference, so nothing bounds it and
 *     it is kept. Conservative by construction;
 *  3. it belongs to the **written package** itself;
 *  4. it belongs to one of that package's **declared dependencies**.
 *
 * Pure, allocation-light, and total: a non-object member is kept rather than
 * inspected, because deciding it is not this function's job.
 */
export function narrowObjectsToPackageClosure(
  objects: readonly unknown[],
  scope: RuntimePackageScope | undefined,
): readonly unknown[] {
  if (!scope || typeof scope.packageId !== 'string' || scope.packageId === '') return objects;
  const reachable = new Set<string>([scope.packageId, ...scope.dependencies]);
  return objects.filter((entry) => {
    if (!entry || typeof entry !== 'object') return true;
    const owner = (entry as AnyRec)[PACKAGE_PROVENANCE_KEY];
    // Limb 2 — no provenance, or the registry's rehydration sentinel, which
    // marks an overlay row rather than a real package (`registry.ts`'s
    // `isArtifactBacked` reads it the same way).
    if (typeof owner !== 'string' || owner === '' || owner === OVERLAY_PROVENANCE_SENTINEL) return true;
    // Limbs 3 and 4.
    if (reachable.has(owner)) return true;
    // Limb 1 — checked last only because it is the rarest, never because it is
    // the weakest: it is the one limb with no escape.
    return isSystemObject(entry as AnyRec);
  });
}

/**
 * The provenance key the registry stamps an item's owning package onto.
 * `registry.ts` writes it (`_packageId = this.getObjectOwner(fqn)?.packageId`)
 * and `listItems` tags with it, which is why the closure can be read off the
 * collection the host already hands over instead of needing a second lookup.
 */
const PACKAGE_PROVENANCE_KEY = '_packageId';

/**
 * The value `_packageId` carries for a row rehydrated from `sys_metadata`
 * rather than delivered by a package. Not a package id — `registry.ts` tests
 * for exactly this string before treating an item as artifact-backed — so the
 * closure reads it as "unpackaged" (limb 2) rather than as a package nobody
 * declared a dependency on.
 */
const OVERLAY_PROVENANCE_SENTINEL = 'sys_metadata';

/**
 * The context collections the snapshot carries, in stack-key order. Derived
 * facts: every entry is a key of {@link RuntimeStackContext} AND a stack key
 * some runtime-wired rule reads (`runtime-gate.test.ts` pins membership).
 */
const CONTEXT_STACK_KEYS = ['objects', 'permissions', 'books', 'datasets'] as const satisfies
  readonly (keyof RuntimeStackContext)[];

/** One rule's verdict at the runtime surface, carrying which rule produced it. */
export interface RuntimeGateResult {
  /** Findings the written item ADDED, severity `error` — the reason to refuse the write. */
  errors: AuthoringFinding[];
  /** Findings the written item added at `warning` / `info`. Never blocks (#4463 P1). */
  advisories: AuthoringFinding[];
  /** Names of the registry rules that actually ran, in registry order. */
  rulesRun: string[];
}

/**
 * The rules the runtime publish gate runs for a write of `type` — read off
 * {@link AUTHORING_RULES}, never a list of its own.
 *
 * @param type Singular metadata type name (`flow`, `object`, …).
 */
export function runtimeAuthoringRulesFor(type: string): readonly AuthoringRule[] {
  return AUTHORING_RULES.filter(
    (r) => r.surfaces.includes('runtime-publish') && (r.runtimeTypes ?? []).includes(type),
  );
}

/** Every singular metadata type at least one rule gates at the runtime surface. */
export function runtimeGatedTypes(): string[] {
  const types = new Set<string>();
  for (const rule of AUTHORING_RULES) {
    if (!rule.surfaces.includes('runtime-publish')) continue;
    for (const t of rule.runtimeTypes ?? []) types.add(t);
  }
  return [...types].sort();
}

/** The stack key a metadata type occupies in a stack view, or null when unmapped. */
export function stackKeyForType(type: string): string | null {
  return TYPE_TO_STACK_KEY[type] ?? null;
}

/** Stable identity of a finding, so two rule passes can be set-differenced. */
const fingerprint = (f: AuthoringFinding) => `${f.rule}\u0000${f.where}\u0000${f.path}\u0000${f.message}`;

/**
 * The baseline/candidate stack pair the gate judges one write against, or
 * `null` when no snapshot can be built (unmapped type, non-object body).
 *
 * Exported (#8309) so the tests that measure per-write vs whole-stack
 * agreement exercise the REAL construction instead of a hand-kept mirror —
 * `validate-security-posture.runtime-surface.test.ts` used to mirror this
 * logic in a local `wouldGateAdd`, which is exactly the drift surface a
 * snapshot change here would have missed.
 *
 * Shape:
 * - The baseline carries every context collection ({@link CONTEXT_STACK_KEYS})
 *   WITHOUT the written item. Anything found there is somebody else's
 *   pre-existing condition and is not this write's to answer for (#4463 D4 —
 *   the gate blocks new writes, never stored rows). Carrying the sibling
 *   collections in BOTH passes is what makes their findings cancel in the
 *   diff — and what gives the cross-collection rules the sibling collection
 *   they compare against, so the per-write verdict agrees with the
 *   whole-stack one instead of inventing findings (the 38-vs-4 measurement,
 *   PR #7886).
 * - The candidate is the same context with this write's item added. When the
 *   written type IS one of the context collections (an `object`, `permission`
 *   or `book` write), the item REPLACES its stored self rather than appearing
 *   beside it — otherwise an update reads as a duplicate name, and for
 *   `objects` every lookup in the tenant's model would read as dangling. For
 *   any other type the item is the sole member of its own collection, so
 *   index-0 paths in the findings are unambiguously this write.
 *
 * Cost (the #4463 D2 question, measured rather than assumed): built per
 * write, never cached. The construction is one filter + one spread over the
 * written type's collection; the sibling collections are passed by reference.
 * Over the shipped corpus (30 objects, 10 permission sets, 1 book) that is
 * microseconds on a PUBLISH (never a draft autosave, D1) — a cache would buy
 * nothing and would need cross-org invalidation the gate has no seam for.
 */
export function buildRuntimeWriteSnapshots(args: {
  /** Singular metadata type of the item being written. */
  type: string;
  /** The item body as it will be persisted. */
  item: unknown;
  /** Live resolution context from the host runtime. */
  context?: RuntimeStackContext;
  /**
   * [#9612] The written item's package and what it may reach. Omitted — or
   * carrying a package whose dependencies the host could not read — hands the
   * rules the WHOLE `objects` collection, exactly as before.
   */
  packageScope?: RuntimePackageScope;
}): { baseline: AnyRec; candidate: AnyRec } | null {
  const stackKey = stackKeyForType(args.type);
  if (!stackKey) return null;
  if (!args.item || typeof args.item !== 'object') return null;

  const item = args.item as AnyRec;
  const itemName = typeof item.name === 'string' ? item.name : undefined;

  const baseline: AnyRec = {};
  for (const key of CONTEXT_STACK_KEYS) {
    // [#9612] `objects` — and only `objects` — is reduced to the written
    // item's package closure. The other three collections are already bounded
    // by what a tenant authors (permission sets, books, datasets), and the
    // measured bill is entirely in what the rules walk over `objects`.
    //
    // ⭐ Narrowing here rather than at either call site is what makes this ONE
    // change covering BOTH doors: every gated write type is built through this
    // function, so a flow publish and an object publish are narrowed by the
    // same rule and cannot drift into two policies.
    //
    // ⛔ Applied to BOTH passes, necessarily. The gate's verdict is
    // candidate MINUS baseline, so narrowing one side and not the other would
    // not be a smaller input — it would be a different question.
    const raw = (args.context?.[key] ?? []) as readonly AnyRec[];
    const collection = key === 'objects'
      ? (narrowObjectsToPackageClosure(raw, args.packageScope) as readonly AnyRec[])
      : raw;
    baseline[key] = key === stackKey
      ? collection.filter((o) => !itemName || o?.name !== itemName)
      : collection;
  }
  const candidate: AnyRec = {
    ...baseline,
    [stackKey]: [...((baseline[stackKey] as readonly AnyRec[] | undefined) ?? []), item],
  };
  return { baseline, candidate };
}

function runRules(
  rules: readonly AuthoringRule[],
  stack: AnyRec,
  ctx: AuthoringRuleContext,
): AuthoringFinding[] {
  const findings: AuthoringFinding[] = [];
  for (const rule of rules) {
    // A rule that throws on an unexpected runtime body must not take the write
    // down with it: the gate's job is to REFUSE bad metadata, and an internal
    // error is not a verdict about the author's document. Surfaced as a
    // warning-tier finding so it is neither silent nor fatal.
    try {
      findings.push(...rule.run(stack, ctx));
    } catch (err) {
      findings.push({
        severity: 'warning',
        rule: 'authoring-rule-threw',
        where: rule.name,
        path: rule.source,
        message: `rule ${rule.name} threw while judging this write: ${err instanceof Error ? err.message : String(err)}`,
        hint:
          'This is a bug in the rule, not in the metadata — the write was not blocked by it. '
          + 'Please report it with the body that triggered it.',
      });
    }
  }
  return findings;
}

/**
 * Judge one about-to-be-published metadata item against the shared registry.
 *
 * Returns an empty `errors` array when the item is clean OR when no rule gates
 * its type — callers must not treat "no rules ran" as a failure, and
 * `rulesRun` is there so a caller can tell the two apart.
 *
 * Pure: no I/O, no `process.env`, no logging. The escape hatch and the HTTP
 * status live at the call site, where the request context is.
 */
export function runRuntimeAuthoringRules(args: {
  /** Singular metadata type of the item being written. */
  type: string;
  /** The item body as it will be persisted. */
  item: unknown;
  /** Live resolution context from the host runtime. */
  context?: RuntimeStackContext;
  /**
   * [#9612] The written item's package closure. Omit to judge against the
   * whole collection — the pre-#9612 behaviour, and the behaviour every caller
   * that cannot state a package keeps.
   */
  packageScope?: RuntimePackageScope;
  /** ADR-0080 SDUI manifest, when the host has one. */
  sduiManifest?: unknown;
}): RuntimeGateResult {
  const rules = runtimeAuthoringRulesFor(args.type);
  const empty: RuntimeGateResult = { errors: [], advisories: [], rulesRun: [] };
  if (rules.length === 0) return empty;

  // The baseline/candidate construction — replace-not-erase for a write into
  // a context collection, the written item as sole member of its own
  // collection otherwise, every context collection present in BOTH passes so
  // sibling-derived findings cancel in the diff. See the builder's own
  // docblock; it is exported precisely so tests exercise this construction
  // and not a mirror of it.
  const snapshots = buildRuntimeWriteSnapshots({
    type: args.type,
    item: args.item,
    ...(args.context !== undefined ? { context: args.context } : {}),
    ...(args.packageScope !== undefined ? { packageScope: args.packageScope } : {}),
  });
  if (!snapshots) return empty;

  // [#9313] `runtimeWriteType` tells a registry-of-registries entry (the
  // reference-integrity suite) which per-write snapshot it is judging, so it
  // can dispatch its MEMBERS as this gate dispatches entries. CLI callers
  // never set it; see `AuthoringRuleContext`.
  const ctx: AuthoringRuleContext = { sduiManifest: args.sduiManifest, runtimeWriteType: args.type };
  const before = new Set(runRules(rules, snapshots.baseline, ctx).map(fingerprint));
  const added = runRules(rules, snapshots.candidate, ctx).filter((f) => !before.has(fingerprint(f)));

  return {
    errors: added.filter((f) => f.severity === 'error'),
    advisories: added.filter((f) => f.severity !== 'error'),
    rulesRun: rules.map((r) => r.name),
  };
}

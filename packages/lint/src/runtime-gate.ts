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
 *
 * [#13390] The VALUES here are also one of the two inputs
 * {@link NAME_KEYED_STACK_KEYS} is derived from — a stack key that some write
 * type maps into is a key whose top-level index the caller cannot resolve. Adding
 * a mapping onto a context collection therefore name-keys it by construction; it
 * is no longer a second edit that nothing checks.
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
  // [#19143] `dataset` — the ADR-0049 declared-not-enforced shape this table
  // was one half of. `DEFAULT_METADATA_TYPE_REGISTRY` declares the type
  // `allowRuntimeCreate: true`, so Studio, REST `/meta` and an MCP/AI author
  // may all mint one at runtime; nothing declared it in `runtimeTypes` and no
  // row stood here, and the two absences were CONSISTENT rather than
  // contradictory (the gate filters by `runtimeTypes` before it consults this
  // table, per the `permission`/`book` note above). What they summed to is
  // that a dataset write built no snapshot and dispatched no rule at all.
  //
  // ⛔ NOT a mapping ahead of its rules — that is the failure the `seed: 'data'`
  // note above records. The key is `datasets`, the collection
  // {@link RuntimeStackContext} already carries, and the rules crossed with
  // this row in the same commit READ it: `validateDatasetReferences` and
  // `validateDatasetMeasureAggregates` both open with
  // `recordsOf(stack.datasets)`, and `validateObjectReferences` walks
  // `datasets[].object`. The door controls that prove each one fires live in
  // `runtime-gate.dataset-writes.test.ts`.
  dataset: 'datasets',
  // [#19542] The three rows the ADR-0049 ruling 「declared ⇒ honoured; not
  // honourable ⇒ retired」 needs for its groups A and C. `action` and `hook`
  // above were already here and INERT — the gate filters by `runtimeTypes`
  // before it consults this table, so a row with no declaring rule dispatches
  // nothing — and the same ruling crosses their rules in this commit, which is
  // what lights those two rows rather than any edit to them.
  //
  // ⛔ NOT mappings ahead of their rules (the `seed: 'data'` failure above).
  // Each key below names a collection some rule crossed in THIS commit reads
  // with the written item as the finding's SUBJECT:
  //
  // - `reports` — `validatePresetComparands` and `validateEmptyCombinators`
  //   scan it as a first-class authored-filter surface (`{ key: 'reports',
  //   kind: 'report' }`), and the suite member `validateChartBindings` opens
  //   with `recordsOf(stack.reports)` and resolves each report's dataset
  //   binding against `stack.datasets`, a collection the snapshot carries.
  // - `emailTemplates` / `mappings` — `lintLivenessProperties` walks them
  //   through its own `TYPE_COLLECTIONS` rows, with `checkItem(type, item, …)`
  //   making the written item the subject. ⚠️ That rule is LEDGER-DRIVEN and
  //   `continue`s on an empty warn map: both ledgers carry 0 warn keys today,
  //   so these two rows are wired-and-silent BY CONSTRUCTION until a property
  //   needs a row. The ruling dispatched the wiring and ⛔ no ledger
  //   population («the empty warn maps stay empty until a real property needs
  //   a row»), so this is the ruled end state, not a half-landing.
  //
  //   ⚠️ Read the size of that proof honestly, because it is smaller than the
  //   others on this table: since those two rules judge NOTHING at this door,
  //   no behavioural case can tell a right key from a wrong one, and a
  //   `mapping: 'mapping'` typo — the `seed: 'data'` shape exactly — leaves
  //   every group C door case GREEN. What catches it is one string assertion,
  //   `each stack key is the collection the crossed rules actually read` in
  //   `runtime-gate.inert-type-writes.test.ts`, measured by ablating both keys.
  //   A table pin, not a door reading. ⛔ Do not delete that assertion as
  //   redundant with the door cases — for these two rows it is the only proof.
  //
  // ⛔ `skill` is deliberately NOT here, and its absence is a measured reading
  // rather than an omission — see the `validateAiToolReferences` member in
  // `reference-integrity-suite.ts`, which carries the measurement and the
  // reason, and the DARK pin that holds this row absent.
  report: 'reports',
  email_template: 'emailTemplates',
  mapping: 'mappings',
  // [#19143 above, #19370 here] `position` / `app` — the two collections only
  // `security-role-word` judges. They arrive together with that rule's
  // crossing, never ahead of it: `DEFAULT_METADATA_TYPE_REGISTRY` declares both
  // `allowRuntimeCreate: true`, so Studio's app designer, REST `/meta` and an
  // MCP/AI author all mint them at runtime, and until the rule declared them a
  // position named `sales_role` walked through the one door a tenant has while
  // an object of that name was refused. `validateSecurityRoleWord` READS
  // `stack.positions` and `stack.apps` — it opens on `objects` /
  // `permissions` and reaches these two further down — so the keys named here
  // are keys a crossed rule really consults, not the `seed: 'data'` shape.
  //
  // ⛔ NOT accompanied by a `RuntimeStackContext` row, and that asymmetry is
  // the measured answer rather than a half-landing. A collection joins the
  // CONTEXT because some rule RESOLVES REFERENCES INTO IT (objects, the three
  // cross-collection security rules' `permissions`/`books`, widget bindings'
  // `datasets`); the vocabulary freeze resolves nothing — it judges each
  // identifier and label on its own, so a sibling position tells it nothing
  // about the written one. Carrying them would be inert twice over: a
  // sibling's finding is produced byte-identically in both differential passes
  // and cancels, and a write's own collection already holds exactly one member
  // — its own item — so `positions[0]` IS this write and name-keying it would
  // say nothing the index does not (the `pages` reading in
  // `runtime-gate.derived-name-keys.test.ts`). Eleven of the fifteen mappings
  // above name a non-context key for the same reason — counted off this table,
  // where only `objects`, `permissions`, `books` and `datasets` are context
  // collections. (This sentence read «eight of the twelve» when the card that
  // added the two rows above wrote it. That card is numbered 19370 — written
  // WITHOUT the citation sigil on purpose, because it NO LONGER RESOLVES: it
  // and its PR were filed by an account since banned, so both answer 404 while
  // their work is landed and unaffected. A dead number dressed as a live link
  // is the dangling reference `check:issue-citations` exists to refuse, so it
  // is spelled as what it is: a historical card id. The live record is the
  // merge commit `a227afa415f596269ed36aae0a0631c84270ccc9`, which carries
  // that card's whole diff and is where its reasoning can still be read.
  // ⛔ Do not re-point it at a rebuild — unlike its sibling below it has none,
  // and guessing an upstream is how a dangling reference becomes a wrong one.
  //
  // «eight of the twelve» was true of the table it was written against;
  // #19542's three rows landed in the same merge, so the count is restated
  // against the merged table rather than left describing a table nobody has.
  // It was briefly restated as «twelve of the sixteen», counted while #19542
  // still carried a fourth row for `skill` — that row was withdrawn and the
  // count with it. The reasoning the sentence carries is unchanged throughout,
  // and the figure is arithmetic over the rows above: ⛔ recount them rather
  // than adjusting it.)
  // ⛔ Do not add a context row
  // "for symmetry": `RuntimeStackContext`'s set is bounded by what the wired
  // rules RESOLVE (measured, not projected), and every member of it costs the
  // publish door one indexed `sys_metadata` read per write.
  position: 'positions',
  app: 'apps',
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
 * bindings against datasets (#7529). Widening the snapshot is a one-key edit
 * here plus a `CONTEXT_STACK_KEYS` entry, made when a rule that RESOLVES
 * REFERENCES INTO the collection actually crosses the wall, never in advance.
 *
 * [#19370] `positions` / `apps` are the measured limit of that sentence, and
 * the reason it now says RESOLVES rather than reads. `security-role-word`
 * crossed the wall reading both collections, and they are still not carried:
 * the rule judges each identifier and label on its own, so the universe it
 * needs for a position write is the written position, which
 * {@link TYPE_TO_STACK_KEY} supplies by mapping the type. A context row would
 * add a sibling whose finding is produced byte-identically in both
 * differential passes and cancels — inert, at one indexed `sys_metadata` read
 * per publish for each collection added. The full argument, and the ⛔ that
 * goes with it, lives on those two rows of the mapping table.
 *
 * [#13977] "Derived from this shape" is now the mechanism and not only the
 * intent: the second half of that edit is DEMANDED by the compiler rather than
 * remembered. Add a key here and this package stops building until the
 * collection has its row below — see {@link CONTEXT_STACK_KEYS} for what the
 * old `satisfies` clause could not ask, and what silently happened when the
 * row was forgotten.
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
   *
   * [#19143] Since `dataset` joined {@link TYPE_TO_STACK_KEY} this collection is
   * also the one a DATASET write lands inside, with the same replace-not-erase
   * semantics `objects` / `permissions` / `books` already had — so an updated
   * dataset is not read as a second dataset of its own name. The cancellation
   * described above is unchanged and is what keeps a stored dataset's condition
   * off an unrelated publish; it is now also what keeps the tenant's OTHER
   * datasets off this one.
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
 * The context collections the snapshot carries, in stack-key order — DERIVED
 * from {@link RuntimeStackContext}, not listed (#13977).
 *
 * ## What the spelling this replaces could not ask
 *
 * It was a hand-written literal carrying `as const satisfies readonly (keyof
 * RuntimeStackContext)[]`. That clause asks that every entry it NAMES is a real
 * context key — validity. It does not ask that every context key HAS an entry —
 * completeness, which the docblock on {@link RuntimeStackContext} nevertheless
 * claimed ("derived from this shape and keeps the two from drifting"). Declared,
 * not enforced.
 *
 * The cost was not a missing member, it was a WRONG VERDICT.
 * {@link buildRuntimeWriteSnapshots} fills the snapshot by iterating this set, so
 * a collection declared on the interface and absent here is never carried: the
 * host passes it in, the gate drops it, and every rule resolving references into
 * that collection judges a universe that is empty — findings that look correct
 * against something that is not there (the `shyx_customer_ds` shape). Measured
 * before this card: adding `widgets?: readonly unknown[]` to the interface and
 * rebuilding left `pnpm --filter @objectstack/lint build` at **exit 0** with
 * nothing in this package red. The only red was second-order and one package
 * over — `protocol.ts`'s `-?` accumulator in `@objectstack/metadata-protocol`,
 * about a different constant, naming this one nowhere. The same asymmetry #13390
 * removed from `NAME_KEYED_STACK_KEYS` and #13768 from
 * `CLOSURE_CONTEXT_KEY_BY_TYPE`.
 *
 * ## Why a keyed record, and why that is a derivation rather than an assertion
 *
 * A type's keys cannot be materialised as values, so the derivation needs
 * exactly one runtime spelling to derive FROM, and the job is to make that
 * spelling impossible to leave incomplete. {@link CONTEXT_STACK_KEY_ORDER} is
 * that spelling and the mapped type pins it in BOTH directions: `-?` over `keyof
 * RuntimeStackContext` demands a row per collection (a missing one is a type
 * error naming the collection, in this file, at `tsc --noEmit` and at the DTS
 * build), and the object-literal excess-property check refuses a row for a
 * collection the interface no longer has. The array is then computed, so it
 * cannot disagree with the record.
 *
 * That is `protocol.ts`'s `-?` accumulator, the mechanism this repo already
 * proves. #13768 had to settle for a completeness ASSERTION beside its constant
 * only because the type lived one package away and the set was not readable
 * there as a value; here both inputs are in this file, so the stronger shape is
 * available and is what ships.
 *
 * ## Order is load-bearing, so the derivation preserves it (measured, #13977)
 *
 * The order this encodes reaches two places, and it was worth measuring before
 * choosing a spelling — a mapped type does not guarantee declaration order:
 *
 * - **The snapshot's own key order.** The loop in
 *   {@link buildRuntimeWriteSnapshots} inserts in this order, so it is what
 *   `Object.keys(baseline)` yields — read as a VALUE by
 *   `runtime-gate.derived-name-keys.test.ts`, which feeds it to
 *   {@link deriveNameKeyedStackKeys} and asserts an ORDERED result.
 * - **The derived alternation.** {@link deriveNameKeyedStackKeys} filters in
 *   context order by contract ("Order follows `contextStackKeys`, deliberately"),
 *   and {@link buildTopLevelIndexPattern} interpolates that order into
 *   {@link TOP_LEVEL_INDEX}. Reordering does not change what the pattern MATCHES
 *   — the `\[` anchor defeats prefix shadowing, pinned in both orders — but it
 *   does change the pattern's `source`, which #13390 keeps byte-identical to the
 *   literal it replaced on purpose.
 *
 * So the requirement is: preserve the author's order. This spelling does, and
 * that is the reason it is a keyed record rather than any union-to-tuple trick:
 * `Object.keys` returns own enumerable string keys in declaration order
 * (ECMAScript `OrdinaryOwnPropertyKeys`), so the order below IS the stack-key
 * order, chosen here and readable here. Integer-like keys would sort ahead of
 * insertion order, which is why that rule is stated rather than assumed — a
 * stack key is an interface property name and never one of those.
 *
 * Ordering is pinned by `runtime-gate.derived-context-keys.test.ts` end to end,
 * because the pre-existing ordered pin could not see all of it: it filters
 * `datasets` out (no write type maps into it), so swapping `datasets` with a
 * neighbour left that assertion green.
 */
const CONTEXT_STACK_KEY_ORDER = {
  objects: true,
  permissions: true,
  books: true,
  datasets: true,
} as const satisfies { [K in keyof RuntimeStackContext]-?: true };

/**
 * The context collections the snapshot carries, in stack-key order. Derived
 * facts: every entry is a key of {@link RuntimeStackContext} AND a stack key
 * some runtime-wired rule reads (`runtime-gate.test.ts` pins membership);
 * every key of {@link RuntimeStackContext} has an entry (#13977 — the record
 * above, held by the compiler).
 *
 * `Object.keys` types as `string[]`, so the read-back is asserted. It is the one
 * assertion in the derivation and it is sound by construction: the record is
 * compiler-pinned to exactly `keyof RuntimeStackContext`, and `Object.keys`
 * returns exactly that record's own enumerable string keys. ⛔ Do not widen this
 * back into a literal — the list would stop being derived and the interface
 * would stop being the single source it says it is.
 */
const CONTEXT_STACK_KEYS = Object.keys(CONTEXT_STACK_KEY_ORDER) as readonly (keyof RuntimeStackContext)[];

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
    // item's package closure. The other collections are already bounded
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

/**
 * The name-keyed stack keys implied by a context shape and a write-type table:
 * the context collections that some write type ALSO lands an item inside.
 *
 * Exported (#13390) as a pure function of its two inputs so the derivation can
 * be exercised on SYNTHETIC sets. The real inputs are four keys that agree with
 * the list they replaced, which shows the answer is right today and cannot show
 * that the DERIVATION is the reason — the property this card buys is about the
 * next widening, so it has to be measured on inputs that widen.
 *
 * Order follows `contextStackKeys`, deliberately: it keeps the derived value
 * comparable to the hand list it replaced position for position, and it keeps
 * the pattern built from it byte-identical to the literal it replaced.
 */
export function deriveNameKeyedStackKeys(
  contextStackKeys: readonly string[],
  writtenStackKeys: Iterable<string>,
): readonly string[] {
  const written = new Set(writtenStackKeys);
  return contextStackKeys.filter((key) => written.has(key));
}

/**
 * `['objects', 'pages']` → `/^(objects|pages)\[(\d+)\](.*)$/` — the top-level
 * index matcher, BUILT from the name-keyed set instead of restating it (#13390).
 *
 * A derived alternation has two hazards a hand-written literal did not, and both
 * are decided here rather than left implicit:
 *
 * - **Escaping.** Every member today is `[a-z]+`, so nothing needs escaping and
 *   nothing would notice if it were skipped. But a stack key is a
 *   {@link RuntimeStackContext} property name, and a quoted one may hold a `.`
 *   or a `-`; an unescaped `.` matches ANY character, which is the silent-failure
 *   direction. Members are escaped rather than trusted — one `replace`.
 * - **Prefix ordering.** Alternation is ordered, so `page|pages` reads as though
 *   the short branch shadows the long one. It does not in THIS pattern: the group
 *   is anchored by `\[`, which fails the short branch and forces the engine to
 *   backtrack into the long one. That is a property of the anchor, not of
 *   alternation — so it is pinned by test with a synthetic `page` / `pages` pair
 *   in BOTH orders, rather than papered over with a longest-first sort that would
 *   silently stop being exercised and would leave the claim untested either way.
 *
 * An empty set yields a pattern matching nothing. Interpolating it would produce
 * `^()\[(\d+)\](.*)$`, which name-keys EVERY top-level index — the failure
 * direction that widens the rewrite instead of narrowing it.
 */
export function buildTopLevelIndexPattern(stackKeys: readonly string[]): RegExp {
  if (stackKeys.length === 0) return /(?!)/;
  const alternation = stackKeys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^(${alternation})\\[(\\d+)\\](.*)$`);
}

/**
 * The stack keys some write type lands an item INSIDE — the VALUES of
 * {@link TYPE_TO_STACK_KEY}, read off the table rather than restated, so a new
 * `type → key` mapping cannot arrive without this set seeing it.
 *
 * Exported for the pin in `runtime-gate.derived-name-keys.test.ts` and for that
 * only — it is not on either package entry. The pin asks, per context
 * collection, whether a top-level index is name-keyed, and it must ask that
 * against the SAME table the gate uses; a test that restated the answer would
 * be a sixth hand-written spelling of the very set this card removed.
 */
export const WRITTEN_STACK_KEYS: ReadonlySet<string> = new Set(Object.values(TYPE_TO_STACK_KEY));

/**
 * The collection-resident stack keys whose TOP-LEVEL index the gate rewrites
 * to a name key before findings leave it (#10064) — DERIVED, not listed (#13390).
 *
 * These are the collections a written item lands INSIDE **and** that the
 * context also fills — so a finding's `objects[417]` is an offset into this
 * gate's per-write snapshot, an in-memory array the caller has never seen and
 * cannot enumerate. Every other write type is the sole member of its own
 * collection (`flows[0]` IS this write, trivially stable), and a context-only
 * collection holds no write at all — so both keep their positional spelling.
 *
 * ## Why it is derived
 *
 * That paragraph is not a judgement call, it is two conditions intersected, and
 * both are already written down: the context fills the collection
 * ({@link CONTEXT_STACK_KEYS}) and some write type maps into it
 * ({@link TYPE_TO_STACK_KEY}). Kept as a literal it was the one spelling of that
 * set with NO guard — at the time, `CONTEXT_STACK_KEYS` carried a `satisfies`
 * clause, which is validity, not completeness, and the compiler held nothing
 * else. Omitting a member here did not fail to build, fail a test, or fail a
 * gate; it emitted findings that LOOK correct whose `path` the caller cannot
 * resolve, which is the #10064 defect re-created silently.
 *
 * [#13977] That reading of `CONTEXT_STACK_KEYS` is now history rather than
 * description: it is derived from `RuntimeStackContext` and complete by
 * construction. This derivation is unchanged — it always rested on the
 * MEMBERSHIP of that set, and it now inherits a set the compiler keeps whole.
 *
 * [#13216] `pages` was the measurement that made the case: adding it touched
 * FIVE spellings of this one set and only the fifth announced itself — the one
 * the compiler could see, and only after that accumulator was retyped as a
 * mapped type. The pairing is the rule rather than a coincidence, and [#17063]
 * proves it in the other direction: retiring `validateViewPageRefs` with the
 * `type: 'page'` view mount took the live page universe back out of
 * `RuntimeStackContext`, and `pages` left this derived set with it, in the same
 * one-key edit. That is the correct answer and not a regression — a `page`
 * write's snapshot again holds exactly ONE page, its own, so `pages[0]` IS this
 * write and name-keying it would say nothing the index does not
 * (`validatePresetComparands` runs on `page` writes and emits paths into this
 * collection; positional resolves for it again).
 *
 * ## Measured against the list it replaces (#13390)
 *
 * The members and their order are derived, never transcribed — today `objects`,
 * `permissions`, `books`, `datasets`. So **no member needs a hand-written
 * exception** and none is kept. If a future member ever does need one, state it
 * here WITH its reason — quietly re-introducing a literal is the thing this
 * constant now exists to prevent.
 *
 * [#19143] `datasets` used to fall OUT on its own — context-only, no write type
 * mapped into it — and the old comment cited that as the exception it no longer
 * had to hand-write. Mapping the `dataset` type moved it IN, in the same one-key
 * edit and with no second spelling to remember: a dataset write's snapshot now
 * holds the tenant's other datasets beside the written one, so `datasets[3]` is
 * again an offset into an array the caller has never seen. That is the #10064
 * defect this constant exists to prevent, and the derivation caught the widening
 * rather than being told about it.
 */
const NAME_KEYED_STACK_KEYS: readonly string[] = deriveNameKeyedStackKeys(
  CONTEXT_STACK_KEYS,
  WRITTEN_STACK_KEYS,
);

/**
 * Machine names safe to splice into a dotted path. Matches the spec's
 * machine-name shape (`snake_case`; see `FieldSchema.name` in
 * `packages/spec`) with room for legacy capitalisation — anything else keeps
 * the positional spelling rather than minting an unparseable path.
 */
const PATH_SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const TOP_LEVEL_INDEX = buildTopLevelIndexPattern(NAME_KEYED_STACK_KEYS);

/**
 * `objects[417].sharingModel` → `objects.acme_invoice.sharingModel` (#10064).
 *
 * The maintainer-ruled wire shape for collection-resident findings: the
 * top-level collection index no caller can resolve is replaced by the entry's
 * NAME, read from the same candidate snapshot the finding was produced
 * against. Nested positions (`.indexes[1]`, `.actions[0]`) stay positional on
 * purpose — within one named item they index the author's own document, which
 * the receiver holds and can resolve.
 *
 * [#13390] Exported for the pin, not for callers (it is on neither package
 * entry). It is the one place the derived set and the derived pattern MEET, so
 * it is where the invariant is observable end to end: for each context
 * collection, is the top-level index rewritten exactly when a write type maps
 * into that collection? Asked here, the answer cannot be produced by a list
 * that agrees with the derivation by luck.
 *
 * Fallback is the positional spelling, never a hole: an entry that is missing,
 * unnamed, or whose name will not splice into a dotted path keeps the index.
 *
 * Applied AFTER the differential, not before it: the fingerprint diff keys on
 * the rules' raw positional paths, where two entries can never collide — two
 * stored items that (illegitimately) share a name must not have their distinct
 * findings merged or cancelled by the rewrite.
 */
export function nameKeyFindingPath(path: string, candidate: AnyRec): string {
  const m = TOP_LEVEL_INDEX.exec(path);
  if (!m) return path;
  const [, stackKey, index, rest] = m;
  if (!NAME_KEYED_STACK_KEYS.includes(stackKey!)) return path;
  const collection = candidate[stackKey!] as readonly unknown[] | undefined;
  const entry = collection?.[Number(index)];
  const name = entry && typeof entry === 'object' ? (entry as AnyRec).name : undefined;
  if (typeof name !== 'string' || !PATH_SAFE_NAME.test(name)) return path;
  return `${stackKey}.${name}${rest}`;
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
  const added = runRules(rules, snapshots.candidate, ctx)
    .filter((f) => !before.has(fingerprint(f)))
    // [#10064] The wire shape: collection-resident findings key their
    // top-level collection entry by NAME, not by this gate's private snapshot
    // index. Rewritten only on what leaves the gate — the differential above
    // ran on the rules' raw positional paths.
    .map((f) => {
      const path = nameKeyFindingPath(f.path, snapshots.candidate);
      return path === f.path ? f : { ...f, path };
    });

  return {
    errors: added.filter((f) => f.severity === 'error'),
    advisories: added.filter((f) => f.severity !== 'error'),
    rulesRun: rules.map((r) => r.name),
  };
}

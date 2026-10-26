/**
 * ObjectUI — the shared record-source readers: the ruled three-rung ladder
 * (`resolveRecordSourceConfig`) and the object-name it resolves to
 * (`resolveRecordSourceObjectName`)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ViewData } from '@object-ui/types';

/**
 * The object a view block is bound to, resolved ONCE for the whole renderer
 * (`b041b9c0c`).
 *
 * ## The question this answers, and the one it does not
 *
 * There are TWO separately-ruled precedence questions about `objectName`, and
 * they only look like one question when a single reader is asked to answer
 * both:
 *
 *  1. **Which object does this block RESOLVE, at render time, when it carries
 *     more than one binding?** — the published three-rung record-source ladder
 *     (`data`, then `staticData`, then `objectName`), declared on both faces of
 *     the contract (`ObjectMapSchema.objectName` / `ObjectGanttSchema.objectName`
 *     in `@object-ui/types`, and the `.describe` on their zod twins — the map
 *     twin's reads *"objectName — the THIRD record source `getDataConfig`
 *     resolves, after `data` and `staticData`"*, naming `ObjectMap.tsx`'s local
 *     wrapper; the gantt twin names `resolveRecordSourceConfig` itself), ruled
 *     2026-09-02 (landed as `77cb489b4`) and pinned by
 *     `objectql-record-source-refinement-6939.test.ts`. **That is this
 *     function.**
 *  2. **How does `objectName` get POPULATED when it is absent?** — the
 *     authoring-time gap-fill in `normalizeListViewSchema` (objectui#7477,
 *     ruling B, landed as `00d2fa682`), where an `objectName` already on the schema WINS
 *     and the `data` block only fills a gap: *"it can never re-point a binding
 *     that already resolves."*
 *
 * The two are NOT merged and neither is re-pointed at the other. Merging them
 * would override a standing maintainer ruling in whichever direction the merged
 * reader happened to pick: at the sites below the binding that already resolves
 * IS `data.object`, so ruling B's own words argue for keeping rung 1 as it is.
 *
 * ## Why `staticData` does not appear here
 *
 * The ladder's second rung wraps inline rows as `{ provider: 'value', items }`,
 * which names no object at all. So for the object-NAME question the three-rung
 * ladder reduces to two rungs — the resolved config's object when it names one,
 * else the schema's own `objectName`, which is what a `value`-backed block
 * still needs for metadata reads, i18n field labels and permission verdicts.
 * Callers pass the ALREADY-RESOLVED config (their
 * {@link resolveRecordSourceConfig} output, direct or through a local wrapper),
 * so rung ordering is settled before this function is reached.
 *
 * ## No lenient rung was added (AGENTS.md #0.1)
 *
 * `ViewDataSchema`'s `object` provider is a `strictObject` carrying exactly
 * `{ provider, object }` with `object` REQUIRED, so `{ provider: 'object' }`
 * without an `object` is off-contract. This reader does not coerce that shape
 * back to `objectName`; the two call sites that used to (`ObjectGrid`'s
 * `'object' in dataConfig` test and `ObjectTree`'s header `?? schema.objectName`
 * tail) keep their own tail at the site, so the collapse changes nothing they
 * resolve today while the shared rung stays contract-strict.
 *
 * @param schema - The block's schema; only `objectName` is read.
 * @param dataConfig - The RESOLVED data config — the caller's own
 *   {@link resolveRecordSourceConfig} output, `null` when nothing is bound.
 * @returns The bound object's name, or `undefined` when neither the resolved
 *   config nor the schema names one.
 *
 * @example
 * ```ts
 * const dataConfig = useMemo(() => resolveRecordSourceConfig(schema, 'view-data'), [schema]);
 * const objectName = resolveRecordSourceObjectName(schema, dataConfig);
 * ```
 */
export function resolveRecordSourceObjectName(
  schema: { objectName?: string } | null | undefined,
  dataConfig: { provider?: string; object?: string } | null | undefined,
): string | undefined {
  return dataConfig?.provider === 'object' ? dataConfig.object : schema?.objectName;
}

/**
 * Which arm of `data` a block's PUBLISHED row declares — the only shape rung 1
 * of the ladder honours for that block (objectui#8348).
 *
 * Maintainer ruling, decision batch #83 (2026-09-08), verbatim: 「8348 以协议为准」
 * — the contract decides. A renderer honours the `data` spelling its block's
 * published row declares and no other: what `os validate` and the save gate
 * refuse, the renderer refuses too.
 *
 *  - `'view-data'` — the row is the spec's `ViewData` discriminated union, four
 *    strict OBJECT arms on `provider`. A bare array under `data` is NOT a record
 *    source for such a block.
 *  - `'array'` — the row is `z.array(...)`: an array of PRE-FETCHED RECORDS. The
 *    `{ provider, items }` config object is NOT a record source for such a
 *    block.
 *  - `'undeclared'` — no published face declares a `data` row for the block at
 *    all, so neither arm of the ruling reaches it and rung 1 keeps its pre-8348
 *    verbatim behaviour. ⛔ NOT a tolerance to copy: it is the honest answer for
 *    a block the ruling does not decide, and it is reported rather than guessed.
 *    No ladder block passes it any more: `object-tree`, the last one that did,
 *    gained a published row and moved to `'view-data'` (objectui#8348, ruling
 *    batch #136 item 3, Q1-C). It stays the answer
 *    {@link recordSourceDataArmForType} gives a type it does not list.
 *
 * The arm is passed BY THE CALL SITE rather than looked up from `schema.type`
 * on purpose. Most of these renderers are registered twice — `object-grid`
 * and the `view:grid` alias `grid`, `object-calendar` and `calendar`, and so on
 * (the bare `gantt` and `map` keys are retired, objectui#8008 / objectui#10393)
 * — so a node reaches the same component under either spelling, and a table
 * keyed by `type` would answer for one tag and silently miss the other. A
 * REQUIRED parameter makes the arm a compile-time obligation at each of the
 * five sites instead.
 */
export type RecordSourceDataArm = 'view-data' | 'array' | 'undeclared';

/**
 * The authored `data` shape a block ON THAT ARM may declare — the DECLARATION
 * half of the same per-block ruling {@link authoredDataIsOnTheDeclaredArm}
 * decides at RUNTIME (`ab856ed30`).
 *
 * ## The contradiction this closes
 *
 * {@link resolveRecordSourceConfig} used to declare its `data` parameter as a
 * flat `ViewData`, while its own docblock, its REQUIRED `dataArm` parameter and
 * its rung-1 predicate all say the honoured shape DIFFERS PER BLOCK — and
 * `ViewData` is a discriminated union over four strict OBJECT arms with no
 * array member. So the signature refused the one block whose published row IS
 * the array arm, and the arm parameter that exists to make the row a
 * compile-time obligation was the one thing the compiler ignored. The
 * contradiction was held shut at `ObjectCalendar.tsx`'s call site by an
 * `as ViewData | undefined` cast whose own comment reported it as an upstream
 * defect rather than a licence.
 *
 * ⛔ The repair is NOT a union of the arms. `ViewData | unknown[]` would let a
 * `'view-data'` site declare a bare array and a `'array'` site declare a
 * provider block — each of them the shape that block's row REFUSES, each of
 * them compiling — which is the repo-wide default {@link RecordSourceDataArm}'s
 * docblock refuses by name: *"a default is how the second de-facto contract got
 * in"* (AGENTS.md #0.1).
 *
 *  - `'view-data'` — the spec's `ViewData`. UNCHANGED, and that matters: this
 *    is exactly what the flat declaration said, and it was right for the three
 *    blocks on this arm, so nothing moves for `object-grid`, `object-map` or
 *    `object-gantt`.
 *  - `'array'` — `unknown[]`, the shape `object-calendar`'s published row
 *    declares (`ComponentPropsMap['object-calendar'].data` is
 *    `z.array(z.unknown()).optional()`, *"Pre-fetched records"*).
 *  - `'undeclared'` — `unknown`. No published face declares a `data` row for
 *    such a block, so rung 1 keeps its pre-8348 verbatim behaviour and honours
 *    ANY truthy value. Anything narrower here would be a rule nobody has ruled.
 *
 * ⚠️ RUNTIME IS UNMOVED. This type is erased; {@link authoredDataIsOnTheDeclaredArm}
 * still takes `unknown` and still decides rung 1 on the value's KIND, so every
 * runtime verdict — including the off-arm ones — is byte-for-byte what it was.
 * `record-source-config.behaviourNeutrality-7632.test.ts` passes its fixtures
 * through `as any` precisely so it keeps measuring that, whatever the
 * declaration says.
 *
 * ⚠️ DISTRIBUTIVE on purpose, and that is why this is a conditional type rather
 * than a set of overloads. A caller holding a `RecordSourceDataArm`-typed
 * VARIABLE instead of a literal gets `ViewData | unknown[] | unknown`, i.e.
 * `unknown` — the honest answer when the arm is not decided at compile time.
 * The same caller would match NONE of three literal-armed overloads, which
 * would turn a working call into an error for no contract reason.
 */
export type AuthoredRecordSourceData<Arm extends RecordSourceDataArm> =
  Arm extends 'view-data' ? ViewData : Arm extends 'array' ? unknown[] : unknown;

/**
 * Does the authored `data` match the arm this block's published row declares?
 *
 * Falsy `data` is never a record source — the pre-8348 `if (schema.data)`
 * truthiness test, kept, so `data: null` and `data: undefined` still fall
 * through to `staticData`.
 */
function authoredDataIsOnTheDeclaredArm(authored: unknown, arm: RecordSourceDataArm): boolean {
  if (!authored) return false;
  if (arm === 'array') return Array.isArray(authored);
  if (arm === 'view-data') return !Array.isArray(authored);
  return true;
}

/**
 * The block's record source, resolved from the ruled three-rung ladder
 * (`ce2aaefe1`), with rung 1 judged against the block's own published `data`
 * row (objectui#8348).
 *
 * ## The ruled contract this is the ONE implementation of
 *
 * `data`, then `staticData`, then `objectName` — declared on both faces of the
 * published contract and pinned by
 * `objectql-record-source-refinement-6939.test.ts`. Quoted here from the
 * `ObjectMapSchema` faces, whose `getDataConfig` is `ObjectMap.tsx`'s local
 * wrapper around this function; the gantt and calendar faces name
 * `resolveRecordSourceConfig` instead (objectui#9618):
 *
 *  1. **`data`** — *"Data source configuration. Read FIRST by `getDataConfig`"*,
 *     honoured ONLY on the arm `dataArm` names. Returned verbatim, so a config
 *     on the declared arm reaches the caller exactly as the author wrote it.
 *  2. **`staticData`** — *"Inline records — read SECOND by `getDataConfig`,
 *     wrapped into a `{ provider: value }` config"*.
 *  3. **`objectName`** — *"the THIRD record source `getDataConfig` resolves,
 *     after `data` and `staticData`"*, folded to `{ provider: 'object' }`.
 *
 * `null` when none of the three is present — the same "nothing is drawn" signal
 * the zod `requireRecordSource` refinement is written against.
 *
 * This is the PRODUCER whose output {@link resolveRecordSourceObjectName} (the
 * reader `b041b9c0c` published) consumes; that function's docblock describes the same
 * ladder from the consuming end. Five plugins — calendar, gantt, grid, map and
 * tree — each carried a hand-copy of this ladder with no gate holding them
 * together, which is the AGENTS.md #0.1 drift class: a change to the ruled
 * order had five edit sites and nothing noticed a missed one.
 *
 * ## Rung 1 is judged against the block's own row (objectui#8348)
 *
 * ⛔ This docblock used to state, as a fact about the whole ladder, that *"an
 * array under `data` cannot be published"*. That is true of the blocks whose row
 * is `ViewData` and FALSE of `object-calendar`, whose published row
 * (`ComponentPropsMap['object-calendar'].data` on `@objectstack/spec` 17.4.0) is
 * `z.array(z.unknown()).optional()` — *"Pre-fetched records — skips the internal
 * fetch"*. Both directions of that disagreement were live at once: the renderers
 * honoured the `{ provider, items }` object on a block whose row refuses it by
 * kind, and `ObjectGrid` / `ObjectMap` lifted a bare array on blocks whose row
 * refuses THAT by kind. Decision batch #83 settled it — the row decides — and
 * `dataArm` is where each block says which row it has.
 *
 * JUDGED, per block, against that block's `ComponentPropsMap` row in the
 * INSTALLED `@objectstack/spec` — and ⛔ the verdicts are not written down here
 * as facts, because a spec release can move a row (AGENTS.md #9). Each pin
 * below derives the arm from the row at test time and compares it with what the
 * block passes, so a moved row turns it red:
 *
 *  - `object-grid` — `'view-data'`; `gridBareArrayDataRefused-8348.test.tsx`,
 *    its "the spec row is what all of the above is judged against" test. The
 *    row's own description names the refusal: *"the bare-array shortcut is
 *    refused — see migration `object-grid-data-view-data-converged`"*.
 *  - `object-calendar` — `'array'`; the test of the same name in
 *    `ObjectCalendar.dataObjectArmRefused-8348.test.tsx`. The registration
 *    publishes the same arm (`{ name: 'data', type: 'array' }`).
 *  - `object-map`, `object-gantt`, `object-tree` — `'view-data'`; one
 *    `dataArmSpecRow-8348` pin per block, in each plugin's own tests. These
 *    three rows are what ruling batch #136 item 3 (Q1-C) had the protocol
 *    gain; until they were installable, map and gantt were judged through this
 *    repo's own `ObjectMapSchema.data` / `ObjectGanttSchema.data` and tree
 *    passed `'undeclared'`. The tree's row declares `data`, so the ruling's
 *    「协议没有的能力删」 clause did not fire for it: it keeps the object arm and
 *    loses only the bare-array spelling. Its `staticData` rung is declared by
 *    the same row and is unchanged.
 *
 * ## The DECLARATION follows the arm too (`ab856ed30`)
 *
 * The `data` member below is {@link AuthoredRecordSourceData}`<Arm>`, not a flat
 * `ViewData`: the arm decides what a site may DECLARE exactly as it decides
 * what rung 1 HONOURS. Read that type's docblock for why it is arm-indexed
 * rather than a union of the arms, and for the reading that says nothing at
 * runtime moved.
 *
 * ## No lenient rung was added (AGENTS.md #0.1)
 *
 * **Null tolerance** stays out: all five copies dereference `schema` unguarded
 * and would throw on `null`; no site passes one, so no `?.` was added.
 *
 * `ObjectCalendar`'s copy guarded with `'data' in schema && schema.data`. That
 * `in` test was a TYPESCRIPT narrowing device, not a behavioural one: when the
 * property is absent the read yields `undefined`, which is falsy either way, so
 * the guard could never change which rung is taken. The optional-property
 * parameter below admits a schema that declares neither key directly, which is
 * why the guard is gone rather than flattened away. The equivalence itself is
 * pinned, not argued, by `CALENDAR_IN_GUARD` in
 * `record-source-config.behaviourNeutrality-7632.test.ts`.
 *
 * ⛔ This passage used to explain that guard by the PROPS UNION the calendar
 * plugin once carried — `ObjectGridSchema | CalendarSchema`, whose second
 * member declared neither `data` nor `staticData`. objectui#8651 RETIRED that
 * union (`ObjectCalendarComponentProps.schema` is the published
 * `ObjectCalendarSchema` today), so the sentence explained the guard by a type
 * no reader could look up. Rewritten rather than deleted: the guard's history
 * is still why this parameter's members are optional.
 *
 * @param schema - The block's schema; only `data`, `staticData` and
 *   `objectName` are read. Its `data` member is typed by the arm — see
 *   {@link AuthoredRecordSourceData}.
 * @param dataArm - The arm the CALLING BLOCK's published `data` row declares.
 *   Required: there is no repo-wide default, because the answer differs per
 *   block and a default is how the second de-facto contract got in.
 * @returns The resolved data config, or `null` when nothing is bound.
 *
 * @example
 * ```ts
 * const dataConfig = useMemo(() => resolveRecordSourceConfig(schema, 'view-data'), [schema]);
 * const objectName = resolveRecordSourceObjectName(schema, dataConfig);
 * ```
 */
export function resolveRecordSourceConfig<Arm extends RecordSourceDataArm>(
  schema: {
    objectName?: string;
    data?: AuthoredRecordSourceData<Arm>;
    staticData?: any[];
  },
  dataArm: Arm,
): ViewData | null {
  if (authoredDataIsOnTheDeclaredArm(schema.data, dataArm)) {
    return schema.data as ViewData;
  }

  if (schema.staticData) {
    return {
      provider: 'value',
      items: schema.staticData,
    };
  }

  if (schema.objectName) {
    return {
      provider: 'object',
      object: schema.objectName,
    };
  }

  return null;
}

/**
 * The arm each REGISTERED BLOCK TYPE declares — the one reading available to a
 * caller that cannot be handed the arm as a parameter (objectui#9571).
 *
 * ## Why a type-keyed table exists beside the REQUIRED parameter
 *
 * {@link RecordSourceDataArm}'s docblock states, correctly, why
 * {@link resolveRecordSourceConfig} takes the arm as a required PARAMETER: most
 * of these renderers are registered under two spellings, a node reaches the same
 * component under either, and a table keyed by `type` would answer for one tag
 * and silently miss the other. That argument is about a call site that already
 * has one block in front of it — there a parameter is strictly better, and it
 * stays exactly as it is.
 *
 * `SchemaRenderer` is the one reader that has no such site. It is generic over
 * every registered type and holds nothing but `schema.type`, and ruling
 * objectui#8348 Q2-C (decision batch #136 item 3, maintainer 「同意」) makes it a
 * reader anyway: it must stop spreading an authored `data` key as a React prop
 * for blocks whose published row is the OBJECT arm, because that prop is the
 * carrier the 「8348 以协议为准」 ruling did not otherwise reach. So "which arm
 * does this TYPE declare" has to be askable, and this is the ONE place that
 * answers it.
 *
 * ## The alias hazard is closed by ENUMERATION plus a registry-derived pin
 *
 * Every registered spelling is listed, and the listing is pinned per plugin
 * AGAINST THE REGISTRY rather than against itself: each affected plugin's pin
 * walks the keys its own `index.tsx` actually produced, groups them by the
 * renderer they resolve to, and requires every member of a group to get the
 * same answer here. An alias added without a row goes red there instead of
 * quietly answering `'undeclared'` and keeping the prop seat.
 *
 * ⚠️ ONE `register()` CALL PRODUCES SEVERAL KEYS, and a row must be written for
 * each of them — `SchemaRenderer` looks this table up with the raw
 * `schema.type`, which is whatever spelling the author wrote. A registration
 * with `namespace: 'view'` is reachable as `view:calendar` AND as bare `calendar`; one
 * with `skipFallback` is reachable ONLY under its namespaced key. MEASURED via
 * `ComponentRegistry.getAllTypes()` with the five plugins loaded, grouped by
 * the renderer each key resolves to.
 *
 * ⛔ `grid` IS NOT A GRID KEY, and this is the trap the registry-derived pin
 * caught on its first run. `plugin-grid` registers its `view` alias with
 * `skipFallback: true` precisely so the bare key stays with
 * `@object-ui/components`' LAYOUT grid container (`ui:grid`) — so `object-grid`
 * resolves to `view:grid`, never to `grid`. A row for `grid` here would strip
 * `data` from a layout container, which declares no `data` row at all.
 *
 * ## The rows are the call sites' literals — ⛔ not a second measurement
 *
 * Each value below is the literal its block already passes to
 * {@link resolveRecordSourceConfig}, and each of those literals carries its own
 * per-block measurement in a comment at that call site. ⛔ Do not re-derive the
 * arm here and ⛔ do not let the two disagree: this table transports an answer,
 * it does not compute one.
 *
 *  - `ObjectGrid.tsx`'s `getDataConfig` — `'view-data'`.
 *  - `ObjectMap.tsx`'s `getDataConfig` — `'view-data'`. One block spelling
 *    only: the bare `map` key (and with it `view:map`) is retired
 *    (objectui#10393).
 *  - `ObjectGantt.tsx`'s `rawDataConfig` — `'view-data'`. One block spelling
 *    only: the bare `gantt` key is retired (objectui#8008).
 *  - `ObjectCalendar.tsx`'s `dataConfig` — `'array'`.
 *  - `ObjectTree.tsx`'s `dataConfig` — `'view-data'`. One block spelling only
 *    (`object-tree` under the `plugin-tree` namespace): the bare `tree` key
 *    (and with it `view:tree`) is retired (objectui#10859 batch 8). These rows
 *    used to read `'undeclared'` and were only
 *    documentary, because no published face declared a `data` row for the
 *    block; `ComponentPropsMap['object-tree']` now does (objectui#8348, ruling
 *    batch #136 item 3, Q1-C), so they DECIDE: an authored `data` on a tree
 *    node no longer takes a prop seat either. The registry-derived pin is
 *    `ObjectTree.dataArmSpecRow-8348.test.tsx`.
 */
const RECORD_SOURCE_DATA_ARM_BY_TYPE: Readonly<Record<string, RecordSourceDataArm>> =
  Object.freeze({
    // — object arm: `ViewData`, a bare array under `data` is off the row —
    'object-grid': 'view-data',
    'plugin-grid:object-grid': 'view-data',
    'view:grid': 'view-data',
    'object-map': 'view-data',
    'plugin-map:object-map': 'view-data',
    'object-gantt': 'view-data',
    'plugin-gantt:object-gantt': 'view-data',
    'object-tree': 'view-data',
    'plugin-tree:object-tree': 'view-data',
    // — array arm: `z.array(...)`, pre-fetched records —
    'object-calendar': 'array',
    'plugin-calendar:object-calendar': 'array',
    'view:calendar': 'array',
    calendar: 'array',
  });

/**
 * Which `data` arm the block registered under `type` declares.
 *
 * `'undeclared'` for every type not listed above — the same verdict the ladder
 * gives a block no published face declares a `data` row for, and the same
 * behaviour those types have today. That default is deliberately the
 * NO-CHANGE direction: a caller acting on this reading (today:
 * `SchemaRenderer`'s props spread) leaves an unlisted type exactly as it was,
 * so a block that has never been measured is never silently re-decided by this
 * table's mere existence.
 *
 * @param type - The node's registry key, either spelling.
 * @returns The arm that type's published `data` row declares.
 */
export function recordSourceDataArmForType(
  type: string | null | undefined,
): RecordSourceDataArm {
  if (typeof type !== 'string') return 'undeclared';
  return RECORD_SOURCE_DATA_ARM_BY_TYPE[type] ?? 'undeclared';
}

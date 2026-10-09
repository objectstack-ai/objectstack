// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-node-config-refusals
 *
 * **What a node's executor needs its `config` to carry** (#20316), and
 * (#21654) **the one target a write node's executor refuses to write** — the
 * one judge `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses
 * first) and `objectstack validate` share, beside the expression ledger's
 * `predicateSlotRefusal` and closing the same gap: a node's `config` is an
 * open `z.record`, so what its executor requires, or refuses, was checked by
 * nobody until the run. And (#21850) **the whole config of a plugin node type
 * whose contract the spec itself declares** — `approval`, judged against
 * `ApprovalNodeConfigSchema` with no plugin loaded. And (#21898) **a value a
 * builtin node's executor contract refuses**, where the build can know what
 * the run will parse — see {@link flowNodeConfigRefusals}' first arm for what
 * that excludes, and why. And (#21982) **a key a builtin's executor contract
 * does not declare** — every builtin in the contract map, `try_catch` included
 * since its `retry` closed (#22343) ({@link builtinNodeConfigKeysJudged}), the
 * one judge of a builtin's undeclared key at every door: `registerFlow`'s
 * descriptor walk stands aside for exactly the types this judges.
 *
 * Its refusal codes join the closed flow slot table
 * (`FLOW_SLOT_REFUSAL_CODES`, `flow-node-expression-paths.ts`); the
 * judge lives in this module rather than that one because it reads the
 * executor contracts, and two of their modules import that one — a leaf it
 * has to stay.
 */

import { NON_BLANK_STRING } from '../shared/refinement-projection';
// [#21654] The stored-metadata family's ONE membership predicate and the ONE
// prescription a refusal of its reach ends on — both from the import-free leaf,
// so this module's import graph gains nothing. ⛔ Never restate either here.
import { STORED_METADATA_BODY_PRESCRIPTION, isStoredMetadataBodyObject } from '../kernel/stored-metadata-body-objects';
import { FLOW_REGION_SLOTS_BY_TYPE } from './region-slots';
import { FLOW_NODE_EXPRESSION_PATHS } from './flow-node-expression-paths';
import type { FlowNodeConfigRefusal, FlowSlotRefusalParams, NodeConfigValueKind } from './flow-node-expression-paths';
// The executor contracts. Read only inside `getBuiltinNodeConfigContracts`,
// never at module load: `control-flow.zod.ts` sits in the flow-schema import
// cycle, so its bindings are live references resolved on first use.
import { LoopConfigSchema, ParallelConfigSchema, TryCatchConfigSchema } from './control-flow.zod';
import {
  CreateRecordConfigSchema,
  DeleteRecordConfigSchema,
  GetRecordConfigSchema,
  MapConfigSchema,
  ScreenConfigSchema,
  UpdateRecordConfigSchema,
} from './builtin-node-config.zod';
import { HttpConfigSchema, NotifyConfigSchema } from './io-node-config.zod';
import { ScriptConfigSchema, SubflowConfigSchema } from './schemaless-node-config.zod';
// [#21850] The one plugin node contract the spec declares. Read only inside
// `getDeclaredPluginNodeConfigContracts`, like the executor contracts above.
// `approval.zod.ts` imports nothing from `automation/` (zod, the membership-role
// leaf, `lazySchema` and `strictObject` only), so it adds no cycle here.
import { APPROVAL_NODE_TYPE, ApprovalNodeConfigSchema } from './approval.zod';

/**
 * The executor contract a builtin node's `config` is parsed against at run
 * time — the SAME Zod schema its executor hands `parseNodeConfig`
 * (`service-automation/builtin/parse-config.ts`) — and, where the executor
 * parses only on one path, the condition it parses on.
 *
 * Structural, like `parseNodeConfig`'s own view of a contract: this module
 * reads `safeParse` and nothing else.
 */
export interface BuiltinNodeConfigContract {
  readonly schema: {
    safeParse(value: unknown): {
      success: boolean;
      error?: { issues: ReadonlyArray<{ code: string; path: ReadonlyArray<PropertyKey>; message: string }> };
    };
  };
  /**
   * The executor parses the config only when this holds. Absent: always. The
   * one member is `loop`, whose legacy flat-graph form (no `body`) predates
   * the ADR-0031 construct its contract describes and is deliberately not
   * parsed (`loop-node.ts`), so `collection` is required only once a `body`
   * is there.
   *
   * (#21982) It gates presence and values only. Key MEMBERSHIP is judged
   * whatever it says, for a type {@link builtinNodeConfigKeysJudged} judges:
   * an undeclared key is never read on either path. Registration refused one
   * on a body-less `loop` before the build doors judged keys, and it still
   * refuses one there.
   */
  readonly parsedWhen?: (config: Readonly<Record<string, unknown>>) => boolean;
}

let cachedBuiltinNodeConfigContracts: ReadonlyMap<string, BuiltinNodeConfigContract> | undefined;

/**
 * Every builtin node type whose executor parses its `config` against a
 * contract at run time, keyed by `node.type` (#20316).
 *
 * The declared half of a pair: `service-automation`'s ratchet
 * (`node-config-contract-ledger.test.ts`) reads each executor's
 * `parseNodeConfig(…)` call out of its source and holds this map equal to it
 * in both directions — the type, the schema, and `loop`'s parse condition —
 * so a new contract-parsing executor cannot go unjudged here, and an entry
 * cannot outlive the parse it mirrors.
 *
 * Built on first use, never at module load: these schemas' modules import
 * this one, and a map literal at top level would read them mid-cycle.
 *
 * NOT here, on purpose: `decision` (its executor parses nothing — its branch
 * shape is judged by {@link flowNodeConfigRefusals}'s own arm), `assignment`
 * (three read-compatible shapes, no single contract), and `wait` /
 * `connector_action`, whose inputs are FlowNode SIBLING blocks
 * (`waitEventConfig` / `connectorConfig`), not `config` — each required by
 * `flow.zod.ts` itself (`requireTypeScopedConfig`,
 * `connectorActionConfigRefusals`). Nor (#21850) a PLUGIN node type, even one
 * whose contract the spec declares: the ratchet above reads only the builtin
 * executors' sources, so a plugin type here would fail it in both directions.
 * Those live in {@link getDeclaredPluginNodeConfigContracts}, beside this map,
 * and the same judge reads both.
 */
export function getBuiltinNodeConfigContracts(): ReadonlyMap<string, BuiltinNodeConfigContract> {
  if (cachedBuiltinNodeConfigContracts === undefined) {
    cachedBuiltinNodeConfigContracts = new Map<string, BuiltinNodeConfigContract>([
      ['get_record', { schema: GetRecordConfigSchema }],
      ['create_record', { schema: CreateRecordConfigSchema }],
      ['update_record', { schema: UpdateRecordConfigSchema }],
      ['delete_record', { schema: DeleteRecordConfigSchema }],
      ['notify', { schema: NotifyConfigSchema }],
      ['http', { schema: HttpConfigSchema }],
      ['screen', { schema: ScreenConfigSchema }],
      ['script', { schema: ScriptConfigSchema }],
      ['subflow', { schema: SubflowConfigSchema }],
      ['map', { schema: MapConfigSchema }],
      ['loop', { schema: LoopConfigSchema, parsedWhen: (config) => config.body != null }],
      ['parallel', { schema: ParallelConfigSchema }],
      ['try_catch', { schema: TryCatchConfigSchema }],
    ]);
  }
  return cachedBuiltinNodeConfigContracts;
}

let cachedDeclaredPluginNodeConfigContracts: ReadonlyMap<string, BuiltinNodeConfigContract> | undefined;

/**
 * [#21850] Every PLUGIN node type whose `config` contract the spec itself
 * declares, keyed by `node.type` — the declared contract map. Today one:
 * `approval`, whose executor (`plugin-approvals`, `approval-node.ts`) parses
 * `node.config ?? {}` against `ApprovalNodeConfigSchema` before it does
 * anything else, and fails the node on ANY issue.
 *
 * Judged WHOLE, unlike the builtin map's arm (#21898: a key left out and a
 * value refused, never key membership): every issue the contract raises is a
 * refusal — a key it requires left out, a key it does not declare, and a value
 * it refuses — because the executor refuses the node on every one of them,
 * before anything else and on its authored config, so a flow carrying one
 * would fail at every run that reached the node. The contract is a `strictObject` whose unknown-key text
 * carries its own did-you-mean (`timeout` → `timeoutHours`), and that text is
 * the refusal's.
 *
 * ⛔ No plugin is loaded to build it, and no node type joins it whose contract
 * the spec does not declare: a plugin node type the spec knows nothing about
 * stays outside the build doors, judged at registration by its descriptor's
 * own `configSchema`.
 *
 * Built on first use, never at module load, like the builtin map.
 */
function getDeclaredPluginNodeConfigContracts(): ReadonlyMap<string, BuiltinNodeConfigContract> {
  if (cachedDeclaredPluginNodeConfigContracts === undefined) {
    cachedDeclaredPluginNodeConfigContracts = new Map<string, BuiltinNodeConfigContract>([
      [APPROVAL_NODE_TYPE, { schema: ApprovalNodeConfigSchema }],
    ]);
  }
  return cachedDeclaredPluginNodeConfigContracts;
}

/** A plain object (not an array, not `null`). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The kind of a value that is not the shape a node-config position wants. */
function nodeConfigValueKind(value: unknown): NodeConfigValueKind {
  if (Array.isArray(value)) return 'array';
  return typeof value as NodeConfigValueKind;
}

/** `a string`, `an array`, `an object` — the phrase a kind token renders as. */
function kindPhrase(kind: NodeConfigValueKind | 'null'): string {
  if (kind === 'null') return '`null`';
  return kind === 'array' || kind === 'object' ? `an ${kind}` : `a ${kind}`;
}

/** A Zod issue path → the ledger spelling (`['fields', 0, 'name']` → `fields[0].name`). */
function ledgerPathOf(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out ? `.${String(segment)}` : String(segment);
  }
  return out;
}

/**
 * Is the key an issue names ABSENT from the authored config — its parent
 * reached, and the key itself not there (or `undefined`)? The contract arm's
 * first question: a key left out is `node-config-key-missing` (or the rule's
 * own code), and a present value is a different finding — refused, for a
 * builtin, only where {@link builtinValueJudged} holds (#21898).
 */
function absentAt(config: Readonly<Record<string, unknown>>, path: ReadonlyArray<PropertyKey>): boolean {
  let parent: unknown = config;
  for (const segment of path.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object') return false;
    parent = (parent as Record<PropertyKey, unknown>)[segment as PropertyKey];
  }
  if (parent === null || typeof parent !== 'object') return false;
  const last = path[path.length - 1] as PropertyKey;
  return (parent as Record<PropertyKey, unknown>)[last] === undefined;
}

/**
 * Does an issue path descend INTO an ADR-0031 region (`body.nodes…`,
 * `branches[0]…`, `try.edges…`)? Those are the region's own nodes and edges,
 * judged where the walks reach them as a graph — never re-reported against
 * the container that holds them. The slot itself absent (`try`, `branches`)
 * is the container's, and is judged here.
 */
function insideRegion(nodeType: string, path: ReadonlyArray<PropertyKey>): boolean {
  if (path.length < 2) return false;
  return (FLOW_REGION_SLOTS_BY_TYPE.get(nodeType) ?? []).some((slot) => slot.key === path[0]);
}

/**
 * Does an issue path descend INTO a ledger `value` slot (`fields.total.source`
 * under `fields.*`)? Such a slot holds an authored VALUE — a literal, a
 * `{token}` template, or an expression envelope — and a key missing inside it
 * is a malformed value, judged at `registerFlow` and `objectstack validate` by
 * the value-envelope pass with its own refusal, never a config key left out.
 */
function insideValueSlot(nodeType: string, path: ReadonlyArray<PropertyKey>): boolean {
  return FLOW_NODE_EXPRESSION_PATHS.some((entry) => {
    if (entry.nodeType !== nodeType || entry.role !== 'value') return false;
    const segments = entry.path.split('.');
    if (path.length <= segments.length) return false;
    return segments.every((segment, i) => segment === '*' || segment === path[i]);
  });
}

// ─── The builtin VALUE arm (#21898) ───────────────────────────────────

/**
 * [#21898] A `{token}` the run interpolates — the interpolator's own token
 * shape (`service-automation` `builtin/template.ts`, `interpolateString`, and
 * the lint's `TEMPLATE_TOKEN_RE`), which also matches the double-brace and
 * dollar-brace spellings an author may write. A string carrying one means
 * something only after interpolation, so the build never judges its type.
 */
const INTERPOLATION_TOKEN = /\{[^{}]+\}/;

/**
 * [#21898] Does `value`, or anything inside it, carry a {@link
 * INTERPOLATION_TOKEN}? Cycle-safe: a flow arriving as hand-built objects
 * rather than parsed JSON may hold a self-reference.
 */
function carriesInterpolationToken(value: unknown, seen: Set<object> = new Set()): boolean {
  if (typeof value === 'string') return INTERPOLATION_TOKEN.test(value);
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return (Array.isArray(value) ? value : Object.values(value)).some((v) => carriesInterpolationToken(v, seen));
}

/** The authored value an issue path names, or `undefined` when the walk leaves the config. */
function authoredAt(config: Readonly<Record<string, unknown>>, path: ReadonlyArray<PropertyKey>): unknown {
  let at: unknown = config;
  for (const segment of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<PropertyKey, unknown>)[segment as PropertyKey];
  }
  return at;
}

/**
 * [#21898] The builtin node types whose executor parses its contract AFTER
 * interpolating the whole config — today `http` alone (`builtin/http-nodes.ts`:
 * `parseNodeConfig(…, interpolate(raw, …))`). Its contract describes the
 * INTERPOLATED shape, so a `{token}` anywhere may change what the contract
 * sees — a sole token resolves to its value's real type — and a rule, which may
 * read keys other than the one its issue names, is judged only on a config that
 * carries no token at all. Every other builtin parses its config as authored.
 */
const PARSED_AFTER_INTERPOLATION: ReadonlySet<string> = new Set(['http']);

/**
 * [#21898] Builtin config keys whose run-time value may not be the authored
 * one: `http.signingSecret` — a secret the write-only flow credential channel
 * holds takes the literal's place before the parse (`builtin/http-nodes.ts`),
 * so the build cannot know what the contract will see there.
 */
const RUN_RESOLVED_KEYS: Readonly<Record<string, readonly string[]>> = { http: ['signingSecret'] };

/** The ledger roles whose slots another judge owns — never re-judged by the value arm. */
const LEDGER_JUDGED_ROLES: ReadonlySet<string> = new Set(['predicate', 'value']);

/** A ledger path (`fields[].visibleWhen`, `fields.*`) → match segments: `[]` any index, `*` any key. */
function ledgerSlotSegments(path: string): string[] {
  const segments: string[] = [];
  for (const part of path.split('.')) {
    if (part.endsWith('[]')) segments.push(part.slice(0, -2), '[]');
    else segments.push(part);
  }
  return segments;
}

/**
 * [#21898] Does an issue path sit AT or INSIDE a `predicate` or `value` slot the
 * expression ledger declares for this node type? Those slots have judges of
 * their own: `predicateSlotRefusal` (whose non-strings the flow parse leaves to
 * `registerFlow` and `objectstack validate` by ruling — `flow.zod.ts`), and the
 * value-envelope pass.
 */
function atOrInsideJudgedLedgerSlot(nodeType: string, path: ReadonlyArray<PropertyKey>): boolean {
  return FLOW_NODE_EXPRESSION_PATHS.some((entry) => {
    if (entry.nodeType !== nodeType || !LEDGER_JUDGED_ROLES.has(entry.role)) return false;
    const segments = ledgerSlotSegments(entry.path);
    if (path.length < segments.length) return false;
    return segments.every((segment, i) =>
      segment === '*' ? typeof path[i] === 'string'
        : segment === '[]' ? typeof path[i] === 'number'
          : segment === path[i]);
  });
}

/** One contract issue, as much of it as the value arm reads. */
interface ContractIssue {
  readonly code: string;
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

/**
 * [#21898] Is a builtin contract's issue at a PRESENT key a value the build can
 * refuse — one the run would refuse for the same reason? Every carve-out is a
 * place where the build does not know what the run will parse, or where
 * another judge owns the finding:
 *
 *  - key membership — an undeclared key (`unrecognized_keys`) and a tombstoned
 *    one (a `retiredKey()`, {@link isRetiredKeyIssue}): both are the key
 *    arm's ({@link builtinNodeConfigKeysJudged}; a tombstone on every judged
 *    type but those in {@link RETIRED_KEYS_JUDGED_ELSEWHERE} — the lint names
 *    the retired script keys), and the conversion layer rewrites a retired
 *    spelling before the doors that convert first;
 *  - an ADR-0031 region slot, the slot itself included (`try: 5`): a region's
 *    shape is `validateControlFlow`'s, and its nodes are the region walk's;
 *  - a `predicate` or `value` ledger slot, at or inside it
 *    ({@link atOrInsideJudgedLedgerSlot});
 *  - a run-resolved key ({@link RUN_RESOLVED_KEYS});
 *  - a value carrying a `{token}` anywhere inside it: it is never refused for
 *    its pre-interpolation type, even where the executor parses the authored
 *    config and so refuses it at the run;
 *  - for a contract parsed after interpolation ({@link
 *    PARSED_AFTER_INTERPOLATION}), a rule (`custom`) when the config carries a
 *    token anywhere.
 */
function builtinValueJudged(
  nodeType: string,
  authored: Readonly<Record<string, unknown>>,
  issue: ContractIssue,
): boolean {
  if (issue.code === 'unrecognized_keys') return false;
  if (isRetiredKeyIssue(issue)) return false;
  if ((FLOW_REGION_SLOTS_BY_TYPE.get(nodeType) ?? []).some((slot) => slot.key === issue.path[0])) return false;
  if (atOrInsideJudgedLedgerSlot(nodeType, issue.path)) return false;
  if ((RUN_RESOLVED_KEYS[nodeType] ?? []).includes(issue.path[0] as string)) return false;
  if (carriesInterpolationToken(authoredAt(authored, issue.path))) return false;
  if (PARSED_AFTER_INTERPOLATION.has(nodeType) && issue.code === 'custom' && carriesInterpolationToken(authored)) return false;
  return true;
}

// ─── The builtin KEY arm (#21982) ─────────────────────────────────────

/**
 * [#21982] Does the spec judge KEY MEMBERSHIP on this node type's `config`, at
 * every door that parses a flow — `FlowSchema.parse`, `objectstack validate`,
 * `objectstack compile`, the metadata save door and `registerFlow` (which
 * parses first)? True for every builtin in {@link
 * getBuiltinNodeConfigContracts}: each of those contracts is strict at every
 * position it declares, and its executor parses it before anything else.
 *
 * The ONE judge of a builtin's undeclared key. `registerFlow`'s descriptor walk
 * (`service-automation` `validateNodeConfigKeys`) asks this and stands aside
 * for every type it answers `true` for, so no type has two judges; the walk
 * keeps the plugin node types the spec does not declare, and no builtin.
 * Measured before each move: on every type it answers `true` for, the
 * descriptor's declared key sets, at every position the walk descends to,
 * equal the keys the contract accepts there, so the move changed no verdict at
 * registration and only added the build doors.
 *
 * (#22343) `try_catch` was the last builtin left to the walk: its descriptor
 * closed `retry` to five keys while its contract's `retry` — the shared
 * `RetryPolicySchema` — was a plain `z.object` that stripped an unknown key, so
 * moving the judge would have widened registration. That schema is a
 * `strictObject` now, closed to the same five keys (plus the `retryDelayMs`
 * tombstone, which the walk refused as undeclared and this arm refuses in the
 * tombstone's own words — see {@link RETIRED_KEYS_JUDGED_ELSEWHERE}).
 *
 * `false` for a declared PLUGIN contract (`approval`): that one is judged whole
 * by {@link flowNodeConfigRefusals}, a different arm, and is not a builtin.
 */
export function builtinNodeConfigKeysJudged(nodeType: string): boolean {
  return getBuiltinNodeConfigContracts().has(nodeType);
}

/**
 * [#22343] Is this contract issue a tombstoned key the author wrote — a
 * `retiredKey()` (`z.never().optional()`), which answers any value but
 * `undefined` with an `invalid_type` expecting `never`, at the key's own path?
 */
function isRetiredKeyIssue(issue: { readonly code: string }): boolean {
  return issue.code === 'invalid_type' && (issue as { readonly expected?: unknown }).expected === 'never';
}

/**
 * [#22343] The judged builtins whose RETIRED keys the key arm leaves to another
 * judge, each with the reason.
 *
 * A tombstoned key is key membership: declared only to refuse, with the
 * upgrade in its message. On every other type the key arm judges, a tombstone
 * the author wrote is refused at its own path in that message. The one such
 * tombstone today is `try_catch`'s `retry.retryDelayMs`. The
 * `retry-policy-converged` conversion renames it to `backoffMs` before every
 * door that converts first, but it keeps both spellings when a `backoffMs`
 * beside it holds a different value, and it leaves a `null`. `registerFlow`'s
 * descriptor walk refused what survived, as an undeclared key, so the arm that
 * replaced the walk on `try_catch` refuses it too — registration widens
 * nowhere.
 *
 * `script` keeps the scope it had: the lint (`validateStackExpressions`) names
 * each of its five retired dispatch keys with that key's own replacement at
 * `objectstack validate`, and no door before the run judged one at all — its
 * descriptor publishes no `configSchema`, so the walk never read a `script` key.
 * Refusing them here would narrow `defineStack`, the save door and
 * `registerFlow` on `script`, which is not this arm's change to make.
 */
const RETIRED_KEYS_JUDGED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ['script', 'the lint names each retired dispatch key at `objectstack validate`, and no other door before the run ever judged a `script` key'],
]);

/**
 * [#21982] Does an `unrecognized_keys` issue sit at or under an ADR-0031
 * region slot — on a region object (`body`, `try`, `catch`, a `branches`
 * element) or deeper, on a region node or edge? The issue's `path` is the
 * object that holds the key, so `[]` is the config itself and `['body']` the
 * loop's region object. A region's shape is `validateControlFlow`'s, as the
 * value arm's own carve-out says ({@link builtinValueJudged}): it parses each
 * region against the strict region contract at `registerFlow` and refuses an
 * undeclared key on the region object and on its nodes and edges alike
 * (measured: `try_catch 'n1' try: invalid region — Unrecognized key(s) on this
 * control-flow region`), while the flow parse leaves a refused region raw for
 * it to name (the region policy `flow.zod.ts` states). So such a key has its
 * judge, one door later, and this arm does not add a second.
 */
function unknownKeyUnderRegionSlot(nodeType: string, path: ReadonlyArray<PropertyKey>): boolean {
  if (path.length === 0) return false;
  return (FLOW_REGION_SLOTS_BY_TYPE.get(nodeType) ?? []).some((slot) => slot.key === path[0]);
}

/**
 * [#21654] The write nodes, each with the verb its refusal names — the same
 * three, in the same words, as the run-time refusal in `service-automation`
 * (`storedMetadataWriteRefusal`, `builtin/crud-nodes.ts`). ⛔ Never `get_record`:
 * a read is not a write, and its family reach is refused at the run.
 */
const STORED_METADATA_WRITE_VERB = {
  create_record: 'create a record in',
  update_record: 'update',
  delete_record: 'delete from',
} as const;

/** A node type in {@link STORED_METADATA_WRITE_VERB}. */
function isStoredMetadataWriteNodeType(nodeType: string): nodeType is keyof typeof STORED_METADATA_WRITE_VERB {
  return Object.prototype.hasOwnProperty.call(STORED_METADATA_WRITE_VERB, nodeType);
}

/**
 * The write-target arm of {@link flowNodeConfigRefusals} (#21654): a
 * `create_record`, `update_record` or `delete_record` node whose `objectName`
 * is a STATIC string naming a stored-metadata table, judged by the family's
 * own predicate, by exact name — the set the run-time refusal refuses, read
 * where the flow is built instead of where it first runs. `undefined` for
 * anything else.
 *
 * A static name only. A value the parse cannot read as a name is the run's to
 * judge: an expression envelope is not a string, and a `{token}` template is
 * never a family name by exact match — the run-time half judges the name the
 * node hands the data engine.
 */
function storedMetadataWriteTargetRefusal(nodeType: string, config: unknown): FlowNodeConfigRefusal | undefined {
  if (!isStoredMetadataWriteNodeType(nodeType) || !isRecord(config)) return undefined;
  const objectName = config.objectName;
  if (typeof objectName !== 'string' || !isStoredMetadataBodyObject(objectName)) return undefined;
  return {
    code: 'write-node-stored-metadata-target',
    params: { nodeType, objectName },
    message:
      `This \`${nodeType}\` node's \`objectName\` is '${objectName}', so it would `
      + `${STORED_METADATA_WRITE_VERB[nodeType]} a table that holds stored metadata, and a flow may not write it `
      + 'directly: every run that reaches the node refuses it before anything is written, and re-running '
      + `changes nothing. ${STORED_METADATA_BODY_PRESCRIPTION}`,
    source: '',
    path: 'objectName',
  };
}

/** The refusal for a key a node's executor contract requires. */
function nodeConfigKeyMissingMessage(nodeType: string, key: string): string {
  return (
    `This \`${nodeType}\` node's config leaves out \`${key}\`, which the ${nodeType} contract requires. Its executor `
    + 'parses the config against that contract before it does anything else and refuses the node without it — so '
    + 'the flow used to register, and then every run that reached this node failed there; the config is metadata, '
    + `and re-running changes nothing. Write \`${key}\` on the node's \`config\`.`
  );
}

/**
 * How a {@link nodeConfigRefusedByContractMessage} refusal closes: `value`
 * prescribes a value the contract accepts (a plain value finding); `key`
 * (#21982) prescribes renaming or removing an undeclared key on a builtin,
 * whose contract sentence says what is wrong but, for a key with no
 * did-you-mean and no guidance, not what to do; `none` adds nothing (a rule's
 * text, and a whole-judged plugin contract's, already say what to write).
 */
type RefusalClosing = 'value' | 'key' | 'none';

/**
 * [#21850] The refusal for a key a WHOLE-judged contract does not declare, or a
 * value it refuses — and (#21898) a value a builtin contract refuses, and
 * (#21982) a key a key-judged builtin contract does not declare — where the
 * author wrote it: the contract's own sentence, inside one that names the node
 * type and the key, closed per {@link RefusalClosing}.
 *
 * `parsedAtRun` false is a key on a config its executor does not parse — a
 * body-less legacy `loop` (#21982): the run would not fail there, but nothing
 * reads the key, and `registerFlow` refused the flow on it before the build
 * doors did, so the sentence says that instead.
 */
function nodeConfigRefusedByContractMessage(
  nodeType: string,
  key: string,
  contractMessage: string,
  closing: RefusalClosing,
  parsedAtRun = true,
): string {
  const reason = contractMessage.trim();
  return (
    `This \`${nodeType}\` node's config is refused at \`${key}\` by the ${nodeType} contract: `
    + `${/[.!?]$/.test(reason) ? reason : `${reason}.`} `
    + (parsedAtRun
      ? 'Its executor parses the config against that contract before it does anything else and refuses the '
        + 'node on any finding, so every run that reached this node would fail there; the config is metadata, '
        + 'and re-running changes nothing.'
      : 'Its executor reads no key the contract does not declare, and registration refuses the whole flow on '
        + 'one, so the flow would never run; the config is metadata, and re-running changes nothing.')
    + (closing === 'value' ? ` Write a value the ${nodeType} contract accepts at \`${key}\`.` : '')
    + (closing === 'key'
      ? ` Rename the key to one the ${nodeType} contract declares there, or remove it: an undeclared key is never `
        + 'read, so it can only be a typo or dead config.'
      : '')
  );
}

/** The keys an `unrecognized_keys` issue names (Zod carries them beside its `path`). */
function unrecognizedKeysOf(issue: { readonly code: string }): readonly string[] {
  if (issue.code !== 'unrecognized_keys') return [];
  const keys = (issue as { readonly keys?: unknown }).keys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
}

/**
 * Every reason a node's `config` is refused on SHAPE, PRESENCE or (#21898)
 * VALUE, and (#21654) a write node's static TARGET in the stored-metadata
 * family — the ONE judge `FlowSchema.parse`, `AutomationEngine.registerFlow`
 * (which parses first) and `objectstack validate` share (#20316).
 *
 * Three arms.
 *
 * ## The executor contract — a key it requires absent, or a value it refuses
 *
 * For a type in {@link getBuiltinNodeConfigContracts}, the config is parsed
 * against the executor's own contract, on the executor's own condition
 * (`config ?? {}`, as `parseNodeConfig` reads it; `loop` only with a `body`),
 * and a failure is kept where it answers one question: "would the run refuse
 * this node, for this reason, whatever it is handed?" Issues inside an
 * ADR-0031 region are the region's own and skipped, and so are issues inside
 * a ledger `value` slot (`fields.*`, `assignments.*`): a key missing inside an
 * authored value is a malformed value, refused by the value-envelope pass, not
 * a config key left out.
 *
 *  - A key the contract simply requires → `node-config-key-missing`, whose
 *    message names the key and the node type.
 *  - A key a RULE of the contract requires in this configuration (a `notify`
 *    with no `template` needs `title`; a `lookup` screen field needs its
 *    `reference`) → `node-config-key-required-by-rule`, whose message is the
 *    contract's own.
 *  - (#21898) A value the contract refuses at a key the author wrote →
 *    `node-config-refused-by-contract`, anchored at the key
 *    (`outputVariable` for a `create_record` `42`; `fields[0].min` for a
 *    screen field's `'1'`), the same code and message the declared plugin
 *    contract below uses. Kept only where {@link builtinValueJudged} holds —
 *    key MEMBERSHIP is not judged by this bullet (an undeclared key is the
 *    next one's, a tombstoned key nobody's here), nor a region slot, a
 *    `predicate` / `value` ledger slot, a run-resolved key, or any value
 *    carrying a `{token}`: never refused for its pre-interpolation type.
 *  - (#21982) A key the contract does not declare, on every builtin
 *    {@link builtinNodeConfigKeysJudged} judges (every one, `try_catch`
 *    included since #22343) → `node-config-refused-by-contract`, anchored at
 *    the key, one refusal per undeclared key (`bogusKey` on a `notify`;
 *    `fields[0].visibleIf` on a `screen` field; `flowName` on a body-less
 *    `loop`; `retry.maxRetry` on a `try_catch`), in the contract's own words —
 *    its prescription for a known slip included (`fieldValues` → `fields`,
 *    `bulk` → `multi`, `visibleIf` → `visibleWhen`, a `subflow` `timeoutMs`
 *    that belongs on the node, a did-you-mean for a near miss) — and closed
 *    with the rename-or-remove remedy. Each executor parses its strict
 *    contract before anything else, so the run refuses such a node; this arm
 *    is the one judge of it at every door, and `registerFlow`'s descriptor
 *    walk stands aside for these types. A key at or under a region slot — on
 *    the region object, or a region node's or edge's own key — is the
 *    region's (`validateControlFlow`, at `registerFlow`). (#22343) A
 *    tombstoned key (a `retiredKey()`) the author wrote is refused the same
 *    way, at its own path and in the tombstone's own words (its upgrade),
 *    with no rename-or-remove closing — except on a type in
 *    {@link RETIRED_KEYS_JUDGED_ELSEWHERE} (`script`), where it keeps the
 *    path it had.
 *
 * Where the build cannot read the config whole, it reads only what is sound,
 * and each such type is named here, not skipped in silence:
 *
 *  - `http` parses AFTER interpolating its whole config, so a value is judged
 *    only when nothing inside it carries a `{token}` (its interpolation is then
 *    the identity), a rule only when the whole config carries none, and
 *    `signingSecret` never (the credential channel may supply it);
 *  - `loop` parses only with a `body` (`parsedWhen`), so a legacy flat-graph
 *    loop is judged on key membership alone (#21982: nothing reads an
 *    undeclared key on either path, and registration refused one there
 *    already), and a loop with a body on its own keys as well (`collection`,
 *    `iteratorVariable`, `indexVariable`, `maxIterations`);
 *  - the region containers — `loop` (`body`), `parallel` (`branches`) and
 *    `try_catch` (`try`, `catch`) — hold regions, judged as graphs of their
 *    own; a container is judged on the keys beside them (`try_catch`'s
 *    `errorVariable` and `retry`), so `parallel`, whose one key is its region
 *    slot, is judged for presence alone.
 *
 * A key only the conversion layer spells canonically (`object` →
 * `objectName`, `flow` → `flowName`, …) is judged AFTER the conversion at
 * `registerFlow` and `objectstack validate`, which convert first; a direct
 * `FlowSchema.parse` of a pre-conversion spelling meets the refusal, exactly
 * as it meets every other tombstone.
 *
 * ## A declared plugin contract — judged whole (#21850)
 *
 * For a type in {@link getDeclaredPluginNodeConfigContracts} (`approval`) the
 * same parse is made, and EVERY issue is kept, because that executor refuses
 * the node on every issue: the two codes above for a key left out, and
 *
 *  - a key the contract does not declare, or a value it refuses, where the
 *    author wrote it → `node-config-refused-by-contract`, anchored at the key
 *    (`escalation.bogusKey`, one refusal per unknown key; `escalation.
 *    timeoutHours` for `0.5` under its `min(1)`), whose message names the node
 *    type and the key around the contract's own sentence — for an unknown key,
 *    its did-you-mean (`timeout` → `timeoutHours`).
 *
 * Whole, where the builtin arm is not: no carve-out above applies to it —
 * the approval executor parses its authored config, with no interpolation and
 * no region, before it does anything else.
 *
 * ## The decision branch shape
 *
 * `decision` is parsed by nothing at run time — its executor reads
 * `conditions[]` raw — so its arm states what that read needs:
 *
 *  - `conditions` present and not `null` is an array
 *    (`decision-conditions-not-array`) — the executor iterates it;
 *  - every element is an object (`decision-branch-not-object`) — the
 *    executor reads `label` and `expression` off it;
 *  - every branch's `label` is a non-blank string
 *    (`decision-branch-label-missing`) — the label is the branch: the matched
 *    branch reports it and traversal keeps only the out-edge carrying it, so
 *    a branch without one selects nothing and EVERY out-edge is considered.
 *
 * The branch's `expression` is not judged here: it is a ledger `predicate`
 * slot, refused absent / blank / non-text by `predicateSlotRefusal`.
 *
 * ## A write node aimed at the stored-metadata family
 *
 * The family (`sys_metadata`, `sys_metadata_history`) has one writer for
 * app-authored work: the metadata protocol, where a change is validated and
 * its provenance recorded (#21520, ruling A, applied to flows by #21624). The
 * `create_record`, `update_record` and `delete_record` executors refuse a
 * family target at run time, before any write; a flow naming one statically
 * used to save, register and validate clean, and failed at its first run.
 *
 *  - A write node whose `objectName` is a string naming a family table →
 *    `write-node-stored-metadata-target`, anchored at `objectName`, whose
 *    message names the node type and the table and ends on the leaf's
 *    `STORED_METADATA_BODY_PRESCRIPTION`.
 *
 * Judged whatever else the config carries: the run refuses such a node either
 * way — by its contract parse when that fails, by the target right after it
 * when it holds. A dynamic target is the run's: see
 * {@link storedMetadataWriteTargetRefusal}.
 *
 * Every refusal carries `source: ''`: none of these values is CEL text.
 */
export function flowNodeConfigRefusals(nodeType: string, config: unknown): FlowNodeConfigRefusal[] {
  const out: FlowNodeConfigRefusal[] = [];
  if (nodeType === 'decision') {
    decisionShapeRefusals(config, out);
    return out;
  }
  const writeTarget = storedMetadataWriteTargetRefusal(nodeType, config);
  if (writeTarget) out.push(writeTarget);
  const builtin = getBuiltinNodeConfigContracts().get(nodeType);
  // [#21850] A declared plugin contract is judged WHOLE: see the docblock.
  const declared = builtin ? undefined : getDeclaredPluginNodeConfigContracts().get(nodeType);
  const contract = builtin ?? declared;
  if (!contract) return out;
  const whole = declared !== undefined;
  // [#21982] Key membership: a declared plugin contract's always, and a
  // builtin's wherever the spec is its one judge (every builtin, `try_catch`
  // included since its `retry` closed — #22343).
  const keysJudged = whole || builtinNodeConfigKeysJudged(nodeType);
  const authored = config ?? {};
  if (!isRecord(authored)) return out;
  // [#21982] `parsedWhen` gates presence and values, never key membership: a
  // body-less `loop` is judged on its keys alone, which is what registration
  // refused there before the build doors judged keys.
  const parsedAtRun = !contract.parsedWhen || contract.parsedWhen(authored);
  if (!parsedAtRun && !keysJudged) return out;
  const result = contract.schema.safeParse(authored);
  if (result.success) return out;
  const seen = new Set<string>();
  for (const issue of result.error?.issues ?? []) {
    if (keysJudged) {
      // An unknown key's issue sits on the object that holds it (the config
      // itself for a top-level key, so its `path` is empty): anchor one
      // refusal at each key the author wrote, with the contract's sentence.
      // A key at or under a region slot is the region's (`validateControlFlow`).
      const keys = unknownKeyUnderRegionSlot(nodeType, issue.path) ? [] : unrecognizedKeysOf(issue);
      for (const unknownKey of keys) {
        const key = ledgerPathOf([...issue.path, unknownKey]);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          code: 'node-config-refused-by-contract',
          params: { nodeType, key },
          message: nodeConfigRefusedByContractMessage(nodeType, key, issue.message, whole ? 'none' : 'key', parsedAtRun),
          source: '',
          path: key,
        });
      }
      if (issue.code === 'unrecognized_keys') continue;
      // [#22343] A tombstoned key the author wrote is key membership too: one
      // refusal at its own path, in the tombstone's words — its upgrade is the
      // remedy, so no rename-or-remove closing. A declared plugin contract keeps
      // it on the value path below (judged whole), and a type in
      // `RETIRED_KEYS_JUDGED_ELSEWHERE` keeps the scope it had.
      if (
        !whole
        && isRetiredKeyIssue(issue)
        && !RETIRED_KEYS_JUDGED_ELSEWHERE.has(nodeType)
        && !unknownKeyUnderRegionSlot(nodeType, issue.path)
      ) {
        const key = ledgerPathOf(issue.path);
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            code: 'node-config-refused-by-contract',
            params: { nodeType, key },
            message: nodeConfigRefusedByContractMessage(nodeType, key, issue.message, 'none', parsedAtRun),
            source: '',
            path: key,
          });
        }
        continue;
      }
    }
    if (!parsedAtRun) continue;
    if (issue.path.length === 0) continue;
    if (insideRegion(nodeType, issue.path)) continue;
    if (insideValueSlot(nodeType, issue.path)) continue;
    const absent = absentAt(authored, issue.path);
    // [#21898] A present builtin value: refused where the build knows what the
    // run will parse — see `builtinValueJudged`.
    if (!absent && !whole && !builtinValueJudged(nodeType, authored, issue)) continue;
    const key = ledgerPathOf(issue.path);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!absent) {
      out.push({
        code: 'node-config-refused-by-contract',
        params: { nodeType, key },
        message: nodeConfigRefusedByContractMessage(nodeType, key, issue.message, issue.code !== 'custom' ? 'value' : 'none'),
        source: '',
        path: key,
      });
      continue;
    }
    out.push(
      issue.code === 'custom'
        ? { code: 'node-config-key-required-by-rule', params: { nodeType, key }, message: issue.message, source: '', path: key }
        : {
          code: 'node-config-key-missing',
          params: { nodeType, key },
          message: nodeConfigKeyMissingMessage(nodeType, key),
          source: '',
          path: key,
        },
    );
  }
  return out;
}

/** The `decision` arm of {@link flowNodeConfigRefusals}. */
function decisionShapeRefusals(config: unknown, out: FlowNodeConfigRefusal[]): void {
  if (!isRecord(config)) return;
  const conditions = config.conditions;
  // Absent or `null` declares no branch: the executor reads `?? []` and the
  // node routes by its out-edges, which is legal.
  if (conditions == null) return;
  if (!Array.isArray(conditions)) {
    const found = nodeConfigValueKind(conditions) as Exclude<NodeConfigValueKind, 'array'>;
    out.push({
      code: 'decision-conditions-not-array',
      params: { found },
      message:
        `A decision's \`conditions\` is its ordered branch list — an array of \`{ label, expression }\` — and this `
        + `one is ${kindPhrase(found)}. The decision executor iterates it, so a run that reaches the node fails `
        + 'there (a string is iterated character by character, each character a branch with no `expression`). '
        + 'Write the branches as an array, or delete `conditions` and route by the out-edges\' own `condition`s.',
      source: '',
      path: 'conditions',
    });
    return;
  }
  conditions.forEach((branch: unknown, index: number) => {
    const path = `conditions[${index}]`;
    if (!isRecord(branch)) {
      const found = branch === null ? 'null' : (nodeConfigValueKind(branch) as Exclude<NodeConfigValueKind, 'object'>);
      out.push({
        code: 'decision-branch-not-object',
        params: { index, found },
        message:
          `A decision branch is an object — \`{ label, expression }\` — and \`${path}\` is ${kindPhrase(found)}. `
          + 'The decision executor reads `label` and `expression` off every branch it reaches, so this one has '
          + 'neither and a run that reaches it fails at the node. Write it as `{ label: \'approved\', expression: '
          + '\'record.amount > 1000\' }` — the label of the out-edge it routes to, and a bare CEL predicate; a '
          + 'predicate written as a bare string belongs under `expression`.',
        source: '',
        path,
      });
      return;
    }
    const label = branch.label;
    if (typeof label === 'string' && NON_BLANK_STRING(label)) return;
    const found: FlowSlotRefusalParams['decision-branch-label-missing']['found'] =
      label === undefined ? 'absent'
        : label === null ? 'null'
          : typeof label === 'string' ? 'blank'
            : (nodeConfigValueKind(label) as Exclude<NodeConfigValueKind, 'string'>);
    const phrase =
      found === 'absent' ? 'nothing — the key is absent'
        : found === 'blank' ? 'a string that is blank after trimming'
          : kindPhrase(found);
    out.push({
      code: 'decision-branch-label-missing',
      params: { index, found },
      message:
        'A decision branch routes by its `label`: the first branch whose `expression` holds is taken, and the run '
        + `continues down the out-edge carrying that label. \`${path}.label\` holds ${phrase}, and that names no `
        + 'out-edge — so when this branch matches, the node reports no branch it can route, and traversal '
        + 'considers EVERY out-edge instead, as if the decision declared no branches: an unconditional labelled '
        + 'out-edge and the default out-edge both run. Write the label of the out-edge this branch should take '
        + '(`label: \'approved\'` for the out-edge labelled `approved`). To branch on the out-edges instead, '
        + 'delete `conditions` and put each predicate on its edge\'s `condition`.',
      source: '',
      path: `${path}.label`,
    });
  });
}

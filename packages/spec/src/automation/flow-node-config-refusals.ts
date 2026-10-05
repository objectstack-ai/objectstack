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
 * `ApprovalNodeConfigSchema` with no plugin loaded.
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
 * Judged WHOLE, unlike the builtin map's presence-only arm: every issue the
 * contract raises is a refusal — a key it requires left out, a key it does not
 * declare, and a value it refuses — because the executor refuses the node on
 * every one of them, so a flow carrying one would fail at every run that
 * reached the node. The contract is a `strictObject` whose unknown-key text
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
 * reached, and the key itself not there (or `undefined`)? The one question
 * the contract arm asks: a present value of the wrong type is a different
 * finding, and not this judge's.
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
 * [#21850] The refusal for a key a WHOLE-judged contract does not declare, or a
 * value it refuses, where the author wrote it — the contract's own sentence,
 * inside one that names the node type and the key. `prescribe` adds the closing
 * instruction for a plain value finding; an unknown key's text (with its
 * did-you-mean) and a rule's text already say what to write.
 */
function nodeConfigRefusedByContractMessage(
  nodeType: string,
  key: string,
  contractMessage: string,
  prescribe: boolean,
): string {
  const reason = contractMessage.trim();
  return (
    `This \`${nodeType}\` node's config is refused at \`${key}\` by the ${nodeType} contract: `
    + `${/[.!?]$/.test(reason) ? reason : `${reason}.`} Its executor parses the config against that contract `
    + 'before it does anything else and refuses the node on any finding, so every run that reached this node '
    + 'would fail there; the config is metadata, and re-running changes nothing.'
    + (prescribe ? ` Write a value the ${nodeType} contract accepts at \`${key}\`.` : '')
  );
}

/** The keys an `unrecognized_keys` issue names (Zod carries them beside its `path`). */
function unrecognizedKeysOf(issue: { readonly code: string }): readonly string[] {
  if (issue.code !== 'unrecognized_keys') return [];
  const keys = (issue as { readonly keys?: unknown }).keys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
}

/**
 * Every reason a node's `config` is refused on SHAPE or PRESENCE, and (#21654)
 * a write node's static TARGET in the stored-metadata family — the ONE judge
 * `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first) and
 * `objectstack validate` share (#20316).
 *
 * Three arms.
 *
 * ## The executor contract — a key it requires, absent
 *
 * For a type in {@link getBuiltinNodeConfigContracts}, the config is parsed
 * against the executor's own contract, on the executor's own condition
 * (`config ?? {}`, as `parseNodeConfig` reads it; `loop` only with a `body`),
 * and a failure is kept ONLY where the key it names is absent from what was
 * authored. That keeps the judge to one question — "would the run refuse this
 * node for a key it leaves out?" — and leaves every other contract finding
 * (a present value of the wrong type, an undeclared key) where it lives
 * today. Issues inside an ADR-0031 region are the region's own and skipped,
 * and so are issues inside a ledger `value` slot (`fields.*`,
 * `assignments.*`): a key missing inside an authored value is a malformed
 * value, refused by the value-envelope pass, not a config key left out.
 *
 *  - A key the contract simply requires → `node-config-key-missing`, whose
 *    message names the key and the node type.
 *  - A key a RULE of the contract requires in this configuration (a `notify`
 *    with no `template` needs `title`; a `lookup` screen field needs its
 *    `reference`) → `node-config-key-required-by-rule`, whose message is the
 *    contract's own.
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
 * The builtin arm stays presence-only: nothing here widens what it judges.
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
  const authored = config ?? {};
  if (!isRecord(authored)) return out;
  if (contract.parsedWhen && !contract.parsedWhen(authored)) return out;
  const result = contract.schema.safeParse(authored);
  if (result.success) return out;
  const seen = new Set<string>();
  for (const issue of result.error?.issues ?? []) {
    if (whole) {
      // An unknown key's issue sits on the object that holds it (the config
      // itself for a top-level key, so its `path` is empty): anchor one
      // refusal at each key the author wrote, with the contract's sentence.
      for (const unknownKey of unrecognizedKeysOf(issue)) {
        const key = ledgerPathOf([...issue.path, unknownKey]);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          code: 'node-config-refused-by-contract',
          params: { nodeType, key },
          message: nodeConfigRefusedByContractMessage(nodeType, key, issue.message, false),
          source: '',
          path: key,
        });
      }
      if (issue.code === 'unrecognized_keys') continue;
    }
    if (issue.path.length === 0) continue;
    if (insideRegion(nodeType, issue.path)) continue;
    if (insideValueSlot(nodeType, issue.path)) continue;
    const absent = absentAt(authored, issue.path);
    if (!absent && !whole) continue;
    const key = ledgerPathOf(issue.path);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!absent) {
      out.push({
        code: 'node-config-refused-by-contract',
        params: { nodeType, key },
        message: nodeConfigRefusedByContractMessage(nodeType, key, issue.message, issue.code !== 'custom'),
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

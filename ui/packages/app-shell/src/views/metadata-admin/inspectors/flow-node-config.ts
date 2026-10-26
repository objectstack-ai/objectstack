// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-node-config — declarative, spec-precise config-field schema per flow
 * node type.
 *
 * Node types and the structured config blocks below mirror the authoritative
 * `@objectstack/spec` FlowNode schema (automation/flow.zod.ts): the type enum
 * is the spec's `FlowNodeAction`, and spec-schematized blocks — `waitEventConfig`
 * (wait), `connectorConfig` (connector_action), `boundaryConfig`
 * (boundary_event) and the node-level `timeoutMs` — are edited as precise form
 * fields rather than free JSON.
 *
 * Each field declares a `path` into the node object. Most CRUD/script/http
 * fields live under `['config', key]` (the spec's freeform, type-specific
 * config record); spec-structured blocks live at the node top level, e.g.
 * `['waitEventConfig', 'eventType']`. Only fields whose path is rooted at
 * `config` "own" a config key — any *other* config keys remain editable in the
 * optional Advanced block so authors are never locked out.
 *
 * Field kinds: scalar (text / expression / number / boolean / select),
 * `textarea` (script code, request body) and `keyValue` for flat object maps
 * (e.g. record field values, connector input). Deeply nested / array values
 * still fall back to the optional Advanced block.
 *
 * The field labels/help/options here are English (the source of truth). A zh-CN
 * overlay lives in `../i18n` (FLOW_FIELD_ZH) and is applied at render by
 * {@link localizeFlowFields} — which also localizes the engine-published
 * `configSchema` fields, since built-in nodes share the same field ids.
 */

import type { FlowTriggerKind } from '@objectstack/spec/automation';
import type { DeclaredConfigKey } from './json-schema-to-fields.js';
import type { RegistryValueSource } from '../../../utils/approverValueSources.js';
import { flowFieldZh, isZhLocale } from '../i18n.js';

export type FlowConfigFieldKind =
  | 'text'
  | 'expression'
  | 'number'
  | 'boolean'
  | 'select'
  | 'textarea'
  | 'keyValue'
  | 'stringList'
  | 'numberList'
  | 'objectList'
  | 'reference'
  // A write-only credential (objectui#11054). Rendered through the metadata
  // form's existing `secret` widget; a value already on the node is never put
  // back into the control, and leaving it blank writes nothing.
  | 'secret'
  // The notify node's audience (objectui#11788): one row per recipient — a
  // trigger-record field, a user, a team or an email address — rendered by
  // `FlowRecipientsField`, which writes only the spellings the messaging
  // service's recipient resolver reads.
  | 'recipients';

/**
 * What a `reference` field points at — the picker's data source. Most kinds
 * render an *editable* combobox (suggestions + free text), so an unknown /
 * not-yet-created value is never rejected and an empty catalog degrades to a
 * plain text box.
 *
 *   • `object`        → a business object, by API name (`client.list('object')`)
 *   • `object-field`  → a field of some object; the object is resolved via
 *                       {@link FlowReferenceSpec.objectSource}
 *   • `flow`          → a flow, by name (`client.list('flow')`)
 *   • `org-membership-level`
 *                     → an org-membership tier. A CLOSED enum rendered as a
 *                       STRICT select (objectstack-ai/objectstack#3508): there is no `role`
 *                       metadata type to list (ADR-0090 D3), and free text is
 *                       how dirty values like `sales_manager` got stored. The
 *                       vocabulary is the spec's membership-role list, taken
 *                       from the server-published `sources` entry when there
 *                       is one — never spelled out here, which is how it went
 *                       stale before (`c7a74c80d`).
 *   • `user` / `team` / `department` / `position` → a DATA-record lookup on
 *                       the matching directory object (`sys_user` / `sys_team`
 *                       / `sys_business_unit` / `sys_position`) via the
 *                       DataSource adapter — NOT the metadata registry, which
 *                       lists no records (objectstack-ai/objectstack#3508). `position` commits
 *                       the machine NAME (`sys_user_position` routes by name,
 *                       ADR-0090 D3); the others commit the row id. See
 *                       `KIND_TO_RECORD_LOOKUP`, which mirrors the spec's
 *                       `APPROVER_VALUE_BINDINGS`.
 *   • `manager`       → auto-resolved at runtime (submitter's manager) — a
 *                       disabled cell, no value to author
 *   • `queue`         → declared-but-unenforced in the runtime (framework
 *                       objectstack-ai/objectstack#3508): free text + warning, not offered for new rows
 *   • `node`          → another node in *this* flow, by id (read from the draft)
 *   • `connector`     → an installed connector (`client.list('connector')`)
 *   • `email-template`→ an email template (`client.list('email_template')`)
 *
 * Kinds that have no catalog in the current tenant simply degrade to a plain
 * text box (record lookups also keep a manual-entry escape hatch) — the author
 * is never trapped.
 */
export type ReferenceKind =
  | 'object'
  | 'object-field'
  | 'flow'
  | 'org-membership-level'
  | 'position'
  | 'node'
  | 'user'
  | 'team'
  | 'queue'
  | 'department'
  | 'manager'
  | 'connector'
  | 'connector-action'
  | 'email-template';

export interface FlowReferenceSpec {
  /**
   * Concrete reference kind. Omit when the kind is *polymorphic* — chosen at
   * render time from a sibling value (see {@link kindFrom}).
   */
  kind?: ReferenceKind;
  /**
   * For `object-field` only: where to find the target object's name.
   *   • `'$trigger'` (default) → the flow trigger object, read from the start
   *     node's `config.objectName` (the record an approval / record node acts on).
   *   • any other string       → a sibling config key on the *same* node holding
   *     the object name (e.g. CRUD nodes resolve from their own `objectName`).
   */
  objectSource?: string;
  /**
   * For `connector-action` only: the sibling key (on this node's
   * `connectorConfig` block) holding the chosen connector's name. Defaults to
   * `'connectorId'`. The picker lists THAT connector's actions (from the runtime
   * connector descriptors); with no connector chosen it degrades to free text.
   */
  connectorSource?: string;
  /**
   * Polymorphic reference: the kind is selected at render time by the value of
   * a sibling field/column named `kindFrom`, looked up in {@link map}. A value
   * with no mapping (or an empty sibling) falls back to free text. Used by the
   * approval node's `approvers[].value` (kind follows the row's `type`) and the
   * script node's `template` (follows `actionType`).
   */
  kindFrom?: string;
  map?: Record<string, ReferenceKind>;
  /**
   * Where each discriminator value's candidates actually live, keyed like
   * {@link map} — published by the spec as `xRef.sources` (objectstack-ai/objectstack#3508
   * follow-up) and carried through by `json-schema-to-fields`.
   *
   * {@link map} only ever named a picker KIND. It never said what backs that
   * picker, so this package had to keep its own copy of the data contract —
   * and the first copy pointed every directory kind at the metadata REGISTRY
   * (`GET /api/v1/meta/:type`), which cannot list `sys_user` / `sys_team` /
   * `sys_business_unit` / `sys_position` ROWS. Candidates came back empty and
   * the control silently degraded to free text (framework#3508). Reading the
   * source off the schema means a new approver type can no longer leave a
   * stale mirror behind here.
   *
   * Absent when the server predates the annotation — consumers keep a local
   * fallback for that case.
   */
  sources?: Record<string, RefValueSource>;
}

/**
 * How a polymorphic reference's candidates are sourced, per discriminator
 * value. Mirrors the spec's `APPROVER_VALUE_SOURCES` projection.
 *
 * `data` means the DATA API (`/api/v1/data/:object`) — named in deliberate
 * contrast to `meta`, the registry this used to query by mistake for ROWS.
 * `registry` is the other half of that split (objectstack#22710, objectui#7611
 * Q3b): the value is the machine name of a declared item of metadata `type`, so
 * its candidates ARE the registry, `GET /api/v1/meta/<type>`, and the picker
 * commits the item's `name` — `position` is bound this way (ADR-0131 D4). The
 * other variants are not pickers at all: a closed `enum`, an `auto`-resolved
 * value, a `trigger-field` name, a CEL `expression`, or an `unsupported` type
 * the runtime never resolves.
 */
export type RefValueSource =
  | { source: 'data'; object: string; valueField: string }
  | RegistryValueSource
  | { source: 'enum'; values: string[] }
  | { source: 'auto' | 'trigger-field' | 'expression' | 'unsupported' };

/** Column descriptor for an `objectList` repeater row. */
export interface FlowConfigColumn {
  key: string;
  label: string;
  /**
   * Scalar cells (`text`/`expression`/`boolean`/`select`/`reference`/`number`)
   * plus the three *nested-list* kinds — a cell that is itself a repeater
   * (repeater-in-repeater). `stringList`/`numberList` hold a primitive array;
   * `objectList` holds an array-of-objects whose own shape is in {@link columns}.
   *
   * `number` (objectui#11664) is a `type: 'number'` / `'integer'` item property —
   * a screen field's `min` / `max`. It edits and commits a JSON number, the shape
   * the node contract declares; as a `text` cell it saved the string the
   * contract refuses.
   */
  kind:
    | 'text'
    | 'expression'
    | 'boolean'
    | 'select'
    | 'reference'
    | 'number'
    | 'stringList'
    | 'numberList'
    | 'objectList';
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  /** For `kind: 'reference'` — the picker data source (may be polymorphic). */
  ref?: FlowReferenceSpec;
  /**
   * For `kind: 'objectList'` — the nested repeater's own column schema. Recursive:
   * a nested `objectList` column may itself carry `columns`, so an engine-published
   * array-of-objects-of-…-arrays renders inline instead of dropping to Advanced JSON.
   */
  columns?: FlowConfigColumn[];
}

export interface FlowConfigField {
  /**
   * Stable field identity — used as the React key and as the `showWhen.field`
   * reference. Distinct from the storage path so nested-path fields stay
   * unambiguous (e.g. `wait.timerDuration`).
   */
  id: string;
  /**
   * Location of this value on the node object. `['config', 'objectName']`
   * writes `node.config.objectName`; `['waitEventConfig', 'eventType']` writes
   * the spec's top-level `node.waitEventConfig.eventType`.
   */
  path: string[];
  /**
   * Optional secondary read location used when `path` holds no value — lets the
   * inspector tolerate a looser on-disk shape the engine also accepts (e.g. a
   * `wait` node authored with `config.eventType` instead of the spec-canonical
   * `waitEventConfig.eventType`). Reads fall back to it; the inspector writes the
   * canonical `path` and prunes the fallback (migrate-on-edit).
   */
  fallbackPath?: string[];
  /** Human-readable field label (English — repo is English-only). */
  label: string;
  kind: FlowConfigFieldKind;
  placeholder?: string;
  /** Options for `select` fields. */
  options?: Array<{ value: string; label: string }>;
  /** One-line helper hint shown under the control. */
  help?: string;
  /**
   * The spec default for this key, always a string: the `'true'` / `'false'`
   * spelling for a `boolean`, the option's own `value` for a `select`.
   *
   * Read at THREE sites, every one of them only when the key is UNSET
   * ({@link isUnsetFieldValue}) — so the list is what a declaration actually
   * changes on screen, which is the correction objectui#6830 asked for:
   *
   * 1. {@link controllerAdmits} (reached through {@link isFieldVisible})
   *    resolves an unset `showWhen` CONTROLLER through it, so a declared
   *    default decides which fields are on screen at all.
   * 2. Since objectui#8451 (objectui#6830 arm A) a `boolean` control seeds its
   *    checked state from it, so the box shows the value the runtime applies
   *    rather than a blank `false`.
   * 3. Since objectui#6830 arm A's select half, a `select` control shows it as
   *    the trigger's PLACEHOLDER — the matching option's label, drawn muted —
   *    so the same fact is legible there without becoming a selection.
   *
   * Shown, never WRITTEN: it does not become part of the node, at any of the
   * three. objectui#6263's standing ruling ("the console needs no second
   * default contract") is what keeps the write half out — a fourth READ site
   * is cheap, a first write site is not this file's to add.
   *
   * ⚠️ A declaration here is a claim about the installed spec and is acted on
   * as one; `flow-node-config.spec-reconciliation.test.ts` reconciles EVERY
   * declaring field against its own per-node-type spec schema, so a drift
   * reddens on the bump. objectui#9109 widened that ledger from the
   * approval-escalation block, which it used to walk alone — declarations the
   * installed spec applies none of had been sitting outside it, unchecked, for
   * exactly that reason. A declaration added in a region the ledger has no spec
   * schema for now fails there by name rather than going unnoticed.
   *
   * ⭐ Those unbacked declarations were then DELETED (objectui#9109's second
   * half, triage's direction B). The reasoning is this doc comment applied to
   * itself: it defines the property AS the spec default for its key, so a
   * declaration with no spec counterpart is FALSE by that definition, and
   * removing it restores an invariant rather than deciding anything. ⛔ The
   * other end — adding the missing `.default()`s to a published contract —
   * changes what omitting the key MEANS; that is a maintainer's call and a
   * `packages/spec` change, ⛔ never made from this file. What the deletion
   * cost is DISPLAY only, and it was measured as such: a declared default is
   * shown, never written (objectui#6263), so the submit side cannot observe one.
   *
   * What the ledger cannot decide is which END of a divergence to move: it
   * RECORDS an unbacked declaration (and the reverse case, a spec default this
   * table states nowhere) in registers that re-measure themselves, and leaves
   * the choice to a human. ⇒ derive a new value from the spec, never from
   * taste.
   */
  defaultValue?: string;
  /**
   * Conditional visibility: only render this field when the controlling field
   * (referenced by its `id`) currently resolves to one of `equals`. A field is
   * always shown if it already holds a stored value, so existing config is
   * never hidden.
   */
  showWhen?: { field: string; equals: string[] };
  /**
   * Flow-level visibility (objectui#11054): only render this field when the
   * OWNING FLOW's trigger kind — the spec's `resolveFlowTriggerKind` over the
   * whole draft, the one question the engine asks before it binds a trigger —
   * is one of these. The gate for a key the engine reads because of what the
   * flow as a whole resolves to, not because of one sibling field: an `api`
   * flow is `type: 'api'` at the flow level OR `triggerType: 'api'` on the
   * start node, and a `showWhen` on the select alone would miss the first.
   *
   * Same re-show rule as {@link showWhen}: a stored value keeps the field on
   * screen, flagged as retained, whatever the kind. The host supplies the kind
   * ({@link isFieldVisible}'s fourth argument); a host that supplies none never
   * admits a `flowKind` field on the gate alone.
   *
   * A field that carries BOTH gates is admitted when EITHER admits it
   * (objectui#12672). The spec resolves some kinds from a descriptor's
   * PRESENCE — `config.timeRelative`, `config.schedule` — and never from the
   * start node's `triggerType` select, so the two gates answer different
   * questions: `flowKind` says the engine binds this flow as that kind (the
   * canonical node stores no `triggerType`, and a select-only gate called its
   * live sweep "not in effect"), and `showWhen` on the select says the author
   * asked for that kind before its descriptor exists (a kind-only gate would
   * hide the very fields that create the descriptor). Neither is a fallback
   * for the other: a field is inert only when the engine binds another kind
   * AND the author has not asked for this one.
   */
  flowKind?: readonly FlowTriggerKind[];
  /**
   * A notice shown beside the control while the field holds no value and its
   * gate admits it (objectui#11054) — for a key the engine refuses the flow
   * without. English, like `help`; the zh overlay localizes it. Shown, never
   * blocking: the host's save is not held back by it.
   */
  unsetNotice?: string;
  /** Column schema for `objectList` fields (array-of-objects repeater). */
  columns?: FlowConfigColumn[];
  /**
   * For a `keyValue` field that shares its map with typed sibling fields: the
   * keys those siblings own, which this editor must neither show nor overwrite
   * (#4305). A connector action whose descriptor publishes an `inputSchema` gets
   * a typed field per declared key, and the repeater stays behind — bound to the
   * SAME `connectorConfig.input` map — for the undeclared extras only. The host
   * inspector filters the value it passes down and merges the commit back, so
   * the stored map round-trips whole.
   */
  omitKeys?: string[];
  /** Reference target for `reference` fields — drives the combobox data source. */
  ref?: FlowReferenceSpec;
  /**
   * Data-picker brace mode override (#1934). Defaults by kind (`expression` →
   * bare CEL, `text` / `textarea` → a literal with no picker, objectui#12329:
   * since spec 18 no flow string outside the text slots reads a `{…}` token,
   * objectstack#19939 S7 having deleted the single-brace resolver). Overrides:
   *   • `'hole'` on a flow TEXT slot (objectui#11824): the slot renders ADR-0032
   *     §3 `{{ }}` template holes and the spec refuses a single-brace `{…}`
   *     token there, so the picker inserts `{{ x }}` and the inline check flags
   *     a single brace with the double-brace fix. Set on the slots the spec's
   *     `FLOW_NODE_TEXT_SLOTS` names: `notify` `title` / `message` /
   *     `actionUrl`, `screen` `title` / `description`, `end` `message`, `http`
   *     `url`, and `http` `headers`, a key/value map whose every value is one
   *     (objectui#12101) — and carried onto a served field of the same key by
   *     `mergeServerFlowFields`, since the published descriptor marks none of
   *     them.
   *   • `'expression'` on a code field (e.g. a script body) so the picker inserts
   *     bare references, the spelling a JS/TS script reads.
   *
   * There is no single-brace member (objectui#12390): the `'template'` mark
   * and its dialect are retired. The loop / map `collection` carries no
   * override — it is an `expression` field, so the picker inserts the bare
   * name and a stored `{x}` gets the brace check, which is what a body-less
   * loop's executor reads (the bare name of a list variable). Where the spec's
   * ledger names the position a `value` slot (a `map`, a `loop` with a `body`)
   * `FlowNodeConfigField` renders the ledger's literal / CEL-envelope control
   * instead (objectui#12372), and the analysis passes ask the same ledger.
   */
  refMode?: 'expression' | 'hole';
  /**
   * Render this `expression` field with the row-based {@link ConditionBuilder}
   * (raw CEL stays one click away as the escape hatch) — objectui#6226.
   *
   * OPT-IN PER DESCRIPTOR, never inferred from `kind`. `expression` is not a
   * synonym for "record predicate": a loop's `collection` is a list, a
   * `recordId` is a scalar lookup, and a script body is code. Only a
   * field that is genuinely a predicate over the TRIGGER RECORD's vocabulary
   * flags itself here.
   *
   * Flagging is necessary but not sufficient. The builder's subjects are a
   * DECLARED vocabulary, so {@link FlowNodeConfigField} mounts it only where the
   * mount site also supplies one — the `TriggerScope` `flow-scope.ts` resolves
   * (`fieldPrefix`, `includePrevious`, `objectName`). No declared vocabulary (a
   * schedule / manual / api trigger binds no record) ⇒ the field keeps the
   * raw expression input rather than the component guessing a scope from the
   * value it was handed.
   */
  conditionBuilder?: boolean;
}

/** Convenience: a `['config', key]`-rooted field (the common case). */
function cfg(
  key: string,
  label: string,
  kind: FlowConfigFieldKind,
  extra: Partial<FlowConfigField> = {},
): FlowConfigField {
  return { id: key, path: ['config', key], label, kind, ...extra };
}

/** Convenience: a top-level node field at `[block, key]` (spec-structured). */
function at(
  block: string,
  key: string,
  label: string,
  kind: FlowConfigFieldKind,
  extra: Partial<FlowConfigField> = {},
): FlowConfigField {
  return { id: `${block}.${key}`, path: [block, key], label, kind, ...extra };
}

/** Reusable HTTP method options. */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }));

/**
 * Config groups keyed by the spec `FlowNodeAction` type. CRUD/script/http
 * fields live under `config`; wait/connector/boundary use the spec's
 * top-level structured blocks.
 */
const FLOW_NODE_CONFIG: Record<string, FlowConfigField[]> = {
  // Trigger — the start node IS the flow trigger (spec: `'start' // Trigger`).
  // The trigger CATEGORY is flow-level (`flow.type`); the start node's `config`
  // carries the trigger PARAMETERS. Keys match real production metadata:
  // record-change starts use objectName + criteria; scheduled starts use a
  // `schedule` cadence (a cron, an interval or a set time). All optional and shown together (no category gating) so every
  // real start node renders without falling back to JSON.
  start: [
    cfg('triggerType', 'Trigger', 'select', {
      help: 'When this flow starts. Record triggers fire on data changes; schedule triggers fire on a schedule (a cron, an interval or a set time).',
      options: [
        { value: 'record-after-create', label: 'Record created' },
        { value: 'record-after-update', label: 'Record updated' },
        { value: 'record-after-write', label: 'Record created or updated' },
        { value: 'record-before-update', label: 'Record before update' },
        { value: 'record-after-delete', label: 'Record deleted' },
        { value: 'schedule', label: 'Schedule' },
        { value: 'time_relative', label: 'Time-relative (date sweep)' },
        { value: 'manual', label: 'Manual / autolaunched' },
        // objectui#11054 — `api` is the token the engine routes to the inbound
        // hook (`resolveFlowTriggerKind` in `@objectstack/spec/automation`).
        // This option used to write `webhook`, which resolves to no trigger
        // kind at all: the flow bound nothing and never received a post.
        { value: 'api', label: 'Webhook / API' },
        // objectui#11067 — no 「Platform event」 option. It wrote
        // `triggerType: 'event'`, which `resolveFlowTriggerKind` answers no
        // kind for and no engine trigger binds, so a flow authored with it
        // never fired. A stored `event` is not rewritten: the select shows it
        // as its flagged unknown value, and a save keeps it as written.
      ],
    }),
    // objectui#11054 — the inbound hook's per-flow secret. The engine refuses
    // an `api`-kind flow whose start node carries no non-blank `config.secret`,
    // so the field is gated on the FLOW's kind (`flowKind`), not on the select:
    // a flow-level `type: 'api'` needs it just as much.
    //
    // Write-only. A server that withholds the secret from definition reads
    // serves the start node WITHOUT the key, and keeps the stored secret when a
    // save carries no key either — so leaving this blank must write nothing,
    // and a value already on the draft is never put back into the control.
    cfg('secret', 'Secret', 'secret', {
      flowKind: ['api'],
      help: 'The per-flow secret the inbound hook verifies every post against. Write-only: a saved secret is never shown here, and leaving this blank keeps it.',
      unsetNotice: 'No secret entered. An API-triggered flow is refused unless its start node carries a secret. A secret already saved on this flow is kept when this is left blank.',
    }),
    // objectui#12780 — gated on exactly the kind whose binding reads it. The
    // engine lifts `config.objectName` into the record-change binding, and the
    // record-change trigger hooks that object. The schedule and API bindings
    // never read it. A time-relative binding falls back to it only for the
    // object its runtime-state row names: the sweep itself reads
    // `config.timeRelative.object`, which `TimeRelativeTriggerSchema` requires,
    // so a sweep authored through this field would not bind. The New
    // automation dialog asks for an object on exactly this `showWhen`.
    cfg('objectName', 'Object', 'reference', {
      ref: { kind: 'object' },
      help: 'Object whose record changes start this flow.',
      flowKind: ['record_change'],
      showWhen: { field: 'triggerType', equals: ['record-after-create', 'record-after-update', 'record-after-write', 'record-before-update', 'record-after-delete'] },
    }),
    cfg('condition', 'Entry condition', 'expression', {
      // objectui#6226 — the one predicate every business admin meets. Row
      // builder over the trigger record's own vocabulary (bare fields +
      // `previous.*`, per flow-scope's TriggerScope), raw CEL as the escape
      // hatch. Deliberately NOT set on `criteria` below: that legacy key is
      // render-only-when-present, so nothing is ever authored into it.
      conditionBuilder: true,
      placeholder: 'status == "qualifying" && previous.status != "qualifying"',
      help: 'CEL predicate — the flow runs only when this is true (for time-relative sweeps it gates each matched record). Leave empty to run on every event. On a "created or updated" trigger, `previous == null` selects the create path.',
      // objectui#12672, objectui#12780 — no gate: the engine evaluates a start
      // node's `condition` itself at the top of every run, before any node
      // runs (the trigger-condition gate in `@objectstack/service-automation`'s
      // `AutomationEngine`). That covers every trigger kind, and also a manual
      // `execute()` of a flow that binds no trigger. A gate on any kind list
      // flagged a live predicate "not in effect" outside that list.
    }),
    // Schedule descriptor — author the canonical nested `config.schedule` object
    // the runtime actually reads (resolveTriggerBinding → normalizeSchedule). This
    // field used to write a FLAT `config.cron`, which the backend never reads — so
    // designer-authored scheduled flows silently never bound. `fallbackPath`
    // migrates an existing flat `config.cron` to `config.schedule.expression` on
    // first edit.
    //
    // objectui#12779 — the path is this field's address, not how it reads:
    // `getFieldValue` reads `config.schedule` the way the engine resolves it
    // (`scheduleCadenceOf`), so a bare string, `{ expression }` and `{ cron }`
    // all show their cron. An interval or once cadence draws read-only as what
    // it is (`readOnlyScheduleCadence`): the designer edits cron cadences only.
    // A commit rewrites the whole block through `scheduleWithExpression`, which
    // keeps a bare string a string and an object's `type` / `timezone`, so the
    // stored cadence resolves to the cron the field shows.
    //
    // objectui#12672 — gated on the flow's RESOLVED kind as well as on the
    // select: a `type: 'schedule'` flow, or a start node carrying
    // `config.schedule`, resolves to `schedule` with no `triggerType` stored, and
    // a sweep's cadence is read beside its `timeRelative` descriptor.
    {
      id: 'schedule.expression',
      path: ['config', 'schedule', 'expression'],
      fallbackPath: ['config', 'cron'],
      label: 'Cron schedule',
      kind: 'text',
      placeholder: '0 7 * * *',
      help: 'Cron expression — when the flow runs. A time-relative sweep defaults to daily if left empty.',
      flowKind: ['schedule', 'time_relative'],
      showWhen: { field: 'triggerType', equals: ['schedule', 'time_relative'] },
    },
    // Time-relative trigger (objectstack-ai/objectstack#1874) — a `config.timeRelative` descriptor sweeps an
    // object on a schedule (daily by default) and launches the flow once per record
    // whose date field falls in the window. All fields live under the nested
    // `config.timeRelative` block (which the whole group "owns", so it never leaks
    // to Advanced JSON — same pattern as the approval `escalation.*` block).
    //
    // objectui#12672 — every field here is gated on the flow's RESOLVED kind
    // (`flowKind`), because the spec makes a start node a sweep by the
    // descriptor's presence: the canonical node (the showcase's
    // `showcase_task_due_reminder`) stores no `triggerType`, and a select-only
    // gate flagged its live sweep "not in effect". The select gate stays beside
    // it as the way an author asks for a sweep before the descriptor exists.
    {
      id: 'timeRelative.object',
      path: ['config', 'timeRelative', 'object'],
      label: 'Sweep object',
      kind: 'reference',
      ref: { kind: 'object' },
      help: 'Object whose records are swept each run.',
      flowKind: ['time_relative'],
      showWhen: { field: 'triggerType', equals: ['time_relative'] },
    },
    {
      id: 'timeRelative.dateField',
      path: ['config', 'timeRelative', 'dateField'],
      label: 'Date field',
      kind: 'text',
      placeholder: 'end_date',
      help: 'The date / datetime field compared against today.',
      flowKind: ['time_relative'],
      showWhen: { field: 'triggerType', equals: ['time_relative'] },
    },
    {
      id: 'timeRelative.withinDays',
      path: ['config', 'timeRelative', 'withinDays'],
      label: 'Within days',
      kind: 'number',
      placeholder: '30',
      help: 'Range mode: fire while the date is within N days of today (negative = overdue lookback). Leave empty if using Offset days.',
      flowKind: ['time_relative'],
      showWhen: { field: 'triggerType', equals: ['time_relative'] },
    },
    {
      id: 'timeRelative.offsetDays',
      path: ['config', 'timeRelative', 'offsetDays'],
      label: 'Offset days',
      kind: 'numberList',
      placeholder: '60',
      help: 'Offset mode: fire when the date is exactly today + each offset (e.g. 60, 30, 7). Leave empty if using Within days.',
      flowKind: ['time_relative'],
      showWhen: { field: 'triggerType', equals: ['time_relative'] },
    },
    {
      id: 'timeRelative.filter',
      path: ['config', 'timeRelative', 'filter'],
      label: 'Extra filter',
      kind: 'keyValue',
      help: 'Optional filter ANDed with the date window (e.g. status = active).',
      flowKind: ['time_relative'],
      showWhen: { field: 'triggerType', equals: ['time_relative'] },
    },
    {
      id: 'timeRelative.maxRecords',
      path: ['config', 'timeRelative', 'maxRecords'],
      label: 'Max records / run',
      kind: 'number',
      placeholder: '1000',
      help: 'Cap on records launched per sweep (default 1000).',
      flowKind: ['time_relative'],
      showWhen: { field: 'triggerType', equals: ['time_relative'] },
    },
    // Legacy `criteria` key — rendered only when present so older metadata never
    // falls back to raw JSON. Prefer `condition` above for new flows. (There is no
    // legacy `schedule` text field: the `schedule.expression` field above owns the
    // whole `config.schedule` block and reads it as the engine resolves it
    // (`scheduleCadenceOf`), so a bare-string or object-shaped schedule renders
    // through it — a raw text field on `config.schedule` would print
    // "[object Object]" for the object shape.)
    cfg('criteria', 'Entry condition (legacy)', 'expression', {
      placeholder: 'status == "active"',
      help: 'Legacy key — prefer "Entry condition" (condition).',
      showWhen: { field: '__legacy__', equals: [] },
    }),
  ],
  end: [
    // objectui#9278 — `outcome` is a CLOSED enum, and `FlowNodeSchema`
    // discriminates an `end` node's config through `EndConfigSchema`, so a
    // value outside it is refused at the door rather than ignored at run time.
    // It was a free-text box whose placeholder printed `success · failure`:
    // two words the parse contract refuses, and on a key with no dropdown that
    // placeholder was the only vocabulary the form offered — so the author's
    // most likely action was to type one of them, and the flow then failed to
    // load. The options and the declared default are derived from the installed
    // spec, as the `defaultValue` doc comment above requires of a declaration
    // outside the escalation ledger, and reconciled against `EndConfigSchema`
    // in `FlowNodeInspector.declaredDefault.test.tsx` so the claim cannot rot.
    cfg('outcome', 'Outcome', 'select', {
      options: [
        { value: 'completed', label: 'Completed' },
        { value: 'refused', label: 'Refused' },
      ],
      defaultValue: 'completed',
      // `refused` carries a cross-field rule the spec states and this form has
      // no typed control for yet: it REQUIRES a `message` saying why, as a
      // `{{ }}` template. Named here so picking it is not a one-click route to
      // a flow that will not load; the key itself stays authorable in Advanced.
      help: 'How the run ends here. "Completed" is the ordinary terminal and is what an omitted key applies. "Refused" records a first-class refusal — a successful evaluation that says no — and requires a message saying why (a {{ }} template), authored in the field below.',
    }),
    // objectui#9336 — the other half of that cross-field rule, which
    // `EndConfigSchema` enforces in BOTH directions via a `superRefine`:
    // `refused` REQUIRES `message`, `completed` (including an omitted key,
    // which the declared default resolves to `completed`) REFUSES it. With no
    // typed control, picking `refused` in this form was a blocked authoring
    // path — the one key the chosen outcome requires was reachable only through
    // Advanced JSON, so the most direct route through the repaired dropdown
    // produced a flow that fails to load.
    //
    // `textarea` is derived, not chosen: the spec's own `message` description
    // says it is "a template rendered at run time exactly like a screen `description`",
    // and that field IS a `textarea` in this table — as is the sibling
    // `message` key on `notify`. The label and placeholder are the spec's own
    // words (its describe opens "Why the run was refused", and both the
    // describe and the refusal message give this exact example), so the form
    // states the contract rather than a second vocabulary.
    //
    // ⛔ No `defaultValue`: `message` is `z.string().min(1).optional()` with no
    // `.default()`, and a declaration here is read as a claim about the
    // installed spec (see the `defaultValue` doc comment above).
    //
    // The gate is what makes the pair authorable in both directions. An unset
    // `outcome` resolves through the declared `completed` default, so the field
    // stays off screen until the author actually picks `refused`; a STORED
    // `message` re-shows it regardless (`isFieldVisible`'s stored-value rule),
    // which is what lets an author clear a stale message after switching back
    // to `completed` — the case the contract's other direction refuses. The
    // clearing itself lands: `setAtPath` deletes the leaf on an empty commit,
    // so the key goes away rather than becoming `''`, which this schema refuses
    // under BOTH outcomes (`min(1)`, and the completed-forbids-message rule).
    cfg('message', 'Why the run was refused', 'textarea', {
      placeholder: 'Refused: {{ record.name }} is a confirmed duplicate',
      help: 'Required when the outcome is "Refused", and refused on a completed end — a completion renders nothing, so the key would be a silent no-op. A {{ }} template rendered at run time (e.g. {{ record.name }}), exactly like a screen Description.',
      showWhen: { field: 'outcome', equals: ['refused'] },
      refMode: 'hole',
    }),
    // objectui#9335 — there is deliberately NO `outputVariable` row here.
    //
    // `EndConfigSchema` is a STRICT object whose whole key surface is the pair
    // above, so the loader refuses `outputVariable` BY NAME (`Unrecognized
    // key(s) on this end node config`). A typed control for it could therefore
    // only ever produce a flow that fails to load — not a nicety that happened
    // to be ignored at run time, but a route to an unsavable draft, on a box
    // that looked as ordinary as the ones beside it. An `end` node terminates
    // rather than producing a value to bind, so there is nothing to name.
    //
    // ⛔ Not kept as a `__legacy__` render-only row either (the treatment
    // `condition` on `decision` and the retired `script` keys get). That
    // pattern is for keys the schema ACCEPTS and the runtime ignores — showing
    // them costs nothing because the document still loads. A key the schema
    // REFUSES needs no control at all, and a stored one is NOT hidden by this
    // absence: an unowned config key falls through to the Advanced (JSON)
    // block, which auto-opens when non-empty, so it stays visible and
    // clearable. The key is real product vocabulary on the groups whose spec
    // config declares it; those keep theirs.
    //
    // ⭐ The removal also UN-HIDES objectui#9336's rule: an unrecognized key
    // short-circuits `EndConfigSchema`'s `superRefine`, so while this box
    // existed a `refused` end that used it reported only `unrecognized_keys`
    // and never the missing-`message` refusal.
    //
    // All of the above is re-derived rather than restated by
    // `FlowNodeInspector.endOutputVariable-9335.test.tsx`.
  ],
  decision: [
    cfg('conditions', 'Branches', 'objectList', {
      // framework#4414: the default/else path is the out-edge marked
      // `isDefault`, not the branch itself — a `true` branch is how you ask for
      // one, and FlowEdgeInspector.applyBranch() writes the marker. Saying
      // "a `true` branch IS the default path" conflated the two, which is the
      // reading that let a decision ship with a guard that did not guard.
      help: 'Each branch has a label, a CEL expression (bare references, no braces), and a target node. Branches are tried in order and the first match wins. A branch whose expression is "true" is the catch-all: picking its target marks that out-edge as the default path, taken only when no other branch matched. Picking a target wires the branch’s outgoing edge (creating or updating it); clearing it detaches that edge.',
      columns: [
        { key: 'label', label: 'Label', kind: 'text', placeholder: 'Has deals' },
        { key: 'expression', label: 'Expression', kind: 'expression', placeholder: 'expiring_deals.length > 0' },
        // #1942 — virtual column: derived from / applied to the out-edges by
        // FlowNodeInspector (flow-decision-edges), never stored on the branch.
        { key: 'target', label: 'Target', kind: 'reference', placeholder: 'next node', ref: { kind: 'node' } },
      ],
    }),
    // Render-only for a stored legacy value (`__legacy__` never matches, so it
    // is not offered for new authoring). The old help said "Prefer Branches
    // above", which reads as "this works, but the other is better" — it does
    // not work at all: framework#4414 confirmed the decision executor never
    // reads `config.condition`. The key is the trigger gate on a `start` node
    // and inert on every other node type, and `os validate` now reports it as
    // `flow-inert-node-condition`.
    cfg('condition', 'Condition (single)', 'expression', {
      placeholder: 'amount > 10000',
      help: 'Inert — nothing reads this. The engine only honours `condition` on a Start node (the trigger gate); on a Decision it gates nothing. Shown so a stored value is not invisible. Move the predicate to a branch above, or to the outgoing edge’s own condition, then clear this.',
      showWhen: { field: '__legacy__', equals: [] },
    }),
    // `@objectstack/spec` 17.5.0 added `DecisionConfigSchema.mode`, and the
    // decision executor reads it (objectui#11073). An OPTIONAL enum with NO
    // `.default()`, so ⛔ no `defaultValue` here, the objectui#9109 rule: the
    // spec's own text says an omitted mode means `exclusive`, but it
    // materialises nothing, and a declaration would state a default the spec
    // does not apply. The spec refuses it beside a non-empty `conditions` list.
    cfg('mode', 'Branch mode', 'select', {
      options: [
        { value: 'exclusive', label: 'Exclusive' },
        { value: 'inclusive', label: 'Inclusive' },
      ],
      help: 'For a decision that branches on its out-edge conditions: Exclusive takes only the first edge that holds, in edge order (what leaving this unset means); Inclusive takes every edge that holds. The default edge runs when none holds. Not allowed together with Branches above.',
    }),
  ],
  assignment: [
    cfg('assignments', 'Assignments', 'keyValue', {
      help: 'Set variables: each key is a variable, each value an expression or literal.',
    }),
  ],
  loop: [
    // objectui#12372 — with a `body`, `collection` is a value slot (the spec's
    // ledger row, `onlyWithKey: 'body'`): a CEL value envelope evaluating to a
    // list, or the items as an inline array. `FlowNodeConfigField` renders that
    // slot's literal / expression control from the ledger. A body-less loop is
    // the legacy flat-graph form, whose executor reads the bare name of a list
    // variable and which no door judges, so the descriptor control stays for it.
    cfg('collection', 'Collection', 'expression', {
      placeholder: 'leadList',
      help: 'The list to iterate: a CEL expression evaluating to a list (e.g. leadList), or the items as a JSON array. A loop with no body region reads the bare name of a list variable instead.',
    }),
    // objectui#9340 — the hint is the identifier the runtime binds when this box is
    // left blank, so it may not name a DIFFERENT one. It hinted `currentItem` while
    // `LoopConfigSchema` applies its own default to the omitted key: an author who
    // read the box and wrote that reference in the body got an unresolved one at run
    // time. ⛔ Not repaired by declaring a `defaultValue` — a `text` control reads
    // `placeholder` and NONE of the three sites the `defaultValue` doc comment above
    // names (objectui#9109 fence 4 owns that wiring). The value is reconciled against
    // the installed spec by `FlowNodeInspector.loopItemVariable-9340.test.tsx`; the
    // twin on `map` already agreed and is pinned there too, so a drift on EITHER
    // reddens rather than being re-derived by hand here.
    cfg('iteratorVariable', 'Item variable', 'text', { placeholder: 'item' }),
  ],
  // Sequential multi-instance (ADR-0037 A2): a per-item subflow, one at a time;
  // each item may durably pause (e.g. a per-item approval).
  map: [
    // objectui#12372 — a value slot: a CEL value envelope evaluating to a list,
    // or the items as an inline array (rendered from the spec's ledger).
    cfg('collection', 'Collection', 'expression', {
      placeholder: 'items',
      help: 'The list to process, one item at a time: a CEL expression evaluating to a list (e.g. items), or the items as a JSON array.',
    }),
    cfg('flowName', 'Per-item flow', 'reference', { ref: { kind: 'flow' }, placeholder: 'one_task_signoff', help: 'Subflow run for each item — it may pause (e.g. an approval).' }),
    cfg('iteratorVariable', 'Item variable', 'text', { placeholder: 'item' }),
    cfg('itemObject', 'Item object', 'reference', { ref: { kind: 'object' }, help: 'When items are records, the object they belong to (exposes each item as the child’s record).' }),
    cfg('outputVariable', 'Output variable', 'text', { placeholder: 'results', help: 'Each item’s subflow output, collected in order.' }),
  ],
  create_record: [
    cfg('objectName', 'Object', 'reference', { ref: { kind: 'object' } }),
    cfg('fields', 'Field values', 'keyValue', { help: 'Field values to write on the new record.' }),
    cfg('outputVariable', 'Output variable', 'text', { placeholder: 'newRecord' }),
  ],
  update_record: [
    cfg('objectName', 'Object', 'reference', { ref: { kind: 'object' } }),
    // objectui#12372 — each `filter` operand is a value slot (the ledger's
    // `filterOperands` row): a literal, or a CEL value envelope.
    cfg('filter', 'Filter', 'keyValue', {
      help: 'Field/value pairs identifying the record(s) to update. Each value is a literal, or a CEL expression (e.g. id \u2192 recordId as an expression).',
    }),
    cfg('fields', 'Field values', 'keyValue', { help: 'Field values to write.' }),
  ],
  delete_record: [
    cfg('objectName', 'Object', 'reference', { ref: { kind: 'object' } }),
    cfg('filter', 'Filter', 'keyValue', {
      help: 'Field/value pairs identifying the record(s) to delete. Each value is a literal, or a CEL expression.',
    }),
  ],
  get_record: [
    cfg('objectName', 'Object', 'reference', { ref: { kind: 'object' } }),
    cfg('filter', 'Filter', 'keyValue', {
      help: 'Field/value pairs to match (e.g. status \u2192 active). Each value is a literal, or a CEL expression. Operator values like {"$ne": null} are preserved.',
    }),
    cfg('limit', 'Limit', 'number', { placeholder: '100' }),
    cfg('outputVariable', 'Output variable', 'text', { placeholder: 'records' }),
  ],
  // objectui#12742 — keyed `http`, the spec's node type: spec 18 reserves
  // `http_request`, `http_call` and `webhook` (the authoring doors refuse them
  // with the rename to `http`), so no alias picks this group.
  http: [
    // ⛔ No `defaultValue` (objectui#9109): `HttpConfigSchema.method` is
    // `z.string().optional()` with NO `.default()`, so an omitted key
    // materialises nothing and a declaration here would be a claim about the
    // installed spec with nothing behind it (see the `defaultValue` doc comment
    // above). ⚠️ That is a statement about SCHEMA DEFAULTING only — the flow
    // EXECUTOR lives in `objectstack` and may well apply `GET`; this repo does
    // NOT MEASURE that, and ⛔ does not claim it false. If it is true the repair
    // is a `.default('GET')` upstream, which this table would then mirror — the
    // direction #0.1 requires (fix the contract, not the view).
    cfg('method', 'Method', 'select', { options: HTTP_METHODS }),
    // objectui#12101 — `url` and each `headers` value are flow text slots
    // (`FLOW_NODE_TEXT_SLOTS`): they render `{{ }}` holes, and the spec refuses
    // a single-brace `{…}` token in them.
    cfg('url', 'URL', 'text', {
      placeholder: 'https://api.example.com/v1/contracts',
      help: 'Request URL. Renders {{ }} holes.',
      refMode: 'hole',
    }),
    cfg('headers', 'Headers', 'keyValue', {
      help: 'Request headers (e.g. Authorization, Content-Type). Each value renders {{ }} holes.',
      refMode: 'hole',
    }),
    // objectui#12372 — `body` is a value slot: a literal sent as written (JSON
    // typed here is stored as the object or list it spells), or a CEL value
    // envelope evaluated to the payload. A string carrying a `{…}` token is
    // refused, so the text cell has no reference picker.
    cfg('body', 'Body', 'textarea', {
      placeholder: '{ "key": "value" }',
      help: 'Request payload: JSON sent as written, or a CEL expression evaluated to the payload.',
    }),
    // objectui#11968 — deliberately NO `outputVariable` row, the objectui#9335
    // shape on another node. The `http` executor contract (`HttpConfigSchema`,
    // reached through the spec's `getBuiltinNodeConfigContracts()`) is strict
    // and declares no such key, the executor never reads it, and the engine's
    // registration refuses a flow carrying it. This group renders only while
    // the server's descriptor is loading or unavailable, so the row turned an
    // ordinary fallback edit into a flow that saved and then never registered;
    // the online form, built from the descriptor, never offered it. A stored
    // one is not hidden: an unowned config key falls through to the Advanced
    // (JSON) block, where it stays visible and clearable.
    // `flow-node-config.contractKeys-11968.test.tsx` holds every group here to
    // the keys its node's contract declares.
    { id: 'timeoutMs', path: ['timeoutMs'], label: 'Timeout (ms)', kind: 'number', placeholder: '30000' },
  ],
  // Script — one thing: call a registered function (framework#1870).
  // `function` + `inputs` + `outputVariable` is the whole authorable surface,
  // reconciled against the spec-published `ScriptConfigSchema` (framework#4278).
  //
  // framework#4343 retired the other dispatch branches, and the form follows.
  // None of them ran: `actionType: 'email' | 'slack'` were logger-backed stubs
  // that reported success and delivered nothing (with `template` / `recipients`
  // / `variables` addressing a message no channel sent), inline `script` was
  // never executed (the built-in runtime has no server-side JS sandbox), and
  // any other `actionType` was a second spelling of `function`. Real delivery
  // is a `notify` node; Slack is a connector (or an `http` webhook).
  //
  // The five keys stay as legacy render-only fields (`__legacy__` never
  // matches, so they are never OFFERED) because a stored node must still show
  // everything it carries — the rule this group already followed for the
  // `code` / `sms` / `notification` action types #3099 dropped. Each carries
  // the replacement in its help text; `os migrate meta --from 16` rewrites the
  // stored metadata.
  script: [
    cfg('function', 'Function', 'text', {
      placeholder: 'score_lead',
      help: 'Registered function to call — declared via defineStack({ functions }). Required: it is what this step runs.',
    }),
    cfg('inputs', 'Inputs', 'keyValue', {
      // objectui#12101 — `inputs.*` is a value slot (ADR-0032 §2): a literal, or
      // a CEL value envelope evaluated in the flow's scope.
      help: 'Values passed to the function. Each is a literal, or a CEL expression evaluated against the flow variables.',
    }),
    cfg('outputVariable', 'Output variable', 'text', {
      placeholder: 'aiResult',
      help: "Flow variable the function's return value is bound to, for later steps.",
    }),
    cfg('actionType', 'Action type (retired)', 'text', {
      help: 'Retired in spec 17 — "email"/"slack" never delivered anything, and any other value was just the function name. Use a notify node for messages, a Slack connector for Slack, or move the name into Function.',
      showWhen: { field: '__legacy__', equals: [] },
    }),
    cfg('template', 'Template (retired)', 'text', {
      help: 'Retired in spec 17 — it fed a side effect that never rendered or sent a message. A notify node carries its own title/message.',
      showWhen: { field: '__legacy__', equals: [] },
    }),
    cfg('recipients', 'Recipients (retired)', 'stringList', {
      help: 'Retired in spec 17 — these addresses were logged, never messaged. Use a notify node, whose recipients reach the messaging service.',
      showWhen: { field: '__legacy__', equals: [] },
    }),
    cfg('variables', 'Template variables (retired)', 'keyValue', {
      help: 'Retired in spec 17 — injected into a template nothing rendered. A notify node carries structured data in payload.',
      showWhen: { field: '__legacy__', equals: [] },
    }),
    cfg('script', 'Code (not executed, retired)', 'textarea', {
      placeholder: 'return { ok: true };',
      help: 'Retired in spec 17 — inline scripts were NEVER executed by the built-in runtime (no server-side sandbox). Move the logic into a registered function and name it in Function.',
      refMode: 'expression',
      showWhen: { field: '__legacy__', equals: [] },
    }),
    { id: 'timeoutMs', path: ['timeoutMs'], label: 'Timeout (ms)', kind: 'number', placeholder: '30000' },
  ],
  // Screen — collect input (a flat `fields` list) OR render an object's full
  // create/edit form (`objectName`, master-detail). `title`/`description`
  // head the screen (both render `{{ }}` holes); `waitForInput` forces a
  // pause on a field-less message/confirmation screen. All optional and shown
  // together so neither a message screen nor an object-form step needs JSON.
  screen: [
    cfg('title', 'Title', 'text', { placeholder: 'Request a discount', help: 'Heading shown above the screen.', refMode: 'hole' }),
    cfg('description', 'Description', 'textarea', {
      placeholder: 'Enter the deal amount and the discount you want.',
      help: 'Body text. Renders {{ }} holes (e.g. {{ approval_path }}).',
      refMode: 'hole',
    }),
    cfg('fields', 'Fields', 'objectList', {
      help: 'Input fields collected on this screen. Leave empty for a message-only screen.',
      columns: [
        { key: 'name', label: 'Name', kind: 'text', placeholder: 'discount' },
        { key: 'label', label: 'Label', kind: 'text', placeholder: 'Discount %' },
        { key: 'type', label: 'Type', kind: 'text', placeholder: 'number' },
        { key: 'required', label: 'Required', kind: 'boolean' },
        // A sibling-field shape (the flows guide's example): the predicate binds
        // this screen's own fields, never a run variable (objectui#10743).
        { key: 'visibleWhen', label: 'Visible when', kind: 'expression', placeholder: 'createOpportunity == true' },
      ],
    }),
    cfg('waitForInput', 'Wait for input', 'boolean', {
      help: 'Pause to show this screen even with no fields (a message / confirmation). A field-less screen with this off is a server pass-through.',
    }),
    cfg('objectName', 'Object form', 'reference', {
      ref: { kind: 'object' },
      help: 'Render this object\u2019s full create/edit form (incl. master-detail) instead of a flat field list.',
    }),
    cfg('idVariable', 'Saved-record variable', 'text', {
      placeholder: 'account_id',
      help: 'Object form only: variable bound to the saved record\u2019s id, for later steps.',
    }),
    // objectui#9109 deleted this field's `defaultValue` while
    // `ScreenConfigSchema.mode` was an OPTIONAL enum with no `.default()`.
    // `@objectstack/spec` 17.5.0 gave it one — an omitted key now materialises
    // `'create'` — so the declaration returns, as that card's pin said it would
    // the day the spec started applying one, with the spec's own value
    // (objectui#11073). Shown, never written (objectui#6263).
    cfg('mode', 'Form mode', 'select', {
      defaultValue: 'create',
      options: [
        { value: 'create', label: 'Create' },
        { value: 'edit', label: 'Edit' },
      ],
      help: 'Object form only.',
    }),
    cfg('defaults', 'Form defaults', 'keyValue', {
      // objectui#12101 — `defaults.*` is a value slot: a literal, or a CEL value
      // envelope (e.g. `account_id` as an expression).
      help: 'Object form only: prefilled values. Each is a literal, or a CEL expression (e.g. account \u2192 account_id as an expression).',
    }),
  ],
  // Approval node (ADR-0019). The node opens an approval request on entry,
  // suspends the run, and resumes down its `approve` / `reject` out-edge once a
  // decision is recorded. Config mirrors `@objectstack/spec`
  // ApprovalNodeConfigSchema; entry criteria and on-approve / on-reject actions
  // are NOT here — they live on the graph (the edge into this node, and the
  // nodes wired to its `approve` / `reject` out-edges).
  approval: [
    cfg('approvers', 'Approvers', 'objectList', {
      help: 'Who may act on this step. Wire the node’s out-edges with labels "approve" and "reject".',
      columns: [
        {
          key: 'type',
          label: 'Type',
          kind: 'select',
          // OFFLINE FALLBACK ONLY. `FlowNodeInspector` renders
          // `serverFields ?? fieldsForNodeType(...)`, so against a real backend
          // the approval node's fields come from the engine-published
          // configSchema and this list is never read — it covers the preview
          // gallery and any stack whose server publishes no schema.
          //
          // That is why the ordering below is ALSO carried by the spec's
          // `ApproverType` enum (framework#3508 follow-up): stating it only
          // here left the live picker in enum order with `user` first, the
          // exact opposite of the intent. Indirect bindings lead and the
          // literal `user` binding comes last — binding a specific person is
          // the least portable choice (env moves, people leave). Keep the two
          // in sync; the spec is the source of truth.
          //
          // Both paths also drop the spec's NON_AUTHORABLE_APPROVER_TYPES —
          // `role` (deprecated spelling of `org_membership_level`, ADR-0090 D3)
          // and `queue` (declared-but-unenforced; the runtime resolves it to
          // nobody, framework#3508). A stored row of either still renders,
          // flagged "(deprecated)", but neither is offered for new authoring.
          options: [
            { value: 'manager', label: 'Manager' },
            { value: 'position', label: 'Position' },
            { value: 'department', label: 'Department' },
            { value: 'team', label: 'Team' },
            { value: 'field', label: 'Field' },
            // objectstack-ai/objectstack#3447: CEL over current.* / trigger.* / vars.*, resolved at node
            // entry — the value cell switches to the expression input.
            { value: 'expression', label: 'Expression (CEL)' },
            { value: 'org_membership_level', label: 'Organization membership tier' },
            { value: 'user', label: 'User' },
          ],
        },
        {
          // Polymorphic: the picker follows the row's `type` — record lookups
          // for the directory kinds, a strict select for the membership tier,
          // an auto-resolved cell for `manager`, an object-field picker for
          // `field` (objectstack-ai/objectstack#3508). Unmapped/empty types fall back to free
          // text — except `expression` (objectstack-ai/objectstack#3447), which the cell special-cases
          // into the CEL expression input (it is a discriminator value, not a
          // reference kind, so it deliberately has no `map` entry).
          key: 'value',
          label: 'Value',
          kind: 'reference',
          placeholder: 'User id / membership tier / position / team / department / field — per `type`',
          ref: {
            kindFrom: 'type',
            objectSource: '$trigger',
            // `role` maps to the same picker as `org_membership_level`, and
            // `queue` stays mapped (free text + warning): the designer no
            // longer offers either, but stored rows must keep rendering for
            // the length of the deprecation window.
            map: {
              user: 'user',
              position: 'position',
              org_membership_level: 'org-membership-level',
              role: 'org-membership-level',
              team: 'team',
              department: 'department',
              manager: 'manager',
              field: 'object-field',
              queue: 'queue',
            },
          },
        },
        {
          // objectstack-ai/objectstack#3447: expression-only — how the expression's resolved ids expand
          // into people. Dead config on other types (linted server-side).
          key: 'resolveAs',
          label: 'Resolve as',
          kind: 'select',
          options: [
            { value: 'user', label: 'User ids (default)' },
            { value: 'department', label: 'Department ids → members' },
            { value: 'position', label: 'Position names → holders' },
            { value: 'team', label: 'Team ids → members' },
          ],
        },
        {
          // Group label for `per_group` sign-off (objectstack-ai/objectstack#3266): approvers sharing a
          // label form one group; the node advances when EACH group reaches
          // `minApprovals`. Ignored by other behaviors.
          key: 'group',
          label: 'Group',
          kind: 'text',
          placeholder: 'legal / finance — for per-group sign-off',
        },
      ],
    }),
    cfg('behavior', 'Behavior', 'select', {
      options: [
        { value: 'first_response', label: 'First response wins' },
        { value: 'unanimous', label: 'Unanimous (all approve)' },
        { value: 'quorum', label: 'Quorum (M of N approve)' },
        { value: 'per_group', label: 'Per group (each group signs off)' },
      ],
      defaultValue: 'first_response',
      help: 'How multiple approvers combine. Any rejection is a veto in every mode.',
    }),
    cfg('minApprovals', 'Min approvals', 'number', {
      placeholder: '1',
      help: 'Approvals required — total for quorum, per group for per_group. Clamped server-side so it can never deadlock.',
    }),
    // `defaultValue` mirrors the spec's `.default(true)` (objectui#9277): an
    // approval config that OMITS `lockRecord` parses as LOCKED, so a table
    // declaring nothing drew the box UNCHECKED — the inspector told the author
    // the record stayed editable while the node was pending, and the runtime
    // locked it. Since objectui#8451 seeded the boolean control from this
    // property, an absent declaration is not a missing claim here; it is the
    // wrong one. Derived from the installed `ApprovalNodeConfigSchema`, never
    // from taste — `FlowNodeInspector.declaredDefault.test.tsx` re-derives it
    // from that schema rather than restating the literal.
    cfg('lockRecord', 'Lock record', 'boolean', {
      defaultValue: 'true',
      help: 'Lock the triggering record from edits while this node is pending.',
    }),
    cfg('approvalStatusField', 'Status field', 'reference', {
      ref: { kind: 'object-field', objectSource: '$trigger' },
      placeholder: 'approval_status',
      help: 'Business-object field to mirror request status onto (pending/approved/rejected). Should be readonly.',
    }),
    // objectstack-ai/objectstack#3447: empty-slate policy — load-bearing for expression approvers, whose
    // slate is runtime data and may legitimately resolve to nobody.
    cfg('onEmptyApprovers', 'If no approver resolves', 'select', {
      options: [
        { value: 'admin_rescue', label: 'Hold for admin takeover (default)' },
        { value: 'fail', label: 'Fail the node (config bug)' },
        { value: 'auto_approve', label: 'Auto-approve (waves through!)' },
      ],
      defaultValue: 'admin_rescue',
      help: 'What an empty resolved approver slate does at node entry. Auto-approve silently waves the record through — opt in deliberately.',
    }),
    // Per-node SLA escalation (spec ApprovalEscalationSchema, nested under
    // config.escalation). Sub-fields reveal once escalation is enabled.
    //
    // `defaultValue` mirrors the spec's `.default(true)` (objectui#6620). An
    // approval node whose escalation block OMITS `enabled` parses as ENABLED,
    // so a table declaring 'false' drew the gate OFF and hid four sub-fields
    // that are live at runtime — the inspector said "no escalation" about a
    // node that escalates. The value is NOT a constant of this file:
    // `flow-node-config.spec-reconciliation.test.ts` derives every default in
    // this block from the installed `ApprovalEscalationSchema`, so the next
    // upstream flip reddens there rather than diverging silently again.
    //
    // That default applies INSIDE a block. Whether the block exists is the
    // switch itself (objectui#11660, `BLOCK_SWITCHES` below): no block reads
    // off, and switching off never writes a bare `{ enabled: false }` — with
    // nothing entered no block is written; entered values stay beside
    // `enabled: false`. The engine-published copy of this gate behaves the
    // same: the rule is keyed by path, not declared here.
    { id: 'escalation.enabled', path: ['config', 'escalation', 'enabled'], label: 'SLA escalation', kind: 'boolean', defaultValue: 'true', help: 'Escalate when a decision is not recorded within the timeout.' },
    { id: 'escalation.timeoutHours', path: ['config', 'escalation', 'timeoutHours'], label: 'Timeout (hours)', kind: 'number', placeholder: '24', showWhen: { field: 'escalation.enabled', equals: ['true'] } },
    {
      id: 'escalation.action', path: ['config', 'escalation', 'action'], label: 'On timeout', kind: 'select', defaultValue: 'notify',
      options: [
        { value: 'notify', label: 'Notify' },
        { value: 'reassign', label: 'Reassign' },
        { value: 'auto_approve', label: 'Auto-approve' },
        { value: 'auto_reject', label: 'Auto-reject' },
      ],
      showWhen: { field: 'escalation.enabled', equals: ['true'] },
    },
    { id: 'escalation.escalateTo', path: ['config', 'escalation', 'escalateTo'], label: 'Escalate to', kind: 'reference', ref: { kind: 'position' }, placeholder: 'position machine name / user id', showWhen: { field: 'escalation.enabled', equals: ['true'] } },
    // `defaultValue` mirrors the spec's `.default(true)` (#6794): an escalation
    // block that omits the key parses as NOTIFYING, so a table that declares no
    // default asserts the opposite of what the runtime does. The engine-published
    // configSchema already carries it (`json-schema-to-fields` turns JSON-Schema
    // `default: true` into `defaultValue: 'true'`) — this is the offline half.
    { id: 'escalation.notifySubmitter', path: ['config', 'escalation', 'notifySubmitter'], label: 'Notify submitter', kind: 'boolean', defaultValue: 'true', showWhen: { field: 'escalation.enabled', equals: ['true'] } },
    // ADR-0044 send-back-for-revision guard. Surfaces from the engine's
    // published configSchema when online; this hardcoded copy keeps it visible
    // offline / on an older backend. Only meaningful once the node has a
    // `revise` out-edge (author one via the canvas "add revision loop").
    cfg('maxRevisions', 'Max revisions', 'number', {
      placeholder: '3',
      defaultValue: '3',
      help: 'Max send-backs for revision before the request auto-rejects (0 disables send-back). Needs a "revise" out-edge to take effect.',
    }),
  ],
  wait: [
    // ⛔ No `defaultValue` (objectui#9109), and here the declaration was not
    // merely unbacked — it was the WRONG SHAPE of statement. `eventType` is
    // REQUIRED on the spec's `waitEventConfig` block: an omitted key does not
    // behave as `timer`, it FAILS TO PARSE. Declaring one told the author (and
    // an AI author reading the reference page) that leaving the key alone was a
    // working configuration, in two ways at once — `controllerAdmits` revealed
    // `timerDuration` below on a node that had stored no `eventType` at all, and
    // the select trigger stated `Timer` as its placeholder.
    //
    // ⭐ Deleting it does NOT leave the required key without a value: a declared
    // default is SHOWN, NEVER WRITTEN (objectui#6263), so the key was unset
    // before and after. What changes is DISPLAY only — `timerDuration` now stays
    // off screen until the author picks `timer`, which is the correct prompt for
    // a key they must set. A STORED value re-shows regardless
    // (`isFieldVisible`'s stored-value rule), so no existing config hides.
    at('waitEventConfig', 'eventType', 'Wait for', 'select', {
      options: [
        { value: 'timer', label: 'Timer' },
        { value: 'signal', label: 'Signal' },
        { value: 'webhook', label: 'Webhook' },
        { value: 'manual', label: 'Manual' },
        { value: 'condition', label: 'Condition' },
      ],
      fallbackPath: ['config', 'eventType'],
    }),
    at('waitEventConfig', 'timerDuration', 'Duration', 'text', {
      placeholder: 'PT1H · P3D',
      help: 'ISO 8601 duration (e.g. PT1H, P3D).',
      showWhen: { field: 'waitEventConfig.eventType', equals: ['timer'] },
      fallbackPath: ['config', 'timerDuration'],
    }),
    at('waitEventConfig', 'signalName', 'Signal name', 'text', {
      placeholder: 'contract.renewed',
      showWhen: { field: 'waitEventConfig.eventType', equals: ['signal', 'webhook'] },
      fallbackPath: ['config', 'signalName'],
    }),
    // `waitEventConfig.timeoutMs` / `.onTimeout` were REMOVED here (#3101,
    // framework#4158): `wait` never had a timeout. `onTimeout` had zero readers
    // — neither 'fail' nor 'continue' ever happened — and `timeoutMs`'s only
    // reader used it as the timer DURATION when `timerDuration` was absent, so
    // it did something, just not what it said. Both are `retiredKey()`
    // tombstones on `FlowNodeSchema` since spec 17.0.0-rc.1, so a value written
    // here is now REJECTED at load: keeping the fields would let an author
    // produce metadata their own runtime refuses. Use `Duration` above — it
    // accepts a bare number as milliseconds, making the old `timeoutMs: 60000`
    // and `timerDuration: '60000'` the same wait. Stored flows are converted by
    // framework's D2 conversion; the designer just stops offering the entry.
  ],
  subflow: [
    cfg('flowName', 'Flow', 'reference', { ref: { kind: 'flow' }, placeholder: 'escalation_flow' }),
    // objectui#12101 — `input.*` is a value slot (ADR-0032 §2): a literal, or a
    // CEL value envelope evaluated in the calling flow's scope.
    cfg('input', 'Input mapping', 'keyValue', {
      help: 'Values passed to the subflow\u2019s input variables. Each is a literal, or a CEL expression evaluated in this flow.',
    }),
    cfg('outputVariable', 'Output variable', 'text', { placeholder: 'subResult' }),
    { id: 'timeoutMs', path: ['timeoutMs'], label: 'Timeout (ms)', kind: 'number', placeholder: '60000' },
  ],
  // `notify` — outbound notification (ADR-0012), dispatched via the messaging
  // service. Config keys mirror the built-in node's server descriptor
  // (service-automation `notify-node.ts` configSchema): title + ≥1 recipient
  // are required at execute time; channels default to inbox. Surfaced here as a
  // first-class static editor so the node is authorable offline, not only when
  // the running engine publishes its descriptor (framework#1878/#1895).
  notify: [
    // objectui#11788 — a picker, not a free-text list, and it renders online
    // too: the published descriptor declares `recipients` untyped (the contract
    // takes a string or a string array), so `mergeServerFlowFields` keeps this
    // editor for it rather than leaving the key to Advanced (JSON).
    cfg('recipients', 'Recipients', 'recipients', { help: 'Who receives the notification: a field of the trigger record, a user, a team or an email address. At least one is required.' }),
    cfg('title', 'Title', 'text', { placeholder: 'Your request was approved', help: 'Notification title (required).', refMode: 'hole' }),
    cfg('message', 'Message', 'textarea', { placeholder: 'Supports {{ var }} template holes.', help: 'Notification body.', refMode: 'hole' }),
    cfg('channels', 'Channels', 'stringList', { help: 'Channels to fan out to (default: inbox — e.g. inbox · email · push).' }),
    cfg('topic', 'Topic', 'text', { placeholder: 'notify', help: 'Event topic (default: "notify").' }),
    cfg('severity', 'Severity', 'select', {
      options: [
        { value: 'info', label: 'Info' },
        { value: 'warning', label: 'Warning' },
        { value: 'critical', label: 'Critical' },
      ],
      help: 'Notification severity.',
    }),
    // Click-through target (objectstack-ai/objectstack#2675): deep-link the notification to a record.
    cfg('sourceObject', 'Link object', 'text', { placeholder: 'sys_approval_request', help: 'Object of the record the notification links to (requires Link record id).' }),
    // objectui#12372 — a value slot: the id as a string, or a CEL value envelope.
    cfg('sourceId', 'Link record id', 'text', {
      help: 'Record id the notification links to (requires Link object): the id as text, or a CEL expression (e.g. record.id).',
    }),
    // objectui#11968 — the canonical key. This row wrote `url`, which
    // `NotifyConfigSchema` does not declare: it is the converted spelling the
    // engine's conversion rewrites to `actionUrl`, so the form was authoring
    // an alias rather than the contract. The online form already writes
    // `actionUrl`; a stored `url` shows in the Advanced (JSON) block.
    cfg('actionUrl', 'Click-through URL', 'text', {
      help: 'Explicit link; overrides the one synthesized from Link object/record. Renders {{ }} holes.',
      refMode: 'hole',
    }),
  ],
  connector_action: [
    at('connectorConfig', 'connectorId', 'Connector', 'reference', { ref: { kind: 'connector' }, placeholder: 'slack · email · salesforce' }),
    // actionId is polymorphic on the chosen connector: the picker lists THAT
    // connector's actions (runtime descriptors), degrading to free text if none.
    // (a deliberate open extension point) — stays free text.
    at('connectorConfig', 'actionId', 'Action', 'reference', { ref: { kind: 'connector-action', connectorSource: 'connectorId' }, placeholder: 'sendMessage · send' }),
    at('connectorConfig', 'input', 'Input', 'keyValue', { help: 'Mapped inputs for the connector action.' }),
    { id: 'timeoutMs', path: ['timeoutMs'], label: 'Timeout (ms)', kind: 'number', placeholder: '30000' },
  ],
  // ADR-0031 structured constructs. Their bodies are nested regions
  // (config.branches / config.try / config.catch) — sub-graphs the flat field
  // kinds can't model; authors edit them in the JSON source editor. Only the
  // scalar knobs surface here.
  parallel: [],
  try_catch: [
    cfg('errorVariable', 'Error variable', 'text', {
      placeholder: '$error',
      help: 'Variable the caught error is bound to inside the catch region.',
    }),
  ],
  // Legacy BPMN interop pair — kept so imported flows still render an
  // inspector, but no longer offered by the palette / type picker (the engine
  // has no executor; ADR-0031 makes them import/export-only).
  parallel_gateway: [],
  join_gateway: [],
  boundary_event: [
    at('boundaryConfig', 'attachedToNodeId', 'Attached to', 'reference', { ref: { kind: 'node' }, placeholder: 'host node id', help: 'Host node this boundary event monitors.' }),
    // ⛔ No `defaultValue` (objectui#9109) — same REQUIRED-key shape as
    // `wait.waitEventConfig.eventType` above: the spec's `boundaryConfig` block
    // requires `eventType`, so an omitted key does not behave as `error`, it
    // fails to parse. `errorCode` below is the sibling the declaration used to
    // reveal on a node storing no `eventType`; it now waits for the author to
    // pick `error`, and a stored value re-shows it regardless.
    at('boundaryConfig', 'eventType', 'Event type', 'select', {
      options: [
        { value: 'error', label: 'Error' },
        { value: 'timer', label: 'Timer' },
        { value: 'signal', label: 'Signal' },
        { value: 'cancel', label: 'Cancel' },
      ],
    }),
    // `defaultValue` mirrors the spec's `.default(true)` (objectui#9277): a
    // `boundaryConfig` that OMITS `interrupting` parses as INTERRUPTING, so a
    // table declaring nothing drew the box UNCHECKED and told the author the
    // host activity would keep running — it is cancelled. Same shape as
    // `lockRecord` above, derived from the installed `FlowNodeSchema` boundary
    // block and re-derived in `FlowNodeInspector.declaredDefault.test.tsx`.
    at('boundaryConfig', 'interrupting', 'Interrupting', 'boolean', {
      defaultValue: 'true',
      help: 'Cancel the host activity when this event fires.',
    }),
    at('boundaryConfig', 'errorCode', 'Error code', 'text', {
      placeholder: 'TIMEOUT (empty = all)',
      showWhen: { field: 'boundaryConfig.eventType', equals: ['error'] },
    }),
    at('boundaryConfig', 'timerDuration', 'Duration', 'text', {
      placeholder: 'PT1H',
      showWhen: { field: 'boundaryConfig.eventType', equals: ['timer'] },
    }),
    at('boundaryConfig', 'signalName', 'Signal name', 'text', {
      placeholder: 'contract.cancelled',
      showWhen: { field: 'boundaryConfig.eventType', equals: ['signal'] },
    }),
  ],

  /**
   * Legacy generic "action" group — retained for flows authored before the
   * spec node types were adopted. Never auto-migrated to a spec type (the old
   * `action` could mean create/update/query/email/webhook); authors re-pick a
   * precise type explicitly.
   */
  legacy_action: [
    cfg('action', 'Action', 'text', { placeholder: 'sendEmail · createTask · update · query' }),
    cfg('objectName', 'Object', 'reference', { ref: { kind: 'object' } }),
    cfg('recordId', 'Record', 'expression', { placeholder: 'record.id' }),
    cfg('params', 'Parameters', 'keyValue', { help: 'Action inputs. Values auto-typed: 3 \u2192 number, true \u2192 boolean.' }),
    cfg('fields', 'Field values', 'keyValue' ),
    cfg('outputVariable', 'Output variable', 'text', { placeholder: 'result' }),
  ],
};

/**
 * Maps legacy / alias designer node types onto a spec config group. The spec
 * `FlowNodeAction` types resolve to themselves; older designer types resolve to
 * the closest spec group. Legacy generic `action` resolves to `legacy_action`
 * (kept deliberately distinct — never silently rewritten to a CRUD type).
 */
const TYPE_ALIASES: Record<string, string> = {
  action: 'legacy_action',
  branch: 'decision',
  gateway: 'decision',
  condition: 'decision',
  timer: 'wait',
  delay: 'wait',
  flow: 'subflow',
  invoke: 'subflow',
  task: 'legacy_action',
  user_task: 'screen',
  service_task: 'connector_action',
  script_task: 'script',
  notification: 'connector_action',
  signal: 'boundary_event',
  for_each: 'loop',
};

/** Resolve the config fields for a node type (alias-aware). */
export function fieldsForNodeType(type?: string): FlowConfigField[] {
  if (!type) return [];
  const canonical = TYPE_ALIASES[type] ?? type;
  return FLOW_NODE_CONFIG[canonical] ?? [];
}

/** A field that edits `node.config.<key>` rather than a spec-structured sibling block. */
function isConfigRooted(field: FlowConfigField): boolean {
  return field.path[0] === 'config';
}

/**
 * Merge the engine-published field set with the hand-written group for a node
 * type (framework#4045).
 *
 * A published `configSchema` describes **`node.config` and nothing else** — that
 * is what the descriptor's contract says (ADR-0018) and what
 * {@link jsonSchemaToFlowFields} produces, since it roots every field it emits
 * at `['config', key]`. But several node types keep part (or all) of their
 * contract in a spec-structured SIBLING block on the node — `connectorConfig`
 * (connector_action), `waitEventConfig` (wait), `boundaryConfig`
 * (boundary_event) — or at the node top level (`timeoutMs`, four types).
 *
 * Replacing the whole group with the server's therefore deletes editors the
 * server never claimed to describe. That is not hypothetical: `connector_action`
 * shipped a `configSchema` declaring `connectorId`/`actionId`/`input` as CONFIG
 * keys, and against a live backend it replaced this table's `connectorConfig.*`
 * fields — connector and action pickers included — so an author writing a
 * connector node online filled in keys the executor never reads, and the node
 * refused to dispatch. framework#4210 retired that schema; this merge is what
 * stops the next one from doing the same to `wait` or `boundary_event`.
 *
 * So the server owns the config-rooted fields (it is the authority on what the
 * executor reads), and the hand-written non-config fields are always preserved,
 * in their declared order, after them. When no schema is published the
 * hand-written group is used whole, unchanged.
 *
 * objectui#11788 — one exception inside the config-rooted half. A key the
 * schema DECLARES (`declaredKeys`, from `declaredConfigKeys`) but the mapper
 * emitted no field for — `notify.recipients`, published untyped because the
 * contract takes a string or a string array — keeps the hand-written editor for
 * that key, in the key's declared position. Without it the online form dropped
 * the field the offline form shows, and the author met the key only as Advanced
 * (JSON). A key the schema does not declare is never brought back: the engine
 * rejects undeclared config keys at `registerFlow()`.
 *
 * objectui#11824 — a served field keeps the hand-written field's `refMode:
 * 'hole'` for the same config key. The descriptor publishes a flow text slot
 * (`screen` `title` / `description`) as a plain string, with no marker naming
 * the `{{ }}` dialect, so the mapped field would default to the single-brace
 * template mode and its picker would insert a token the spec refuses there.
 * Only the brace mode is carried; the label, help and kind stay the server's.
 */
export function mergeServerFlowFields(
  serverFields: FlowConfigField[] | null | undefined,
  type?: string,
  declaredKeys?: ReadonlyArray<DeclaredConfigKey> | null,
): FlowConfigField[] {
  const handWritten = fieldsForNodeType(type);
  if (!serverFields) return handWritten;
  // A sibling-block field the server also described (by id) is not duplicated —
  // the server's config-rooted version is dropped in favour of the structured
  // editor, since a `config`-rooted duplicate would write where nothing reads.
  const serverConfigFields = serverFields.filter(isConfigRooted);
  const preserved = handWritten.filter((f) => !isConfigRooted(f));
  const preservedKeys = new Set(preserved.map((f) => f.path[f.path.length - 1]));
  const holeKeys = new Set(handWritten.filter((f) => isConfigRooted(f) && f.refMode === 'hole').map((f) => f.path[1]));
  const served = serverConfigFields
    .filter((f) => !preservedKeys.has(f.path[f.path.length - 1]))
    .map((f) => (f.path.length === 2 && holeKeys.has(f.path[1]) ? { ...f, refMode: 'hole' as const } : f));
  return [...withUnmappedDeclaredKeys(served, handWritten, preservedKeys, declaredKeys), ...preserved];
}

/**
 * `served` with the hand-written editor of every declared-but-unmapped config
 * key put back at that key's declared position (objectui#11788), labelled and
 * described by the schema where it says something — the server owns the words
 * for its keys as it does for every field it maps (`meta()` in
 * `json-schema-to-fields.ts`); the table lends only the control. The served
 * fields keep their own order: the mapper emits them in declaration order, so
 * walking the declared keys reproduces it.
 */
function withUnmappedDeclaredKeys(
  served: FlowConfigField[],
  handWritten: FlowConfigField[],
  preservedKeys: ReadonlySet<string>,
  declaredKeys: ReadonlyArray<DeclaredConfigKey> | null | undefined,
): FlowConfigField[] {
  if (!declaredKeys?.length) return served;
  const configKey = (f: FlowConfigField) => f.path[1];
  const out: FlowConfigField[] = [];
  const placed = new Set<FlowConfigField>();
  for (const declared of declaredKeys) {
    const mapped = served.filter((f) => configKey(f) === declared.key);
    if (mapped.length || preservedKeys.has(declared.key)) {
      for (const f of mapped) {
        out.push(f);
        placed.add(f);
      }
      continue;
    }
    for (const f of handWritten) {
      if (!isConfigRooted(f) || configKey(f) !== declared.key) continue;
      out.push({
        ...f,
        ...(declared.title ? { label: declared.title } : {}),
        ...(declared.description ? { help: declared.description } : {}),
      });
    }
  }
  // Defensive: a served field under a key the declared list does not name.
  for (const f of served) if (!placed.has(f)) out.push(f);
  return out;
}

/** Overlay a column's zh label / option labels (English is the fallback). */
function localizeColumn(
  col: FlowConfigColumn,
  cz: { label?: string; opts?: Record<string, string> } | undefined,
): FlowConfigColumn {
  if (!cz) return col;
  const out: FlowConfigColumn = { ...col };
  if (cz.label) out.label = cz.label;
  if (col.options && cz.opts) {
    out.options = col.options.map((o) => ({ ...o, label: cz.opts![o.value] ?? o.label }));
  }
  return out;
}

/** Overlay a field's zh label / help / option / column labels. The raw node
 *  type wins over its alias, so a type with its OWN server field set (e.g.
 *  `notify`, which aliases to `connector_action` for the offline client fields)
 *  still gets its own translations. */
function localizeField(rawType: string, canonicalType: string, field: FlowConfigField): FlowConfigField {
  const z = flowFieldZh(rawType, field.id) ?? flowFieldZh(canonicalType, field.id);
  if (!z) return field;
  const out: FlowConfigField = { ...field };
  if (z.label) out.label = z.label;
  if (z.help) out.help = z.help;
  if (field.unsetNotice && z.unsetNotice) out.unsetNotice = z.unsetNotice;
  if (field.options && z.opts) {
    out.options = field.options.map((o) => ({ ...o, label: z.opts![o.value] ?? o.label }));
  }
  if (field.columns && z.cols) {
    out.columns = field.columns.map((c) => localizeColumn(c, z.cols![c.key]));
  }
  return out;
}

/**
 * Localize a resolved flow-field list for the active locale. English is a
 * no-op (the table is authored in English); for zh-CN each field's label /
 * help / options / column labels are overlaid from `FLOW_FIELD_ZH`, falling
 * back to English for any field not covered (e.g. plugin nodes). Keyed by the
 * canonical node type so it works for both the hardcoded table and the
 * engine-published `configSchema` fields (which share field ids).
 */
export function localizeFlowFields(
  type: string | undefined,
  fields: FlowConfigField[],
  locale?: string,
): FlowConfigField[] {
  if (!type || !isZhLocale(locale)) return fields;
  const canonical = TYPE_ALIASES[type] ?? type;
  return fields.map((f) => localizeField(type, canonical, f));
}

/** Read the current value at a field's node path, falling back to `fallbackPath`. */
export function getFieldValue(node: Record<string, unknown> | null | undefined, field: FlowConfigField): unknown {
  // objectui#12779 — the start node's cadence is read the way the engine reads
  // it, not by walking a path a bare string or `{ cron }` does not have.
  if (isScheduleExpressionPath(field.path)) return scheduleFieldValue(node, field);
  const read = (path: string[]): unknown => {
    let cur: unknown = node;
    for (const seg of path) {
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) cur = (cur as Record<string, unknown>)[seg];
      else return undefined;
    }
    return cur;
  };
  const primary = read(field.path);
  if (primary !== undefined) return primary;
  return field.fallbackPath ? read(field.fallbackPath) : undefined;
}

/**
 * A start node's cadence, in the three shapes the engine runs (objectui#12779).
 */
export type ScheduleCadence =
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'interval'; intervalMs: number }
  | { type: 'once'; at: string };

/** The path of the start group's Cron schedule field. */
const SCHEDULE_EXPRESSION_PATH: readonly string[] = ['config', 'schedule', 'expression'];

/** Whether `path` is the start group's Cron schedule field's (objectui#12779). */
export function isScheduleExpressionPath(path: readonly string[]): boolean {
  return path.length === SCHEDULE_EXPRESSION_PATH.length && path.every((seg, i) => seg === SCHEDULE_EXPRESSION_PATH[i]);
}

/**
 * Resolve a stored `config.schedule` to the cadence the engine runs, or `null`
 * when the engine binds none (objectui#12779).
 *
 * A mirror of `normalizeSchedule` in objectstack
 * `packages/triggers/trigger-schedule/src/schedule-trigger.ts`, which the
 * schedule trigger calls on `config.schedule` when it binds a flow. It is
 * mirrored rather than imported: this package takes no dependency on a
 * `@objectstack/trigger-*` package. Every branch and its order are the
 * engine's, so a form the engine accepts reads here and a form it refuses
 * reads `null`:
 *   - a bare cron string;
 *   - `{ expression }` or `{ cron }`, with `type: 'cron'` or untyped
 *     (`expression` wins over `cron`; `timezone` rides along);
 *   - `{ intervalMs }` or `{ every }`, with `type: 'interval'` or untyped;
 *   - `{ at }`, with `type: 'once'` or untyped.
 * A `type` the engine does not know, or a typed descriptor missing its value,
 * resolves to nothing.
 */
export function normalizeScheduleCadence(raw: unknown): ScheduleCadence | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const expr = raw.trim();
    return expr ? { type: 'cron', expression: expr } : null;
  }
  if (typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const type = typeof s.type === 'string' ? s.type : undefined;
  if (type === 'cron' || (!type && (typeof s.cron === 'string' || typeof s.expression === 'string'))) {
    const expression =
      (typeof s.expression === 'string' && s.expression) || (typeof s.cron === 'string' && s.cron) || undefined;
    if (!expression) return null;
    const out: ScheduleCadence = { type: 'cron', expression };
    if (typeof s.timezone === 'string') out.timezone = s.timezone;
    return out;
  }
  if (type === 'interval' || (!type && (typeof s.intervalMs === 'number' || typeof s.every === 'number'))) {
    const intervalMs =
      (typeof s.intervalMs === 'number' && s.intervalMs) || (typeof s.every === 'number' && s.every) || undefined;
    if (!intervalMs || intervalMs <= 0) return null;
    return { type: 'interval', intervalMs };
  }
  if (type === 'once' || (!type && typeof s.at === 'string')) {
    const at = typeof s.at === 'string' ? s.at : undefined;
    if (!at) return null;
    return { type: 'once', at };
  }
  return null;
}

function configOfNode(node: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  const c = node?.config;
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : undefined;
}

/**
 * The cadence a start node's Cron schedule field stands for (objectui#12779):
 * its `config.schedule` as the engine resolves it, else — only for a field
 * that declares the `fallbackPath` — the legacy flat `config.cron` the field
 * migrates on first edit. The engine never reads that flat key; the designer
 * shows it so an author can move it into place.
 */
export function scheduleCadenceOf(
  node: Record<string, unknown> | null | undefined,
  field?: Pick<FlowConfigField, 'fallbackPath'>,
): ScheduleCadence | null {
  const config = configOfNode(node);
  const cadence = normalizeScheduleCadence(config?.schedule);
  if (cadence || (field && !field.fallbackPath)) return cadence;
  const flat = config?.cron;
  return typeof flat === 'string' && flat.trim() !== '' ? { type: 'cron', expression: flat } : null;
}

/**
 * What the Cron schedule field holds: a cron cadence's expression; an interval
 * or once cadence itself, which the designer shows read-only and never offers
 * as a cron (the seat's ruling on objectui#12779); or, when the engine binds
 * nothing, any `expression` string stored on an object-shaped schedule, so a
 * half-written descriptor still reads back what was typed into it.
 */
function scheduleFieldValue(node: Record<string, unknown> | null | undefined, field: FlowConfigField): unknown {
  const cadence = scheduleCadenceOf(node, field);
  if (cadence) return cadence.type === 'cron' ? cadence.expression : cadence;
  const schedule = configOfNode(node)?.schedule;
  if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
    const expression = (schedule as Record<string, unknown>).expression;
    if (expression !== undefined) return expression;
  }
  return undefined;
}

/**
 * The cadence the Cron schedule field draws read-only, or `undefined` when the
 * field is an ordinary cron text box (objectui#12779). Only an interval or once
 * cadence: the designer edits cron cadences only.
 */
export function readOnlyScheduleCadence(
  node: Record<string, unknown> | null | undefined,
  field: Pick<FlowConfigField, 'path' | 'fallbackPath'>,
): Exclude<ScheduleCadence, { type: 'cron' }> | undefined {
  if (!isScheduleExpressionPath(field.path)) return undefined;
  const cadence = scheduleCadenceOf(node, field);
  return cadence && cadence.type !== 'cron' ? cadence : undefined;
}

/** The keys a non-cron cadence is spelt with, which a written cron replaces. */
const NON_CRON_CADENCE_KEYS = ['intervalMs', 'every', 'at'] as const;

/**
 * The `config.schedule` a Cron schedule commit stores (objectui#12779), so the
 * stored descriptor resolves, through the engine's `normalizeSchedule`, to the
 * cron the field then shows. `undefined` removes the schedule.
 *
 * - A bare string stays a bare string: the typed cron replaces it.
 * - No schedule yet stores `{ expression }`, as the field always has.
 * - An object keeps its other keys (`type: 'cron'`, `timezone`) and takes the
 *   typed cron as `expression`; a stale `cron` beside it is dropped, as is a
 *   `type` or value key the engine would resolve ahead of the cron. Those are
 *   only met on a descriptor the engine binds nothing from, since a live
 *   interval or once cadence offers no cron edit at all.
 * - Clearing removes `expression` and `cron`, or the whole schedule when it is
 *   a string, an interval or once cadence, or an object left empty.
 */
export function scheduleWithExpression(schedule: unknown, value: unknown): unknown {
  const expression = typeof value === 'string' ? value : '';
  if (typeof schedule === 'string') return expression === '' ? undefined : expression;
  const isObject = !!schedule && typeof schedule === 'object' && !Array.isArray(schedule);
  const next: Record<string, unknown> = isObject ? { ...(schedule as Record<string, unknown>) } : {};
  delete next.cron;
  if (expression === '') {
    const cadence = normalizeScheduleCadence(schedule);
    if (cadence && cadence.type !== 'cron') return undefined;
    delete next.expression;
  } else {
    if (typeof next.type === 'string' && next.type !== 'cron') delete next.type;
    for (const key of NON_CRON_CADENCE_KEYS) delete next[key];
    next.expression = expression;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/**
 * Boolean gates whose spec meaning is "the enclosing block EXISTS"
 * (objectui#11660), keyed by node type and the gate's path.
 *
 * The approval node's SLA escalation is the one instance, and the spec states
 * it in the declaration itself: `ApprovalEscalationSchema.enabled` is
 * described as "an escalation block carrying timeoutHours is live unless this
 * is explicitly false — the feature-level switch is whether the escalation
 * block exists at all", and the block's `timeoutHours` is REQUIRED whatever
 * `enabled` says. So OFF has two conforming spellings: NO BLOCK, and a block
 * that keeps its `timeoutHours` beside `enabled: false` (the runtime skips the
 * escalation sweep on an explicit `false`). What it refuses is the bare
 * `{ enabled: false }` stub — and the inspector used to write exactly that when
 * an author switched off a node with nothing entered, because the switch drew
 * ON over a node with no block. The flow saved and then failed at the approval
 * node on every run, or, at a door that judges the block, did not save.
 *
 * Keyed by PATH, not by a descriptor member: the offline table and the
 * engine-published `configSchema` (`jsonSchemaToFlowFields`) both emit this
 * path for the gate, so the rule holds whichever of the two produced the field
 * on screen. Triage's ruling on objectui#11660 (6003792818, amending its
 * first grade under objectui#6499 Option C) is what this list carries out: no
 * block reads off; switching off with nothing entered writes no block;
 * switching off a block holding values writes `enabled: false` and keeps every
 * value; clearing the last retained value removes the block.
 */
const BLOCK_SWITCHES: ReadonlyArray<{ nodeType: string; path: readonly string[] }> = [
  { nodeType: 'approval', path: ['config', 'escalation', 'enabled'] },
];

/** Where a field sits relative to a {@link BLOCK_SWITCHES} block. */
export interface SwitchedBlock {
  /** The block whose existence is the switch, e.g. `['config', 'escalation']`. */
  block: readonly string[];
  /** The switch's own key inside that block, e.g. `enabled`. */
  switchKey: string;
  /** Whether the field IS the switch, rather than a value stored inside the block. */
  isSwitch: boolean;
}

/**
 * The switched block `field` belongs to on `node` — as its switch or as a
 * value inside it — or `undefined` for every other field (objectui#11660).
 */
export function switchedBlockOf(
  node: Record<string, unknown> | null | undefined,
  field: Pick<FlowConfigField, 'path' | 'kind'>,
): SwitchedBlock | undefined {
  const type = node?.type;
  if (typeof type !== 'string') return undefined;
  for (const s of BLOCK_SWITCHES) {
    if (s.nodeType !== type) continue;
    const block = s.path.slice(0, -1);
    if (field.path.length <= block.length || !block.every((seg, i) => field.path[i] === seg)) continue;
    const isSwitch =
      field.kind === 'boolean' && field.path.length === s.path.length && s.path.every((seg, i) => field.path[i] === seg);
    return { block, switchKey: s.path[s.path.length - 1], isSwitch };
  }
  return undefined;
}

function blockAt(node: Record<string, unknown> | null | undefined, block: readonly string[]): unknown {
  let cur: unknown = node;
  for (const seg of block) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}

const isBlockObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The value a field's control draws and a `showWhen` controller resolves
 * through: the stored value ({@link getFieldValue}), except that a block
 * switch over an ABSENT block reads `false` (objectui#11660).
 *
 * The switch's declared default (`'true'`, the spec's `.default(true)`) is what
 * the runtime applies to an `enabled` key omitted from a block that EXISTS —
 * the objectui#6620 reading, unchanged: `{ timeoutHours: 24 }` draws checked.
 * With no block there is nothing for that default to apply to, and the spec
 * calls the block's absence OFF; reading the default there drew the toggle
 * checked, and revealed the four escalation fields, on every approval node
 * that has no escalation at all.
 *
 * A READ: it writes nothing, so a node that stores no block keeps storing none.
 */
export function readFieldValue(node: Record<string, unknown> | null | undefined, field: FlowConfigField): unknown {
  const switched = switchedBlockOf(node, field);
  if (switched?.isSwitch && !isBlockObject(blockAt(node, switched.block))) return false;
  return getFieldValue(node, field);
}

/**
 * Whether `node` holds `switched`'s block as the bare `{ <switch>: false }`
 * stub — OFF spelt as a block that holds no entered value, which
 * `ApprovalNodeConfigSchema` refuses for its missing `timeoutHours` and which
 * absence already says (objectui#11660). A switched-off block that still holds
 * any other key is NOT a stub: its values are the author's, kept (objectui#6499
 * Option C).
 */
export function isBareSwitchedOffBlock(
  node: Record<string, unknown> | null | undefined,
  switched: SwitchedBlock,
): boolean {
  const block = blockAt(node, switched.block);
  if (!isBlockObject(block)) return false;
  const keys = Object.keys(block);
  return keys.length === 1 && keys[0] === switched.switchKey && block[switched.switchKey] === false;
}

/**
 * The `config` key this field owns, or `undefined` for fields stored outside
 * `config` (spec-structured blocks, top-level `timeoutMs`). Used by the
 * inspector to compute "extra" config keys for the optional Advanced block —
 * only config-rooted fields suppress an Advanced key.
 */
export function configKeyOf(field: FlowConfigField): string | undefined {
  // Any config-rooted field claims its first config segment — so nested groups
  // (e.g. `['config','escalation','enabled']`) all claim `escalation`, keeping
  // the whole block out of the Advanced editor.
  return field.path.length >= 2 && field.path[0] === 'config' ? field.path[1] : undefined;
}

/**
 * Whether a field should render. Conditional fields show when their controller
 * (by `id`) resolves — via stored value, else spec `defaultValue` — to one of
 * `equals`, OR when the field already holds a stored value (so existing config
 * is never hidden).
 *
 * `flowKind` is the owning flow's trigger kind, for a field gated by
 * {@link FlowConfigField.flowKind} (objectui#11054) — the host resolves it once
 * from the whole draft, for the start node the spec resolves it from. It is
 * read by no other field.
 */
export function isFieldVisible(
  field: FlowConfigField,
  node: Record<string, unknown> | null | undefined,
  fields: FlowConfigField[],
  flowKind?: FlowTriggerKind,
): boolean {
  if (!field.showWhen && !field.flowKind) return true;
  // ⛔ THE STORED-VALUE RE-SHOW RULE — do not weaken it, and do not invert it
  // into a prune. objectui#6499 ruled (maintainer, 2026-08-27, Option C) that a
  // hidden-but-stored dependent value is KEPT: the author sees it and clears it
  // deliberately. Deleting it on save is the rejected option precisely because
  // this line is what stops config an author entered from vanishing unseen.
  if (hasStoredValue(field, node)) return true;
  return controllerAdmits(field, node, fields, flowKind);
}

/**
 * Whether a read value counts as UNSET — the one definition of "the author has
 * stored nothing here", shared by every site that has to answer it.
 *
 * There were three copies of this predicate before objectui#8451: the re-show
 * rule's {@link hasStoredValue}, {@link controllerAdmits}'s fallback to the
 * declared default, and (as of that card) the boolean control's own fallback in
 * `FlowNodeConfigField`. The third is the reason it is exported and named: a
 * control that seeds from `defaultValue` must call a key unset in exactly the
 * words the visibility resolver does, or the same node can render a field whose
 * gate says "unset, so use the default" beside a control that says "stored, so
 * ignore it". `''` is included because a cleared text control commits the empty
 * string rather than deleting the key.
 */
export function isUnsetFieldValue(raw: unknown): boolean {
  return raw === undefined || raw === null || raw === '';
}

/**
 * Whether a field's {@link FlowConfigField.unsetNotice} stands for this value
 * (objectui#11054). A `secret` counts as unset unless it is a non-blank string
 * — the engine's own test for the inbound hook's secret (`trim() !== ''`), so
 * a whitespace-only value keeps the notice up exactly as the engine keeps
 * refusing the flow. Every other kind uses {@link isUnsetFieldValue}.
 */
export function unsetNoticeApplies(field: FlowConfigField, raw: unknown): boolean {
  if (!field.unsetNotice) return false;
  if (field.kind === 'secret') return !(typeof raw === 'string' && raw.trim() !== '');
  return isUnsetFieldValue(raw);
}

/**
 * Whether this field currently holds a stored value — the input to the
 * re-show rule above, named so {@link inactiveRetainedKind} asks the same
 * question in the same words rather than re-deriving "empty".
 */
function hasStoredValue(
  field: FlowConfigField,
  node: Record<string, unknown> | null | undefined,
): boolean {
  return !isUnsetFieldValue(getFieldValue(node, field));
}

/**
 * Whether a gated field's CONTROLLER admits it — the `showWhen` predicate on
 * its own, deliberately blind to the field's own stored value.
 *
 * Split out of {@link isFieldVisible} (behaviour unchanged — it is that
 * function's former tail) so the affordance below and the visibility filter
 * read ONE definition of "the controller says yes". Duplicating the resolution
 * would let the two drift, and the drift would be silent: the affordance would
 * quietly stop matching the fields it is supposed to annotate.
 *
 * A `flowKind` gate (objectui#11054) is one more controller: the flow's
 * resolved trigger kind must be one the field names, and no kind supplied ⇒
 * that gate does not admit. On a field that also carries a `showWhen`, EITHER
 * gate admits it (objectui#12672 — {@link FlowConfigField.flowKind} says why
 * the two are alternatives, not a conjunction).
 */
function controllerAdmits(
  field: FlowConfigField,
  node: Record<string, unknown> | null | undefined,
  fields: FlowConfigField[],
  flowKind?: FlowTriggerKind,
): boolean {
  if (field.flowKind) {
    const kindAdmits = flowKind !== undefined && field.flowKind.includes(flowKind);
    if (kindAdmits || !field.showWhen) return kindAdmits;
  }
  if (!field.showWhen) return true;
  const controller = fields.find((f) => f.id === field.showWhen!.field);
  if (!controller) return false;
  // `readFieldValue`, not the bare stored read: a block switch over an absent
  // block resolves OFF rather than through its declared default (objectui#11660).
  const raw = readFieldValue(node, controller);
  const resolved = isUnsetFieldValue(raw) ? controller.defaultValue : raw;
  // Boolean controllers (e.g. `escalation.enabled`) compare against 'true'/'false'.
  const value = typeof resolved === 'boolean' ? String(resolved) : resolved;
  return typeof value === 'string' && field.showWhen.equals.includes(value);
}

/**
 * Why a gated field is on screen when its controller does not admit it.
 *
 * `'controller-off'` — the descriptor names a controller that EXISTS in this
 * node's field set and currently resolves to something outside `equals`. The
 * author can turn it back on, so the affordance says so.
 *
 * `'no-controller'` — the descriptor's `showWhen.field` resolves to no field
 * at all. The `__legacy__` sentinel (`equals: []`, no such field) is the
 * deliberate instance: a render-only key that is never offered for fresh
 * authoring and appears solely because a value is stored. There is nothing to
 * switch back on, so the affordance must NOT tell the author to go find a
 * toggle — that would be a new small lie on a screen whose whole defect was
 * showing inert config as if it were live.
 */
export type InactiveRetainedKind = 'controller-off' | 'no-controller';

/**
 * The "inactive values retained" predicate (objectui#6499, Option C).
 *
 * True exactly when a field is rendered ONLY because {@link isFieldVisible}'s
 * stored-value re-show rule fired — i.e. the value is stored, the controller
 * does not admit it, and so what the author sees is retained-but-inert config.
 * Returns `null` for every other field, including a gated field the controller
 * genuinely admits and a gated field holding nothing.
 *
 * This is a READ. It changes no stored value, and nothing on the save path
 * consults it; clearing is an ordinary author-initiated field commit through
 * the inspector's existing `setField`, exactly as if the author had emptied the
 * control by hand.
 *
 * A field gated by `flowKind` alone reports `'controller-off'`: its controller
 * is the flow's trigger, which the author can switch back. A field gated by
 * both reports here only when neither admits it (objectui#12672): a stored
 * sweep field is "not in effect" exactly when the spec binds the flow as
 * another kind — a `record-*` trigger outranks a leftover descriptor — and
 * the select does not ask for a sweep either.
 */
export function inactiveRetainedKind(
  field: FlowConfigField,
  node: Record<string, unknown> | null | undefined,
  fields: FlowConfigField[],
  flowKind?: FlowTriggerKind,
): InactiveRetainedKind | null {
  if (!field.showWhen && !field.flowKind) return null;
  if (!hasStoredValue(field, node)) return null;
  if (controllerAdmits(field, node, fields, flowKind)) return null;
  if (!field.showWhen) return 'controller-off';
  return fields.some((f) => f.id === field.showWhen!.field) ? 'controller-off' : 'no-controller';
}

/**
 * What the start node's Trigger select READS while the node stores no
 * `triggerType` (objectui#12672): the option naming the flow's resolved trigger
 * kind, or `undefined`.
 *
 * The spec resolves a kind from a descriptor's presence (`config.timeRelative`,
 * `config.schedule`) or from the flow's own `type`, and the canonical shape of
 * such a start node stores no `triggerType` — so the select drew `—` over a
 * trigger the engine binds. Three kinds are spelled as the select's own option
 * values (`time_relative`, `schedule`, `api`). The fourth, `record_change`,
 * resolves only FROM a stored `record-*` token, so a node that stores none never
 * resolves to it; and a kind the select offers no option for reads nothing
 * rather than a guessed neighbour.
 *
 * A READING, never a value. The host shows it in the select's placeholder slot,
 * `FlowNodeConfigField`'s "show, do not write" channel for what the runtime
 * applies while the node stores nothing (objectui#6830), and nothing writes it:
 * the stored flow stays exactly as authored until the author picks an option,
 * which writes as any pick does. The gates never read it either — they read
 * the kind itself through {@link FlowConfigField.flowKind}.
 */
export function unsetTriggerReading(
  field: FlowConfigField,
  node: Record<string, unknown> | null | undefined,
  flowKind?: FlowTriggerKind,
): string | undefined {
  if (field.id !== 'triggerType' || field.kind !== 'select' || node?.type !== 'start') return undefined;
  if (flowKind === undefined || !isUnsetFieldValue(getFieldValue(node, field))) return undefined;
  return field.options?.some((o) => o.value === flowKind) ? flowKind : undefined;
}

/**
 * Every node type this table holds a hand-written field group for — its keys,
 * the canonical types the aliases in `TYPE_ALIASES` resolve onto through
 * {@link fieldsForNodeType}. The population a sweep over the table walks.
 *
 * ⛔ Not the inspector's Node Type list. That list is the add-node palette's
 * (objectui#11778): it replaced the hand list `FLOW_NODE_TYPE_OPTIONS` that
 * stood here, which offered `http_request` (a name spec 18 reserves, with the
 * rename to `http`) and missed `notify`, a type the palette adds.
 */
export const FLOW_NODE_CONFIG_TYPES: readonly string[] = Object.keys(FLOW_NODE_CONFIG);

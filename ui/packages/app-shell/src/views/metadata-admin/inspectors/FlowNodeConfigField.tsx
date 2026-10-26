// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowNodeConfigField — renders one scalar config control for a flow node,
 * driven by a `FlowConfigField` descriptor. Bridges descriptor "kind" to the
 * shared inspector field primitives and writes back to `node.config[key]`.
 */

import * as React from 'react';
import { isUnsetFieldValue, unsetNoticeApplies } from './flow-node-config.js';
import type { FlowConfigField, InactiveRetainedKind } from './flow-node-config.js';
import { t, tFormat } from '../i18n.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import { WIDGETS, OBJECTUI_SECRET_MASK } from '../widgets.js';
import {
  InspectorNumberField,
  InspectorSelectField,
  InspectorCheckboxField,
  RequiredMarker,
  flagUnknownValue,
} from './_shared.js';
import { Button, Label, cn } from '@object-ui/components';
import { Code2 } from 'lucide-react';
import {
  FLOW_NODE_EXPRESSION_PATHS,
  flowNodeConfigRefusals,
  flowNodeValueTemplateRefusals,
  isExpressionEnvelopeShaped,
  resolveFlowNodeValueSlots,
  valueSlotTemplateRefusals,
} from '@objectstack/spec/automation';
import { FlowKeyValueField, type FlowKeyValueFieldProps } from './FlowKeyValueField.js';
import { FlowExprIssue } from './FlowExprIssue.js';
import {
  isEditableValueEnvelope,
  isValueEnvelopeSlot,
  valueEnvelopeRefusal,
  writeValueEnvelope,
} from './flow-value-envelope.js';
import { FlowStringListField } from './FlowStringListField.js';
import { FlowRecipientsField } from './FlowRecipientsField.js';
import { decisionEdgeBranches, FlowObjectListField } from './FlowObjectListField.js';
import { unpairedDecisionEdges } from './flow-decision-edges.js';
import type { FlowDesignerEdge } from '../previews/flow-canvas-layout.js';
import { FlowReferenceField, type FlowReferenceContext } from './FlowReferenceField.js';
import { validateExpressionClient } from './expression-validate.js';
import { VariableTextInput } from './VariableTextInput.js';
import type { ScopeGroup } from './useFlowScope.js';
import type { TriggerScope } from './flow-scope.js';
import { ConditionBuilder } from './ConditionBuilder.js';
import { findUnknownRefs, scopeRoots, describeUnknownRefs } from './flow-ref-check.js';

/**
 * The context subjects a flow trigger condition binds — none (objectui#6226).
 *
 * ConditionBuilder's default context list is `record.id` / `user.*` / `org.*`,
 * which is right for its five record-scoped consumers and wrong here: at a
 * record-trigger gate the evaluation context is the changed record FLATTENED to
 * top level plus `previous`, and that is the vocabulary this site declares. The
 * engine binds `record` there too, and `flow-scope.ts` scopes it on the start
 * node (objectui#11789), but `record.FIELD` is the same value as the bare
 * `FIELD` the builder already offers — a second spelling, not a new subject.
 *
 * So the vocabulary offered here is exactly what `TriggerScope` declares: the
 * trigger record's fields (bare) and `previous` / `previous.FIELD`. Roots this
 * surface has not been shown to bind are not guessed into the list; an author
 * who needs one still has the raw CEL escape hatch.
 */
const FLOW_TRIGGER_CONTEXT_SUBJECTS: ReadonlyArray<{ value: string; label?: string }> = [];

/**
 * The field-value maps whose KEYS are fields of the node's own target object
 * (`config.objectName`) — objectui#11788. `CreateRecordConfigSchema.fields` and
 * `UpdateRecordConfigSchema.fields` (in `@objectstack/spec/automation`) map a
 * field name to the value written to it.
 *
 * Keyed by node type and PATH, not by a descriptor member, like
 * `BLOCK_SWITCHES` in `flow-node-config.ts`: the offline table and the
 * engine-published `configSchema` (`additionalProperties` → `keyValue`) both
 * emit this path, so the picker holds whichever of the two drew the field.
 * Only the key cell changes; the value cell keeps the slot's own dialect.
 */
const FIELD_VALUE_MAPS: ReadonlyArray<{ nodeType: string; path: readonly string[] }> = [
  { nodeType: 'create_record', path: ['config', 'fields'] },
  { nodeType: 'update_record', path: ['config', 'fields'] },
];

/**
 * The target object whose fields key the map at `path` on `node`: its
 * `config.objectName` ('' while none is chosen), or `null` when `path` is not a
 * field-value map.
 */
function fieldValueMapObject(
  node: Record<string, unknown> | null | undefined,
  path: readonly string[],
): string | null {
  const type = node?.type;
  if (typeof type !== 'string') return null;
  const hit = FIELD_VALUE_MAPS.some(
    (m) => m.nodeType === type && m.path.length === path.length && m.path.every((seg, i) => path[i] === seg),
  );
  if (!hit) return null;
  const cfg = node?.config;
  const objectName =
    cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as Record<string, unknown>).objectName : undefined;
  return typeof objectName === 'string' ? objectName.trim() : '';
}

/** A record node's field-value map: the key-value editor with the object's fields as key suggestions. */
function FieldValueMapField({
  objectName,
  locale,
  ...kv
}: FlowKeyValueFieldProps & { objectName: string; locale?: string }) {
  // The same field source the reference picker's `object-field` kind reads.
  const { fields } = useObjectFields(objectName || undefined);
  const keyOptions = React.useMemo(
    () =>
      fields.map((f) => ({
        value: f.name,
        label: f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name,
      })),
    [fields],
  );
  return (
    <FlowKeyValueField
      {...kv}
      keyOptions={keyOptions}
      keyHint={
        objectName
          ? tFormat('engine.inspector.reference.fieldsOf', locale, { object: objectName })
          : t('engine.inspector.fieldMap.chooseObject', locale)
      }
    />
  );
}

/*
 * ── objectui#12372: a field whose WHOLE value is one `value`-role slot ─────
 *
 * The spec's expression ledger (`FLOW_NODE_EXPRESSION_PATHS`) names, beside the
 * value MAPS objectui#7588 / objectui#12101 render per row, positions whose
 * whole value is one value slot: a `map`'s `collection` (a `loop`'s too, while
 * it has a `body`), a `notify` `sourceId`, an `http` `body`, a `screen`
 * `recordId`. Each holds a literal or a CEL value envelope `{ dialect: 'cel',
 * source }` (ADR-0032 Decision 2), and the spec refuses a string carrying a
 * single-brace `{…}` token there (Decision 3). The descriptor's own control
 * (one text box) can author only one of the two forms, so such a field renders
 * {@link FlowValueSlotControl}: the text / expression toggle the value maps
 * carry, on one value.
 *
 * Which positions: the spec's own path walk, `resolveFlowNodeValueSlots`, asked
 * of the node as it stands with a probe at the key — so the ledger's
 * `onlyWithKey` (a `loop` reads `collection` as a value only with a `body`) is
 * the spec's answer, not one restated here. What is refused: the two config
 * judges `registerFlow` and `objectstack validate` share, read at the key.
 */

/** The node's `config`, or an empty one. */
function configOf(node: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const cfg = node?.config;
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : {};
}

/** Whether `path` on `node` is one `value`-role slot of the spec's ledger (objectui#12372). */
function isScalarValueSlot(
  node: Record<string, unknown> | null | undefined,
  path: readonly string[],
): boolean {
  const type = node?.type;
  if (typeof type !== 'string' || path.length !== 2 || path[0] !== 'config') return false;
  const key = path[1];
  const probe = { ...configOf(node), [key]: 'probe' };
  return resolveFlowNodeValueSlots(type, probe).some((found) => found.path === key && found.entry.eachElement !== true);
}

/**
 * Whether `path` on a node of `nodeType` is a CRUD `filter`, whose every
 * operand is a value slot (the ledger's `filterOperands` row, objectui#12372).
 */
function isFilterOperandSlot(nodeType: unknown, path: readonly string[]): boolean {
  if (typeof nodeType !== 'string' || path.length !== 2 || path[0] !== 'config') return false;
  return FLOW_NODE_EXPRESSION_PATHS.some(
    (entry) => entry.nodeType === nodeType && entry.role === 'value' && entry.filterOperands === true && entry.path === path[1],
  );
}

/**
 * The spec's refusal of one filter operand, or `null`. An envelope is judged by
 * the value-slot envelope rule; anything else by the filter-operand rule, under
 * which a whole query placeholder (`{today}`) is the query engine's and passes.
 */
function filterOperandRefusal(value: unknown): string[] | null {
  if (isExpressionEnvelopeShaped(value)) return valueEnvelopeRefusal(value);
  const refusals = valueSlotTemplateRefusals(value, { filterOperand: true });
  return refusals.length > 0 ? refusals.map((r) => r.message) : null;
}

/** What the spec's config judges refuse at `key` of `config` on a node of `nodeType`. */
function valueSlotRefusals(nodeType: string, config: Record<string, unknown>, key: string): string[] {
  const at = (path: string) => path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[`);
  const messages = [...flowNodeValueTemplateRefusals(nodeType, config), ...flowNodeConfigRefusals(nodeType, config)]
    .filter((refusal) => at(refusal.path))
    .map((refusal) => refusal.message);
  return [...new Set(messages)];
}

/**
 * A text cell's literal: JSON spelling an object or a list is that value (an
 * `http` body object, a `collection`'s inline array); anything else is the text
 * as typed. Blank is no value.
 */
function parseSlotLiteral(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return undefined;
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return JSON.parse(s);
    } catch {
      // Not JSON: the text itself, which the spec judges like any string.
    }
  }
  return raw;
}

/** The cell text for a stored value: an envelope's source, a string as is, else its JSON. */
function slotRaw(value: unknown): string {
  if (isEditableValueEnvelope(value)) return value.source;
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

type SlotMode = 'text' | 'expression';

function slotMode(value: unknown, expressionFirst: boolean): SlotMode {
  if (isEditableValueEnvelope(value)) return 'expression';
  return isUnsetFieldValue(value) && expressionFirst ? 'expression' : 'text';
}

/**
 * One value slot: a TEXT cell that is a literal, with no reference picker (the
 * picker could only insert a `{var}` token the spec refuses), or an EXPRESSION
 * cell stored as a CEL value envelope, whose picker inserts the bare reference.
 * The toggle carries the typed text over, as a value map's row does. An
 * `expression` descriptor (a `collection`, whose literal is never a string)
 * opens on the expression cell.
 */
function FlowValueSlotControl({
  field,
  value,
  onCommit,
  disabled,
  required,
  locale,
  scopeGroups,
  refusals,
}: {
  field: FlowConfigField;
  value: unknown;
  onCommit: (value: unknown) => void;
  disabled?: boolean;
  required?: boolean;
  locale?: string;
  scopeGroups?: ScopeGroup[];
  refusals: readonly string[];
}) {
  const expressionFirst = field.kind === 'expression';
  const [mode, setMode] = React.useState<SlotMode>(() => slotMode(value, expressionFirst));
  const [raw, setRaw] = React.useState(() => slotRaw(value));
  // The last value this control committed, so an EXTERNAL change (another
  // node, an undo) re-reads the cell and its own commits do not.
  const lastCommitted = React.useRef(JSON.stringify(value ?? null));
  React.useEffect(() => {
    const seen = JSON.stringify(value ?? null);
    if (seen === lastCommitted.current) return;
    lastCommitted.current = seen;
    setMode(slotMode(value, expressionFirst));
    setRaw(slotRaw(value));
  }, [value, expressionFirst]);

  const commit = (nextMode: SlotMode, nextRaw: string) => {
    let out: unknown =
      nextMode === 'expression'
        ? nextRaw.trim() === ''
          ? undefined
          : writeValueEnvelope(value, nextRaw)
        : parseSlotLiteral(nextRaw);
    // Text whose JSON is a CEL value envelope IS an expression (the spec tells
    // the forms apart by shape), so the cell shows it as one.
    if (nextMode === 'text' && isEditableValueEnvelope(out)) {
      setMode('expression');
      setRaw(out.source);
      out = writeValueEnvelope(out, out.source);
    }
    lastCommitted.current = JSON.stringify(out ?? null);
    onCommit(out);
  };

  const expression = mode === 'expression';
  const toggle = () => {
    const next: SlotMode = expression ? 'text' : 'expression';
    setMode(next);
    commit(next, raw);
  };
  const toggleLabel = t('engine.inspector.flowNode.kv.asExpression', locale);
  const placeholder = expression
    ? expressionFirst
      ? field.placeholder
      : t('engine.inspector.flowNode.kv.expressionPlaceholder', locale)
    : expressionFirst
      ? undefined
      : field.placeholder;
  const stored = expression && raw.trim() !== '' ? writeValueEnvelope(value, raw) : undefined;

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">
        {field.label}
        {required && <RequiredMarker />}
      </Label>
      <div className="flex items-start gap-1.5">
        <VariableTextInput
          multiline={field.kind === 'textarea'}
          rows={4}
          mono={expression || expressionFirst}
          value={raw}
          onValueChange={(v) => {
            setRaw(v);
            commit(mode, v);
          }}
          groups={expression ? (scopeGroups ?? []) : []}
          placeholder={placeholder}
          disabled={disabled}
          ariaRequired={required}
          className="flex-1"
        />
        <Button
          type="button"
          variant={expression ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-8 w-8 shrink-0 p-0', expression ? 'text-foreground' : 'text-muted-foreground')}
          onClick={toggle}
          disabled={disabled}
          aria-pressed={expression}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <Code2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {refusals.length > 0 ? (
        <div className="space-y-0.5" role="alert">
          {refusals.map((message, i) => (
            <p key={i} className="text-[11px] leading-snug text-destructive">
              {message}
            </p>
          ))}
        </div>
      ) : stored !== undefined ? (
        <FlowExprIssue value={stored} role="value" scopeGroups={scopeGroups} />
      ) : null}
    </div>
  );
}

/** The metadata form's write-only credential input, reused as-is (objectui#11054). */
const SecretWidget = WIDGETS['secret'];

/**
 * The `secret` kind (objectui#11054) — a flow-node credential, write-only.
 *
 * The widget speaks the metadata form's protocol: a value equal to
 * `OBJECTUI_SECRET_MASK` means "one is stored" (the box starts empty with a
 * leave-blank-to-keep hint and a Clear button); any other string is a value it
 * would put INTO the input. A flow never carries the mask — a server that
 * withholds the secret serves the start node without the key, and one that does
 * not serves the value itself — so this adapter translates both directions:
 *
 * - READ: a value already on the node when the control mounts is `held`, and
 *   is handed to the widget as the mask. It is never rendered, revealed or
 *   echoed: the widget's own input only ever holds what the author types here.
 * - WRITE: a typed value is committed as-is. Blank over a held value writes
 *   nothing (the node keeps it); blank with nothing held commits `undefined`,
 *   which the inspector's `setAtPath` turns into an ABSENT key — never `''`, and
 *   never the mask, either of which a server would store as the secret. Clear
 *   drops the key from the draft and forgets the held value.
 *
 * An absent key is what a withholding server reads as "keep the stored
 * secret", so a save that never touched this control keeps it.
 */
function FlowSecretControl({
  id,
  value,
  onCommit,
  disabled,
}: {
  id: string;
  value: unknown;
  onCommit: (value: unknown) => void;
  disabled?: boolean;
}) {
  const [held, setHeld] = React.useState<string | undefined>(() =>
    typeof value === 'string' && value !== '' ? value : undefined,
  );
  const shown = held !== undefined && value === held ? OBJECTUI_SECRET_MASK : typeof value === 'string' && value !== '' ? value : undefined;
  const onChange = (next: unknown) => {
    if (next === OBJECTUI_SECRET_MASK) return; // blank over a held secret: keep it
    if (next === null) {
      setHeld(undefined); // Clear: forget it, and drop the key from the draft
      onCommit(undefined);
      return;
    }
    if (typeof next === 'string' && next !== '') {
      onCommit(next);
      return;
    }
    onCommit(held); // blank: back to what was held, or no key at all
  };
  return (
    <SecretWidget
      id={id}
      value={shown}
      onChange={onChange}
      readOnly={disabled}
      schema={{ type: 'string', writeOnly: true }}
    />
  );
}

export interface FlowNodeConfigFieldProps {
  field: FlowConfigField;
  value: unknown;
  onCommit: (value: unknown) => void;
  disabled?: boolean;
  locale?: string;
  /** Draft + node context so `reference` fields can resolve their options. */
  context?: FlowReferenceContext;
  /** In-scope variable references for the data-picker (#1934). */
  scopeGroups?: ScopeGroup[];
  /** objectstack-ai/objectstack#3447: approval-expression picker groups (current/trigger/vars roots). */
  approvalScopeGroups?: ScopeGroup[];
  /**
   * The trigger record's declared subject vocabulary at this node, when one is
   * in scope (objectui#6226) — supplied by `useFlowScope`, resolved by
   * `flow-scope.ts`. Required before a `conditionBuilder` field may render the
   * row builder: the vocabulary is declared by the site, never inferred from
   * the value.
   */
  triggerScope?: TriggerScope;
  /**
   * objectui#6499 — set when this field is on screen ONLY because it holds a
   * stored value its `showWhen` controller does not currently admit. Supplied
   * by the host inspector, which owns the node and the sibling field set (this
   * component sees neither), and computed by `inactiveRetainedKind`.
   *
   * `undefined`/`null` is the normal case and renders exactly as before, so a
   * caller that does not pass it is unaffected.
   */
  inactiveRetained?: InactiveRetainedKind | null;
  /**
   * Clears the retained value — an ordinary field commit of `undefined`, the
   * same write the author would make by emptying the control by hand. The
   * ruling keeps hidden values by default; this is how the author discards one
   * DELIBERATELY. Omit to render the notice without the button.
   */
  onClearInactive?: () => void;
  /**
   * objectui#10948 — the installed spec refuses this node without a value at
   * `field.path`. Supplied by the host inspector, which owns the node, from
   * `specRequiresField` (`flow-required-keys.ts`) — the spec's own verdict,
   * never a list kept here. The label carries {@link RequiredMarker}; a control
   * this component owns carries `aria-required`.
   */
  required?: boolean;
  /**
   * objectui#10948 — for an `objectList` field, the column keys the spec
   * requires on every row (`specRequiredColumns`), handed to the list editor.
   */
  requiredColumns?: ReadonlySet<string>;
}

export function FlowNodeConfigField({ field, value, onCommit, disabled, locale, context, scopeGroups, approvalScopeGroups, triggerScope, inactiveRetained, onClearInactive, required, requiredColumns }: FlowNodeConfigFieldProps) {
  // A text / textarea field with no override is a literal (no picker spelling).
  const refMode: 'expression' | 'hole' | undefined =
    field.refMode ?? (field.kind === 'expression' ? 'expression' : undefined);
  // objectui#12372 — a field whose whole value is one `value`-role slot of the
  // spec's ledger renders the literal / CEL-envelope control, whatever brace
  // mode its descriptor (offline or served) carries.
  const valueSlot =
    (field.kind === 'text' || field.kind === 'textarea' || field.kind === 'expression') &&
    isScalarValueSlot(context?.node, field.path);
  const valueSlotIssues =
    valueSlot && typeof context?.node?.type === 'string' && !isUnsetFieldValue(value)
      ? valueSlotRefusals(context.node.type, { ...configOf(context.node), [field.path[1]]: value }, field.path[1])
      : [];
  // objectui#6226 — the row-based condition builder, on the fields that opted in
  // AND at a site that declares the vocabulary. All three conjuncts are load
  // bearing: `conditionBuilder` keeps `expression` from meaning "predicate"
  // everywhere it appears; `triggerScope` is the declared vocabulary, absent on
  // a trigger that binds no record; `refMode === 'expression'` keeps a
  // `{{ }}` text slot out even if one ever opts in.
  const asConditionBuilder =
    field.kind === 'expression' && !!field.conditionBuilder && !!triggerScope && refMode === 'expression';
  // ADR-0032 — surface a malformed condition (e.g. the `{record.x}` brace-in-CEL
  // mistake) inline, with the same corrective message the build/agent emit, on
  // every expression field. objectui#12329 / objectui#12390: that includes the
  // one `collection` the value-slot control above does not take, a body-less
  // loop's — a plain `expression` field. Its executor reads the bare name of a
  // list variable, so a stored `{x}` names no variable, and the brace check's
  // fix (the bare reference) is the spelling it reads.
  //
  // objectui#11824 — a flow TEXT slot (`refMode: 'hole'`) renders ADR-0032 §3
  // `{{ }}` holes, and the spec refuses a single-brace `{…}` token there. Its
  // check is the template role's: a single brace is flagged with the
  // double-brace spelling as the fix. The CEL brace check above is unchanged.
  //
  // objectui#12329 — every other text field is a LITERAL: since spec 18 no
  // flow string outside the text slots reads a `{…}` token (objectstack#19939
  // S7 deleted the single-brace resolver). It gets no picker, which could only
  // insert such a token, and no reference check, which would read one.
  const isHole = refMode === 'hole';
  const isLiteral = refMode === undefined;
  const exprIssue = valueSlot
    ? null
    : isHole
      ? validateExpressionClient('template', value, locale)
      : field.kind === 'expression'
        ? validateExpressionClient('predicate', value, locale)
        : null;

  // #1934 — pair the picker with a gentle, scope-aware "unknown reference"
  // warning: CEL for expression fields, `{{ }}` holes for a text slot. Skipped
  // for a literal, for free-form code (refMode 'expression' on a textarea, e.g.
  // a script body) and when scope is unknown. The brace error above takes
  // precedence.
  const scopeRole: 'predicate' | 'hole' | null = isHole
    ? 'hole'
    : field.kind === 'expression'
      ? 'predicate'
      : null;
  const unknownRefs =
    !valueSlot && !exprIssue && scopeRole && scopeGroups && scopeGroups.length > 0
      ? findUnknownRefs(value, scopeRole, scopeRoots(scopeGroups.flatMap((g) => g.refs)))
      : [];

  const secretId = React.useId();
  const control = (() => {
    if (valueSlot) {
      return (
        <FlowValueSlotControl
          field={field}
          value={value}
          onCommit={onCommit}
          disabled={disabled}
          required={required}
          locale={locale}
          scopeGroups={scopeGroups}
          refusals={valueSlotIssues}
        />
      );
    }
    if (asConditionBuilder && triggerScope) {
      return (
        <ConditionBuilder
          label={field.label}
          value={value != null ? String(value) : ''}
          onCommit={(cel) => onCommit(cel)}
          objectName={triggerScope.objectName}
          disabled={disabled}
          subjects={{
            fieldPrefix: triggerScope.fieldPrefix,
            includePrevious: triggerScope.includePrevious,
            context: FLOW_TRIGGER_CONTEXT_SUBJECTS,
          }}
          // objectui#11789 — one verdict: the scope note this field renders
          // below replaces the raw editor's "Valid CEL", never sits under it.
          scopeIssue={unknownRefs.length > 0}
        />
      );
    }
    switch (field.kind) {
      case 'reference':
        return (
          <FlowReferenceField
            field={field}
            value={value}
            onCommit={(v) => onCommit(v)}
            disabled={disabled}
            context={context}
            required={required}
          />
        );
      case 'keyValue': {
        const kv: FlowKeyValueFieldProps = {
          label: field.label,
          value,
          onCommit: (v) => onCommit(v),
          disabled,
          addLabel: t('engine.inspector.flowNode.kv.add', locale),
          keyLabel: t('engine.inspector.flowNode.kv.key', locale),
          valueLabel: t('engine.inspector.flowNode.kv.value', locale),
          removeLabel: t('engine.inspector.flowNode.kv.remove', locale),
          emptyLabel: t('engine.inspector.flowNode.kv.empty', locale),
          scopeGroups,
          required,
          // objectui#7588 — the per-value text / expression toggle, offered
          // only on a map the spec's expression ledger
          // (`FLOW_NODE_EXPRESSION_PATHS`) declares `value`-role for this
          // node type.
          // objectui#12372 — so is a CRUD node's `filter`, whose every operand
          // is a value slot (the ledger's `filterOperands` row), judged by the
          // spec's filter-operand rule.
          valueEnvelope:
            isValueEnvelopeSlot(context?.node?.type, field.path) || isFilterOperandSlot(context?.node?.type, field.path)
            ? {
                toggleLabel: t('engine.inspector.flowNode.kv.asExpression', locale),
                expressionPlaceholder: t('engine.inspector.flowNode.kv.expressionPlaceholder', locale),
              }
            : undefined,
          // objectui#12101 — a map whose every value is a flow text slot (http
          // `headers`) renders `{{ }}` holes in each value cell.
          valueMode: field.refMode === 'hole' ? 'hole' : undefined,
          valueRefusal: isFilterOperandSlot(context?.node?.type, field.path) ? filterOperandRefusal : undefined,
        };
        // objectui#11788 — a record node's field-value map: its keys are fields
        // of the node's own target object, so the key cell lists them. The
        // value cell is untouched.
        const fieldMapObject = fieldValueMapObject(context?.node, field.path);
        return fieldMapObject !== null ? (
          <FieldValueMapField {...kv} objectName={fieldMapObject} locale={locale} />
        ) : (
          <FlowKeyValueField {...kv} />
        );
      }
      case 'stringList':
        return (
          <FlowStringListField
            label={field.label}
            value={value}
            onCommit={(v) => onCommit(v)}
            disabled={disabled}
            required={required}
            addLabel={t('engine.inspector.flowNode.list.add', locale)}
            itemLabel={t('engine.inspector.flowNode.list.item', locale)}
            removeLabel={t('engine.inspector.flowNode.list.remove', locale)}
            emptyLabel={t('engine.inspector.flowNode.list.empty', locale)}
          />
        );
      case 'recipients':
        return (
          <FlowRecipientsField
            label={field.label}
            value={value}
            onCommit={(v) => onCommit(v)}
            disabled={disabled}
            locale={locale}
            context={context}
            scopeGroups={scopeGroups}
            required={required}
          />
        );
      case 'numberList':
        return (
          <FlowStringListField
            label={field.label}
            // Stored as number[]; the list editor works in strings, so show each
            // number as text and coerce back to number[] on commit (dropping
            // blanks / non-numbers). Keeps the backend contract strict (number[])
            // rather than persisting string values the schema would reject.
            value={Array.isArray(value) ? (value as unknown[]).map((n) => String(n)) : value}
            onCommit={(v) => {
              if (v == null) return onCommit(undefined);
              const nums = v.map((s) => Number(String(s).trim())).filter((n) => Number.isFinite(n));
              onCommit(nums.length ? nums : undefined);
            }}
            disabled={disabled}
            required={required}
            addLabel={t('engine.inspector.flowNode.list.add', locale)}
            itemLabel={t('engine.inspector.flowNode.list.item', locale)}
            removeLabel={t('engine.inspector.flowNode.list.remove', locale)}
            emptyLabel={t('engine.inspector.flowNode.list.empty', locale)}
          />
        );
      case 'objectList': {
        // objectui#12488 — a top-level decision's Branches (the list that
        // carries the virtual Target column) draw as branch cards, and the
        // decision's out-edges no branch is paired with show read-only beside
        // them (objectui#13138 — adding a branch never hides a connection).
        const decisionBranches =
          context?.node?.type === 'decision' &&
          field.path.length === 2 &&
          field.path[0] === 'config' &&
          field.path[1] === 'conditions' &&
          (field.columns ?? []).some((c) => c.key === 'target');
        const draftEdges = Array.isArray(context?.draft?.edges) ? (context.draft.edges as FlowDesignerEdge[]) : [];
        const draftNodes = Array.isArray(context?.draft?.nodes)
          ? (context.draft.nodes as Array<{ id?: unknown; label?: unknown } | null>)
          : [];
        return (
          <FlowObjectListField
            label={field.label}
            columns={field.columns ?? []}
            value={value}
            onCommit={(v) => onCommit(v)}
            disabled={disabled}
            variant={decisionBranches ? 'branches' : undefined}
            edgeBranches={
              decisionBranches && typeof context?.node?.id === 'string'
                ? decisionEdgeBranches(
                    context.node.id,
                    draftEdges,
                    draftNodes,
                    unpairedDecisionEdges(context.node.id, value, draftEdges),
                    locale,
                  )
                : undefined
            }
            addLabel={t(decisionBranches ? 'engine.inspector.flowNode.branch.add' : 'engine.inspector.flowNode.list.add', locale)}
            removeLabel={t('engine.inspector.flowNode.list.remove', locale)}
            emptyLabel={t('engine.inspector.flowNode.list.empty', locale)}
            itemLabel={t('engine.inspector.flowNode.list.item', locale)}
            context={context}
            scopeGroups={scopeGroups}
            approvalScopeGroups={approvalScopeGroups}
            // objectui#10772 — with `context.node`, names a screen's `fields`
            // list, whose `visibleWhen` column binds the screen's own fields.
            fieldId={field.id}
            required={required}
            requiredColumns={requiredColumns}
          />
        );
      }
      case 'number':
        return (
          <InspectorNumberField
            label={field.label}
            value={typeof value === 'number' ? value : value != null && value !== '' ? Number(value) : undefined}
            placeholder={field.placeholder}
            onCommit={(v) => onCommit(v)}
            disabled={disabled}
            required={required}
          />
        );
      case 'boolean': {
        // objectui#6830 arm A — "show, do not write" (triage 2026-09-04), the
        // boolean half (objectui#8451).
        //
        // The control shows the value IN EFFECT: the stored boolean, or — when
        // the author has stored nothing — the `defaultValue` the descriptor
        // declares, which is what the runtime applies to the omitted key.
        // Nothing is WRITTEN: an untouched node still ships without the key,
        // and the first author edit commits an explicit boolean as before.
        //
        // The seed used to be `value === true`, which flattened `undefined` and
        // `false` onto one unchecked box although the runtime treats them
        // oppositely on a `default(true)` key — the mechanism that turned a
        // missing display into a false assertion. The distinction survives to
        // here (`getFieldValue` returns `undefined` vs `false`), so the two
        // branches are kept apart:
        //
        //  - unset  -> the declared default in the table's own 'true'/'false'
        //    spelling, the one `controllerAdmits` compares a controller against;
        //  - stored -> `=== true`, unchanged. Deliberately NOT widened to also
        //    accept a stored string `'true'`: that would be a lenient
        //    renderer-side alias for off-spec metadata (AGENTS.md #0.1).
        //
        // ⛔ Nothing is rendered NAMING the default — no "(default)" caption,
        // no help line. That is triage's arm-A ruling and stands on its own.
        //
        // ⚑ Its original SECONDARY argument has been discharged and must not be
        // cited again: `escalation.enabled` used to declare the OPPOSITE of what
        // the installed spec applies to an omitted key, so a caption would have
        // shipped a wrong claim to authors in words. objectui#6620 fixed the
        // declaration and, from this seed, that field now draws CHECKED — it no
        // longer renders byte-identically to before, and the argument that the
        // seed is the safe half of the change no longer applies to it. Both
        // boolean fields the offline table declares a default for now agree with
        // the spec, and `flow-node-config.spec-reconciliation.test.ts` keeps the
        // whole escalation block reconciled against the installed
        // `ApprovalEscalationSchema`, so a future divergence reddens there rather
        // than being absorbed by a rendering decision here. Pinned by
        // `FlowNodeInspector.declaredDefault.test.tsx`'s #6620 case.
        const checked = isUnsetFieldValue(value) ? field.defaultValue === 'true' : value === true;
        return (
          <InspectorCheckboxField
            label={field.label}
            value={checked}
            onCommit={(v) => onCommit(v)}
            disabled={disabled}
          />
        );
      }
      case 'select':
        return (() => {
          const current = value != null ? String(value) : '';
          const opts = field.options ?? [];
          // objectui#6830 arm A, SELECT half — the counterpart of the boolean
          // seed above, and deliberately not the same mechanism. A boolean has
          // nowhere but its own checked state to say what an unset key does, so
          // that control seeds its VALUE. A select has a placeholder slot, so
          // this one leaves the value alone and puts the declared default
          // there: the trigger states what the runtime applies while the node
          // still stores nothing, and `InspectorSelectField` marks the trigger
          // `data-placeholder` (muted), so it never reads as a selection.
          //
          // ⛔ Nothing is WRITTEN. That is the whole of triage's "show, do not
          // write", and objectui#6263's standing ruling — "the console needs no
          // second default contract" — is what forbids the other half: a commit
          // from here would freeze today's default into the node and un-track
          // it from the spec.
          //
          // The primitive owns WHEN a placeholder shows (empty value, and no
          // `''` row of the caller's own standing for "none"), so this branch
          // only decides WHAT it says, and a stored value is untouchable by
          // construction rather than by a second predicate here.
          //
          // Where the declaration names an offered option, that option's LABEL
          // wins: it is the text this same trigger draws once the author picks
          // it, so "unset behaves as X" and "stored X" read alike instead of a
          // raw wire value appearing nowhere else in the control. A declaration
          // matching no option falls back to the raw value rather than
          // vanishing — an author whose runtime applies a value the roster does
          // not offer needs to see it, the same reason `unknownValueLabel`
          // surfaces a stored one.
          const declared = field.defaultValue;
          const declaredDefault =
            declared !== undefined && declared !== ''
              ? (opts.find((o) => o.value === declared)?.label ?? declared)
              : undefined;
          // A stored value dropped from the options (e.g. a script node's
          // legacy `code` / `sms` actionType, framework#4278) must still
          // render, or editing a legacy node would silently blank it. Surface
          // it as selectable but flag it — it is not offered to fresh nodes.
          // Same rule as FlowObjectListField's select cells (ADR-0090 D3).
          //
          // objectui#8488 promoted that RULE into `InspectorSelectField`, where
          // the other 42 call sites inherit it. What stays here is the WORDING:
          // "(deprecated)" is sourced (framework#4278, ADR-0090 D3) and says
          // something the generic "(not found)" does not — the value is known,
          // it is simply no longer offered. The prop exists so this sentence
          // survives the unification instead of being flattened by it.
          return (
            <InspectorSelectField
              label={field.label}
              value={current}
              options={opts}
              placeholder={declaredDefault}
              unknownValueLabel={(v) =>
                flagUnknownValue(v, t('engine.form.deprecated', locale), locale)
              }
              onCommit={(v) => onCommit(v)}
              disabled={disabled}
              required={required}
            />
          );
        })();
      case 'secret': {
        // objectui#11054 — keyed on the node, so a control moved to another
        // node's value never carries the previous node's `held` secret over.
        const nodeId = typeof context?.node?.id === 'string' ? context.node.id : '';
        return (
          <div className="space-y-1">
            <Label htmlFor={secretId} className="text-xs text-muted-foreground">
              {field.label}
              {required && <RequiredMarker />}
            </Label>
            <FlowSecretControl key={nodeId} id={secretId} value={value} onCommit={onCommit} disabled={disabled} />
          </div>
        );
      }
      case 'textarea':
        return (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {field.label}
              {required && <RequiredMarker />}
            </Label>
            <VariableTextInput
              multiline
              rows={4}
              mode={isHole ? 'hole' : 'expression'}
              value={value != null ? String(value) : ''}
              onValueChange={(v) => onCommit(v)}
              groups={isLiteral ? [] : (scopeGroups ?? [])}
              placeholder={field.placeholder}
              disabled={disabled}
              ariaRequired={required}
            />
          </div>
        );
      case 'expression':
      case 'text':
      default:
        return (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {field.label}
              {required && <RequiredMarker />}
            </Label>
            <VariableTextInput
              mode={isHole ? 'hole' : 'expression'}
              mono={field.kind === 'expression'}
              value={value != null ? String(value) : ''}
              onValueChange={(v) => onCommit(v)}
              groups={isLiteral ? [] : (scopeGroups ?? [])}
              placeholder={field.placeholder}
              disabled={disabled}
              ariaRequired={required}
            />
          </div>
        );
    }
  })();

  return (
    <div className="space-y-1">
      {control}
      {/*
        objectui#6499 — the "inactive values retained" affordance. Rendered
        ABOVE the expression/scope notes and independently of them: those judge
        the value's CONTENT, this one says the value is not in effect at all,
        and an author who cannot see the second will misread the first.
        Deliberately not a `disabled` control — the value is still editable, it
        just is not live, and greying it out would hide the very text the
        ruling asks the author to be able to read and act on.
      */}
      {inactiveRetained && (
        <div
          className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5"
          role="note"
          data-testid="inactive-retained"
          data-inactive-retained={inactiveRetained}
        >
          <p className="flex-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
            {t(
              inactiveRetained === 'no-controller'
                ? 'engine.inspector.flowNode.inactiveRetainedOrphan'
                : 'engine.inspector.flowNode.inactiveRetained',
              locale,
            )}
          </p>
          {onClearInactive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-[11px] text-amber-700 dark:text-amber-400"
              onClick={onClearInactive}
              disabled={disabled}
            >
              {t('engine.inspector.flowNode.inactiveRetainedClear', locale)}
            </Button>
          )}
        </div>
      )}
      {/*
        objectui#11054 — a key the engine refuses the flow without, while it is
        empty. Shown only on a field its gate admits: a retained-but-inert value
        above already says the field is not in effect.
      */}
      {!inactiveRetained && unsetNoticeApplies(field, value) && (
        <p
          className="text-[11px] leading-snug text-amber-700 dark:text-amber-400"
          role="note"
          data-testid="unset-notice"
        >
          {field.unsetNotice}
        </p>
      )}
      {exprIssue && (
        <p className="text-[11px] leading-snug text-destructive" role="alert">
          {exprIssue.message}
        </p>
      )}
      {!exprIssue && unknownRefs.length > 0 && (
        <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400" role="note">
          {describeUnknownRefs(unknownRefs, locale)}
        </p>
      )}
      {field.help && !exprIssue && unknownRefs.length === 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">{field.help}</p>
      )}
    </div>
  );
}

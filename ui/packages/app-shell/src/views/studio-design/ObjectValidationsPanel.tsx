/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Data pillar — Validations view.
 *
 * Edits `ObjectSchema.validations` (spec `ValidationRuleSchema`, a discriminated
 * union on `type`). Every rule type in the spec is authorable here — not just
 * `script` — so the no-code surface is a faithful config panel for the metadata:
 *
 *   - script        — a CEL FAIL predicate (TRUE ⇒ the write is rejected).
 *   - cross_field   — a CEL predicate plus the participating fields.
 *   - state_machine — a status field + allowed from→to transitions.
 *   - format        — a field + a built-in format or a regex pattern.
 *   - json_schema   — a JSON field validated against a JSON Schema.
 *   - conditional   — a CEL guard + a nested rule applied when it holds.
 *
 * Adding a rule starts from the "New" menu, which opens on a few common rules in
 * plain words (objectui#11861, `validationPresets.ts`) and keeps every spec type
 * under "Advanced" — see "Starting points" below. A new rule starts on
 * Create + Update (objectui#11820). A type whose rule carries a CEL guard
 * (`script`, `cross_field`, `conditional`) is NOT written to the object draft
 * until the author gives it a condition — see "A new rule waits for its
 * condition" below. The other types are written at once, each seeded with a
 * VALID skeleton so the object-draft save never 422s. The common fields
 * (name / label / message / severity / events / priority / active) are shared
 * by all types; the type-specific fields render below them. CEL conditions
 * reuse the metadata-admin `ConditionBuilder`, fed the DRAFT field list so
 * unpublished fields are pickable.
 *
 * Persistence: like actions, validations live ON the object draft — this panel
 * calls `onPatch({ validations })` and the Data pillar's Save draft owns the
 * write. Nothing here fetches or saves on its own.
 *
 * ## A new rule waits for its condition (objectui#11820)
 *
 * A guard-bearing rule used to be written at once with the placeholder guard
 * `'false'`: the draft autosave stored a rule that can never fire, and nothing
 * on screen said so. Now the new rule is held HERE, in the panel, until its
 * guard is non-empty (for `conditional`, its `then` rule's guard too). It is
 * listed and editable like any rule, marked as not saved, and the editor shows
 * the line the Data pillar uses for an edit it holds (objectui#11786,
 * `engine.studio.held.line`) plus that hold's input hint under the guard. The
 * first edit that gives it a guard writes it to the draft; from then on it is an
 * ordinary rule.
 *
 * Why the panel and not the pillar's hold: the pillar holds a draft its write
 * guard would refuse (`objectHeldEdit` in `metadataError.ts`) and routes "Show
 * me" to a field. A rule that has never been written is not an edit of that
 * draft, and nothing it needs lives in the draft yet. The known cost, which the
 * pillar's hold does not have: leaving the Rules view, or the object, before the
 * rule has a condition drops it, and Publish does not wait for it (it was never
 * in the draft, and the line says it is not saved).
 *
 * An EXISTING rule is edited exactly as before, including a type switch, which
 * still seeds the `'false'` placeholder: a rule already in the draft must stay
 * saveable while it is being reshaped.
 *
 * ## Starting points (objectui#11861)
 *
 * "New" opens on the presets of `validationPresets.ts` — each a rule of a type
 * the spec already has, labelled by what it does rather than by its type — and
 * the per-type list, unchanged, under "Advanced". A preset is applied through
 * the same door as a type: the new-rule skeleton, then the keys the preset
 * fills. So the hold above covers it as it covers any new rule: a preset that
 * fills its condition from the object's fields is written at once, and one that
 * leaves it empty is held, and opens with the condition editor focused. A preset
 * whose fields the object lacks is listed disabled, saying what it needs.
 */

import React from 'react';
import { Plus, Trash2, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import { ConditionBuilder, RECORD_CONDITION_SUBJECTS } from '../metadata-admin/inspectors/ConditionBuilder.js';
import { expressionSource, writeExpressionSource } from '../metadata-admin/inspectors/expression-envelope.js';
import { readFields } from '../metadata-admin/previews/object-fields-io.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import type { ExpressionInput } from '@objectstack/spec/shared';
import { ScriptValidationSchema, type ScriptValidationParsed } from '@objectstack/spec/data';
import { VALIDATION_PRESETS, type PresetPlan, type ValidationPreset } from './validationPresets.js';
import { StudioEmptyState, StudioEmptyStateAction } from './StudioEmptyState.js';

/**
 * objectui#11781 — the look a disabled control takes: the pair the
 * `@object-ui/components` primitives (`Input`, `SelectTrigger`, `Textarea`)
 * carry, and so the one the read-only field inspector's inputs wear. This
 * panel's text controls are plain elements, which keep the editable look
 * (white fill, dark text) when disabled unless they are given it too. Its
 * pickers are the primitive itself ({@link RulePicker}) and wear its look
 * without help. Plain checkboxes are left to the browser's own disabled look,
 * as the inspector's are.
 */
const DISABLED_LOOK = 'disabled:cursor-not-allowed disabled:opacity-50';

/** The rule editor's scrolling body. */
const EDITOR_BODY = 'flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4';

/** The item a stored value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — one of the rule editor's pickers (type, field, format,
 * severity), drawn with the shared `Select`, the control the condition
 * builder beside it already picks with. It used to be a browser-native
 * `<select>`. What a pick writes is unchanged: `onPick` receives the picked
 * option's own `value`, the string the native control's `change` carried, and
 * re-picking the current option writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value. The field and format
 *   pickers open on an option whose value is `''`, which `SelectItem`
 *   refuses; an index cannot collide with a field's name, as any stand-in
 *   string could.
 * - A stored value none of the options carries gets an item of its own,
 *   labelled with the value, so the trigger shows what the rule holds. The
 *   native control showed its first option instead ("pick a field", "none",
 *   "error"), which is not what the rule says. Picking that item writes
 *   nothing.
 * - Read-only follows the primitive (objectui#11781): `disabled` disables
 *   the trigger, which wears `SelectTrigger`'s own disabled look.
 * - Each caller keeps the picker inside its `<label>`, which names the
 *   trigger as it named the native control.
 */
function RulePicker({
  value,
  options,
  onPick,
  disabled,
  className,
  testId,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  disabled?: boolean;
  className: string;
  testId: string;
}) {
  const at = options.findIndex((o) => o.value === value);
  const outside = at === -1 && value !== '';
  return (
    <Select
      value={at !== -1 ? String(at) : outside ? OUTSIDE_OPTIONS : ''}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
      disabled={disabled}
    >
      <SelectTrigger data-testid={testId} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {outside && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The classes a full-width picker takes, to sit at the height of the editor's inputs. */
const PICKER_FULL = 'h-7 px-2 py-1 text-[12px]';

type RuleType = 'script' | 'cross_field' | 'state_machine' | 'format' | 'json_schema' | 'conditional';

interface ValidationRuleDraft {
  type?: string;
  name?: string;
  label?: string;
  description?: string;
  message?: string;
  /**
   * `ExpressionInput`, not `string`: the spec's validation-rule `condition` is
   * `ExpressionInputSchema`, so a rule loaded off a saved object carries the
   * ADR-0089 envelope. Typing it `string` was the same over-narrow local
   * mirror #3202 / #3216 closed elsewhere, and it made the guard render empty
   * here (#3218).
   */
  condition?: ExpressionInput;
  /**
   * The `conditional` rule type's guard — a SECOND live spelling, not an alias.
   * `ConditionalValidationSchema` spells it `when` and refuses `condition` BY
   * NAME on that shape (an `unrecognized_keys` issue whose message suggests the
   * rename); symmetrically `ScriptValidationSchema` refuses `when`. So neither
   * key may be assumed — read and write the guard through `guardKey(rule.type)`.
   */
  when?: ExpressionInput;
  severity?: 'error' | 'warning' | 'info';
  active?: boolean;
  events?: string[];
  priority?: number;
  // type-specific
  field?: string;
  fields?: string[];
  regex?: string;
  format?: string;
  transitions?: Record<string, string[]>;
  schema?: Record<string, unknown>;
  then?: unknown;
  otherwise?: unknown;
  [key: string]: unknown;
}

interface FieldOpt {
  name: string;
  label?: string;
  hidden?: boolean;
  /** The field's declared type and `multiple` flag — what `ConditionBuilder`
   *  words and compiles its value-less operators by (objectui#11894). The New
   *  menu's presets also pick their fields by `type` (objectui#11861). */
  type?: string;
  multiple?: boolean;
  /** Read by the New menu's presets only (objectui#11861), to pick their fields. */
  system?: boolean;
}

/** Rule types, in menu order. `json_schema` matches the spec literal (not `json`). */
const RULE_TYPES: ReadonlyArray<{ value: RuleType; labelKey: string }> = [
  { value: 'script', labelKey: 'engine.studio.rules.typeScript' },
  { value: 'cross_field', labelKey: 'engine.studio.rules.typeCrossField' },
  { value: 'state_machine', labelKey: 'engine.studio.rules.typeStateMachine' },
  { value: 'format', labelKey: 'engine.studio.rules.typeFormat' },
  { value: 'json_schema', labelKey: 'engine.studio.rules.typeJsonSchema' },
  { value: 'conditional', labelKey: 'engine.studio.rules.typeConditional' },
];

/** An event a validation rule may run on: the spec's enum, not a local list. */
type RuleEvent = ScriptValidationParsed['events'][number];

/**
 * objectui#11923 — the "Runs on" row reads the spec's `events` contract
 * (`events` in `BASE_VALIDATION_SHAPE`, which every rule type spreads). A local
 * list here offered `delete`, which the spec refuses (the server's rule
 * validator runs only on insert and update), and showed a rule with no `events`
 * key as running on nothing, while the spec defaults it to both and the server
 * runs it on both.
 *
 * Both halves come off the spec's own schema: the enum's options are the boxes
 * the row offers, and what the schema makes of an absent key is what the row
 * shows for one. Read on first use rather than at import, as the spec builds
 * its schemas lazily. `ScriptValidationSchema` is read because every rule type
 * spreads the same key; `ObjectValidationsPanel.runsOn-11923.test.tsx` pins
 * that every type's schema agrees.
 */
let runsOnSpec: { offered: readonly RuleEvent[]; absent: readonly RuleEvent[] } | undefined;
function runsOnContract(): { offered: readonly RuleEvent[]; absent: readonly RuleEvent[] } {
  if (!runsOnSpec) {
    const events = ScriptValidationSchema.shape.events;
    runsOnSpec = { offered: events.unwrap().element.options, absent: events.parse(undefined) };
  }
  return runsOnSpec;
}

/**
 * The events a rule runs on, as the "Runs on" boxes show them: its own list, or
 * the spec's default when it names none. The one place the row reads `events`,
 * so no box falls back on its own.
 *
 * A stored value the spec does not offer (a `delete` written before
 * objectui#11923) has no box. The server never ran a rule on it, so the boxes
 * still show what the rule runs on; an unrelated edit keeps it, and the next
 * write from this row leaves it out (see `writeRunsOn`).
 */
function ruleRunsOn(rule: ValidationRuleDraft): readonly string[] {
  if (rule.events === undefined) return runsOnContract().absent;
  return Array.isArray(rule.events) ? rule.events : [];
}

/**
 * The full list a tick or an untick on the "Runs on" row writes: every offered
 * event whose box is checked afterwards, in the spec's order. Unticking the last
 * box writes `[]`, which the spec accepts and the server reads as running on
 * nothing; it is not the absent key, so the row then shows no box checked.
 */
function writeRunsOn(rule: ValidationRuleDraft, event: RuleEvent, on: boolean): RuleEvent[] {
  const current = ruleRunsOn(rule);
  return runsOnContract().offered.filter((ev) => (ev === event ? on : current.includes(ev)));
}

/**
 * The events a NEW rule starts on: Create + Update (objectui#11820). They are
 * also the spec's own default for a rule that names none (`events` in
 * `BASE_VALIDATION_SHAPE`), so writing them changes nothing the server runs —
 * it makes the "Runs on" boxes say what the rule does.
 */
const NEW_RULE_EVENTS = ['insert', 'update'] as const;
const BUILTIN_FORMATS = ['', 'url', 'email', 'phone', 'json'] as const;

/** The rule types whose rule carries a CEL guard (`guardKey` names its key). */
const GUARDED_TYPES: ReadonlySet<string> = new Set(['script', 'cross_field', 'conditional']);

function readRules(input: unknown): ValidationRuleDraft[] {
  if (!Array.isArray(input)) return [];
  return input.filter((r): r is ValidationRuleDraft => !!r && typeof r === 'object');
}

function nextRuleName(existing: string[]): string {
  let i = existing.length + 1;
  let name = `validation_${i}`;
  const taken = new Set(existing);
  while (taken.has(name)) name = `validation_${++i}`;
  return name;
}

/**
 * Which key carries a rule's CEL guard, per rule type.
 *
 * The spec does NOT use one spelling: `script` and `cross_field` carry
 * `condition`, while `conditional` carries `when` — and each shape refuses the
 * other's key by name rather than accepting it as an alias. Measured against
 * the resolved `@objectstack/spec`: a `conditional` bearing `condition` fails
 * `ConditionalValidationSchema` with `unrecognized_keys`, and a `script`
 * bearing `when` fails `ScriptValidationSchema` the same way. `whenKeyPin` in
 * this directory re-derives both directions through the spec's own parser.
 *
 * ⇒ every read and write of the guard goes through here. Assuming either
 * spelling silently produces metadata the object-draft save refuses.
 */
function guardKey(type: unknown): 'when' | 'condition' {
  return type === 'conditional' ? 'when' : 'condition';
}

/**
 * A minimal skeleton for a rule of `type`; required `field`/`fields` seed from
 * the first field. The guard's KEY is per-type (`guardKey`) — `conditional`
 * spells it `when`.
 *
 * `guard` is what the guard-bearing types are seeded with:
 *
 *   - `'false'` — a VALID skeleton (an empty guard is rejected by the spec's
 *     ExpressionInputSchema), used when an EXISTING rule switches type: it is
 *     already in the draft, so the next save must not 422. `'false'` never
 *     fires, which the editor's guard caption says.
 *   - `''` — a NEW rule (objectui#11820): the guard is left for the author,
 *     and the panel keeps the rule out of the draft until it is filled
 *     ({@link missingGuard}). The conditional's nested `then` gets the same
 *     empty `condition`, so its JSON shows where the condition goes.
 *
 * "Valid" is a claim about a foreign schema, so it is pinned against that
 * schema rather than asserted in prose: `whenKeyPin` parses what this panel
 * emits through the spec's own `ValidationRuleSchema` and `ObjectSchema`.
 * Before that pin, this docblock's promise was re-derived by nothing, and the
 * `conditional` skeleton contradicted it for its whole life.
 */
function makeSkeleton(type: RuleType, name: string, firstField: string | undefined, guard: 'false' | ''): ValidationRuleDraft {
  const base = { name, message: '', severity: 'error' as const, active: true };
  // A new rule leaves its guard key out; `missingGuard` reads absent as empty.
  const own = guard ? { [guardKey(type)]: guard } : {};
  switch (type) {
    case 'script':
      return { ...base, type, ...own };
    case 'cross_field':
      return { ...base, type, ...own, fields: firstField ? [firstField] : [] };
    case 'state_machine':
      return { ...base, type, field: firstField ?? '', transitions: {} };
    case 'format':
      return { ...base, type, field: firstField ?? '' };
    case 'json_schema':
      return { ...base, type, field: firstField ?? '', schema: {} };
    case 'conditional':
      return {
        ...base,
        type,
        ...own,
        // The nested branch is a `script` rule, so ITS guard stays `condition`.
        then: { type: 'script', name: `${name}_then`, message: '', condition: guard, severity: 'error' },
      };
  }
}

/** A rule the "New" menu adds: an empty guard and Create + Update (objectui#11820). */
function newRule(type: RuleType, name: string, firstField?: string): ValidationRuleDraft {
  return { ...makeSkeleton(type, name, firstField, ''), events: [...NEW_RULE_EVENTS] };
}

/**
 * Which guard a rule still lacks, or `null` when it has every guard its type
 * carries: `'rule'` — its own (`condition`, or `when` on a `conditional`);
 * `'then'` — a `conditional` whose own guard is set but whose `then` rule's is
 * not. A guard is lacking when its source is blank, the state the spec's
 * ExpressionInputSchema refuses. A type with no guard never lacks one.
 */
function missingGuard(rule: ValidationRuleDraft): 'rule' | 'then' | null {
  if (typeof rule.type !== 'string' || !GUARDED_TYPES.has(rule.type)) return null;
  if (!expressionSource(rule[guardKey(rule.type)]).trim()) return 'rule';
  if (rule.type === 'conditional' && rule.then && typeof rule.then === 'object' && !Array.isArray(rule.then)) {
    if (missingGuard(rule.then as ValidationRuleDraft) !== null) return 'then';
  }
  return null;
}

/** A JSON <textarea> that keeps invalid text local and only commits parsed objects. */
function JsonField({
  label,
  value,
  onCommit,
  disabled,
  locale,
}: {
  label: string;
  value: unknown;
  onCommit: (parsed: unknown) => void;
  disabled?: boolean;
  locale: string;
}) {
  const serialized = React.useMemo(() => {
    if (value == null) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }, [value]);
  const [text, setText] = React.useState(serialized);
  const [err, setErr] = React.useState<string | null>(null);
  // Re-sync when the selected rule changes underneath us.
  React.useEffect(() => {
    setText(serialized);
    setErr(null);
  }, [serialized]);
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
      <textarea
        value={text}
        disabled={disabled}
        spellCheck={false}
        rows={5}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const raw = text.trim();
          if (!raw) {
            setErr(null);
            onCommit(undefined);
            return;
          }
          try {
            onCommit(JSON.parse(raw));
            setErr(null);
          } catch {
            setErr(t('engine.studio.rules.invalidJson', locale));
          }
        }}
        className={`w-full rounded border bg-background px-2 py-1 font-mono text-[11px] ${DISABLED_LOOK}`}
      />
      {err && <span className="mt-1 block text-[11px] text-destructive">{err}</span>}
    </label>
  );
}

/** State-machine `transitions` editor: from-state → allowed next states (CSV). */
function TransitionsField({
  transitions,
  onCommit,
  disabled,
  locale,
}: {
  transitions: Record<string, string[]>;
  onCommit: (next: Record<string, string[]>) => void;
  disabled?: boolean;
  locale: string;
}) {
  const rows = Object.entries(transitions);
  const setRow = (idx: number, from: string, to: string[]) => {
    const next: Record<string, string[]> = {};
    rows.forEach(([k, v], i) => {
      if (i === idx) {
        if (from) next[from] = to;
      } else {
        next[k] = v;
      }
    });
    onCommit(next);
  };
  return (
    <div className="space-y-2">
      <span className="block text-[11px] text-muted-foreground">{t('engine.studio.rules.transitions', locale)}</span>
      {rows.map(([from, to], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={from}
            disabled={disabled}
            placeholder={t('engine.studio.rules.transitionFrom', locale)}
            onChange={(e) => setRow(i, e.target.value, to)}
            className={`w-32 rounded border bg-background px-2 py-1 text-[12px] ${DISABLED_LOOK}`}
          />
          <span className="text-muted-foreground">→</span>
          <input
            value={to.join(', ')}
            disabled={disabled}
            placeholder={t('engine.studio.rules.transitionTo', locale)}
            onChange={(e) =>
              setRow(i, from, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
            }
            className={`min-w-0 flex-1 rounded border bg-background px-2 py-1 text-[12px] ${DISABLED_LOOK}`}
          />
          {!disabled && (
            <button
              type="button"
              aria-label={t('engine.studio.rules.delete', locale)}
              onClick={() => setRow(i, '', [])}
              className="rounded border border-destructive/40 p-1 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={() => onCommit({ ...transitions, '': [] })}
          disabled={'' in transitions}
          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> {t('engine.studio.rules.addTransition', locale)}
        </button>
      )}
    </div>
  );
}

/** The type-specific fields for the selected rule (below the shared common fields). */
function RuleTypeFields({
  rule,
  fields,
  patch,
  disabled,
  locale,
  onBlockingIssuesChange,
  missing,
  guardRef,
}: {
  rule: ValidationRuleDraft;
  fields: FieldOpt[];
  patch: (p: Partial<ValidationRuleDraft>) => void;
  disabled?: boolean;
  locale: string;
  /** Blocking CEL error count for this rule's guard (objectui#4527). */
  onBlockingIssuesChange?: (count: number) => void;
  /**
   * objectui#11820 — the guard a new, not-yet-saved rule still needs
   * ({@link missingGuard}); the input it names carries the hold's hint.
   */
  missing?: 'rule' | 'then' | null;
  /**
   * objectui#11861 — the condition group, which the panel focuses when a
   * preset leaves the condition to the author.
   */
  guardRef?: React.Ref<HTMLDivElement>;
}) {
  const captionId = React.useId();
  // The hint the Data pillar's hold puts under the input an edit waits on
  // (objectui#11786), under the input this rule waits on.
  const heldHint = (
    <span data-testid="rule-held-hint" className="mt-1 block text-[11px] text-muted-foreground">
      {t('engine.studio.held.inputHint', locale)}
    </span>
  );
  const fieldSelect = (label: string, value: string | undefined, onSet: (v: string) => void) => (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
      <RulePicker
        testId="rule-field"
        value={value ?? ''}
        disabled={disabled}
        onPick={onSet}
        className={PICKER_FULL}
        options={[
          { value: '', label: t('engine.studio.rules.pickField', locale) },
          ...fields.map((f) => ({
            value: f.name,
            label: f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name,
          })),
        ]}
      />
    </label>
  );

  // ONE element serves `script`, `cross_field` and `conditional`, and the spec
  // does not spell their guard alike — so the key is resolved per rule, not
  // baked in. It was baked in as `condition`, which made every conditional
  // rule this panel wrote refused by the very save the docblock above promises.
  const guard = guardKey(rule.type);

  const conditionField = (
    // A group named by its caption, and focusable from script only
    // (`tabIndex={-1}`): where a preset that leaves the condition empty puts
    // the author (objectui#11861).
    <div
      ref={guardRef}
      role="group"
      aria-labelledby={captionId}
      tabIndex={-1}
      className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span id={captionId} className="mb-1 block text-[11px] text-muted-foreground">
        {t('engine.studio.rules.celPre', locale)}
        <b>{t('engine.studio.rules.celTrue', locale)}</b>
        {t('engine.studio.rules.celMid', locale)}
      </span>
      {/* `scope="record"` (objectui#8167). The authority for a validation rule
          is the SERVER: objectql's rule validator evaluates a `script` /
          `cross_field` `condition` with `{ record, previous }` and nothing
          else, and since objectstack#4649 an unevaluable predicate there is
          fail-CLOSED — it rejects the write. So a bare `amount > 100` authored
          here does not merely fail to match, it makes every write to the
          object fail, while this editor linted it clean under `celAuthoring`'s
          `hint.scope ?? 'flattened'` default.

          ⚠️ What this is NOT resting on. The dispatch that ordered this change
          said the draft-level validator for THIS surface already runs
          `scope: 'record'`. It does not: `clientValidation`'s
          `validateObjectFieldRules` lints `visibleWhen` / `readonlyWhen` /
          `requiredWhen` and `formula` expressions — a sibling surface, which
          is the word the filing card itself uses. Nothing validates a
          validation rule's `condition` at draft level at all. The server
          binding above is the reason, and it is the stronger one.

          The counter-datum, recorded so it is not re-discovered as an
          objection: `ObjectValidationEngine.scopeFor` in `@object-ui/core`
          binds the bare field names AND `record`. That engine is deprecated
          and deliberately unwired — `validation-engine-stays-unwired.test.ts`
          reddens if a production module imports it — so it is not an
          authority on what an author should type. */}
      <ConditionBuilder
        value={expressionSource(rule[guard])}
        onCommit={(cel) => patch({ [guard]: writeExpressionSource(rule[guard], cel) })}
        fields={fields}
        disabled={disabled}
        scope="record"
        /* objectui#9855 — the SUBJECT dropdown's half of the narrowing the
           `scope` above buys for the autocomplete. objectql's rule validator
           evaluates this guard against `{ record, previous }` and nothing else
           (`checkPredicate` for `condition`, `checkConditional` for `when`),
           and an unevaluable predicate there is fail-CLOSED — so a `user.*`
           subject builds a row that rejects every write to the object.
           Declared at the mount, not defaulted: `scope="record"` does not
           imply a server host — see `RECORD_CONDITION_SUBJECTS`. */
        subjects={{ context: RECORD_CONDITION_SUBJECTS }}
        onBlockingIssuesChange={onBlockingIssuesChange}
      />
      {missing === 'rule' && heldHint}
    </div>
  );

  switch (rule.type) {
    case 'script':
      return conditionField;
    case 'cross_field': {
      const selected = Array.isArray(rule.fields) ? rule.fields : [];
      const toggle = (name: string, on: boolean) =>
        patch({ fields: on ? [...new Set([...selected, name])] : selected.filter((f) => f !== name) });
      return (
        <>
          {conditionField}
          <div>
            <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.rules.fields', locale)}</span>
            <div className="flex flex-wrap gap-2 rounded border p-2">
              {fields.length === 0 && (
                <span className="text-[11px] text-muted-foreground">{t('engine.studio.rules.noFields', locale)}</span>
              )}
              {fields.map((f) => (
                <label key={f.name} className="flex items-center gap-1 text-[12px]">
                  <input
                    type="checkbox"
                    checked={selected.includes(f.name)}
                    disabled={disabled}
                    onChange={(e) => toggle(f.name, e.target.checked)}
                  />
                  {f.label && f.label !== f.name ? `${f.label} (${f.name})` : f.name}
                </label>
              ))}
            </div>
          </div>
        </>
      );
    }
    case 'state_machine':
      return (
        <>
          {fieldSelect(t('engine.studio.rules.statusField', locale), rule.field, (v) => patch({ field: v }))}
          <TransitionsField
            transitions={rule.transitions && typeof rule.transitions === 'object' ? rule.transitions : {}}
            onCommit={(next) => patch({ transitions: next })}
            disabled={disabled}
            locale={locale}
          />
        </>
      );
    case 'format':
      return (
        <>
          {fieldSelect(t('engine.studio.rules.field', locale), rule.field, (v) => patch({ field: v }))}
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.rules.format', locale)}</span>
            <RulePicker
              testId="rule-format"
              value={typeof rule.format === 'string' ? rule.format : ''}
              disabled={disabled}
              onPick={(v) => patch({ format: v || undefined })}
              className={PICKER_FULL}
              options={BUILTIN_FORMATS.map((f) => ({ value: f, label: f || t('engine.studio.rules.formatNone', locale) }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.rules.regex', locale)}</span>
            <input
              value={typeof rule.regex === 'string' ? rule.regex : ''}
              disabled={disabled}
              placeholder="^[A-Z]{2}\\d{4}$"
              onChange={(e) => patch({ regex: e.target.value || undefined })}
              className={`w-full rounded border bg-background px-2 py-1 font-mono text-[12px] ${DISABLED_LOOK}`}
            />
          </label>
        </>
      );
    case 'json_schema':
      return (
        <>
          {fieldSelect(t('engine.studio.rules.field', locale), rule.field, (v) => patch({ field: v }))}
          <JsonField
            label={t('engine.studio.rules.jsonSchema', locale)}
            value={rule.schema}
            onCommit={(parsed) => patch({ schema: (parsed as Record<string, unknown>) ?? {} })}
            disabled={disabled}
            locale={locale}
          />
        </>
      );
    case 'conditional':
      return (
        <>
          {conditionField}
          <div>
            <JsonField
              label={t('engine.studio.rules.then', locale)}
              value={rule.then}
              onCommit={(parsed) => patch({ then: parsed })}
              disabled={disabled}
              locale={locale}
            />
            {missing === 'then' && heldHint}
          </div>
          <JsonField
            label={t('engine.studio.rules.otherwise', locale)}
            value={rule.otherwise}
            onCommit={(parsed) => patch({ otherwise: parsed })}
            disabled={disabled}
            locale={locale}
          />
        </>
      );
    default:
      return null;
  }
}

export function ObjectValidationsPanel({
  draft,
  onPatch,
  disabled,
  onBlockingIssuesChange,
}: {
  draft: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  /**
   * Report how many BLOCKING author-time issues the panel is showing — rule
   * guards whose CEL does not parse (objectui#4527). This panel owns no Save;
   * the Data pillar's "Save draft" writes the object, so it holds this count
   * and refuses to write.
   */
  onBlockingIssuesChange?: (count: number) => void;
}) {
  const locale = useMetadataLocale();
  const rules = React.useMemo(() => readRules(draft.validations), [draft.validations]);
  // objectui#11820 — new rules still waiting for their condition: listed and
  // edited here, and NOT in the draft (see "A new rule waits for its condition"
  // in the header). The first edit that gives one its guard writes it.
  const [unsaved, setUnsaved] = React.useState<ValidationRuleDraft[]>([]);
  const listed = React.useMemo(() => [...rules, ...unsaved], [rules, unsaved]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  // Default to the first rule so the detail pane isn't a dead "pick one" empty
  // state whenever rules already exist. Falls back automatically when `selected`
  // no longer matches the current rule list (deleted, or the object switched).
  const effectiveSelected = listed.some((r) => r.name === selected) ? selected : (listed[0]?.name ?? null);

  const fields = React.useMemo<FieldOpt[]>(
    () =>
      readFields(draft.fields).entries.map((e) => ({
        name: e.name,
        label: typeof e.def.label === 'string' ? (e.def.label as string) : undefined,
        hidden: e.def.hidden === true,
        // objectui#11894 — the type the condition builder compiles "is empty"
        // by. Without it every field here read as undeclared, and a rule built
        // as "due date is empty" saved as `!record.due_date`, which the server
        // cannot evaluate on a date, so it refused every matching write.
        // `multiple` puts a multi-capable field declared `multiple` on the
        // null-or-empty-list check.
        type: typeof e.def.type === 'string' ? (e.def.type as string) : undefined,
        multiple: e.def.multiple === true,
        // objectui#11861 — the New menu's presets pick their fields by `type`
        // and leave out `system` ones.
        system: e.def.system === true,
      })),
    [draft.fields],
  );
  const firstField = fields.find((f) => !f.hidden)?.name ?? fields[0]?.name;

  // objectui#11861 — what each preset would do on THIS object, read before the
  // author picks one so its menu row can say which fields it uses, or what the
  // object lacks.
  const presetPlans = React.useMemo(
    () => VALIDATION_PRESETS.map((preset) => ({ preset, plan: preset.plan(fields, locale) })),
    [fields, locale],
  );
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const presetIds = React.useId();
  // Set when a preset leaves its condition to the author: the menu's closing
  // focus goes to the condition editor instead of back to "New".
  const focusGuardOnClose = React.useRef(false);
  const guardRef = React.useRef<HTMLDivElement>(null);
  // objectui#12514 — the header's "New": where the menu hands focus back once
  // the empty block that opened it has given way to the list.
  const headerNewRef = React.useRef<HTMLButtonElement>(null);
  // objectui#12691 — the panel's title, and the read-only reason the rule editor is described by.
  const titleId = React.useId();
  const readOnlyReasonId = React.useId();

  /* ─── Blocking CEL verdicts → the Data pillar's Save gate (objectui#4527) ──
   *
   * Master-detail: only the SELECTED rule's ConditionBuilder is mounted, so
   * the map is keyed by rule NAME and a verdict deliberately SURVIVES
   * deselection — a rule whose guard does not parse is still in the document
   * and saving would still publish it, and it stays reachable by selecting it
   * again. What must not survive is a DELETED rule: its editor is gone and can
   * never report `0`, so the total is DERIVED against the live rule-name set
   * rather than repaired by a reset effect.
   *
   * Known limit: the lint lives in the editor, so a faulty rule the author
   * never opens is never counted. Strictly better than no gate, and the
   * mechanical scope the #4527 phase-2 ruling asked for. */
  const [celErrors, setCelErrors] = React.useState<Record<string, number>>({});
  const reportCel = React.useCallback((ruleName: string, count: number) => {
    setCelErrors((prev) => (prev[ruleName] === count ? prev : { ...prev, [ruleName]: count }));
  }, []);
  const liveRuleNames = React.useMemo(
    () => new Set(rules.map((r) => r.name ?? '')),
    [rules],
  );
  const blockingIssues = React.useMemo(() => {
    let total = 0;
    for (const [name, count] of Object.entries(celErrors)) {
      if (!liveRuleNames.has(name)) continue; // pruned: the rule is gone
      total += count;
    }
    return total;
  }, [celErrors, liveRuleNames]);
  // Held in a ref so an unmemoized host callback cannot re-fire the effect.
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);

  const commit = (next: ValidationRuleDraft[]) => onPatch({ validations: next });

  const isUnsaved = (name: string | undefined) => unsaved.some((r) => r.name === name);

  /**
   * objectui#11820 — put `next` in place of the unsaved rule named `name`: it
   * stays here while it still lacks a guard, and is written to the draft (and
   * leaves this list) the moment it has every guard its type carries.
   */
  const settleUnsaved = (name: string, next: ValidationRuleDraft) => {
    if (missingGuard(next) === null) {
      commit([...rules, next]);
      setUnsaved((prev) => prev.filter((r) => r.name !== name));
      return;
    }
    setUnsaved((prev) => prev.map((r) => (r.name === name ? next : r)));
  };

  const patchRule = (name: string, patch: Partial<ValidationRuleDraft>) => {
    const pending = unsaved.find((r) => r.name === name);
    if (pending) {
      settleUnsaved(name, { ...pending, ...patch });
      return;
    }
    commit(rules.map((r) => (r.name === name ? { ...r, ...patch } : r)));
  };

  /** Put a new rule in place: written when it lacks no guard, held otherwise (objectui#11820). */
  const placeNewRule = (rule: ValidationRuleDraft) => {
    // A type with no guard has nothing to wait for: written at once, as before.
    if (missingGuard(rule) === null) commit([...rules, rule]);
    else setUnsaved((prev) => [...prev, rule]);
    setSelected(rule.name ?? null);
  };

  const addRule = (type: RuleType) => {
    placeNewRule(newRule(type, nextRuleName(listed.map((r) => r.name ?? '')), firstField));
  };

  /**
   * objectui#11861 — the same new rule a type gets, then the keys the preset
   * fills. Its condition decides the rest: filled ⇒ written now; empty ⇒ held,
   * and the editor opens on the condition.
   */
  const addPreset = (preset: ValidationPreset, plan: Extract<PresetPlan, { ready: true }>) => {
    const rule: ValidationRuleDraft = {
      ...newRule(preset.type, nextRuleName(listed.map((r) => r.name ?? '')), firstField),
      message: plan.message,
    };
    if (plan.fields) rule.fields = plan.fields;
    if (plan.condition) rule[guardKey(preset.type)] = plan.condition;
    focusGuardOnClose.current = missingGuard(rule) !== null;
    placeNewRule(rule);
  };

  const removeRule = (name: string) => {
    if (isUnsaved(name)) setUnsaved((prev) => prev.filter((r) => r.name !== name));
    else commit(rules.filter((r) => r.name !== name));
    if (selected === name) setSelected(null);
  };

  const sel = listed.find((r) => r.name === effectiveSelected) ?? null;
  const selType = (typeof sel?.type === 'string' ? sel.type : 'script') as RuleType;
  const selUnsaved = sel !== null && isUnsaved(sel.name);
  const selMissing = selUnsaved && sel ? missingGuard(sel) : null;

  // Switching a rule's type REPLACES it with a fresh valid skeleton (so stale
  // type-specific keys — a state_machine's `transitions`, a format's `regex` —
  // don't linger on the new shape) while carrying the shared fields across.
  const changeType = (name: string, nextType: RuleType) => {
    const cur = listed.find((r) => r.name === name);
    if (!cur) return;
    const unsavedRule = isUnsaved(name);
    // An existing rule is reshaped into a VALID skeleton (it is in the draft);
    // an unsaved one keeps its empty guard (objectui#11820).
    const next = makeSkeleton(nextType, name, firstField, unsavedRule ? '' : 'false');
    // Carry a CEL condition across the types that share one — envelope
    // INCLUDED. A `typeof === 'string'` test here dropped a persisted guard on
    // the floor and left the skeleton's never-firing `'false'` in its place
    // (#3218). Carried verbatim: no `source` was edited, so `ast` stays valid.
    // Each side uses ITS OWN spelling: converting script → conditional moves the
    // guard from `condition` to `when`, and back again the other way.
    const from = guardKey(cur.type);
    const to = guardKey(nextType);
    if (
      (nextType === 'script' || nextType === 'cross_field' || nextType === 'conditional') &&
      expressionSource(cur[from])
    ) {
      next[to] = cur[from];
    }
    for (const k of ['label', 'description', 'message', 'severity', 'active', 'events', 'priority'] as const) {
      if (cur[k] !== undefined) (next as Record<string, unknown>)[k] = cur[k];
    }
    if (unsavedRule) settleUnsaved(name, next);
    else commit(rules.map((r) => (r.name === name ? next : r)));
  };

  const headerTrigger = (
    <button
      ref={headerNewRef}
      type="button"
      className="ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
    >
      <Plus className="h-3 w-3" /> {t('engine.studio.new', locale)}
      <ChevronDown className="h-3 w-3 text-muted-foreground" />
    </button>
  );
  // objectui#12514 — the one "New" menu. While the object holds no rule it
  // opens from the empty block's button, and once the first one lists it hands
  // focus to the header's "New", the trigger that is then on the page.
  const menuFromEmpty = listed.length === 0;
  const addMenu = (
    <Popover
      open={addOpen}
      onOpenChange={(open) => {
        setAddOpen(open);
        // Every opening starts on the presets, Advanced folded.
        if (open) setAdvancedOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        {menuFromEmpty ? (
          <StudioEmptyStateAction data-testid="rules-empty-new" label={t('engine.studio.rules.newButton', locale)} />
        ) : (
          headerTrigger
        )}
      </PopoverTrigger>
      <PopoverContent
        align={menuFromEmpty ? 'center' : 'end'}
        sideOffset={4}
        className="w-64 p-1"
        onCloseAutoFocus={(e) => {
          // objectui#11861 — a preset that left its condition empty
          // hands focus to the condition editor, not back to "New".
          if (focusGuardOnClose.current) {
            focusGuardOnClose.current = false;
            e.preventDefault();
            guardRef.current?.focus();
            return;
          }
          if (menuFromEmpty && headerNewRef.current) {
            e.preventDefault();
            headerNewRef.current.focus();
          }
        }}
      >
        <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('engine.studio.rules.presets', locale)}
        </p>
        {presetPlans.map(({ preset, plan }) => (
          <button
            key={preset.id}
            type="button"
            data-testid={`rule-preset-${preset.id}`}
            disabled={!plan.ready}
            aria-labelledby={`${presetIds}-${preset.id}-label`}
            aria-describedby={`${presetIds}-${preset.id}-hint`}
            onClick={() => {
              if (!plan.ready) return;
              addPreset(preset, plan);
              setAddOpen(false);
            }}
            className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <span id={`${presetIds}-${preset.id}-label`} className="text-[12px]">
              {t(preset.labelKey, locale)}
            </span>
            <span id={`${presetIds}-${preset.id}-hint`} className="text-[11px] text-muted-foreground">
              {plan.hint}
            </span>
          </button>
        ))}
        <div className="my-1 border-t" />
        <button
          type="button"
          aria-expanded={advancedOpen}
          // Names the list only while it is on the page.
          aria-controls={advancedOpen ? `${presetIds}-advanced` : undefined}
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-muted"
        >
          {advancedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('engine.studio.rules.advanced', locale)}
        </button>
        {/* The per-type menu, unchanged, folded under Advanced. */}
        {advancedOpen && (
          <div id={`${presetIds}-advanced`}>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('engine.studio.rules.newType', locale)}
            </p>
            {RULE_TYPES.map((rt) => (
              <button
                key={rt.value}
                type="button"
                onClick={() => {
                  addRule(rt.value);
                  setAddOpen(false);
                }}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-muted"
              >
                {t(rt.labelKey, locale)}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  // objectui#12691 — on a read-only package every control in the rule editor is
  // disabled for one reason, the package's. It rides the treatment the Data
  // pillar's Field properties rail got (objectui#12303): the editor body is the
  // tooltip trigger, so hovering any disabled control in it shows the reason,
  // and a tab stop described by an `sr-only` copy of it, so a keyboard or
  // screen-reader user reaches it too (a disabled control takes neither hover
  // nor focus, and Tab skipped the whole editor). One trigger for the editor
  // rather than one per control: the reason is the same for all of them.
  const ruleEditorBody = (content: React.ReactNode) => {
    if (!disabled) return <div className={EDITOR_BODY}>{content}</div>;
    const reason = t('engine.studio.pkg.readonlyHint', locale);
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              role="group"
              aria-labelledby={titleId}
              tabIndex={0}
              aria-describedby={readOnlyReasonId}
              data-disabled-reason=""
              className={`${EDITOR_BODY} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
            >
              {content}
              <span id={readOnlyReasonId} className="sr-only">{reason}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" align="start">{reason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  if (listed.length === 0) {
    return (
      <StudioEmptyState
        testId="rules-empty"
        icon={ShieldAlert}
        sentence={t('engine.studio.rules.none', locale)}
        action={disabled ? undefined : addMenu}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* rule list */}
      <div className="flex w-72 shrink-0 flex-col rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span id={titleId} className="text-[13px] font-medium">{t('engine.studio.rules.title', locale)}</span>
          <span className="text-[11px] text-muted-foreground">({listed.length})</span>
          {!disabled && addMenu}
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {listed.map((r) => (
            <button
              key={r.name}
              type="button"
              onClick={() => setSelected(r.name ?? null)}
              className={
                'flex w-full items-start gap-2 border-b px-3 py-2 text-left text-[12px] ' +
                (effectiveSelected === r.name ? 'bg-muted' : 'hover:bg-muted/50')
              }
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.label || r.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {r.message || t('engine.studio.rules.noMessage', locale)}
                </span>
                {isUnsaved(r.name) && (
                  <span data-testid="rule-unsaved" className="block truncate text-[11px] italic text-muted-foreground">
                    {t('engine.studio.rules.notSaved', locale)}
                  </span>
                )}
              </span>
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {r.type ?? 'script'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* rule editor — the list always selects a rule, so it is never blank
          for want of a pick (objectui#12514 retired that sentence). */}
      <div className="flex min-w-0 flex-1 flex-col rounded-lg border">
        {!sel ? null : ruleEditorBody(
          <>
            {/* objectui#11820 — the line the Data pillar shows for an edit it
                holds (objectui#11786), for a new rule this panel holds. */}
            {selMissing && (
              <p
                data-testid="rule-held"
                role="status"
                className="rounded-md border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"
              >
                {tFormat('engine.studio.held.line', locale, {
                  clause: tFormat(
                    selMissing === 'then' ? 'engine.studio.held.needsThenCondition' : 'engine.studio.held.needsCondition',
                    locale,
                    { rule: sel.label || sel.name || '' },
                  ),
                })}
              </p>
            )}
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.rules.type', locale)}</span>
              <RulePicker
                testId="rule-type"
                value={selType}
                disabled={disabled}
                onPick={(v) => changeType(sel.name!, v as RuleType)}
                className={PICKER_FULL}
                options={RULE_TYPES.map((rt) => ({ value: rt.value, label: t(rt.labelKey, locale) }))}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.rules.nameLabel', locale)}</span>
              <input
                value={sel.name ?? ''}
                disabled={disabled}
                onChange={(e) => {
                  const name = e.target.value;
                  patchRule(sel.name!, { name });
                  setSelected(name);
                }}
                className={`w-full rounded border bg-background px-2 py-1 text-[12px] ${DISABLED_LOOK}`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.rules.label', locale)}</span>
              <input
                value={sel.label ?? ''}
                disabled={disabled}
                onChange={(e) => patchRule(sel.name!, { label: e.target.value || undefined })}
                className={`w-full rounded border bg-background px-2 py-1 text-[12px] ${DISABLED_LOOK}`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.rules.messageLabel', locale)}</span>
              <input
                value={sel.message ?? ''}
                disabled={disabled}
                onChange={(e) => patchRule(sel.name!, { message: e.target.value })}
                placeholder={t('engine.studio.rules.messagePlaceholder', locale)}
                className={`w-full rounded border bg-background px-2 py-1 text-[12px] ${DISABLED_LOOK}`}
              />
            </label>

            {/* type-specific configuration */}
            <RuleTypeFields
              rule={sel}
              fields={fields}
              patch={(p) => patchRule(sel.name!, p)}
              disabled={disabled}
              locale={locale}
              onBlockingIssuesChange={(count) => reportCel(sel.name!, count)}
              missing={selMissing}
              guardRef={guardRef}
            />

            {/* runs-on events: the spec's events, an absent key shown as its default (objectui#11923) */}
            <div>
              <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.rules.events', locale)}</span>
              <div className="flex items-center gap-4">
                {runsOnContract().offered.map((ev) => (
                  <label key={ev} className="flex items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox"
                      checked={ruleRunsOn(sel).includes(ev)}
                      disabled={disabled}
                      onChange={(e) => patchRule(sel.name!, { events: writeRunsOn(sel, ev, e.target.checked) })}
                    />
                    {t(`engine.studio.rules.event.${ev}`, locale)}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-[12px]">
                <span className="text-muted-foreground">{t('engine.studio.rules.severity', locale)}</span>
                <RulePicker
                  testId="rule-severity"
                  value={sel.severity ?? 'error'}
                  disabled={disabled}
                  onPick={(v) => patchRule(sel.name!, { severity: v as ValidationRuleDraft['severity'] })}
                  className="h-6 w-auto gap-1.5 px-1.5 py-0.5 text-[12px]"
                  options={[
                    { value: 'error', label: t('engine.studio.rules.severityError', locale) },
                    { value: 'warning', label: 'warning' },
                    { value: 'info', label: 'info' },
                  ]}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[12px]">
                <span className="text-muted-foreground">{t('engine.studio.rules.priority', locale)}</span>
                <input
                  type="number"
                  value={typeof sel.priority === 'number' ? sel.priority : ''}
                  disabled={disabled}
                  onChange={(e) =>
                    patchRule(sel.name!, { priority: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                  className={`w-20 rounded border bg-background px-1.5 py-0.5 text-[12px] ${DISABLED_LOOK}`}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[12px]">
                <input
                  type="checkbox"
                  checked={sel.active !== false}
                  disabled={disabled}
                  onChange={(e) => patchRule(sel.name!, { active: e.target.checked })}
                />
                {t('engine.studio.rules.enabled', locale)}
              </label>
              {!disabled && (
                <button
                  type="button"
                  data-testid="rule-delete"
                  onClick={() => removeRule(sel.name!)}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" /> {t('engine.studio.rules.delete', locale)}
                </button>
              )}
            </div>
          </>,
        )}
      </div>
    </div>
  );
}

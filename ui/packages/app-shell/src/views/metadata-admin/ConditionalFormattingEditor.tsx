/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Author a list/grid view's `conditionalFormatting` rules in Studio (#1584 /
 * #1582 follow-up).
 *
 * Before this, `conditionalFormatting` had no authoring UI at all — a low-code
 * author could only hand-write the JSON. This is the missing editor: an ordered
 * list of rules, each a **CEL predicate** (authored with {@link CelPredicateField}
 * — inline lint + field autocomplete, the same canonical `@objectstack/formula`
 * engine the runtime and server use) plus a style (background / text / border
 * color). Rules are first-match-wins, so order matters — hence move up / down.
 *
 * It reads and writes the spec-canonical `{ condition, style }` shape (the one
 * `@object-ui/plugin-list`/`-grid`/`-kanban` evaluate since #1584). Legacy rule
 * shapes (`{ field, operator, value }`, top-level color props, or a
 * `{ dialect, source }` condition envelope) are normalized to `{ condition,
 * style }` on read, so opening an old rule upgrades it in place.
 */

import * as React from 'react';
import { Button, Input, cn } from '@object-ui/components';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { CelPredicateField } from './CelPredicateField.js';
import type { CelLintIssue } from './celAuthoring.js';

/**
 * Scope roots bound at RUNTIME for a row predicate, advertised to autocomplete.
 *
 * A formatting `condition` is evaluated by `@object-ui/core`'s
 * `evalRowPredicate` (ADR-0058 — list rows, grid rows, kanban cards), which
 * binds the row ONE way — as the `record` namespace — plus the host shell's
 * global predicate scope (`ExpressionProvider`, #1583/ADR-0068:
 * `current_user` / `user` / `ctx` / `os` / `features`).
 *
 * ## What changed, and why this list lost a member (objectui#7727)
 *
 * It used to bind the row THREE ways: bare fields, `record.*` and `data.*`.
 * Phase 2 of the objectui#5330 canon (`83fe6e741`, ruled 2026-09-02, amended
 * 2026-09-05) RETIRED the other two — see `@object-ui/core`'s
 * `evaluator/rowPredicateCanon.ts`. Neither `status` nor `data.status` names
 * this row any more; both fault as unknown variables, exactly as they always
 * did on the server.
 *
 * `data` is therefore off this list. The subtlety it used to carry — that a
 * host scope may legitimately bind its OWN ambient `data`, so `data.*` still
 * RESOLVED against the host's object rather than the row — no longer applies to
 * THIS host: objectui#8166 unbound it in `buildExpressionScope`. The subtlety
 * is still worth stating for a host that does bind one (a rowless dialog, the
 * metadata-admin form): "does `data` resolve?" is not a test of whether `data`
 * names the row, which is why `ConditionalFormattingEditor.test.tsx` probes it
 * against the producer's real bag instead of a hand-written literal.
 *
 * The engine's default advertisement adds `previous` / `input` / `vars`, none
 * of which are bound for row predicates at all. Suggesting an unbound root
 * would author a condition that silently never matches, so this override pins
 * the truthful catalog (#2571 follow-up).
 *
 * ## The two roots objectui#8155 settled, in opposite directions
 *
 * They were mirror images, and the ruling (2026-09-07) is that the engine's
 * `SCOPE_ROOTS` is the contract this list aligns to — in BOTH directions.
 *
 * - ⛔ `app` is GONE. It was advertised here and bound by
 *   `buildExpressionScope`, but the engine refuses it: ADR-0068 declares no
 *   such root and `@objectstack/formula`'s `SCOPE_ROOTS` has no `app`, so the
 *   record-scope lint read `app.name` as a bare field and errored with the
 *   nonsense remedy `record.app`. This editor was advertising a root its own
 *   linter rejected. `buildExpressionScope` stopped binding it in the same
 *   patch, so all three surfaces now agree that `app` does not exist here.
 * - ✅ `os` is ADDED. The mirror case: bound by `buildExpressionScope`,
 *   ACCEPTED by the engine, and merely unadvertised — so it was the one root
 *   an author could legitimately write but was never offered. It is also the
 *   root authors actually reach for: `os.user.id` is the identity spelling
 *   ADR-0068 declares and the `@objectstack/spec` expression docs describe,
 *   and in-tree authored predicates spell `record.owner == os.user.id` across
 *   `packages/core`, `packages/components` and `packages/plugin-grid`,
 *   including a conditional-formatting `condition` in
 *   `core/src/evaluator/__tests__/listConditional.test.ts`. Withholding a root
 *   that is bound, accepted AND used was curation with nothing behind it.
 *
 * `data` is deliberately still absent, and that is NOT the same case as either:
 * the engine ACCEPTS it — `SCOPE_ROOTS` still carries it, so a `data.*`
 * condition lints clean at `scope: 'record'` to this day — but the row is not
 * reachable through it. objectui#8166 settled the half this repo owns: the host
 * no longer binds an ambient `data`, so such a condition now FAULTS with the
 * engine's own `Unknown variable: data` instead of resolving against the host's
 * object. Narrowing the accept set itself is the producer-side half and lives
 * in `@objectstack/formula`, not here.
 */
export const ROW_PREDICATE_ROOTS = [
  'record',
  'current_user',
  'user',
  'features',
  'os',
  'ctx',
];

/** The canonical authoring shape this editor reads and writes. */
export interface ConditionalFormattingRuleDraft {
  condition: string;
  style: Record<string, string>;
}

/** Any historical rule shape that may already be persisted. */
type AnyRule = {
  condition?: string | { dialect?: string; source?: string };
  expression?: string;
  field?: string;
  operator?: string;
  value?: unknown;
  style?: Record<string, unknown>;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
};

/** Serialize a JS value as a CEL literal (for translating a legacy native rule). */
function celLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v);
  if (t === 'number' || t === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(celLiteral).join(', ')}]`;
  return JSON.stringify(String(v));
}

/** Translate a legacy `{ field, operator, value }` rule to a CEL predicate. */
function nativeToCel(rule: AnyRule): string {
  if (!rule.field || !rule.operator) return '';
  const ref = `record[${JSON.stringify(rule.field)}]`;
  switch (rule.operator) {
    case 'equals': return `${ref} == ${celLiteral(rule.value)}`;
    case 'not_equals': return `${ref} != ${celLiteral(rule.value)}`;
    case 'greater_than': return `${ref} > ${celLiteral(rule.value)}`;
    case 'less_than': return `${ref} < ${celLiteral(rule.value)}`;
    case 'contains': return `${ref}.contains(${celLiteral(rule.value)})`;
    case 'in': return `${ref} in ${celLiteral(Array.isArray(rule.value) ? rule.value : [rule.value])}`;
    default: return '';
  }
}

/** Resolve a rule's CEL condition string across every historical shape. */
function resolveCondition(rule: AnyRule): string {
  if (typeof rule.condition === 'string') return rule.condition;
  if (rule.condition && typeof rule.condition === 'object' && typeof rule.condition.source === 'string') {
    return rule.condition.source;
  }
  if (typeof rule.expression === 'string') return rule.expression;
  return nativeToCel(rule);
}

/** Normalize any persisted rule shape into the `{ condition, style }` draft. */
export function normalizeRule(rule: AnyRule): ConditionalFormattingRuleDraft {
  const condition = resolveCondition(rule);

  const style: Record<string, string> = {};
  if (rule.style && typeof rule.style === 'object') {
    for (const [k, v] of Object.entries(rule.style)) if (v != null) style[k] = String(v);
  }
  if (rule.backgroundColor) style.backgroundColor = String(rule.backgroundColor);
  if (rule.textColor) style.color = String(rule.textColor);
  if (rule.borderColor) style.borderColor = String(rule.borderColor);

  return { condition, style };
}

export interface ConditionalFormattingEditorProps {
  /** The current rules (any persisted shape). */
  rules?: readonly AnyRule[];
  /** Emits the full, normalized `{ condition, style }` rule list on any edit. */
  onChange: (rules: ConditionalFormattingRuleDraft[]) => void;
  /** Bound object api-name — powers CEL field lint + autocomplete. */
  objectName?: string;
  /** Field names of {@link objectName} for autocomplete. */
  fieldNames?: string[];
  disabled?: boolean;
  /** i18n resolver (`(key) => string`). */
  t: (key: string) => string;
  /**
   * Report how many BLOCKING author-time issues this editor is showing — rule
   * conditions that do not parse (objectui#4527). The inspector above
   * aggregates and hands the total to the host through
   * `MetadataInspectorProps.onBlockingIssuesChange`, because the Save button
   * belongs to the host, not here.
   *
   * Optional: mount sites with no Save to gate simply omit it. Fires whenever
   * the aggregate changes, `0` when every rule is clean.
   */
  onBlockingIssuesChange?: (count: number) => void;
}

/** A native color swatch + free-text value (hex / CSS / Tailwind), like the
 * spec-form color widget. Empty clears the style key. */
function ColorInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="color"
          value={/^#([0-9a-f]{6})$/i.test(value) ? value : '#000000'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-8 shrink-0 rounded border border-input bg-background p-0.5 disabled:opacity-60"
          aria-label={label}
        />
        <Input
          value={value}
          placeholder="#RRGGBB"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 text-xs font-mono"
        />
      </span>
    </label>
  );
}

export function ConditionalFormattingEditor({
  rules,
  onChange,
  objectName,
  fieldNames,
  disabled,
  t,
  onBlockingIssuesChange,
}: ConditionalFormattingEditorProps) {
  // Normalize the persisted rules to the authoring shape once per input change.
  const drafts = React.useMemo<ConditionalFormattingRuleDraft[]>(
    () => (Array.isArray(rules) ? rules.map(normalizeRule) : []),
    [rules],
  );

  /* ─── Blocking CEL verdicts → the inspector's aggregate (objectui#4527) ───
   *
   * Errors are counted PER RULE rather than into one running total: each rule
   * mounts its own `CelPredicateField`, and they lint independently and
   * asynchronously, so a shared counter would let whichever reported last
   * overwrite the others — fixing one of two broken rules would hand back a
   * writable Save while the other was still malformed.
   *
   * The total is DERIVED against the rule list rather than repaired by a reset
   * effect: a deleted rule's editor is gone and can never report `0` for
   * itself, so counting a verdict it left behind would wedge Save shut with no
   * editor on screen to fix it. Indices at or past the current length are
   * therefore simply not counted. */
  const [celErrors, setCelErrors] = React.useState<Record<number, number>>({});
  const reportCel = React.useCallback((index: number, issues: CelLintIssue[]) => {
    // Only `error` blocks Save; `warning` is advisory, matching #4306.
    const errs = issues.filter((i) => i.severity === 'error').length;
    setCelErrors((prev) => (prev[index] === errs ? prev : { ...prev, [index]: errs }));
  }, []);
  const ruleCount = drafts.length;
  const blockingIssues = React.useMemo(() => {
    let total = 0;
    for (const [index, count] of Object.entries(celErrors)) {
      if (Number(index) >= ruleCount) continue; // pruned: the rule is gone
      total += count;
    }
    return total;
  }, [celErrors, ruleCount]);
  // Held in a ref so an unmemoized parent callback cannot re-fire the effect.
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(blockingIssues);
  }, [blockingIssues]);

  const commit = (next: ConditionalFormattingRuleDraft[]) => onChange(next);

  const setRule = (i: number, patch: Partial<ConditionalFormattingRuleDraft>) => {
    const next = drafts.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    commit(next);
  };
  const setStyleKey = (i: number, key: string, val: string) => {
    const nextStyle = { ...drafts[i].style };
    if (val) nextStyle[key] = val;
    else delete nextStyle[key];
    setRule(i, { style: nextStyle });
  };
  const addRule = () => commit([...drafts, { condition: '', style: {} }]);
  const removeRule = (i: number) => commit(drafts.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= drafts.length) return;
    const next = drafts.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  return (
    <div className="space-y-2" data-testid="cf-editor">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('engine.inspector.view.cf.title')}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={disabled}
          onClick={addRule}
          data-testid="cf-add"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('engine.inspector.view.cf.add')}
        </Button>
      </div>

      {drafts.length === 0 && (
        <p className="text-[11px] italic text-muted-foreground">{t('engine.inspector.view.cf.empty')}</p>
      )}

      {drafts.map((rule, i) => (
        <div key={i} className="rounded-md border border-border p-2 space-y-2" data-testid={`cf-rule-${i}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('engine.inspector.view.cf.rule')} {i + 1}
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                type="button" size="icon" variant="ghost" className="h-6 w-6"
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
                aria-label={t('engine.inspector.view.cf.moveUp')}
                data-testid={`cf-up-${i}`}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button" size="icon" variant="ghost" className="h-6 w-6"
                disabled={disabled || i === drafts.length - 1}
                onClick={() => move(i, 1)}
                aria-label={t('engine.inspector.view.cf.moveDown')}
                data-testid={`cf-down-${i}`}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button" size="icon" variant="ghost"
                className="h-6 w-6 text-destructive hover:text-destructive"
                disabled={disabled}
                onClick={() => removeRule(i)}
                aria-label={t('engine.inspector.view.cf.remove')}
                data-testid={`cf-remove-${i}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <CelPredicateField
            label={t('engine.inspector.view.cf.when')}
            value={rule.condition}
            disabled={disabled}
            placeholder="record.status == 'overdue'"
            objectName={objectName}
            fieldNames={fieldNames}
            // Row predicates bind the row as `record.*` and nothing else at
            // runtime — `83fe6e741` (Phase 2 of the objectui#5330 canon)
            // retired the bare shorthand and `data.*`. So this lints in the
            // RECORD scope, the same one the field conditional rules
            // `visibleWhen` / `readonlyWhen` / `requiredWhen` use: a bare
            // `status` is an ERROR carrying the `record.status` fix instead of
            // linting clean and authoring a rule that never matches
            // (objectui#7727). The advertised roots stay the runtime-bound set.
            scope="record"
            roots={ROW_PREDICATE_ROOTS}
            onChange={(v) => setRule(i, { condition: v })}
            onLintChange={(issues) => reportCel(i, issues)}
            t={t}
            id={`cf-condition-${i}`}
          />

          <div className={cn('grid gap-2 sm:grid-cols-3')}>
            <ColorInput
              label={t('engine.inspector.view.cf.background')}
              value={rule.style.backgroundColor ?? ''}
              disabled={disabled}
              onChange={(v) => setStyleKey(i, 'backgroundColor', v)}
            />
            <ColorInput
              label={t('engine.inspector.view.cf.text')}
              value={rule.style.color ?? ''}
              disabled={disabled}
              onChange={(v) => setStyleKey(i, 'color', v)}
            />
            <ColorInput
              label={t('engine.inspector.view.cf.border')}
              value={rule.style.borderColor ?? ''}
              disabled={disabled}
              onChange={(v) => setStyleKey(i, 'borderColor', v)}
            />
          </div>

          {/* Live preview chip of the resolved style. */}
          <div
            className="rounded border border-dashed border-border px-2 py-1 text-xs"
            style={rule.style as React.CSSProperties}
            data-testid={`cf-preview-${i}`}
          >
            {t('engine.inspector.view.cf.preview')}
          </div>
        </div>
      ))}
    </div>
  );
}

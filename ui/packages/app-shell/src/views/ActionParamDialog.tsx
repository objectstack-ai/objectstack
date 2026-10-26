/**
 * ActionParamDialog — Collects user input for action parameters before execution.
 *
 * Renders each `ActionParamDef` through the SAME field-widget renderer the
 * object form uses (`@object-ui/fields` — `fieldWidgetMap` via
 * `getLazyFieldWidget`), so a declared action param of any form-supported
 * field type (`select`, `lookup`, `file`, `image`, `richtext`, `color`,
 * `date`, …) renders its real widget instead of collapsing to a text input
 * (ADR-0059). The param → field translation lives in the pure
 * `paramToField()` adapter; widgets stay lazy behind `<Suspense>` so opening
 * a dialog only loads the widgets its params actually use.
 *
 * Ambient context is relied on, not threaded: `UploadProvider` (file/image
 * uploads) and `SchemaRendererContext` (dataSource for lookup/user pickers)
 * come from the host view, exactly as the previous `LookupField` reuse did.
 *
 * One thing is threaded rather than ambient, and deliberately so: the live
 * record a dependent widget scopes itself by. The dialog is a small form, so
 * its own in-progress `values` are that record — for WHICH widgets receive it
 * and on which of the two independent grounds, see
 * `paramNeedsDependentValues()` below (objectui#3765 for the option widgets,
 * objectui#8672 ruling A for the reference-bearing pickers).
 *
 * Returns collected param values or null on cancel.
 *
 * ## A long `params` list still reaches Confirm (objectui#12080)
 *
 * The dialog takes the bound `FlowRunner`'s screen dialog has: at most `90vh`
 * tall, the param list in the ONE scrolling region, the header above it and
 * the footer below it. The upstream `DialogContent` has no height bound, so a
 * list taller than the window used to overflow both edges of a fixed,
 * scroll-locked overlay — its first required params above the top, Confirm
 * below the bottom, and nothing a mouse wheel could move. A list of more than
 * {@link NARROW_PARAM_MAX_COUNT} params also widens to two columns from `sm`
 * up; a shorter one keeps the default width and its single column.
 *
 * ## A refused run keeps what the user typed (objectui#13161)
 *
 * When the host hands the dialog the runner's `run` (`ParamDialogState.run`),
 * Confirm runs the action from inside the dialog instead of closing first:
 * the dialog stays open and busy until the run has an outcome. A successful
 * run closes it, then the runner toasts as before. A refused run leaves it
 * open with every value as typed and the refusal shown above the buttons, so
 * the user can fix the input and confirm again, or cancel. The refusal is the
 * run's own `error`, shown as it came: the dialog marks no field from it,
 * because nothing in the result names one (the runner's `ActionResult`
 * carries the refusal as text only). Without `run` the dialog closes on
 * Confirm, as it always did.
 */

import { Suspense, useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DIALOG_VIEWPORT_GUTTER,
  Button,
  Label,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  cn,
} from '@object-ui/components';
import { ChevronDown, Loader2, Lock } from 'lucide-react';
import { useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import { RefusalMessage } from '../components/RefusalMessage.js';
import type { ActionParamDef, ActionResult, ParamCollectionHandler } from '@object-ui/core';
import {
  evalRowPredicate,
  hasDeclaredPredicate,
  // The shared allow-table of widgets that are fed the dialog's own values as
  // their record — one definition for this dialog, the object form and the bulk
  // dialog (objectui#4770). Its TSDoc carries the rationale that used to be
  // repeated in each of the three copies.
  CASCADE_OPTION_WIDGET_TYPES,
  // The shared reference-bearing family — the SECOND reason a widget in this
  // dialog needs the live record, and a different one (objectui#8672, ruling A).
  // See `paramNeedsDependentValues` below; ⛔ never copied into a local literal
  // and never merged into the set above.
  EXPANDABLE_FIELD_TYPES,
} from '@object-ui/core';
import { usePredicateScope } from '@object-ui/react';
import { getLazyFieldWidget, fileIdOf } from '@object-ui/fields';
import { paramToField, paramDegradesWithoutTarget } from '../utils/paramToField.js';

export interface ParamDialogState {
  open: boolean;
  params: ActionParamDef[];
  /** Dialog title — defaults to the generic "Action parameters" label when
   *  absent. Callers pass the action's own label (e.g. "Create environment")
   *  so the dialog reads as the task, not a generic param prompt. */
  title?: string;
  description?: string;
  /**
   * Fills the `${...}` holes of each param's `helpText` — the runner's
   * `ParamCollectionHandler` `interpolate` argument, passed through. It runs on
   * the text the user reads (after an inline per-locale map is picked), in the
   * template scope the runner reads `confirmText` in, so a `${record.*}` hole
   * reads the same from a record header and from a list row (objectui#12967).
   * Absent, `helpText` prints as authored.
   */
  interpolate?: (text: string) => string;
  resolve?: (value: Record<string, any> | null) => void;
  /**
   * Runs the action with the collected values and answers how the run went —
   * the runner's `ParamCollectionHandler` `run` argument, passed through
   * (objectui#13161). Present, Confirm keeps the dialog open until the run
   * settles: it closes on success and shows the refusal beside the typed
   * values on failure. Absent, Confirm resolves and closes at once.
   */
  run?: Parameters<ParamCollectionHandler>[3];
}

/**
 * The refusal a failed run reports, as text. `error` is declared a string,
 * but a handler bug can leak the server's `{ code, message }` object through
 * it; the runner's toast reads its `message` for the same reason, and an
 * object handed to React as a child would crash the page. `null` = the run
 * said nothing (a handler that opened its own dialog for the refusal).
 */
function refusalText(result: ActionResult): string | null {
  const raw: unknown = result.error;
  if (typeof raw === 'string') return raw || null;
  const nested = (raw as { message?: unknown } | null | undefined)?.message;
  return typeof nested === 'string' && nested ? nested : null;
}

interface ActionParamDialogProps {
  state: ParamDialogState;
  onOpenChange: (open: boolean) => void;
}

/**
 * The most params the dialog keeps its default single-column width for; a
 * longer list gets the wide two-column dialog (objectui#12080 — see the
 * header). The same count as `FlowRunner`'s `NARROW_SCREEN_MAX_FIELDS`, so a
 * flow screen and an action's params lay out alike.
 */
const NARROW_PARAM_MAX_COUNT = 8;

/** Apply the dialog's `interpolate` to a picked string; anything else as-is. */
function fillHoles<T>(text: T, interpolate: ParamDialogState['interpolate']): T | string {
  return interpolate && typeof text === 'string' ? interpolate(text) : text;
}

/**
 * Filter action params by their optional `visible` predicate, evaluated on the
 * canonical entry (`evalRowPredicate`) against the host predicate scope
 * (features / user / app / data). Pure + exported so the gating is unit-testable
 * without the dialog render tree.
 *
 * ## Fail-open, and LOUD (objectui#4640)
 *
 * A param whose `visible` cannot be evaluated — unparseable source, unbound
 * identifier, a key the scope does not carry — is SHOWN, and says so once, with
 * the action and param named and the predicate quoted. Both halves are ruled,
 * not chosen here:
 *
 *  - **Loud** is the standing 2026-08-06 ruling on objectui#4051 /
 *    objectstack#5149: fail-open or fail-closed may be chosen, *silent may not*.
 *    This function used to be silent in three of the four fault shapes — the
 *    bare `catch { return true }` below the old `evaluateCondition` call swallowed
 *    parse errors and unbound identifiers without a word, so a broken predicate
 *    was indistinguishable from an absent one.
 *  - **Open** is the direction ruled for THIS surface: a silently dropped param
 *    is the undiagnosable failure — the dialog never collects a value the server
 *    requires, and the action then fails at submit with nothing pointing at the
 *    predicate. An extra offered field fails the other way, with a server
 *    rejection that carries a message. Two harms; the self-diagnosing one wins.
 *    (Row surfaces rule the opposite way — a faulting row-action `visible` stays
 *    hidden — because there the harm is acting on records the predicate excluded.)
 *
 * ## One value, one answer (objectui#3314)
 *
 * The old implementation's fail DIRECTION was decided by the predicate's
 * DIALECT, not by this surface: a bare string ran the legacy JS evaluator
 * (lenient → falsy → param silently DROPPED) while a `{ dialect, source }`
 * envelope ran CEL (fault → param silently KEPT). One `visible` key, two
 * opposite outcomes, chosen by whether the authored text happened to contain
 * `${…}` / `===`. That fork is deleted, not braced: every spelling now reaches
 * one entry, one fail direction and one warning. (`evalRowPredicate` still
 * routes a legacy-dialect STRING to the old engine for back-compat — with its
 * own deprecation warning naming the predicate — but the fault direction is the
 * same on both of its paths, so the surface no longer has two answers.)
 *
 * ## No row here — the scope keeps its own `data` / `record`
 *
 * `evalRowPredicate`'s subject is a row, and it pins `record` / `data` to it
 * over the host scope (objectui#3796). This surface has no row: its scope IS the
 * host predicate scope, `data` and all. So it passes `rowless: true`, which
 * binds nothing over the scope — an author's `data.*` / `record.*` param
 * predicate keeps reading the host's values instead of faulting on an empty
 * object written over them.
 *
 * @param actionLabel The action's own label, so the fault warning names the
 *                    action as well as the param. Optional — the param name
 *                    alone is still a locator.
 */
export function filterVisibleParams(
  params: ActionParamDef[],
  scope: Record<string, any>,
  actionLabel?: string,
): ActionParamDef[] {
  return params.filter((p) => {
    const raw: unknown = p.visible;
    // "Is a gate declared?" is asked once, by the canonical definition —
    // absent, `''`, whitespace-only and an empty `{ dialect, source: '' }`
    // envelope (what a spec-normalized empty predicate compiles to) all mean
    // "no gate", and must not reach the evaluator to be reported as a fault.
    // A value with no evaluable `source` (`0`, `{}`, an array, an `ast`-only
    // envelope) is a declared gate since objectui#11358: it reaches the
    // evaluator below, faults, and takes this surface's fail-open fallback —
    // shown, and reported.
    if (!hasDeclaredPredicate(raw)) return true;
    // A BOOLEAN `visible` is a verdict, not an expression — short-circuited the
    // same way `useRowPredicate` / the row kebab / `bulkEligibility` do
    // (objectui#3492). Handing it to the engine yields
    // `{ dialect: 'cel', source: undefined }`, which faults; on this surface's
    // fail-open that would turn `visible: false` — the most explicit "never
    // offer this" an author can write — into a shown param plus a bogus warning.
    if (typeof raw === 'boolean') return raw;
    return evalRowPredicate(raw as never, null, {
      fallback: true,
      scope,
      rowless: true,
      warnOnError: true,
      label: actionLabel
        ? `param "${p.name}" of action "${actionLabel}"`
        : `param "${p.name}"`,
    });
  });
}

/**
 * Serialize collected values for the request body. Upload widgets (`file` /
 * `image`) may hold a bare `sys_file` id — the reference form they now submit
 * when the adapter surfaces one — or a rich `{ file_id, name, url, … }` object,
 * or an array of either when `multiple`. The portable API contract is the
 * storage id(s), so each upload param is reduced to its id via `fileIdOf`, the
 * same extractor the field widgets use, so the two surfaces cannot drift on
 * what counts as an id. An object carrying no id is left intact, so the failure
 * is visible rather than silently POSTing `undefined`. Every non-upload value is
 * returned as-is. Pure + exported so the mapping is unit-testable without the
 * dialog render tree.
 *
 * `datetime` params pass through here untouched, and that is the fix for
 * objectstack#5061 — the previous version of this function converted them back
 * to the control's zone-less local wall clock (`YYYY-MM-DDTHH:mm`), which is
 * the one shape the platform's `datetime` value contract REJECTS. Since 17.0
 * the dispatcher validates a params bag against the action's declaration before
 * the handler runs (ADR-0104 D2, `validateActionParams` →
 * `InstantValueSchema`), and that contract is an ISO-8601 instant with an
 * explicit zone. A zone-less wall clock earned a 400 on every UI submission, so
 * no value a user could pick could pass: the renderer and the validator wanted
 * disjoint shapes.
 *
 * No conversion is needed at this boundary, because `DateTimeField` is already
 * ISO-canonical on both sides (objectui#3127/#3565): it takes the record's ISO
 * instant in, and hands an ISO instant back out — seconds and milliseconds
 * included, zone explicit. #3565 added the back-conversion to keep the wire
 * shape byte-identical while it fixed a display bug, and said so: moving action
 * params onto ISO is a contract change of its own. objectstack#5061 is that
 * change, and it only removes the conversion — every param value the dialog can
 * hold is already zoned (widget output, or a `defaultFromRow` seed read from a
 * stored instant). Deliberately NOT normalized here: an authored
 * `defaultValue` written as a zone-less wall clock. That value is ambiguous
 * metadata (whose zone?), the spec types it `unknown` so nothing rejects it at
 * authoring time yet, and coercing it in the renderer would make it "work" in
 * the UI while the identical literal still 400s from REST/MCP — the worst split
 * to debug. It stays loud until the spec validates a param default against the
 * param's own value contract (objectstack#6970).
 *
 * A `carryOver` param is exempt from all of it (objectui#6246): the spec's
 * contract is that its row value is submitted VERBATIM, so even a carried value
 * bound to an upload field goes out exactly as it was seeded.
 */
export function serializeParamValues(
  params: ActionParamDef[],
  values: Record<string, any>,
): Record<string, any> {
  const uploadNames = new Set<string>();
  for (const p of params) {
    if (p.carryOver) continue;
    const t = paramToField(p).type;
    if (t === 'file' || t === 'image') uploadNames.add(p.name);
  }
  if (uploadNames.size === 0) return values;
  const toId = (item: any) => fileIdOf(item) ?? item;
  const out: Record<string, any> = { ...values };
  for (const name of uploadNames) {
    const v = out[name];
    if (v == null) continue;
    out[name] = Array.isArray(v) ? v.map(toId) : toId(v);
  }
  return out;
}

/** Skeleton shown while a lazy field widget's chunk loads. */
function WidgetFallback() {
  return <div className="h-9 w-full animate-pulse rounded-md bg-muted" aria-hidden="true" />;
}

/**
 * The text an expanded carry-over summary shows. DISPLAY ONLY: what is
 * submitted is the dialog's `values` entry, which nothing here writes to.
 *
 * A string is shown exactly as it will be sent — no re-indentation of a JSON
 * column — so what the user reads is what the action submits. Anything else is
 * printed as JSON for reading. `null` = there is no value to show.
 */
function carryOverDisplayText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

/**
 * A param that declares `carryOver` (`@objectstack/spec`'s `ActionParamSchema`,
 * the 2026-08-25 ruling whose spec half is objectstack `0e4e51b0a`, objectui#6246): a
 * collapsed READ-ONLY summary.
 *
 * ⛔ No field widget is built for it at all — not a disabled one, not a
 * read-only one. The ruling's point is that the renderer leaves NO editing
 * affordance, and a disabled input is still an input some host, extension or
 * devtools session can re-enable. The value lives only in the dialog's
 * `values`, seeded from the row, and is submitted from there verbatim.
 *
 * Collapsed by default because the values this serves are large: the
 * permission-set Clone action's row-level security facet is a JSON array of
 * many policy objects. The trigger toggles the disclosure and nothing else.
 */
function CarryOverParam({
  name,
  label,
  required,
  helpText,
  value,
  hint,
  error,
}: {
  name: string;
  label: string;
  required?: boolean;
  helpText?: string;
  value: unknown;
  hint: string;
  error?: string;
}) {
  const text = carryOverDisplayText(value);
  return (
    <div className="grid gap-2" data-testid={`param-carry-over-${name}`}>
      <Collapsible className="rounded-md border bg-muted/40">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium">
          <span>
            {label}
            {required && <span className="text-destructive ml-1" aria-hidden="true">*</span>}
          </span>
          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            {hint}
            <ChevronDown
              className="size-4 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border-t px-3 py-2 font-mono text-xs">
            {text ?? '—'}
          </pre>
        </CollapsibleContent>
      </Collapsible>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
    </div>
  );
}

/**
 * Which widgets in this dialog are handed the dialog's live record as
 * `dependentValues` — and the reason is not one rule but TWO, over overlapping
 * families, exactly as the object form already splits them
 * (`form.tsx`'s `needsDataSourceWiring` line beside its
 * `CASCADE_OPTION_WIDGET_TYPES` line).
 *
 * 1. **Option widgets** — {@link CASCADE_OPTION_WIDGET_TYPES}. Their OFFERED
 *    SET is re-resolved against the record (`visibleWhen`, `dependsOn` gating)
 *    by the shared evaluator. This half has been supplied since objectui#3765.
 * 2. **Reference-bearing pickers** — {@link EXPANDABLE_FIELD_TYPES}. They have
 *    no options list to narrow; they narrow a QUERY. `LookupField` turns the
 *    field's declared `dependsOn` into a hard `$filter` (`dependentFilter` →
 *    `popoverFilter` / `baseFilter`, feeding the quick-select popover, the
 *    Level-2 table picker and PeoplePicker alike) and gates the trigger while
 *    a named parent is still empty. objectui#8672, ruling A — the maintainer's
 *    decision batch #115 — wires this half up here.
 *
 * ⭐ **Why this is not `CASCADE_OPTION_WIDGET_TYPES.add('lookup')`.** That set
 * is shared verbatim by the object form and `plugin-grid`'s `BulkActionDialog`,
 * and its members mean one specific thing: "this widget's offered OPTION set is
 * re-resolved by `resolveCascadingOptions`". A lookup's is not — it has no
 * option set. Adding a member would silently change the form's cascade-CLEAR
 * loop and the bulk dialog too, deciding objectui#4771's open boundary for two
 * surfaces this card never measured. So the families stay separate and this
 * surface ORs them, which is the extension shape `paramToField.ts` names and
 * the form has shipped all along. ⛔ Never `new Set([...A, ...B])` — a copy
 * re-forks a shared table.
 *
 * ⚠️ `EXPANDABLE_FIELD_TYPES` is read over WIDGET keys here (the output of
 * `paramToField`, i.e. `resolveParamWidgetType`), the same coincidence the form
 * documents: each reference type maps onto a same-named widget id. `tree`
 * resolves to `lookup` before it reaches this test, so that member is inert
 * here — as it is on the form. A picker that degraded to `text` for want of a
 * declared target is a `text` widget by then, and correctly gets nothing.
 */
function paramNeedsDependentValues(widgetType: string): boolean {
  return (
    CASCADE_OPTION_WIDGET_TYPES.has(widgetType) || EXPANDABLE_FIELD_TYPES.has(widgetType)
  );
}

export function ActionParamDialog({ state, onOpenChange }: ActionParamDialogProps) {
  const { t, language } = useObjectTranslation();
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  // Params whose upload widget (file/image/avatar) is mid-upload. Confirm stays
  // disabled while any is in flight so a param can't be submitted before its
  // fileId resolves (the value is only the fileId once the upload settles).
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const anyUploading = Object.values(uploading).some(Boolean);
  // A run started from Confirm is in flight (objectui#13161): Confirm and
  // Cancel are disabled and the dialog refuses to close, because the run
  // cannot be called back and closing would hide its outcome.
  const [submitting, setSubmitting] = useState(false);
  // The last run's refusal, shown above the buttons until the next Confirm.
  const [refusal, setRefusal] = useState<string | null>(null);

  // A param may carry a `visible` predicate (CEL) gating it on the same scope as
  // action visibility (features / user / app / data) — e.g. `create_user`'s
  // phoneNumber param is `features.phoneNumber == true`, so the form never offers
  // a field the backend rejects. Absent = visible; a predicate that cannot be
  // evaluated is shown AND reported once, naming this action and the param
  // (objectui#4640) — `state.title` is the action's own label, so the console
  // line points at the dialog the user is looking at.
  const scope = usePredicateScope();
  const visibleParams = useMemo(
    () => filterVisibleParams(state.params, scope, state.title),
    [state.params, scope, state.title],
  );

  /**
   * Params whose FIELD-BACKED declaration could not be resolved against object
   * metadata — `resolveActionParams()` names the `<object>.<field>` pair it
   * could not find on each one (`6cc910b6d`).
   *
   * ## Why the dialog REFUSES instead of rendering an input
   *
   * An unresolved param has no type, no options and no picker target: the
   * resolver's `type: param.type ?? 'text'` is a placeholder for a contract it
   * could not read, not a reading of one. Rendering it is a lie in both
   * directions — a `lookup` becomes an empty box with no dropdown and no
   * request for the referenced object on the wire, and a `select` loses the
   * option list that was the only legal input. When such a param is `required`
   * the action cannot be launched from the UI at all, which is exactly the
   * state that hid this defect for a whole version: the dialog LOOKED usable.
   *
   * The refusal is deliberately not gated on `required`. A param that cannot be
   * read is a broken action declaration whether or not a value is mandatory,
   * and a silent optional param is the same invisible failure one submit later.
   *
   * ⛔ Not a validation error: the user cannot fix it, so it is not reported on
   * the control. It names the object and field an administrator must repair.
   */
  const unresolvedParams = visibleParams.filter((p) => !!p.unresolvedField);
  /** Primitive digest — ⛔ never the array's identity (AGENTS.md #10). */
  const unresolvedKey = unresolvedParams.map((p) => `${p.name}=${p.unresolvedField}`).join('|');

  // Loud in EVERY build, not just dev: the whole defect this refuses was
  // invisible in a shipped one. Fired once per dialog opening — the effect is
  // keyed on the digest above, so a re-render with the same params says nothing.
  useEffect(() => {
    if (!state.open || !unresolvedKey) return;
    for (const p of unresolvedParams) {
      console.error(
        `[ActionParamDialog] Action "${typeof state.title === 'string' && state.title ? state.title : '(untitled)'}" `
          + `declares a field-backed param "${p.name}" whose backing field \`${p.unresolvedField}\` is not in `
          + 'the object metadata. The param\'s type, options and picker target are therefore unknown, so the '
          + 'dialog refuses it instead of offering an input built from a contract it could not read. '
          + 'Fix the action declaration (field name / `objectOverride`) or publish the missing field.',
      );
    }
    // `unresolvedParams` is derived from `unresolvedKey`'s source each render;
    // keying on the digest is what keeps this from re-firing on identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.title, unresolvedKey]);

  // Reset values when params change
  useEffect(() => {
    if (state.open) {
      const defaults: Record<string, any> = {};
      for (const param of visibleParams) {
        if (param.defaultValue !== undefined) {
          defaults[param.name] = param.defaultValue;
        }
      }
      setValues(defaults);
      setErrors({});
      setUploading({});
      setSubmitting(false);
      setRefusal(null);
    }
  }, [state.open, visibleParams]);

  const isMissingValue = (value: unknown): boolean => {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    // Boolean false is a VALID value — only treat undefined/null as missing.
    if (typeof value === 'boolean') return false;
    return false;
  };

  const handleSubmit = async () => {
    // A run is already in flight; Confirm is disabled too.
    if (submitting) return;
    // An upload is still in flight — the param value isn't its fileId yet, so
    // block the submit (Confirm is also disabled; this guards keyboard submit).
    if (anyUploading) return;
    // A param the resolver could not read has no value this dialog could
    // legitimately collect, so the action is not launchable from here. Confirm
    // is disabled too; this guards keyboard submit (`6cc910b6d`).
    if (unresolvedKey) return;
    // Validate required fields
    const newErrors: Record<string, boolean> = {};
    for (const param of visibleParams) {
      if (param.required && isMissingValue(values[param.name])) {
        newErrors[param.name] = true;
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    // Map upload params (file/image) from their rich widget objects to the
    // storage id(s) the API expects before resolving.
    const collected = serializeParamValues(visibleParams, values);
    if (state.run) {
      // Run from inside the dialog and close only on success (objectui#13161).
      // Closing first is what lost the input: the refusal landed on a dialog
      // that no longer existed, and only the toast remained.
      setRefusal(null);
      setSubmitting(true);
      let result: ActionResult;
      try {
        result = await state.run(collected);
      } finally {
        setSubmitting(false);
      }
      if (!result.success) {
        setRefusal(refusalText(result));
        return;
      }
    }
    // Settled with the values that ran, even if the user typed on while the
    // run was in flight.
    state.resolve?.(collected);
    onOpenChange(false);
  };

  const handleCancel = () => {
    // The run in flight cannot be called back; Cancel is disabled meanwhile,
    // and this guards Escape, an outside click and the header close button.
    if (submitting) return;
    state.resolve?.(null);
    onOpenChange(false);
  };

  const updateValue = (name: string, value: any) => {
    setValues(prev => ({ ...prev, [name]: value }));
    setErrors(prev => ({ ...prev, [name]: false }));
  };

  // A long list widens to two columns (objectui#12080 — see the header).
  const isLongList = visibleParams.length > NARROW_PARAM_MAX_COUNT;

  return (
    <Dialog open={state.open} onOpenChange={(open) => {
      if (!open) handleCancel();
    }}>
      {/* Bounded (objectui#12080): a flex column at most 90vh tall, in which
          only the body below can give up height (`min-h-0`) and scroll, so the
          header and the footer always stay on screen. */}
      <DialogContent className={cn('flex max-h-[90vh] flex-col', isLongList && `sm:max-w-3xl ${DIALOG_VIEWPORT_GUTTER}`)}>
        <DialogHeader>
          <DialogTitle>{state.title || t('actionDialog.title')}</DialogTitle>
          {/* `whitespace-pre-line` so a description composed of more than one
              paragraph renders as authored. objectui#5178 puts an admin-override
              warning ahead of the action's declared description here; collapsed
              to one run-on paragraph the warning stops reading as a warning. */}
          <DialogDescription className="whitespace-pre-line">
            {state.description || t('actionDialog.description')}
          </DialogDescription>
        </DialogHeader>

        {/* The ONE scrolling region (objectui#12080). `-mx-6 px-6` runs it to
            the dialog's edges, so the scrollbar sits on the border and a
            control's focus ring is not clipped at the sides. */}
        <div
          className={cn('-mx-6 grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4', isLongList && 'sm:grid-cols-2')}
          data-testid="action-param-body"
        >
          {visibleParams.map((rawParam) => {
            const param = {
              ...rawParam,
              label: pickLocalized(rawParam.label, language),
              helpText: rawParam.helpText != null
                ? fillHoles(pickLocalized(rawParam.helpText, language), state.interpolate)
                : rawParam.helpText,
              options: rawParam.options?.map((o) => ({ ...o, label: pickLocalized(o.label, language) })),
            };
            // The refusal comes FIRST — ahead of `paramToField()`, which would
            // otherwise build a widget from the placeholder type the resolver
            // fell back to (`6cc910b6d`).
            if (rawParam.unresolvedField) {
              return (
                <div key={param.name} className="grid gap-2">
                  <Label>{param.label}</Label>
                  <div
                    role="alert"
                    data-testid={`param-unresolved-${param.name}`}
                    className="grid gap-1 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    <p>{t('actionDialog.unresolvedParam')}</p>
                    {/* The locator is its own node rather than an interpolation
                        (`6cc910b6d`): `<object>.<field>` is an identifier, so
                        it must render verbatim in every locale, never be
                        re-ordered by a translator, and stay readable when the
                        surrounding sentence has not been translated yet. */}
                    <p className="font-mono">{rawParam.unresolvedField}</p>
                  </div>
                </div>
              );
            }
            // A declared carry-over is shown, never collected (objectui#6246):
            // it returns BEFORE `paramToField()`, so no widget exists for it and
            // nothing but the row seed ever writes its `values` entry.
            if (rawParam.carryOver) {
              return (
                <CarryOverParam
                  key={param.name}
                  name={param.name}
                  label={param.label}
                  required={param.required}
                  helpText={param.helpText}
                  value={values[param.name]}
                  hint={t('actionDialog.carryOverHint')}
                  error={errors[param.name] ? t('actionDialog.requiredError', { label: param.label }) : undefined}
                />
              );
            }
            const field = paramToField(param);
            const Widget = getLazyFieldWidget(field.type);
            // Only upload widgets emit upload-in-progress; wiring the callback
            // to non-upload widgets would spread an unknown prop toward the DOM.
            // `avatar` joined when its pick started waiting on a network
            // upload (objectui#10785).
            const isUploadWidget = field.type === 'file' || field.type === 'image' || field.type === 'avatar';
            const uploadProps = isUploadWidget
              ? { onUploadingChange: (u: boolean) => setUploading((prev) => ({ ...prev, [param.name]: u })) }
              : {};
            // The dialog's own in-progress values ARE the record its option
            // predicates are resolved against (objectui#3765, maintainer ruling
            // 2026-08-11, Option B: "the dialog is a small form"). Until this
            // prop existed the dialog passed nothing, so `useCascadingOptions`
            // resolved the EMPTY record — and a `visibleWhen` written against a
            // sibling PARAM could never see the value the user had just picked
            // in this same dialog. The evaluator is untouched: this is the
            // supply half that was missing.
            //
            // ⚠️ This used to say the fall-through reached "`SchemaRendererContext`'s
            // `formValues` / `data` — the OUTER page's record". It did not, and
            // no host could have made it: `SchemaRendererContextType` declares
            // exactly `dataSource` / `debug` / `debugFlags` / `apiFetch`, so
            // that tail was unconditionally `{}` — unsettable, not merely
            // unset. It has since been retired under ADR-0049 enforce-or-remove
            // (objectui#7206), and `useCascadingOptions` now reads
            // `dependentValues ?? {}`. The fall-through reached `{}` then and
            // resolves `{}` now, which is why a predicate the dialog has no
            // param for comes back UNRESOLVABLE rather than resolved against
            // some outer record.
            //
            // Ruled cost, recorded rather than worked around: because a
            // supplied record wins that chain outright, a predicate naming a
            // ROW field the dialog has no param for (`record.owner_id`) does not
            // resolve against the host page here. It becomes unresolvable, which
            // `resolveVisibleOptions` fails OPEN — the option is offered, never
            // wrongly hidden. ⚠️ Measured, that cost is not a loss: the same
            // predicate was ALREADY unresolvable before this prop existed,
            // because the chain's tail could not reach a host record then
            // either. Merging the two records (`{ ...row, ...values }`) was
            // option C on the card and was NOT ruled: it invents a third scope
            // dialect that would have to be written into the contract first.
            //
            // ⭐ objectui#8672, ruling A — the record now reaches the
            // reference-bearing PICKERS too, not only the option widgets.
            // WHICH record the dialog holds was the measurement the ruling left
            // to the implementer, and the answer is that there is exactly one:
            // `values`, its own in-progress params. The grid's `#7165` shape
            // (`dependentValues={ctx.pendingRow ?? ctx.row}`) has a persisted
            // row to merge staged edits into; this dialog has no row at all —
            // it is not scoped to a record, its params ARE the record, and the
            // option widgets beside it have been resolved against that same
            // `values` since objectui#3765. So `values` is the dialog's whole
            // equivalent of `pendingRow ?? row`, with no second candidate to
            // rank against it.
            //
            // Before this, a lookup param declaring `dependsOn` rendered a
            // trigger that was disabled forever: `LookupField` reached the
            // context tail that objectui#7206 measured as unconditionally `{}`,
            // so `dependenciesMissing` could never clear and the prompt named a
            // field the user had already filled. ⛔ Nothing about the cascade
            // itself is implemented here — `LookupField`'s `dependentFilter`
            // chain was always live and host-independent; this line supplies
            // the one INPUT no host could otherwise deliver.
            const cascadeProps = paramNeedsDependentValues(field.type)
              ? { dependentValues: values }
              : {};
            // A picker param that fell back to text for want of a declared
            // target keeps the "paste an ID" placeholder/help hints (objectstack-ai/objectstack#3405).
            //
            // WHICH params fell back is asked of the adapter that performs the
            // fallback — never restated here (objectui#5654). This line used to
            // carry its own literal over RAW spellings
            // (`param.type === 'lookup' || param.type === 'reference'`), a set
            // that was neither a subset nor a superset of the one that actually
            // degrades: `master_detail` degraded and got NO hints, while
            // `reference` was a hand-copy of an alias-table row this side of the
            // adapter never sees. One member set, answered once.
            //
            // The `field.type === 'text'` conjunct the two readers below used to
            // carry is subsumed, not dropped: it was their proxy for "did this
            // param degrade?", and the predicate answers that exactly — it is
            // true only when the `paramToField(param)` call above returned the
            // text fallback (equivalence pinned in `paramToField.test.ts`).
            const degradedPicker = paramDegradesWithoutTarget(param);
            if (field.type === 'select' && !field.placeholder) {
              field.placeholder = t('actionDialog.selectPlaceholder', { label: param.label });
            }
            if (degradedPicker && !field.placeholder) {
              field.placeholder = t('actionDialog.lookupPlaceholder', { label: param.label });
            }

            // Boolean → inline checkbox row (label sits beside the control
            // instead of above it; help text appears underneath).
            if (field.type === 'boolean') {
              return (
                <div key={param.name} className="grid gap-1">
                  <div className="flex items-start gap-2">
                    <Suspense fallback={<div className="size-4 mt-0.5 animate-pulse rounded-sm bg-muted" aria-hidden="true" />}>
                      <Widget
                        // The HOST owns the control id (objectui#3962), exactly
                        // as the generic branch below does. Omitting it made
                        // this branch's `<Label htmlFor>` association IMPLICIT:
                        // it only resolved because `BooleanField`'s id fallback
                        // chain reaches `config.name`, which `paramToField`
                        // seeds from `param.name` — a host living off another
                        // package's fallback. Worse, a widget that receives no
                        // host id cannot know the host already rendered a label,
                        // so it emitted its own `sr-only` copy too, and two
                        // label elements referencing one control CONCATENATE
                        // into the accessible name (accname §2D): the checkbox
                        // announced "Confirm This Confirm This". Passing the id
                        // makes the association explicit and suppresses the
                        // duplicate (PR #3959's `emitOwnLabel = !hostId`).
                        id={param.name}
                        value={values[param.name] === true}
                        onChange={(checked: unknown) => updateValue(param.name, checked === true)}
                        field={field}
                        className="mt-0.5"
                        // Required is a STATE, so it rides the state channel to the
                        // control (objectui#3299, same shape as #3290/#3298). The
                        // widget's `toDomProps` whitelist forwards `aria-*` by
                        // prefix, so this lands on the rendered control. `|| undefined`
                        // so an optional param carries no attribute at all.
                        aria-required={param.required || undefined}
                      />
                    </Suspense>
                    <Label htmlFor={param.name} className="font-normal cursor-pointer">
                      {param.label}
                      {/* Visual-only: the state is announced via `aria-required` on
                          the control; without `aria-hidden` the bare `*` would fold
                          into the accessible name ("Label asterisk"). */}
                      {param.required && <span className="text-destructive ml-1" aria-hidden="true">*</span>}
                    </Label>
                  </div>
                  {errors[param.name] && (
                    <p className="text-xs text-destructive ml-6">{t('actionDialog.requiredError', { label: param.label })}</p>
                  )}
                  {param.helpText && (
                    <p className="text-xs text-muted-foreground ml-6">{param.helpText}</p>
                  )}
                </div>
              );
            }

            return (
            <div key={param.name} className="grid gap-2">
              <Label htmlFor={param.name}>
                {param.label}
                {/* Visual-only (objectui#3299): `aria-required` on the widget is
                    the announced channel; hiding the `*` keeps it out of the
                    control's accessible name. */}
                {param.required && <span className="text-destructive ml-1" aria-hidden="true">*</span>}
              </Label>

              <Suspense fallback={<WidgetFallback />}>
                <Widget
                  id={param.name}
                  value={values[param.name] ?? null}
                  onChange={(v: unknown) => updateValue(param.name, v)}
                  field={field}
                  className={errors[param.name] ? 'border-destructive' : ''}
                  // State channel for required (objectui#3299) — deliberately NOT
                  // the native `required` attribute (#3290 ruling: that would arm
                  // the browser's constraint-validation bubble alongside the
                  // dialog's own `requiredError` messages — two validators, one
                  // field). Widgets forward `aria-*` via their `toDomProps`
                  // whitelist, so this reaches the real control.
                  aria-required={param.required || undefined}
                  {...uploadProps}
                  {...cascadeProps}
                />
              </Suspense>

              {errors[param.name] && (
                <p className="text-xs text-destructive">{t('actionDialog.requiredError', { label: param.label })}</p>
              )}
              {param.helpText && (
                <p className="text-xs text-muted-foreground">{param.helpText}</p>
              )}
              {degradedPicker && !param.helpText && (
                <p className="text-xs text-muted-foreground">
                  {t('actionDialog.lookupHelpText')}
                </p>
              )}
            </div>
            );
          })}
        </div>

        {/* The refused run's own words (objectui#13161), outside the scrolling
            region so a long param list cannot scroll it out of view. */}
        {refusal && (
          <div
            role="alert"
            data-testid="action-param-refusal"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive whitespace-pre-line"
          >
            <RefusalMessage text={refusal} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>{t('actionDialog.cancel')}</Button>
          <Button
            onClick={() => { void handleSubmit(); }}
            disabled={submitting || anyUploading || !!unresolvedKey}
            aria-busy={submitting || undefined}
          >
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
            {anyUploading ? t('actionDialog.uploading') : t('actionDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

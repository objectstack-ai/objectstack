/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:alert` — banner-style notice rendered between the page header and
 * the body of a record page. Use to draw the user's attention to a state
 * that needs action (unverified email, expired trial, locked account, …)
 * without forcing them to hunt for the relevant control.
 *
 * Schema
 * ------
 *   {
 *     type: 'record:alert',
 *     properties: {
 *       severity: 'info' | 'warning' | 'error' | 'success',  // default 'info'
 *       title?: string,
 *       body?: string,
 *       visible?: string | { dialect, source } | boolean,    // CEL/template predicate
 *       icon?: string,                                       // lucide name
 *       action?: {                                           // optional CTA
 *         actionName: string,                                // resolved from object metadata
 *         label?: string,                                    // overrides action.label
 *       },
 *       dismissible?: boolean,                               // X to dismiss
 *       dismissKey?: string,                                 // localStorage key suffix
 *     }
 *   }
 *
 * Visibility model
 * ----------------
 *   `properties.visible` is normalized by `toPredicateInput` and evaluated by
 *   `useCondition` against `usePredicateRecordContext(record)` — the repo's one
 *   row-binding rule (objectui#4075 / #4077), shared with `<ActionButton>` /
 *   `<ActionMenu>` / `<ActionGroup>` / `<ActionIcon>` and app-shell's
 *   `DeclaredActionsBar`, so this banner cannot disagree with the buttons it
 *   pairs with. The row therefore resolves the three ways objectui#5330 ruled
 *   on (maintainer, 2026-08-20): `record.status` — the CANON, what an author
 *   should write — plus the deprecated-but-kept row-action shorthand `status`
 *   and legacy `data.status`.
 *
 *   Merged UNDER the row is whatever the host put in the ambient predicate
 *   scope (`PredicateScopeProvider`; app-shell's `ExpressionProvider` supplies
 *   `current_user` / `user` / `ctx.user` / `os.user` / `data` /
 *   `features`). The row wins, so a host-supplied `record` / `data` cannot
 *   shadow it. `objectName` is NOT in the predicate scope — it is read from
 *   `useRecordContext()` for the metadata lookup and the dismiss key only.
 *
 *   Missing predicate → always visible. A predicate that cannot be evaluated →
 *   also visible: this call site is FAIL-SOFT (it does not pass
 *   `throwOnError`), which is why the unbound spellings above were a
 *   user-visible defect rather than a console line — objectui#4807.
 *   Empty `record` (loading) → hidden (no flash of stale alert), AND the
 *   predicate is not evaluated at all in that frame — a bare/`${…}`
 *   `record.*` reference against an unbound row faults, and evaluating a
 *   verdict this component is about to discard anyway only produced a
 *   permanently misleading `record is not defined` console line on every
 *   load (objectui#5776).
 *
 *   A node-level `visibleWhen` is a SEPARATE gate one tier up, evaluated by
 *   `SchemaRenderer` on its own bindings (notably `data` = the data-source
 *   ADAPTER, not the row). The two compose as AND. Both facts are pinned in
 *   `__tests__/record-alert.visibleWhen.evidence.test.tsx` (group 4) and
 *   `__tests__/record-alert.rowBinding.test.tsx`.
 *
 * CTA wiring
 * ----------
 *   The optional `action.actionName` is resolved from the object's
 *   metadata `actions[]` and executed via the shared `<ActionProvider>`
 *   runner — so confirm dialogs, param dialogs, toast, and reload
 *   handlers all work exactly as they do in `record:quick_actions`.
 *
 *   The by-name lookup is `resolveDeclaredActionIds` from `@object-ui/types`
 *   — the one function `page:header` and `record:quick_actions` call — not a
 *   hand-written `find` of its own (objectui#7382). Only its ACTION-ID arm
 *   reaches the CTA: see the comment at the lookup below.
 */

import * as React from 'react';
import {
  useRecordContext,
  useMetadataItem,
  useCondition,
  toPredicateInput,
  usePredicateRecordContext,
  useActionEngine,
} from '@object-ui/react';
import { Alert, AlertTitle, AlertDescription, Button, cn, LazyIcon } from '@object-ui/components';
// The config bag this renderer reads — its own module so this file keeps
// exporting components only; the reader's contract and its pin live there
// (objectui#6790).
import { readProps } from './record-alert.readProps';
import { useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import type { ActionDef } from '@object-ui/core';
import { resolveDeclaredActionIds } from '@object-ui/types';
// The spec's INLINE locale-map form (`string | Record< string, string >`), bound
// by reference rather than re-spelled — same import and same spelling as
// `BaseSchema.label` / `.description` in `packages/types/src/base.ts`, which
// carry this identical fact. NOT the KEYED `{ key, defaultValue }` vocabulary:
// the read sites below resolve through `pickLocalized`, whose input is the
// inline map.
import type { I18nLabel } from '@objectstack/spec/ui';

type Severity = 'info' | 'warning' | 'error' | 'success';

/**
 * Local (unexported) prop shape for the renderer below.
 *
 * ⚠️ Spelled `RecordAlertRendererProps`, NOT `RecordAlertProps`. At the RESOLVED
 * `@objectstack/spec` pin, `@objectstack/spec/ui` exports `RecordAlertProps` —
 * and a `Record<Block>Props` for every sibling block this directory renders —
 * for the block's AUTHORED properties — the key set nested under
 * `schema.properties` below, and nothing else. What this declaration holds is a
 * different thing one level up: the React props this renderer is called with, a
 * `schema` node plus `className` plus an open tail. Every other renderer beside
 * this one already spells that distinction `…RendererProps`; this file did not,
 * which is why its name was rule 1's last entry in the `check:spec-symbols` DEBT
 * ledger (objectui#7265) while its structurally identical siblings were never
 * in it. Both halves are pinned — that the spec still owns the plain name, and
 * that it does not own this one — in this package's spec-symbol file, together
 * with the sibling convention itself, re-derived from the directory rather than
 * restated here.
 *
 * `title` / `body` accept the inline locale map as well as a plain string
 * (objectui#4970): both are read through `pickLocalized` further down, and the
 * block's published authoring surface declares the two arms
 * (`plugin-detail/src/index.tsx`, `type: ['string', 'object']` since
 * objectui#3832), so while these two said `string` they were narrower than both
 * the renderer and this block's own published surface — the
 * declaration-narrower-than-the-renderer family of objectui#4581.
 *
 * The CTA's `action.label` below is the same slot one level down, widened here
 * (objectui#4998) to match: it is read through the same `pickLocalized` call as
 * `title` / `body` (`const ctaLabel = pickLocalized(props.action?.label, language)`
 * further down), so a declaration of bare `string` was narrower than the
 * renderer's own runtime behaviour, exactly as `title` / `body` were before
 * objectui#4970. This widening is TYPE-only: the block's published surface still
 * declares `action` as a bare `object` with the member shape in prose
 * (`plugin-detail/src/index.tsx`), so there is no manifest arm to align — that
 * half stays parked on the `ComponentInput` member-shape question (PR #3795).
 */
interface RecordAlertRendererProps {
  schema?: {
    properties?: {
      severity?: Severity;
      title?: string | I18nLabel;
      body?: string | I18nLabel;
      visible?: any;
      icon?: string;
      action?: { actionName: string; label?: string | I18nLabel; variant?: string };
      dismissible?: boolean;
      dismissKey?: string;
    };
    // Legacy: support flat properties too (mirrors element:text convention).
    severity?: Severity;
    title?: string | I18nLabel;
    body?: string | I18nLabel;
    visible?: any;
    icon?: string;
    action?: { actionName: string; label?: string | I18nLabel; variant?: string };
    dismissible?: boolean;
    dismissKey?: string;
    className?: string;
  };
  className?: string;
  [k: string]: any;
}

// Severity → Tailwind classes + default icon. The shadcn Alert primitive
// only ships `default`/`destructive` variants, so the other severities get
// applied via composed utility classes — keeps the primitive untouched.
const SEVERITY_STYLES: Record<Severity, { wrap: string; icon: string }> = {
  info: {
    wrap: 'border-blue-300/60 bg-blue-50 text-blue-900 dark:border-blue-700/40 dark:bg-blue-950/30 dark:text-blue-100 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-300',
    icon: 'Info',
  },
  warning: {
    wrap: 'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-300',
    icon: 'AlertTriangle',
  },
  error: {
    wrap: 'border-destructive/60 bg-destructive/10 text-destructive dark:bg-destructive/20 [&>svg]:text-destructive',
    icon: 'AlertCircle',
  },
  success: {
    wrap: 'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-100 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-300',
    icon: 'circle-check',
  },
};

export const RecordAlertRenderer: React.FC<RecordAlertRendererProps> = ({ schema = {}, className }) => {
  const props = readProps(schema);
  const recordCtx = useRecordContext();
  const record = recordCtx?.data;
  const objectName = recordCtx?.objectName || '';
  const recordId = (recordCtx?.recordId as any) ?? record?.id;
  const { language, t } = useObjectTranslation();

  // Authored copy may carry inline translations (`{ en, 'zh-CN', … }`) —
  // resolve to the current language before rendering / keying.
  const title = pickLocalized(props.title, language);
  const body = pickLocalized(props.body, language);
  const ctaLabel = pickLocalized(props.action?.label, language);

  const severity: Severity = (['info', 'warning', 'error', 'success'] as const).includes(props.severity)
    ? (props.severity as Severity)
    : 'info';
  const styles = SEVERITY_STYLES[severity];
  const iconName = props.icon || styles.icon;

  // Always-call hooks (Rules of Hooks). Bind the row through the shared
  // helper — NOT a local `{ record }` bag (objectui#4807). A root-only bag
  // resolves the canonical `record.*` spelling and nothing else, so the two
  // spellings objectui#5330 kept never reached the row: the shorthand threw
  // and this fail-soft site answered SHOWN, while `data.*` silently read the
  // host's ambient `data` and answered a constant false. Either way the
  // author's gate was never consulted. See `usePredicateRecordContext`.
  const predicateRecord = usePredicateRecordContext(record);
  const predicateInput = toPredicateInput(props.visible);
  // `recordLoaded` is also the early-return condition below — deliberately
  // the SAME expression, not a re-derived one, so the two can never drift
  // apart (objectui#5776). While `record` hasn't loaded this hook still has
  // to run (Rules of Hooks), but its verdict is provably moot: the early
  // return a few lines down hides the banner unconditionally in that frame
  // regardless of what the predicate says. Evaluating anyway made a bare/
  // `${…}` predicate that references `record.*` fault with a bare
  // `record is not defined` ReferenceError against `usePredicateRecordContext`'s
  // empty loading-frame bag (its own doc: "No row → bind NOTHING") — logged
  // via `console.warn` on EVERY load, including the correct, working ones,
  // because the SAME predicate resolves fine one frame later once `record`
  // populates. Skipping evaluation while unloaded removes that permanently
  // misleading noise without touching the verdict once data arrives: a
  // predicate that is genuinely broken (bad field, bad syntax) still faults —
  // and still logs, via this same fail-soft `useCondition` call — on every
  // frame from the first loaded one onward.
  const recordLoaded = !!record && Object.keys(record).length > 0;
  const passesPredicate = useCondition(recordLoaded ? predicateInput : undefined, predicateRecord);

  // Dismissed-state persistence. Keyed by `<objectName>:<recordId>:<key>`
  // so an admin viewing a different record sees the alert fresh, and so
  // dismissing on one record does not silence the same alert on another.
  const storageKey = React.useMemo(() => {
    if (!props.dismissible) return null;
    // Key by the language-independent resolution ('en'/default) so dismissing
    // the alert in one locale keeps it dismissed after a language switch.
    const k = props.dismissKey || pickLocalized(props.title, 'en') || severity;
    return `os.record-alert:${objectName}:${recordId ?? '_'}:${k}`;
  }, [props.dismissible, props.dismissKey, props.title, severity, objectName, recordId]);

  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    if (!storageKey || typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  // Resolve the optional CTA from object metadata (DRY — same `actions[]`
  // that backs `record:quick_actions`). Skip the lookup when no CTA is
  // requested to avoid an extra metadata fetch per record page.
  const ctaName = props.action?.actionName as string | undefined;
  const needsMeta = !!ctaName && !!objectName;
  const { item: objectMeta } = useMetadataItem('object', needsMeta ? objectName : null);
  // The lookup itself is the shared `resolveDeclaredActionIds` — the one home
  // for "an authored action id → the object's registered definition", which
  // `page:header` and `record:quick_actions` also call (objectui#7182,
  // objectui#7382). A single CTA is a one-element declared array; no CTA is
  // the empty array, never `[undefined]`, which the shared element rule
  // refuses.
  //
  // ⛔ ONLY the `ids` arm resolves a CTA. `actionName` names an action; it is
  // not a slot for an action DEFINITION. An object authored there would
  // classify as the shared rule's inline-object arm and come back as an
  // "action" — handed to the engine and executed on click, even though the
  // object declares no such action. That is renderer tolerance
  // `page:header` keeps for its own transition, and it is not this surface's
  // to inherit: here it would widen what an alert can run.
  //
  // An id that resolves to nothing renders no CTA and says nothing at
  // runtime. Refusing a misspelled `actionName` belongs to authoring time —
  // objectstack's `action-name-undefined` lint (objectstack#20105) — not to a
  // console line the author never reads.
  const ctaAction: ActionDef | undefined = React.useMemo(() => {
    const declared = resolveDeclaredActionIds<ActionDef>(
      ctaName ? [ctaName] : [],
      Array.isArray(objectMeta?.actions) ? (objectMeta.actions as ActionDef[]) : undefined,
    );
    return declared.kind === 'ids' ? declared.actions[0] : undefined;
  }, [ctaName, objectMeta]);

  // Route execution through the shared ActionEngine so confirm /
  // param-dialog / result-dialog / toast handlers from the surrounding
  // ActionProvider all fire — same pipeline that record:quick_actions
  // uses for its Salesforce-Lightning-style toolbar.
  const engineActions = React.useMemo(() => (ctaAction ? [ctaAction] : []), [ctaAction]);
  const { executeAction } = useActionEngine({
    actions: engineActions,
    context: {
      record,
      recordId,
      objectName,
    } as any,
  });

  // Hide if dismissed, if record hasn't loaded yet (avoids false alerts
  // during the empty initial-render frame — same `recordLoaded` the
  // predicate evaluation above is gated on, see its comment), or if the
  // visibility predicate returns false.
  if (dismissed) return null;
  if (!recordLoaded) return null;
  if (predicateInput !== undefined && !passesPredicate) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, '1');
      } catch {
        /* storage disabled — dismiss for session only */
      }
    }
  };

  const handleCta = () => {
    if (!ctaAction?.name) return;
    void executeAction(ctaAction.name);
  };

  return (
    <Alert
      className={cn('relative pr-12', styles.wrap, className)}
      role={severity === 'error' ? 'alert' : 'status'}
      aria-live={severity === 'error' ? 'assertive' : 'polite'}
    >
      <LazyIcon name={iconName} className="h-4 w-4" aria-hidden="true" />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {body || ctaAction ? (
        <AlertDescription>
          {body ? <p className="mb-2 last:mb-0">{body}</p> : null}
          {ctaAction ? (
            <Button
              size="sm"
              variant={(props.action?.variant as any) || (severity === 'error' ? 'destructive' : 'default')}
              onClick={handleCta}
            >
              {ctaLabel || ctaAction.label || ctaAction.name}
            </Button>
          ) : null}
        </AlertDescription>
      ) : null}
      {props.dismissible ? (
        <button
          type="button"
          onClick={handleDismiss}
          // objectui#12145 — the close button's accessible name, read from the
          // pack. It borrows the dismissible home banner's key rather than
          // adding a second key for the same name.
          aria-label={t('home.recoveryReminder.dismiss', { defaultValue: 'Dismiss' })}
          className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/80 hover:bg-foreground/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <LazyIcon name="X" className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </Alert>
  );
};

export default RecordAlertRenderer;

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `MetadataTypeActions` — renders the declarative, **type-level** actions a
 * metadata type carries (GAP-1) using the same button affordance business
 * objects use for their `actions`.
 *
 * The framework's `/meta/types` endpoint emits these on each rich entry as
 * spec `ActionSchema` objects (see `MetadataTypeAction` in `useMetadata`).
 * The canonical first consumer is the `datasource` type, which declares a
 * "Test connection" action (`type:'api'`, `POST
 * /api/v1/datasources/${ctx.recordId}/test`). Rendering happens in two
 * chrome slots:
 *
 *   • ResourceEditPage  → `location='record_header'`, `recordId` = item name.
 *   • ResourceListPage  → `location='list_toolbar'` (no recordId).
 *
 * Execution path mirrors ObjectView's auth-aware `apiHandler` rather than the
 * core ActionRunner's bare `fetch`: the metadata API endpoints require the
 * better-auth session cookie + bearer token, which only ride along through
 * `createAuthenticatedFetch` (and matter in split-origin dev where the SPA is
 * on :5180 and the backend on :3000). `${ctx.recordId}` / `${param.X}` tokens
 * in `target` are resolved here, exactly as the spec mandates renderers do.
 *
 * Dialogs: actions that declare an array of `params` collect them from the
 * user in the shared {@link ActionParamDialog} before running (same UX as
 * business-object actions); actions that declare a `resultDialog` render the
 * API response in {@link ActionResultDialog}. `confirmText` still gates the run,
 * asked in an in-app AlertDialog that names the action and the item it runs on
 * (objectui#13333), never the browser's native `confirm()`.
 *
 * Only `type:'api'` is wired today; other types surface a toast so a
 * misconfigured action fails loud instead of silent.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@object-ui/components';
import { createAuthenticatedFetch } from '@object-ui/auth';
import type { ActionParamDef } from '@object-ui/core';
import { actionRendersAt, type ActionLocation } from '@object-ui/types';
import { getIcon } from '../../utils/getIcon.js';
import { ActionParamDialog, type ParamDialogState } from '../ActionParamDialog.js';
import { ActionResultDialog, type ResultDialogState } from '../ActionResultDialog.js';
import type { MetadataTypeAction, RichMetadataTypeEntry } from './useMetadata.js';
import { t, tFormat, useMetadataLocale } from './i18n.js';

/** An open `confirmText` question: its copy, and the settle of the run awaiting it. */
interface ConfirmState {
  title: string;
  message: string;
  actionLabel: string;
  resolve: (ok: boolean) => void;
}

/** Map the spec's action variants onto the Shadcn Button variants. */
const VARIANT_MAP: Record<NonNullable<MetadataTypeAction['variant']>, React.ComponentProps<typeof Button>['variant']> = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'destructive',
  ghost: 'ghost',
  link: 'link',
};

/**
 * Substitute `${ctx.X}` / `${param.X}` tokens in an action target. Values are
 * `encodeURIComponent`'d — opaque ids in a path segment (datasource name) are
 * the only use today, and encoding is the correct behaviour for those.
 */
function interpolateTarget(
  target: string,
  ctx: Record<string, unknown>,
  params: Record<string, unknown>,
): string {
  if (target.indexOf('${') === -1) return target;
  return target.replace(/\$\{(param|ctx)\.([\w.]+)\}/g, (_m, scope: string, path: string) => {
    const root = scope === 'param' ? params : ctx;
    const value = path
      .split('.')
      .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), root);
    return value == null ? '' : encodeURIComponent(String(value));
  });
}

export interface MetadataTypeActionsProps {
  /** The rich type entry whose `actions` to render. */
  entry?: Pick<RichMetadataTypeEntry, 'actions'> | undefined;
  /**
   * Which chrome slot is asking — actions are filtered by their `locations`.
   * Typed as the spec vocabulary rather than `string` so a typo cannot quietly
   * match nothing: both call sites pass a literal, so this costs them nothing.
   */
  location: ActionLocation;
  /** Current item name, exposed to actions as `${ctx.recordId}`. */
  recordId?: string;
  /** Called after a successful action when `refreshAfter` is set. */
  onAfter?: () => void;
}

/**
 * Render the location-filtered type-level actions. Returns `null` when the
 * type declares none for this slot, so callers can drop it straight into an
 * existing toolbar `<>…</>` without conditionals.
 */
export function MetadataTypeActions({ entry, location, recordId, onAfter }: MetadataTypeActionsProps): React.ReactElement | null {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [paramState, setParamState] = React.useState<ParamDialogState>({ open: false, params: [] });
  const [resultState, setResultState] = React.useState<ResultDialogState>({ open: false });
  const [confirmState, setConfirmState] = React.useState<ConfirmState | null>(null);
  const locale = useMetadataLocale();
  const authFetch = React.useMemo(() => createAuthenticatedFetch(), []);

  // Placement is `actionRendersAt`'s call (objectui#3142). These actions come
  // from the server's `/meta/types` feed, so a type shipping an action with no
  // `locations` used to get a button on BOTH the list toolbar and the record
  // header; now it must declare where it belongs, like every other surface.
  const actions = React.useMemo(
    () => (entry?.actions ?? []).filter((a) => actionRendersAt(a, location)),
    [entry?.actions, location],
  );

  if (actions.length === 0) return null;

  /** Open the param dialog and resolve with the collected values (or null on cancel). */
  const collectParams = (params: ActionParamDef[], title?: string) =>
    new Promise<Record<string, unknown> | null>((resolve) => {
      setParamState({ open: true, params, title, resolve });
    });

  /**
   * Ask an action's `confirmText` in the dialog below and resolve with the
   * answer. The title names the action and, in the record header, the item it
   * runs on (objectui#13333).
   */
  const askConfirm = (title: string, confirmText: string) =>
    new Promise<boolean>((resolve) => {
      setConfirmState({
        title: recordId
          ? tFormat('engine.typeAction.confirmTitle', locale, { action: title, item: recordId })
          : tFormat('engine.typeAction.confirmTitleNoItem', locale, { action: title }),
        message: confirmText,
        actionLabel: title,
        resolve,
      });
    });

  /**
   * Settle the open confirm and close it. The confirm button's click settles
   * `true` first; the close that follows settles `false` on a promise that has
   * already settled, which does nothing.
   */
  const settleConfirm = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirmState(null);
  };

  const run = async (action: MetadataTypeAction) => {
    const title = action.label ?? action.name;

    // Only `type:'api'` is wired today. Default (`undefined`) is treated as
    // `script` by the spec, which the engine cannot execute — fail loud.
    if (action.type !== 'api') {
      toast.error(`Action “${title}”: type "${action.type ?? 'script'}" is not supported here yet.`);
      return;
    }

    if (action.confirmText && !(await askConfirm(title, action.confirmText))) return;

    // Inputs: an array of param descriptors → collect in a dialog; a static
    // object → forward as-is.
    let params: Record<string, unknown>;
    if (Array.isArray(action.params) && action.params.length > 0) {
      const collected = await collectParams(action.params as ActionParamDef[], title);
      if (collected == null) return; // user cancelled
      params = collected;
    } else {
      params = (action.params as Record<string, unknown> | undefined) ?? {};
    }

    const ctx = { recordId, origin: window.location.origin };
    const resolved = interpolateTarget(action.target ?? '', ctx, params);
    if (!resolved) {
      toast.error(`Action “${title}” has no target.`);
      return;
    }

    // Split SPA + backend dev: promote same-origin `/api/...` paths to the
    // backend origin so the request (and its auth cookie) reaches :3000.
    const apiBase = ((import.meta as { env?: Record<string, string> }).env?.VITE_SERVER_URL || '').replace(/\/+$/, '');
    const url = /^https?:\/\//i.test(resolved) ? resolved : `${apiBase}${resolved}`;
    const method = (action.method || 'POST').toUpperCase();

    setBusy(action.name);
    try {
      const init: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      };
      if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(params);

      const res = await authFetch(url, init);
      let body: Record<string, unknown> | null = null;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        /* non-JSON / empty body — fall back to status text */
      }

      // framework#3843: the service route modules now answer the declared
      // `{ success, data }` envelope (`BaseResponseSchema`), so the payload a
      // `resultDialog` binds to — and the `message` the success toast reads —
      // lives under `data` rather than at the top level. Unwrap it here, in the
      // one place every `type: 'api'` action passes through.
      //
      // Deliberately tolerant of an already-unwrapped body: endpoints an action
      // may target are converted module by module (framework#3675 → objectstack-ai/objectstack#3689 →
      // objectstack-ai/objectstack#3843), so this repo must not be coupled to the merge order of that
      // sequence. Same reason the two attachment openers read
      // `body?.url ?? body?.data?.url` for framework#3689.
      const data =
        body && typeof body.success === 'boolean' && 'data' in body
          ? (body.data as Record<string, unknown> | null)
          : body;

      if (!res.ok || (body && body.success === false)) {
        // `error` is `{ code, message }` in the envelope, and was a bare string
        // before it — read both so a partially-converted backend still explains
        // itself instead of toasting "[object Object]".
        const err = body?.error as { message?: string } | string | undefined;
        const detail =
          (typeof err === 'object' && err !== null ? err.message : undefined) ||
          (typeof err === 'string' ? err : undefined) ||
          (body?.message as string) ||
          `HTTP ${res.status} ${res.statusText}`.trim();
        toast.error(`${action.errorMessage ? `${action.errorMessage}: ` : ''}${title}: ${detail}`);
        return;
      }

      // Rich result reveal when declared, else a success toast.
      if (action.resultDialog) {
        setResultState({ open: true, spec: action.resultDialog as ResultDialogState['spec'], data: data ?? {} });
      } else {
        const msg = action.successMessage || (typeof data?.message === 'string' ? (data.message as string) : `${title} ✓`);
        toast.success(msg);
      }
      if (action.refreshAfter) onAfter?.();
    } catch (err) {
      toast.error(`${title}: ${(err as Error)?.message ?? String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {actions.map((action) => {
        const Icon = action.icon ? getIcon(action.icon) : null;
        const isBusy = busy === action.name;
        return (
          <Button
            key={action.name}
            size="sm"
            variant={VARIANT_MAP[action.variant ?? 'secondary'] ?? 'secondary'}
            disabled={isBusy}
            onClick={() => run(action)}
            title={action.label ?? action.name}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : Icon ? (
              <Icon className="h-4 w-4 mr-1" />
            ) : null}
            {action.label ?? action.name}
          </Button>
        );
      })}

      {/*
        Close = flip `open` and KEEP every other field (objectui#6473), the
        shape the other two `ActionParamDialog` consumers in this package
        already carry: `hooks/useConsoleActionRuntime.tsx` and
        `views/RecordDetailView.tsx` converged on it in objectui#6431. This was
        the third consumer and the last one still blanking.

        `DialogContent` carries `duration-200 data-[state=closed]:animate-out`,
        so Radix holds the content mounted through its exit animation and the
        dialog goes on rendering off `state` for the whole fade-out. The
        `{ open: false, params: [] }` this replaced dropped `title` and emptied
        `params`, so the closing dialog re-titled itself from the action's own
        label to the generic `actionDialog.title` and dropped every param row
        while it faded. `run()` opens with a real title (`action.label ??
        action.name`), so this site does have something to lose. (`description`
        is the one field of the sibling shape this site never supplies — it is
        the generic string under both shapes here, so it is not what was lost.)

        This is NOT the form deliberately dropping stale values: the user's
        typed values never lived in `paramState`. They live in
        `ActionParamDialog`'s own `values`, reseeded from the param defaults on
        every `state.open` false-to-true edge, so a reopen starts from the
        defaults under either shape.

        The `paramState.resolve?.(null)` that used to run before the reset is
        GONE rather than retained, and that is an enumeration, not an appeal to
        "resolving twice is a no-op". This callback is reachable from exactly
        three places, all inside `ActionParamDialog`, and every one settles the
        promise BEFORE it asks for the close: `handleSubmit`
        (`state.resolve?.(collected)`, the serialized values), `handleCancel`
        (`state.resolve?.(null)`), and the Radix root's own `onOpenChange`,
        which delegates to `handleCancel` and is the route Escape, an
        overlay/outside click and the header X button all take. No path arrives
        here unsettled. `MetadataTypeActions.paramDialogClose-6473.test.tsx`
        drives all four routes and asserts the settle precedes this callback, so
        a future path that skipped it is red there rather than a pending promise
        here.
      */}
      <ActionParamDialog
        state={paramState}
        onOpenChange={(open) => {
          if (!open) setParamState((s) => ({ ...s, open: false }));
        }}
      />
      <ActionResultDialog
        state={resultState}
        onAcknowledge={() => setResultState({ open: false })}
      />
      <AlertDialog
        open={confirmState !== null}
        onOpenChange={(open) => {
          // Escape, an outside click and Cancel all close: the run is declined.
          if (!open) settleConfirm(false);
        }}
      >
        <AlertDialogContent data-testid="type-action-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="type-action-confirm-cancel">
              {t('engine.cancel', locale)}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="type-action-confirm-action"
              onClick={() => settleConfirm(true)}
            >
              {confirmState?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * useConsoleActionRuntime — the reusable console "action runtime".
 *
 * ObjectView historically owned all the wiring needed to make schema-driven
 * `action:button`s actually *do* something: confirm/param/result dialogs, an
 * authenticated API caller, flow + server-action handlers, SPA navigation, and
 * the paused screen-flow runner. SDUI pages (PageView) render the same
 * `action:button` widgets but lacked that runtime, so their actions could not
 * collect params, call authenticated APIs, show result dialogs, refresh, or
 * navigate (#1605).
 *
 * This hook extracts that generic wiring so BOTH ObjectView and PageView can
 * mount it. It owns the dialog state and handlers, and returns:
 *   - `actionProviderProps` — spread onto `<ActionProvider>`;
 *   - `dialogs` — the confirm/param/result/flow dialogs to render inside it;
 *   - the individual handlers (e.g. `confirmHandler`, `toastHandler`) so a
 *     caller like ObjectView can also feed them into `useObjectActions`.
 *
 * `objectName` is optional: pages run global (or action-scoped) actions, while
 * ObjectView passes its current object so object-scoped actions resolve their
 * target + param defaults.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, createAuthenticatedFetch } from '@object-ui/auth';
import { usePermissions } from '@object-ui/permissions';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { ActionProvider, useGlobalUndo, useMetadata, type ActionProviderProps } from '@object-ui/react';
import { toast } from 'sonner';
import type {
  ActionContext,
  ActionDef,
  ActionParamDef,
  ActionResult,
  ConfirmationHandler,
  NavigationHandler,
  ParamCollectionHandler,
  ResultDialogHandler,
  ServerActionHandler,
  ToastHandler,
} from '@object-ui/core';
import { actionErrorDetail, captureUpdateUndoData, resolveRecordIdParamSeed, resolveServerActionRecordId } from '@object-ui/core';
import { useActionModal } from './useActionModal.js';
import { ActionConfirmDialog, type ConfirmDialogState } from '../views/ActionConfirmDialog.js';
import { ActionParamDialog, type ParamDialogState } from '../views/ActionParamDialog.js';
import { ActionResultDialog, type ResultDialogState } from '../views/ActionResultDialog.js';
import { FlowRunner, type ScreenFlowState, type ScreenSpec } from '../views/FlowRunner.js';
import { FlowRefusalNotice, type FlowRefusalState } from '../views/FlowRefusalNotice.js';
import { resolveActionParams, withKnownObjects } from '@object-ui/fields';
import { EnvironmentEntitlementDialog, type EntitlementDialogState } from '../environment/EnvironmentEntitlementDialog.js';
import { entitlementDialogFromError, type EntitlementDialogSpec } from '../environment/entitlements.js';
import { resolvePageVarTokens } from '../utils/resolvePageVarTokens.js';
import { launchConsoleFlow } from '../utils/flowLaunch.js';
import { createConsoleServerActionHandler } from '../utils/consoleServerAction.js';
import { modalTargetRefusalMessage } from '../utils/modalTargetDiagnostics.js';
import { actionContextOrg } from '../utils/actionContextOrg.js';
import { resolveHostAppSegment } from '../utils/appRoute.js';
import { hostInConsolePath } from '../utils/hostInConsolePath.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import type { ConsoleActionDispatch } from '../consoleActionDispatch.js';

const FALLBACK_USER = { id: 'current-user', name: 'Demo User', isPlatformAdmin: false };

/**
 * Extract a human-readable message from an error response body — shared with
 * every `/actions` caller, which needs the same React-#31 guard. Owned by
 * `@object-ui/core` since #2904 (it moved there with the dispatch itself).
 */
const errorDetail = actionErrorDetail;

export interface ConsoleActionRuntimeOptions {
  /** Adapter for generic CRUD / execute calls. */
  dataSource: any;
  /** All object definitions — used to resolve param defaults from row/object. */
  objects?: any[];
  /** Current object name (ObjectView). Omit for pages running global actions. */
  objectName?: string;
  /** Invoked after a successful action that requests a refresh (`refreshAfter`
   *  !== false) — bump a refresh key to re-fetch embedded data. */
  onRefresh?: () => void;
  /**
   * The `:appName` of the app route the caller renders under, when it renders
   * under one. A `type: 'form'` action then opens its form inside that app's
   * shell (`/apps/<app>/forms/<name>`) rather than on the app-less
   * `/forms/<name>` (objectui#13433). Omitted — the console-wide runtime, which
   * sits above the route tree — the form keeps the app-less route: this hook
   * does not read the URL itself, and the shell's published app is the last
   * app the user had open, not necessarily one they are in now.
   */
  routeAppSegment?: string;
}

export interface ConsoleActionRuntime {
  confirmHandler: ConfirmationHandler;
  toastHandler: ToastHandler;
  navigateHandler: NavigationHandler;
  paramCollectionHandler: ParamCollectionHandler;
  resultDialogHandler: ResultDialogHandler;
  // Two parameters, like its three siblings below — the implementation has
  // always been `(action, context?)` (it reads `context.pageVariables` to
  // resolve `{{page.<var>}}` tokens). The one-parameter declaration was a
  // narrower restatement that nothing could catch while the tests calling it
  // with two arguments were unchecked (objectui#4040).
  apiHandler: (action: ActionDef, context?: ActionContext) => Promise<ActionResult>;
  /**
   * Carries `refuseBeforeInput` (objectui#13397), so the runner refuses a
   * single-record flow launched with 0 or several rows selected before its
   * param dialog opens — the member `serverActionHandler` carries since
   * objectui#13384, answered by the same resolver.
   */
  flowHandler: ((action: ActionDef, context?: ActionContext) => Promise<ActionResult>)
    & Pick<ServerActionHandler, 'refuseBeforeInput'>;
  serverActionHandler: (action: ActionDef, context?: ActionContext) => Promise<ActionResult>;
  /** `type: 'modal'` — opens `target` as a page/object form, else runs the action server-side. */
  modalActionHandler: (action: ActionDef, context?: ActionContext) => Promise<ActionResult>;
  /** Authenticated fetch wrapper (Bearer + tenant + cookies). */
  authFetch: ReturnType<typeof createAuthenticatedFetch>;
  /** Open the shared environment entitlement (upgrade / limit) dialog. */
  openEntitlementDialog: (spec: EntitlementDialogSpec) => void;
  /**
   * Props to spread onto `<ActionProvider>`.
   *
   * DERIVED from that component's own props (`ActionProviderProps`) rather than
   * restated. The key list stays explicit — it states which props this hook
   * owns — but every TYPE comes from the consumer, so the two cannot drift.
   * They had: the restatement omitted `onModal` (which the implementation has
   * returned all along) and declared `handlers` values as one-parameter
   * functions where `<ActionProvider>` passes `(action, ctx)`. Neither was
   * visible while this package's tests were not type-checked — the suite next
   * door asserts `typeof props.onModal === 'function'` and was reading a key
   * the interface said did not exist (objectui#4040).
   */
  actionProviderProps: Required<
    Pick<
      ActionProviderProps,
      | 'context'
      | 'onConfirm'
      | 'onToast'
      | 'onModal'
      | 'onNavigate'
      | 'onParamCollection'
      | 'onResultDialog'
      | 'handlers'
    >
  >;
  /** Confirm / param / result / paused-flow / flow-refusal dialogs — render inside the provider. */
  dialogs: React.ReactNode;
}

export function useConsoleActionRuntime(opts: ConsoleActionRuntimeOptions): ConsoleActionRuntime {
  const { dataSource, objects, objectName, onRefresh, routeAppSegment } = opts;
  const navigate = useNavigate();
  const { user, activeOrganization } = useAuth();
  // [ADR-0066 D4] System capabilities for the action capability gate. Forwarded
  // AS-IS below (no `?? []`) — `undefined` here means either no
  // PermissionProvider is mounted, or the backend never reported
  // `systemPermissions` at all (a deployment predating ADR-0066), and
  // `ActionEngine`'s own `Array.isArray(held)` check already fails OPEN on
  // that (framework#3923). Defaulting it to `[]` here used to silently
  // collapse "unknown" into "holds nothing" and gate every
  // `requiredPermissions` action closed on exactly the deployments this
  // doctrine exists to protect (objectui#4656).
  const { systemPermissions } = usePermissions();
  const { fieldLabel, fieldOptionLabel, actionParamText, actionParamOptionLabel, actionDescription, actionResultDialog } = useObjectLabel();
  // Entitlement 403s render as a dialog, not a toast — its copy is localized
  // here rather than taken from the server (objectui#2458 / cloud#959).
  // `language` also resolves inline per-locale action-param labels below, and
  // with `i18n` it is what a flow launch translates the flow's own toasts in
  // (objectui#12075).
  const { t, language, i18n } = useObjectTranslation();

  /**
   * The console's own metadata store.
   *
   * ⛔ The CONTEXT VALUE is what this closes over — never its `objects` getter,
   * which builds a fresh array on every read, and never a snapshot of that
   * array. The getter and `ensureType` both read the provider's live cache
   * through refs, so a value captured at any render answers with today's data
   * at CALL time. Nothing below therefore rests on the identity of a memoised
   * result (AGENTS.md #10): the dep carries the value only so the lint rule can
   * see it, and a discarded-and-recomputed context value would rebuild this
   * callback with no change in what it reads.
   *
   * ⭐ Why this hook reaches for it at all (`6cc910b6d`). Field-backed action
   * params resolve against `ctx.objects`, and the `objects` OPTION is whatever
   * the caller happened to hold: `ConsoleShell`'s root runtime passes NONE, and
   * `DeclaredActionsBar` passes exactly ONE object (and none at all when it is
   * driven by an `actions` prop). A param whose owner is not in that list
   * resolves to nothing — and, because a field-backed param carries no inline
   * `type`, silently becomes a `text` param: an empty box with no dropdown and
   * no request for the referenced object on the wire, while the SAME field
   * renders a real picker on a record form in the same build, off the same
   * store. The binding was never missing from the client; this seam just never
   * asked for it. The caller's list still WINS (see `withKnownObjects`) — a
   * preview/draft world stays authoritative for the objects it carries.
   */
  const metadata = useMetadata();

  const objectDef = useMemo(
    () => (objectName ? objects?.find((o: any) => o.name === objectName) : undefined),
    [objects, objectName],
  );
  // Object name used for API paths / generic CRUD. Falls back to the action's
  // own `objectName` (set per call below) or 'global'.
  const objApiName = objectName || (objectDef as any)?.name;

  const refresh = useCallback(() => { onRefresh?.(); }, [onRefresh]);

  // Global undo/redo (Ctrl+Z / Ctrl+Shift+Z), backed by the dataSource. The
  // success toast's "Undo" button calls `undoCtl.undo()` for `undoable` actions
  // (the ActionRunner has already pushed the operation onto the UndoManager).
  // The confirmation it raises reads the session's language, as the button's
  // own label does (objectui#11056).
  const undoCtl = useGlobalUndo({
    dataSource,
    onUndo: () => { refresh(); toast.success(t('actions.undone')); },
  });

  // Promise-based confirm / param / result dialogs.
  const [confirmState, setConfirmState] = useState<ConfirmDialogState>({ open: false, message: '' });
  const [paramState, setParamState] = useState<ParamDialogState>({ open: false, params: [] });
  const [resultDialogState, setResultDialogState] = useState<ResultDialogState>({ open: false });
  // A paused `screen`-node flow awaiting user input.
  const [screenFlow, setScreenFlow] = useState<ScreenFlowState | null>(null);
  // A flow launch that ended `refused` without pausing (objectui#9973).
  const [flowRefusal, setFlowRefusal] = useState<FlowRefusalState>({ open: false });
  // Plan/capacity gate dialog (upgrade / limit), opened by the api-action error
  // path below when the server refuses a create. The env-list toolbar opens no
  // dialog: its plan-locked state draws a locked mark instead (objectui#12190).
  const [entitlementDialog, setEntitlementDialog] = useState<EntitlementDialogState>({ open: false });

  const resultDialogHandler = useCallback<ResultDialogHandler>(
    (spec: any, data: unknown, action?: any) => new Promise<void>((resolve) => {
      // Localize title/description/acknowledge + field labels via the
      // `_actions.<action>.resultDialog` convention (metadata literals as
      // fallback). The action's own object wins over the page object,
      // mirroring the param-dialog localization below.
      const objForI18n = (typeof action?.objectName === 'string' && action.objectName)
        ? action.objectName
        : objectName || (objectDef as any)?.name;
      const localized = actionResultDialog(objForI18n, action?.name, spec) ?? spec;
      setResultDialogState({ open: true, spec: localized, data, resolve });
    }),
    [objectName, objectDef, actionResultDialog],
  );

  const confirmHandler = useCallback<ConfirmationHandler>((message, options) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ open: true, message, options, resolve });
    });
  }, []);

  // `ConsoleActionDispatch`, not bare `ActionDef` (objectui#5611): this handler
  // reads `overrideNotice`, which is host-composed dispatch chrome rather than
  // authorable metadata, so it is declared at the seam instead of on the
  // published authored-metadata mirror. Narrowing off `any` is what puts this
  // whole function under the compiler — every other read below is a declared
  // `ActionDef` field, and the one that was not is the reason objectui#4282
  // backed the narrowing out.
  const paramCollectionHandler = useCallback<ParamCollectionHandler>((params: ActionParamDef[], action?: ConsoleActionDispatch, interpolate?: (text: string) => string, run?: Parameters<ParamCollectionHandler>[3]) => {
    return new Promise<Record<string, any> | null>((resolve) => { void (async () => {
      // ⭐ Ask the store for the object type BEFORE resolving (`6cc910b6d`).
      // `ensureType` is idempotent and answers from cache in a microtask once
      // warm, so the cost is nil on the path a user actually takes — but it is
      // what makes "this field does not exist" an ANSWER rather than a race.
      // The refusal below is only sound if the metadata had its chance to
      // arrive; resolving against a store that simply had not fetched yet would
      // refuse a perfectly good param the instant a console booted cold.
      await metadata.ensureType('object').catch(() => []);
      const knownObjects = withKnownObjects(objects, metadata.objects);
      // List_item actions stash the row record under params._rowRecord (see
      // ObjectGrid → onRowAction). Pull it out so resolveActionParams can
      // pre-fill `defaultFromRow` params from the row's current values.
      const row = action?.params && !Array.isArray(action.params)
        ? (action.params as Record<string, any>)._rowRecord
        : undefined;
      // Field-backed params resolve against the action's OWN object when the
      // dispatch carries one (related-list row actions retarget a CHILD object
      // — e.g. sys_member rows on an org record page); the page-level object
      // is only the fallback. Without this, a child action's `field` lookup
      // ran against the parent object, missed, and degraded to a bare text
      // input (no select options, no field label).
      const actionObject = typeof action?.objectName === 'string' && action.objectName
        ? action.objectName
        : undefined;
      const resolved = resolveActionParams(params as any, {
        objectName: actionObject || objectName || (objectDef as any)?.name || '',
        objects: knownObjects,
        fieldLabel,
        fieldOptionLabel,
        row,
        // Resolves an inline per-locale `label` map (rc.6's widened
        // `I18nLabel`) for the active language — objectui#4163.
        locale: language,
      });
      // Localize each param's label/placeholder/helpText via the
      // `_actions.<action>.params.<param>.<attr>` convention.
      const objForI18n = actionObject || objectName || (objectDef as any)?.name;
      const localized = (resolved as any[]).map((p: any) => ({
        ...p,
        label: actionParamText(objForI18n, action?.name, p.name, 'label', p.label) ?? p.label,
        placeholder: actionParamText(objForI18n, action?.name, p.name, 'placeholder', p.placeholder) ?? p.placeholder,
        helpText: actionParamText(objForI18n, action?.name, p.name, 'helpText', p.helpText) ?? p.helpText,
        options: Array.isArray(p.options)
          ? p.options.map((o: any) => ({ ...o, label: actionParamOptionLabel(objForI18n, action?.name, p.name, o.value, o.label) }))
          : p.options,
      }));
      // objectui#5178 — a caller-authored notice that must reach the user
      // AHEAD of the declared description, and must not be replaceable by a
      // translation bundle.
      //
      // `DeclaredActionsBar` sets this when the viewer is taking a privileged
      // admin-override branch (`can_act:false && can_override:true`), naming the
      // approvers about to be bypassed. It is deliberately NOT folded into
      // `description`: `actionDescription` resolves
      // `_actions.<name>.description` and prefers a bundle hit over the passed
      // literal, and `plugin-approvals` ships exactly such an entry for
      // `approval_reject` — so a warning routed through `description` would be
      // silently overwritten by the ordinary "Reject this request?" copy in
      // every locale that has the bundle. A safety notice a translation can
      // delete is not a safety notice.
      //
      // The notice arrives already localized (bar-authored chrome, resolved
      // through the normal locale bundle), so it is concatenated verbatim.
      // The declared description's `${...}` holes are filled here, in the
      // runner's template scope (the row is `record` on a row dispatch —
      // objectui#12967), and BEFORE the notice joins it: the notice carries
      // approver names, which are data, never a template.
      const localizedDescription = actionDescription(objForI18n, action?.name, action?.description);
      const declaredDescription = interpolate && localizedDescription
        ? interpolate(localizedDescription)
        : localizedDescription;
      const overrideNotice = typeof action?.overrideNotice === 'string' && action.overrideNotice
        ? action.overrideNotice
        : undefined;
      setParamState({
        open: true,
        params: localized,
        // Titled from `label` alone — the one spelling an action carries for
        // this. The `|| action?.title` fallback that used to sit here read a
        // key declared on no action surface at all — not `@objectstack/spec`'s
        // `ActionSchema`, not `ActionDef`, not `@object-ui/types`' renderer
        // view (`ui-action.ts`) or `crud.ts` — and forwarded by none of the
        // four action renderers, so it could not fire from authored metadata
        // (objectui#4282). Reads exactly one key, like `description` below.
        title: action?.label,
        description: overrideNotice
          ? [overrideNotice, declaredDescription].filter(Boolean).join('\n\n')
          : declaredDescription,
        interpolate,
        resolve,
        // The runner's `run`, so Confirm runs the action from inside the
        // dialog and a refusal keeps what the user typed (objectui#13161).
        run,
      });
    })(); });
  }, [objectName, objectDef, objects, metadata, fieldLabel, fieldOptionLabel, actionParamText, actionParamOptionLabel]);

  const currentUser = user
    ? { id: user.id, name: user.name, avatar: user.image, isPlatformAdmin: (user as any)?.isPlatformAdmin ?? false, systemPermissions }
    : { ...FALLBACK_USER, systemPermissions };

  const toastHandler = useCallback<ToastHandler>((message, options) => {
    if (options?.type === 'error') { toast.error(message); return; }
    if (options?.undo) {
      toast.success(message, {
        duration: options.duration,
        action: { label: options.undo.label || 'Undo', onClick: () => { void undoCtl.undo(); } },
      });
      return;
    }
    toast.success(message, { duration: options?.duration });
  }, [undoCtl]);

  // The app an in-place hop is hosted under (objectui#13379): the inbox's own
  // answer to the same question — `resolveHostAppSegment` over the shell's
  // published app (`currentAppName`, re-checked against the live app list) —
  // so a post-success hop and a notification link from the same page land in
  // the same app. `currentAppName` is read from the navigation context, not
  // `useParams`: the console-wide runtime (`ConsoleShell`) sits above the
  // route tree, where the URL's own `:appName` is not matched.
  const { currentAppName } = useNavigationContext();
  const hostAppSegment = resolveHostAppSegment(metadata.apps, currentAppName);

  const navigateHandler = useCallback<NavigationHandler>((url, options) => {
    if (options?.external || options?.newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      navigate(hostInConsolePath(url, hostAppSegment, routeAppSegment));
    }
  }, [navigate, hostAppSegment, routeAppSegment]);

  // Authenticated fetch for direct backend calls. Declared before apiHandler.
  //
  // `sameOriginOnly` (#2725 mitigation, applied to this lane per the #5702
  // ruling): an action's `target` comes from author-supplied metadata and may
  // name an off-origin host. Cross-origin requests pass through to the bare
  // global fetch — no Authorization, X-Tenant-ID, or Accept-Language — matching
  // the renderers' `apiFetch` lane (ConsoleShell). Same-origin actions
  // are unaffected. An off-origin integration that legitimately needs the
  // platform bearer declares itself explicitly or proxies same-origin.
  const authFetch = useMemo(() => createAuthenticatedFetch({ sameOriginOnly: true }), []);

  const openEntitlementDialog = useCallback((spec: EntitlementDialogSpec) => {
    setEntitlementDialog({ open: true, spec });
  }, []);

  const apiHandler = useCallback(async (action: ActionDef, context?: ActionContext): Promise<ActionResult> => {
    try {
      const target = action.target || action.name;
      const params = action.params || {};

      // Absolute HTTP target — bypass dataSource and call the API directly
      // through the authenticated fetch wrapper. Same-origin targets get
      // Bearer + X-Tenant-ID + same-origin cookies; an off-origin target
      // (the metadata may name a third-party host) goes out through the bare
      // global fetch with none of them (`sameOriginOnly`, #5702). The
      // canonical path for schema actions on managed-by tables and global
      // page actions.
      const targetStr = typeof target === 'string' ? target : '';
      const isAbsolute = targetStr.startsWith('/') || /^https?:\/\//i.test(targetStr);
      if (isAbsolute) {
        const baseUrl = import.meta.env.VITE_SERVER_URL || '';
        const rawParams = { ...(params as Record<string, any>) };
        const rowRecord = rawParams._rowRecord as Record<string, any> | undefined;
        delete rawParams._rowRecord;

        // Resolve `{{page.<var>}}` tokens against the live page-variable snapshot
        // (published into the action context by PageVariableActionBridge). This is
        // what lets a pure-SDUI form submit the values its inputs wrote into page
        // variables; whole-value tokens preserve type. See resolvePageVarTokens.
        const pageVars = (context?.pageVariables ?? undefined) as Record<string, any> | undefined;
        const resolvedParams = resolvePageVarTokens(rawParams, pageVars);

        // Interpolate `{field}` tokens in the target URL from the row record.
        let resolvedTarget = targetStr;
        if (rowRecord && /\{[a-z_][a-z0-9_]*\}/i.test(resolvedTarget)) {
          resolvedTarget = resolvedTarget.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (_, k) => {
            const v = rowRecord[k];
            return v == null ? '' : encodeURIComponent(String(v));
          });
        }
        const url = resolvedTarget.startsWith('http') ? resolvedTarget : `${baseUrl}${resolvedTarget}`;

        const wrap = action.bodyShape && typeof action.bodyShape === 'object' && action.bodyShape.wrap
          ? action.bodyShape.wrap
          : undefined;
        const body: Record<string, any> = wrap ? { [wrap]: resolvedParams } : { ...resolvedParams };

        // objectstack-ai/objectstack#3447: decision outputs. DeclaredActionsBar synthesizes one param per
        // author-declared output key, named `outputs.<key>` (the key set is
        // per-request, so it can't be a static action param). Fold the dotted
        // params into the nested `outputs` object the approvals decide route
        // expects. Scoped to the `outputs.` prefix — a generic dotted-key fold
        // could reinterpret existing actions' literal param names.
        for (const k of Object.keys(body)) {
          if (k.startsWith('outputs.') && k.length > 'outputs.'.length) {
            const value = body[k];
            delete body[k];
            if (value === undefined || value === '') continue; // blank optional output → omit
            (body.outputs ??= {})[k.slice('outputs.'.length)] = value;
          }
        }

        // Seed the declared `recordIdParam` from the row — or REFUSE
        // (objectstack#8018). The read used to be `if (rowValue != null)` with a
        // silent `else`, so a row that could not supply the key sent the request
        // anyway, minus the parameter naming the record. A backend that reads a
        // missing selector as "match nothing" then answers success for having
        // changed nothing, and the user is told the action worked. Refusing is
        // the contract-first answer (AGENTS.md #0.1): an under-specified request
        // is rejected at the producer, not sent and hoped about. `error` here is
        // what makes the runner toast it (see the entitlement note below).
        const seed = resolveRecordIdParamSeed(action, rowRecord);
        if (seed.error) return { success: false, error: seed.error };
        if (seed.value !== undefined) body[action.recordIdParam!] = seed.value;

        const isAuthOrgEndpoint = /\/api\/v1\/auth\//.test(resolvedTarget);
        if (isAuthOrgEndpoint && !body.organizationId && activeOrganization?.id) {
          body.organizationId = activeOrganization.id;
        }

        if (action.bodyExtra && typeof action.bodyExtra === 'object') {
          Object.assign(body, resolvePageVarTokens(action.bodyExtra, pageVars));
        }

        const method = (action.method || 'POST').toUpperCase();
        const init: any = {
          method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        };
        if (method !== 'GET' && method !== 'DELETE') {
          init.body = JSON.stringify(body);
        }
        const res = await authFetch(url, init);
        if (!res.ok) {
          let body: any = null;
          try { body = await res.json(); } catch { /* response body not JSON */ }
          // Plan/capacity gates (e.g. creating an environment the org's plan
          // doesn't include) come back as coded 403s. Surface them as a friendly
          // upgrade/limit DIALOG with a CTA — never a generic red error toast.
          // Returning success:false WITHOUT an `error` suppresses the runner's
          // error toast (ActionRunner.handlePostExecution); the dialog owns the
          // messaging.
          const entitlementSpec = entitlementDialogFromError(body, t);
          if (entitlementSpec) {
            openEntitlementDialog(entitlementSpec);
            return { success: false };
          }
          return { success: false, error: errorDetail(body, `HTTP ${res.status}`) };
        }
        const json = await res.json().catch(() => ({}));
        // A business rejection can arrive as HTTP 200 with `success: false`
        // (objectstack#3913). `res.ok` alone misses it, so the call reported
        // success, toasted green and refreshed while the error was swallowed
        // (#2958). Classified BEFORE the refresh below — a rejected call
        // changed nothing to re-fetch.
        if (json && typeof json === 'object' && (json as { success?: unknown }).success === false) {
          // `name` is not guaranteed on an api action (it can be target-only),
          // so fall back to the endpoint rather than interpolating `undefined`.
          return { success: false, error: errorDetail(json, `Action "${action.name || targetStr}" failed`) };
        }
        if (action.refreshAfter !== false) refresh();
        // Unwrap the ObjectStack `{ success, data }` envelope so `result.data`
        // is the inner payload — the contract every `result.data` consumer
        // expects. The action `resultDialog` field paths (e.g. `user.email`,
        // `temporaryPassword`) and the success toast's `outcome` and
        // `${result.*}` reads (objectui#11344) are all written relative to the
        // inner `data`. flowHandler and
        // serverActionHandler already unwrap `json.data`; apiHandler was the
        // lone handler that leaked the whole envelope, which blanked every
        // resultDialog whose paths didn't redundantly prefix `data.` (the
        // "Create User temporary password shows empty" bug). Bare,
        // non-enveloped responses (some stock better-auth bodies) pass through
        // unchanged.
        const data = json && typeof json === 'object' && !Array.isArray(json) && 'data' in json
          ? (json as { data: unknown }).data
          : json;
        return { success: true, data, reload: action.refreshAfter !== false };
      }

      // Generic list-level API handler: update/execute via dataSource. Only
      // meaningful when an object context exists (ObjectView); pages without an
      // object resolve their actions through the absolute path above.
      const obj = action.objectName || objApiName;
      // The row record is stashed under `_rowRecord` for list_item actions —
      // separate it from the field values, and resolve the record id from it
      // (the action's static params carry the field changes, not the id).
      const rowRecord = (params as any)._rowRecord as Record<string, any> | undefined;
      const fields: Record<string, any> = { ...(params as Record<string, any>) };
      delete fields._rowRecord;
      const recId = fields.recordId ?? rowRecord?.[(action as any).recordIdField || 'id'];
      delete fields.recordId;

      // Constant body fields merged last (overrides user params), matching the
      // absolute-HTTP branch and the spec's documented `bodyExtra` semantics.
      // Without this a pure-confirmation action (confirmText, no params array)
      // carries its mutation only in bodyExtra, leaving `fields` empty so the
      // update below is skipped and nothing is persisted.
      if (action.bodyExtra && typeof action.bodyExtra === 'object') {
        Object.assign(fields, action.bodyExtra);
      }

      if (obj && typeof dataSource?.execute === 'function') {
        await dataSource.execute(obj, target, fields);
      } else if (obj && recId && Object.keys(fields).length > 0 && typeof dataSource?.update === 'function') {
        await dataSource.update(obj, recId, fields);
      }

      // Undoable single-record update: capture the prior values of the changed
      // fields from the row record so the success toast can offer "Undo".
      //
      // ⛔ A field the row does not CARRY is never captured as `null`
      // (objectui#10404). The snapshot is `@object-ui/core`'s
      // `captureUpdateUndoData`, called on this handler's written set
      // (`params` plus `bodyExtra`), so the rule lives in one place
      // (objectui#11082). A list row is projected by `$select`, so a written
      // field no column shows is absent while the server holds a real value;
      // recording `null` made Undo overwrite it. A `null` the row carries is a
      // real empty value and is captured as one. When any written field is not
      // carried there is no Undo at all: the success toast then has no Undo
      // button, and the warning names the cause.
      //
      // ⛔ A relation is captured as its stored id, never as the record
      // `$expand` put in its place (objectui#11122): a grid expands the
      // relations it shows, so the row carries `{ id, name, … }` where the
      // server stores the id. The rule reads which fields are relations from
      // the written object's field definitions, looked up the way the param
      // dialog looks them up (the caller's `objects` first, then the console's
      // metadata store, asked to load before it answers).
      let undo: ActionResult['undo'];
      if (action.undoable && obj && recId && rowRecord && Object.keys(fields).length > 0
          && typeof dataSource?.update === 'function') {
        const written = Object.keys(fields);
        await metadata.ensureType('object').catch(() => []);
        const objectFields = withKnownObjects(objects, metadata.objects)
          .find((o: any) => o?.name === obj)?.fields;
        const undoData = captureUpdateUndoData(written, rowRecord, objectFields);
        if (undoData) {
          undo = {
            id: `undo-${obj}-${recId}-${Date.now()}`,
            type: 'update',
            objectName: obj,
            recordId: String(recId),
            timestamp: Date.now(),
            // objectui#11080 — the object, never an English verb: the Undo / Redo
            // toast supplies the verb from a pack key (see the runner's twin).
            description: action.label || obj,
            undoData,
            redoData: { ...fields },
          };
        } else {
          const missing = written.filter((k) => captureUpdateUndoData([k], rowRecord, objectFields) === undefined);
          console.warn(
            '[useConsoleActionRuntime] `undoable` action succeeded but offers no Undo: the row it ran on '
            + 'does not carry every field it wrote, so their prior values are unknown and an Undo would '
            + 'overwrite stored data. A list row carries a written field when the object declares it and '
            + 'the principal may read it.',
            { action: action.name, missing },
          );
        }
      }

      const shouldRefresh = action.refreshAfter !== false;
      if (shouldRefresh) refresh();
      return { success: true, reload: shouldRefresh, undo };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }, [dataSource, objApiName, objects, metadata, authFetch, activeOrganization, refresh, openEntitlementDialog, t]);

  /**
   * Flow action handler — starts the flow through one of two doors
   * (objectui#12037, triage ruling B; the rule and its reasons live in
   * `utils/flowLaunch`):
   *
   * - a click whose object and `name` resolve to a DECLARED `type: 'flow'`
   *   action with the same target goes through the action door,
   *   `POST /api/v1/actions/:object/:action`, so every server-side gate that
   *   action declares applies to the click (ADR-0066 D4);
   * - every other flow click — an inline page button with no or a
   *   non-matching `name`, a dashboard header's synthesized
   *   `name: actionUrl` — stays on `POST /api/v1/automation/:flow/trigger`.
   *   An undeclared flow start has no action gate to apply, and ruling A's
   *   elevation refusal already holds on the trigger route.
   *
   * The lookup reads the object metadata this hook already holds (the
   * caller's `objects`, then the console's store, asked to load first as the
   * param dialog asks). An object-less declared action or a standalone action
   * row no object embeds is absent from it, so such a click keeps taking the
   * trigger route, as every flow click did before.
   *
   * `context` is the shared ActionRunner context (registered handlers are
   * invoked as `handler(action, runnerContext)`).
   *
   * This is the dispatch only; the registered `flowHandler` below wraps it
   * with the early row-count refusal (objectui#13397).
   */
  const flowDispatch = useCallback(async (action: ActionDef, context?: ActionContext): Promise<ActionResult> => {
    const flowName = action.target || action.name;
    if (!flowName) {
      return { success: false, error: 'No flow target provided for flow action' };
    }
    try {
      const baseUrl = import.meta.env.VITE_SERVER_URL || '';
      const params = { ...(action.params || {}) } as Record<string, any>;
      delete params._rowRecord;
      // The record a launch runs on, by the ONE selection rule the `script`
      // launcher uses (objectui#12331): `@object-ui/core`'s
      // `resolveServerActionRecordId`. An explicit `params.recordId`, then the
      // list_item row (`_rowRecord`), then — for a list_toolbar launch, which
      // carries no row — the grid's checkbox selection (`selectedRecords`,
      // published into the runner context by ObjectGrid). One row supplies the
      // record. Several rows are refused: a flow takes a single `recordId`
      // input, so the run would fail at its first record-bound node. Zero rows
      // are refused when the action is record-scoped by its `locations`, so the
      // wizard does not open, collect input and die there ("Update requires an
      // ID"); a pure object-level toolbar flow keeps triggering with no record.
      // This handler used to hold a second copy of that rule, worded for flows.
      // ⛔ Never re-add one here: a rule written twice drifts.
      //
      // A launch through the runner is refused before its dialog by
      // `flowHandler.refuseBeforeInput` below; this check stays for a caller
      // that invokes the handler directly. Its refusal is shown through its
      // pack key, as the runner shows the early one (objectui#13397), with
      // the English source as the default and the fallback for an empty
      // answer.
      const resolution = resolveServerActionRecordId(action, context);
      if (resolution.error) {
        const error = resolution.errorKey
          ? String(t(resolution.errorKey, { defaultValue: resolution.error })) || resolution.error
          : resolution.error;
        return { success: false, error };
      }
      const recordId = resolution.recordId;
      if (recordId != null && params.recordId == null) params.recordId = recordId;
      // Ask the store for the object type BEFORE the lookup, as the param
      // dialog does (`6cc910b6d`): it answers from cache once warm, and it is
      // what makes "this click names no declared action" an answer rather
      // than a race against a cold store.
      await metadata.ensureType('object').catch(() => []);
      // Single source for the door choice, the request, the flow-response
      // rule AND what a launch does with it — shared with RecordDetailView's
      // copy of this handler (and the interpretation with FlowRunner's
      // resume). Each launch copy once held its own branch set, and each time
      // a kind was missing it fell into the terminal-success tail: a failed
      // run toasted green (#2958), and a run that ended `refused` without
      // pausing toasted the action's `successMessage` and refreshed while the
      // refusal was never shown (objectui#9973). See utils/flowLaunch.
      const launch = await launchConsoleFlow<ScreenSpec>({
        fetch: authFetch,
        baseUrl,
        action,
        objectName: action.objectName || objApiName,
        recordId,
        triggerParams: params,
        objects: withKnownObjects(objects, metadata.objects),
        translation: { i18n, language },
      });
      const judged = launch.judged;
      // Paused at a `screen` node: FlowRunner renders the form + resumes, and
      // refreshes on completion. The pause keeps the action's own toast
      // silent, so its `successMessage` rides along to the run's completion
      // (objectui#12234 — see FlowRunner's header).
      if (judged.followUp?.kind === 'screen') {
        setScreenFlow({
          flowName: launch.flowName,
          flowLabel: judged.followUp.flowLabel,
          runId: judged.followUp.runId,
          screen: judged.followUp.screen,
          actionSuccessMessage: action.successMessage,
        });
      }
      // Ended `refused`: the Close-only notice carries the engine's sentence,
      // titled with the action the user clicked.
      if (judged.followUp?.kind === 'refusal') {
        setFlowRefusal({ open: true, title: action.label, message: judged.followUp.message });
      }
      if (judged.refresh) refresh();
      return judged.result;
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }, [authFetch, objApiName, objects, metadata, refresh, i18n, language, t]);

  // Server-side action handler — POST /api/v1/actions/{object}/{action}, built
  // from @object-ui/core's `createServerActionHandler` via the shared console
  // wrapper (#2904): core owns the dispatch (name-only identity per ADR-0110
  // D1, the record-id resolution dance, the re-entrancy guard, the /actions
  // envelope rule), the wrapper owns the console DOM choreography (popup
  // pre-open, `newTabUrl` fast path, `redirectUrl` convention).
  // RecordDetailView builds ITS handler from the same two pieces — the drift
  // between the two hand-rolled copies (objectstack#3913, framework#3935)
  // cannot recur.
  //
  // The env ref keeps the handler INSTANCE stable across renders (authFetch is
  // memoized once) while the config thunks read the latest object scope and
  // refresh callback — the factory's in-flight guard only spans invocations of
  // the same instance.
  const serverActionEnvRef = useRef({ objApiName, refresh, t, navigate });
  serverActionEnvRef.current = { objApiName, refresh, t, navigate };
  const serverActionHandler = useMemo(
    () => createConsoleServerActionHandler({
      fetch: authFetch,
      baseUrl: () => import.meta.env.VITE_SERVER_URL || '',
      resolveObject: () => serverActionEnvRef.current.objApiName,
      onRefresh: () => serverActionEnvRef.current.refresh(),
      // SPA route hop for a handler-returned `openIn: 'self'` — react-router's
      // own `navigate`, read through the env ref like every other live value
      // here so the handler instance stays stable.
      navigate: (url: string) => serverActionEnvRef.current.navigate(url),
      // Read through the env ref so the spinner-tab / popup-blocked copy
      // follows a language switch without invalidating the handler instance
      // (objectui#3321).
      t: (key, englishDefault) => String(serverActionEnvRef.current.t(key, englishDefault)),
    }),
    [authFetch],
  );

  /**
   * The registered flow handler: {@link flowDispatch}, plus the early
   * row-count refusal the runner asks before its confirmation and param
   * dialog (`ActionRunnerHandler`'s `refuseBeforeInput`, objectui#13397).
   * Without it a single-record flow launched from a list toolbar with 0 or
   * several rows ran its whole param dialog and was refused only after
   * Confirm, in English.
   *
   * The member is `serverActionHandler`'s own — core's
   * `createServerActionHandler` builds it (objectui#13384) and the console
   * wrapper forwards it. That handler is built here with no `resolveRecordId`,
   * so its member runs `resolveServerActionRecordId`, the resolver
   * `flowDispatch` runs, and skips an action whose dialog itself collects
   * `recordId`. ⛔ Never write a flow copy of that rule: a rule written twice
   * drifts.
   */
  const flowHandler = useMemo(
    () => Object.assign(
      (action: ActionDef, context?: ActionContext) => flowDispatch(action, context),
      { refuseBeforeInput: serverActionHandler.refuseBeforeInput },
    ),
    [flowDispatch, serverActionHandler],
  );

  // Client-side modal transport, shared with RecordDetailView so a
  // `type: 'modal'` action behaves the SAME on a list page, an SDUI page, a
  // declared-actions bar and a record page. Before this, only RecordDetailView
  // opened modals client-side and every other console surface POSTed them to
  // `/actions/...` — the same button did two different things depending on
  // where it was mounted (framework#3530).
  const { modalHandler, modalElement, resolveModalTarget } = useActionModal(dataSource);

  /**
   * `type: 'modal'` dispatch — CLIENT-SIDE ONLY. The action's `target` names
   * the page to open (spec: "the modal/page name to open"); rendering it is
   * the whole of what a modal action does.
   *
   * [objectstack#3959] This used to fall through to `serverActionHandler` when
   * the target resolved to neither a page nor an object, documented as "how a
   * modal action bound to `engine.registerAction(...)` still runs". It never
   * ran: the framework's `headlessActionTypeError` rejects `type: 'modal'`
   * over REST with a 400, because a modal has no server dispatch. The
   * fallthrough only converted an authoring mistake — a target naming no
   * page — into a confusing round-trip, and it let apps ship handlers no
   * declaration could address (app-todo's `deferTask` / `setReminder` sat dead
   * for exactly this reason).
   *
   * An unresolvable target is now reported as what it is. To collect input and
   * then run server-side, declare `type: 'script'` with `params`: the runner
   * collects the same dialog and the handler runs with those values.
   *
   * The refusal WORDING is built by `utils/modalTargetDiagnostics`, shared with
   * `RecordDetailView.modalActionHandler` and `useActionModal.modalHandler`.
   * All three used to spell it here, and drifted: PR #4764 retired the object
   * fallback and rewrote only `useActionModal`'s copy, leaving this one — the
   * one console users actually read — saying the target names "no page or
   * object" and never mentioning `type: 'form'`, the replacement the
   * retirement handed authors (objectui#4767). Change the contract there, not
   * here.
   */
  const modalActionHandler = useCallback(async (action: ActionDef, _context?: ActionContext): Promise<ActionResult> => {
    const schema = (action as any).modal ?? action.target ?? (action as any).params?.schema;
    const descriptor = schema != null ? await resolveModalTarget(schema) : null;
    if (descriptor) return modalHandler(descriptor);
    return {
      success: false,
      error: modalTargetRefusalMessage({
        actionName: action.name,
        target: schema,
        serverHandlerHint: true,
      }),
    };
  }, [resolveModalTarget, modalHandler]);

  const actionProviderProps = useMemo(() => ({
    context: {
      ...(objectName ? { objectName } : {}),
      // The field definitions of the object `objectName` names, published
      // beside it (objectui#11122). `ActionRunner`'s `operation: 'update'`
      // Undo capture reads them to tell a relation, captured as its stored id,
      // from a field whose value merely has an object's shape.
      ...(objectName && objectDef?.fields ? { objectFields: objectDef.fields } : {}),
      // Its declared actions, beside them (objectui#13022): the Undo capture
      // of an `operation: 'update'` reads the `patch` of the declaration the
      // action's `name` names, the one the platform action route writes.
      ...(objectName && Array.isArray(objectDef?.actions) ? { objectActions: objectDef.actions } : {}),
      user: currentUser,
      // Backend origin — lets `type: 'url'` actions issue full-page
      // navigations to API endpoints across origins in dev.
      apiBase: (import.meta as any).env?.VITE_SERVER_URL || '',
      // The spec-declared `${ctx.org.*}` scope (`ActionSchema.target` and
      // `onSuccess.navigate` in `@objectstack/spec` `ui/action.zod.ts`).
      // `ActionRunner.buildInterpolationContext` reads `org` from here, so
      // without this key `${ctx.org.id}` interpolated to an empty string
      // (objectui#10918).
      org: actionContextOrg(activeOrganization),
      activeOrganization: actionContextOrg(activeOrganization),
    },
    onConfirm: confirmHandler,
    onToast: toastHandler,
    onNavigate: navigateHandler,
    onParamCollection: paramCollectionHandler,
    onResultDialog: resultDialogHandler,
    onModal: modalHandler,
    handlers: { api: apiHandler, flow: flowHandler, script: serverActionHandler, modal: modalActionHandler },
  }), [
    objectName, objectDef, currentUser, activeOrganization, confirmHandler, toastHandler,
    navigateHandler, paramCollectionHandler, resultDialogHandler, apiHandler,
    flowHandler, serverActionHandler, modalHandler, modalActionHandler,
  ]);

  const dialogs = (
    <>
      {/*
        Close = flip `open` and KEEP every other field (objectui#6034). Radix
        holds `AlertDialogContent` mounted through its exit animation
        (`data-[state=closed]:animate-out … duration-200`), so
        `ActionConfirmDialog` goes on reading `state.message` into the
        description and `state.options` into the title and both button labels
        for the whole fade-out. The `{ open: false, message: '' }` this replaced
        blanked the description and reverted the labels to their i18n defaults
        mid-fade. The retained `resolve` is inert — the dialog settles the
        promise BEFORE it asks for the close, and the open path above replaces
        the whole state object, so nothing stale survives a reopen.

        `RecordDetailView` mounts a SECOND runtime into this same dialog and
        already closed this way; that both runtimes hand the dialog one field
        set on open AND reset it one way on close is pinned by
        `views/RecordDetailView.confirmRuntimeParity-5835.test.tsx`.
      */}
      <ActionConfirmDialog state={confirmState} onOpenChange={(open) => {
        if (!open) setConfirmState(s => ({ ...s, open: false }));
      }} />
      {/*
        Close = flip `open` and KEEP every other field (objectui#6431), the same
        shape the confirm pair converged on above — and for the same reason,
        re-measured on THIS dialog rather than inherited from #6034.

        `DialogContent` carries `duration-200 data-[state=closed]:animate-out`,
        so Radix holds the content mounted through its exit animation and
        `ActionParamDialog` goes on rendering off `state` for the whole
        fade-out. The `{ open: false, params: [] }` this replaced dropped
        `title`, `description` and `resolve` and emptied `params`, so the
        closing dialog re-titled itself to the generic `actionDialog.title`,
        swapped the action's description for the generic one, and dropped every
        param row — a form the user just filled in blanks out and re-labels
        itself while it fades.

        This is NOT the params form deliberately dropping stale values: the
        user's typed values never lived in `paramState`. They live in the
        dialog's own `values` state, which its `useEffect` reseeds from the
        param defaults on every `state.open` false→true edge — so a reopen
        starts blank under BOTH reset shapes, and nothing a user can observe
        beyond the fade-out frame differs between them.

        The retained `resolve` is inert, as on the confirm path: the dialog
        settles the promise before it asks for the close, and the open path
        above replaces the whole state object, so nothing stale survives a
        reopen.

        `RecordDetailView` mounts a SECOND runtime into this same dialog and
        already closed this way; that both runtimes now reset it identically is
        pinned by `views/RecordDetailView.paramRuntimeParity-6431.test.tsx`,
        which also renders the real dialog across the exit-animation frame.
      */}
      <ActionParamDialog state={paramState} onOpenChange={(open) => {
        if (!open) setParamState(s => ({ ...s, open: false }));
      }} />
      <ActionResultDialog
        state={resultDialogState}
        onAcknowledge={() => {
          resultDialogState.resolve?.();
          setResultDialogState({ open: false });
        }}
      />
      <FlowRunner
        state={screenFlow}
        authFetch={authFetch}
        baseUrl={import.meta.env.VITE_SERVER_URL || ''}
        dataSource={dataSource}
        objects={objects}
        onClose={() => setScreenFlow(null)}
        onComplete={() => { setScreenFlow(null); refresh(); }}
      />
      <FlowRefusalNotice
        state={flowRefusal}
        onClose={() => setFlowRefusal(s => ({ ...s, open: false }))}
      />
      <EnvironmentEntitlementDialog
        state={entitlementDialog}
        apiBase={import.meta.env.VITE_SERVER_URL || ''}
        onOpenChange={(open) => { if (!open) setEntitlementDialog({ open: false }); }}
      />
      {modalElement}
    </>
  );

  return {
    confirmHandler,
    toastHandler,
    navigateHandler,
    paramCollectionHandler,
    resultDialogHandler,
    apiHandler,
    flowHandler,
    serverActionHandler,
    modalActionHandler,
    authFetch,
    openEntitlementDialog,
    actionProviderProps,
    dialogs,
  };
}

/**
 * ConsoleActionRuntimeProvider — convenience wrapper for callers (e.g. PageView)
 * that only need to wrap a subtree in the console action runtime. ObjectView
 * uses {@link useConsoleActionRuntime} directly because it also feeds the
 * handlers into `useObjectActions`.
 */
export function ConsoleActionRuntimeProvider({
  children,
  ...opts
}: ConsoleActionRuntimeOptions & { children: React.ReactNode }) {
  const runtime = useConsoleActionRuntime(opts);
  return (
    <ActionProvider {...runtime.actionProviderProps}>
      {children}
      {runtime.dialogs}
    </ActionProvider>
  );
}

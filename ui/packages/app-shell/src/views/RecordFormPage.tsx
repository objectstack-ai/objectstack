/**
 * RecordFormPage Component
 *
 * Renders a full-screen create or edit page for a record. This is the
 * page-mode counterpart to the global `ModalForm` mounted by `AppContent`
 * for objects whose metadata declares `editMode: 'page'`.
 *
 * Routes (mounted by `AppContent`):
 *   - `/apps/:appName/:objectName/new`              — create mode
 *   - `/apps/:appName/:objectName/record/:recordId/edit` — edit mode
 *
 * Behavior:
 *   - Resolves the object definition via `useMetadata()`. While metadata is
 *     still loading the page renders a `SkeletonDetail` to avoid a flash of
 *     "Object Not Found".
 *   - Delegates form rendering and data fetching to `<ObjectForm>` from
 *     `@object-ui/plugin-form` with `formType: 'simple'`. ObjectForm itself
 *     fetches the existing record (in edit mode) via `dataSource.findOne`,
 *     so this page does not need to manage its own loading state for
 *     record data.
 *   - On success / cancel, navigates back when an earlier entry of THIS
 *     console session is behind the page, otherwise goes to the parent route
 *     (record detail in edit mode, object list in create mode). Cancel never
 *     toasts.
 *   - Wraps the form in a sticky page header (back button + title) for a
 *     consistent full-screen chrome.
 *
 * @module views/RecordFormPage
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ObjectForm } from '@object-ui/plugin-form';
import { Button, Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import { ArrowLeft, Building2, Database } from 'lucide-react';
import { toast } from 'sonner';
import { useObjectTranslation, useObjectLabel, recordSaveMessage } from '@object-ui/i18n';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useAdapter } from '../providers/AdapterProvider.js';
import { claimAnswerWarnings, toastRecordSave, type AnswerWarningClaim } from '../providers/writeWarningToast.js';
import {
  ExpressionProvider,
  createExpressionEvaluator,
  isObjectFieldVisible,
  useExpressionPermissions,
  useExpressionSystemPermissions,
} from '../providers/ExpressionProvider.js';
import { buildExpressionUser } from '../providers/expressionUser.js';
import { SkeletonDetail } from '../skeletons/index.js';
import { ManagedByBadge } from '../components/ManagedByBadge.js';
import { resolveFormViewChrome, selectRecordFormView } from '../utils/recordFormNavigation.js';
import { useAuth } from '@object-ui/auth';

export interface RecordFormPageProps {
  /** Form mode — `'create'` for the `/new` route, `'edit'` for the `/edit` route. */
  mode: 'create' | 'edit';
}

/**
 * Full-screen record create/edit page.
 *
 * Reads `:objectName` (and `:recordId` when editing) from the URL and
 * resolves the object definition. Renders an `<ObjectForm>` configured with
 * `formType: 'simple'` (i.e. a flat in-page form), wrapped in a page header
 * that mirrors the look of `RecordDetailView`.
 */
export function RecordFormPage({ mode }: RecordFormPageProps) {
  const { appName, objectName, recordId } = useParams<{
    appName: string;
    objectName: string;
    recordId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dataSource = useAdapter();
  const { objects, loading: metadataLoading } = useMetadata();
  const { t, language } = useObjectTranslation();
  const { objectLabel, objectPluralLabel } = useObjectLabel();
  const { user, getAuthConfig, activeOrganization } = useAuth();

  // Pull deployment-level feature flags so action visibility predicates
  // (e.g. `features.multiOrgEnabled != false` on sys_organization's create
  // action) can see them inside the nested ExpressionProvider below.
  const [features, setFeatures] = useState<Record<string, any>>({});
  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then(cfg => { if (!cancelled) setFeatures(cfg?.features ?? {}); })
      .catch(() => { /* leave empty — predicates default to visible */ });
    return () => { cancelled = true; };
  }, [getAuthConfig]);

  /**
   * Query-string prefills for create mode. Used by related-list "+ New"
   * buttons that pass the parent record id as a `<referenceField>=<id>`
   * pair so the new child record is auto-linked back to the parent.
   * Stable identity: only changes when the actual search string changes.
   */
  const prefillValues = useMemo<Record<string, string> | undefined>(() => {
    if (mode !== 'create') return undefined;
    const entries: Array<[string, string]> = [];
    for (const [k, v] of searchParams.entries()) {
      if (k && v) entries.push([k, v]);
    }
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, searchParams.toString()]);

  const objectDef = useMemo(
    () => objects.find((o: any) => o.name === objectName),
    [objects, objectName],
  );

  const baseUrl = `/apps/${appName}`;
  const objectListUrl = `${baseUrl}/${objectName}`;
  const recordDetailUrl =
    mode === 'edit' && recordId
      ? `${baseUrl}/${objectName}/record/${encodeURIComponent(recordId)}`
      : objectListUrl;

  /**
   * Navigate back to the most relevant location.
   * Back only when this console pushed an entry behind this one, so users
   * return to the exact list/view they came from. react-router numbers the
   * entries it writes in `history.state.idx`: 0 on the entry the document
   * loaded on, one more per push, unchanged by a replace. ⛔ Not
   * `location.key !== 'default'`: a replace on load (the app-name address
   * moved to the package-id one) mints a key with nothing behind it, so Save
   * went Back out of the app (objectstack-ai/objectstack#28036). ⛔ Nor
   * `window.history.length`: it counts the tab's entries from before the
   * console loaded (objectstack-ai/objectstack#27454). Otherwise the record
   * detail (edit) or list (create), inside the app.
   */
  const goBack = useCallback(() => {
    const entryIndex = (window.history.state as { idx?: unknown } | null)?.idx;
    if (typeof entryIndex === 'number' && entryIndex > 0) {
      navigate(-1);
    } else {
      navigate(recordDetailUrl, { replace: true });
    }
  }, [navigate, recordDetailUrl]);

  // Two names, not one (objectui#11733): the title and the toasts speak of ONE
  // record, so they keep the singular; the breadcrumb link opens the object's
  // list, so it reads the plural, as that list page's title and the header
  // crumb above this page do.
  const label = objectDef ? objectLabel(objectDef as any) : objectName ?? '';
  const listLabel = objectDef ? objectPluralLabel(objectDef) : objectName ?? '';
  // No inline `defaultValue` on these lookups: every key below is defined in
  // all ten locale packs and `all-locales-key-parity.test.ts` pins that
  // permanently, so i18next always resolves the pack value and a fallback
  // could never render. Worse, an inline default is a SECOND English spelling
  // that drifts unwatched — `form.createTitle`'s was `New {object}` while the
  // pack says `Create {{object}}`, so the day the key was renamed the title
  // would have silently changed verb with every test still green (#3469).
  // Declared = enforced: the packs are the single source of this copy, and a
  // missing key must surface (raw key + dev missing-key warning), not be
  // papered over at the call site. This now holds for EVERY `t()` in the file:
  // `form.createTargetOrg` was the last exception (#3469 kept its default
  // because the key existed in no pack, not even `en`) and #3517 backfilled it
  // into all ten, so the write-target badge is translated and passes bare too.
  const pageTitle =
    mode === 'create'
      ? t('form.createTitle', { object: label })
      : t('form.editTitle', { object: label });

  // objectstack-ai/objectstack#26461 — the save toast names the record it
  // wrote (`ux-conventions.write-feedback`): `Task "Quarterly review" created`.
  // The message is the ONE builder every record save surface shares
  // (`recordSaveMessage` in `@object-ui/i18n`), read through this page's
  // object; `ObjectForm` hands the write's result to `onSuccess`. Its keys are
  // in all ten packs, so they pass bare like every key above.
  //
  // objectstack-ai/objectstack#27999 — and it is the save's ONE toast: while
  // this page is open, the write-warning channel parks the answer warnings of
  // the write the page makes (this record's update, or a create of this
  // object) on the claim below instead of toasting them, and this toast
  // carries them.
  const answerWarningClaim = useRef<AnswerWarningClaim | null>(null);
  useEffect(() => {
    if (!dataSource || !objectName) return;
    if (mode === 'edit' && !recordId) return;
    const claim = claimAnswerWarnings(dataSource, mode === 'edit'
      ? { operation: 'update', resource: objectName, id: recordId }
      : { operation: 'create', resource: objectName });
    answerWarningClaim.current = claim;
    return () => {
      if (answerWarningClaim.current === claim) answerWarningClaim.current = null;
      claim.release();
    };
  }, [dataSource, mode, objectName, recordId]);

  const handleSuccess = useCallback((saved?: any) => {
    const warnings = answerWarningClaim.current?.take(saved) ?? [];
    toastRecordSave(toast, recordSaveMessage(t, {
      label,
      objectDef,
      saved,
      mode,
    }), warnings);
    goBack();
  }, [mode, t, label, objectDef, goBack]);

  const handleCancel = useCallback(() => {
    goBack();
  }, [goBack]);

  // Authenticated-user descriptor — shared by the ExpressionEvaluator (used
  // for field-visibility expression evaluation) and the ExpressionProvider
  // wrapping the form (which exposes the same descriptor to descendant
  // expression consumers). Memoised on the underlying user identity so a
  // re-render that doesn't change the user does not invalidate downstream
  // memoisations.
  //
  // objectui#6515 — THE normaliser, not a second derivation of it. This was
  // hand-rolled as `{ name, email, role, positions }`, which dropped `id` and
  // `isPlatformAdmin` from every predicate evaluated on this page. Those two
  // are named by real gates (`ctx.user.isPlatformAdmin == true` on
  // `sys_environment`'s "Change Plan (admin)"; `record.id == ctx.user.id`
  // throughout `sys_user`), and an ABSENT key is not `false` — it makes the
  // predicate FAULT, and `evaluateVisibility` fails OPEN on a fault, so an
  // admin-only field or action rendered for everyone with nothing on screen to
  // say so. The signed-out branch diverged too: it carried no `isPlatformAdmin`
  // at all, while `buildExpressionUser(null)` carries `false`.
  //
  // It is imported from `providers/`, NOT from `console/AppContent.js` where it
  // used to live: this view is `lazy()`-loaded BY `AppContent`, so that import
  // would be a static edge from the split chunk back into the module it was
  // split out of — what `check-eager-closure-budget` weighs. The leaf module
  // beside the provider is what makes the shared normaliser reachable here.
  const expressionUser = useMemo(() => buildExpressionUser(user), [user]);

  // Evaluator for the field-visibility expressions below, over the SAME bag
  // the `ExpressionProvider` at the bottom of this file publishes to the form's
  // descendants — one builder, called with the same four inputs (objectui#6493).
  //
  // It cannot simply READ that provider: the provider is mounted in this
  // component's own returned tree, so `useExpressionContext()` here would
  // resolve to whatever provider sits ABOVE this page (today `AppContent`'s,
  // with a different `app`; nothing at all if the page is ever mounted
  // elsewhere, which would silently unbind `user` too). Building the same scope
  // from the same inputs is the fix that needs no new wiring.
  //
  // The private bag this replaced bound `user` alone, so an authored
  // `current_user` / `ctx.user` / `os.user` / `features` gate on a field
  // faulted here and failed OPEN while resolving normally on a nav item.
  // objectui#4421 — the `permissions` input the `ExpressionProvider` below
  // reads for itself, so `current_user.can(...)` answers the same on both.
  // objectui#13083 — and its `systemPermissions` beside it, so
  // `current_user.hasCapability(name)` answers here too (objectui#13006).
  const expressionPermissions = useExpressionPermissions();
  const expressionSystemPermissions = useExpressionSystemPermissions();
  const expressionEvaluator = useMemo(
    () =>
      // ⛔ No `app`: objectui#8155 removed it from the predicate scope, because
      // neither ADR-0068 nor the engine's `SCOPE_ROOTS` declares such a root.
      // ⛔ No `data`: objectui#8166 removed that one too. It was `{}` here, so
      // a `data.*` field predicate faulted with `No such key` and fell back
      // fail-open; it now faults with the engine's own `Unknown variable: data`,
      // the verdict the server gives the same string.
      createExpressionEvaluator({
        // expressionUser already handles the anonymous fallback, so we can
        // pass it through unconditionally.
        user: expressionUser,
        features,
        permissions: expressionPermissions,
        systemPermissions: expressionSystemPermissions,
      }),
    [expressionUser, features, expressionPermissions, expressionSystemPermissions],
  );

  // Resolve the field list using the same visibility-aware logic as the
  // ModalForm in AppContent so page-mode and modal-mode show the same
  // fields for a given user — one helper, called from both, so the two
  // surfaces cannot drift on the polarity below.
  //
  // objectui#6514 — this gated on `f.visible`, a key `@objectstack/spec`'s
  // `FieldSchema` REFUSES (it is prose in `FIELD_KEY_GUIDANCE`, deliberately
  // not an alias). The gate was therefore unreachable through the authoring
  // surface: metadata carrying a field-level `visible` never validates, and a
  // census over the framework's 113 `*.object.*` files found zero of them.
  // `isObjectFieldVisible` reads the DECLARED keys instead — the static `hidden`
  // (INVERTED: `visible: false` is `hidden: true`) and the `visibleWhen`
  // predicate — and the dead read is gone rather than kept alongside.
  const fields = useMemo(() => {
    if (!objectDef?.fields) return [];
    if (Array.isArray(objectDef.fields)) {
      return (objectDef.fields as any[])
        .filter((f: any) => {
          if (typeof f === 'string') return true;
          return isObjectFieldVisible(f, expressionEvaluator);
        })
        .map((f: any) => (typeof f === 'string' ? f : f.name));
    }
    return Object.entries(objectDef.fields as Record<string, any>)
      .filter(([, f]) => isObjectFieldVisible(f, expressionEvaluator))
      .map(([key]) => key);
  }, [objectDef, expressionEvaluator]);

  // Show skeleton while metadata is still loading rather than the
  // "Object Not Found" empty state — otherwise direct/refreshed loads of
  // the URL flash an error before the metadata resolves.
  if (metadataLoading) {
    return <SkeletonDetail />;
  }

  if (!objectDef) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Empty>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Database className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('empty.objectNotFound')}</EmptyTitle>
          <EmptyDescription>
            {t('empty.objectNotFoundDescription', { name: objectName })}
          </EmptyDescription>
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate(baseUrl)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('empty.back')}
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  // Honour the object's form view layout (objectstack-ai/objectstack#1890): wire the declared `type`
  // (simple/tabbed/wizard) + `sections` through to ObjectForm, which renders
  // each layout. Those three are the form view `type`'s whole vocabulary
  // (ADR-0050); anything else — a stored row not yet converted — falls back
  // to `simple` here.
  // The form view is the one the record flow selects (objectui#13099): a
  // create uses the object's `create` form view when it declares one, an edit
  // the default form view — the same selection the New/Edit modal makes.
  const formDef: any = selectRecordFormView(objectDef as any, mode) ?? {};
  const pageFormType: 'simple' | 'tabbed' | 'wizard' =
    ['tabbed', 'wizard'].includes(formDef.type) ? formDef.type : 'simple';
  // Curated `sections` are wired through for EVERY layout family — a `simple`
  // form view's sections still carry the authored field selection, order,
  // grouping and per-field `visibleOn` predicates (#2212). Dropping them for
  // `simple` made the page-mode form fall back to the raw schema (every field,
  // no conditional visibility) while the New/Edit modal honored the same view
  // via resolveFormViewLayout.
  const formLayoutProps = Array.isArray(formDef.sections) && formDef.sections.length > 0
    ? {
        sections: formDef.sections,
        defaultTab: formDef.defaultTab,
        tabPosition: formDef.tabPosition,
        allowSkip: formDef.allowSkip,
        showStepIndicator: formDef.showStepIndicator,
      }
    : {};
  // objectstack-ai/objectstack#26843 — the form view's `buttons`, `layout`
  // and `defaults`, which this page used to hard-set over (`showSubmit: true`,
  // `layout: 'vertical'`, its own labels). `defaults` seed a create under the
  // URL prefill, which still wins per field.
  const formChrome = resolveFormViewChrome(formDef, {
    flow: mode,
    language,
    submitText: t('form.saveRecord'),
    cancelText: t('common.cancel'),
    createValues: prefillValues,
  });

  return (
    <ExpressionProvider user={expressionUser} app={{ name: appName }} data={{}} features={features}>
      <div
        className="flex flex-col h-full overflow-hidden bg-background"
        data-testid="record-form-page"
        data-mode={mode}
      >
        {/* Sticky header with back button + breadcrumb + title */}
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            data-testid="record-form-page-back"
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <nav aria-label={t('common.breadcrumb')} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              to={objectListUrl}
              className="hover:text-foreground transition-colors"
            >
              {listLabel}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-foreground font-medium" data-testid="record-form-page-title">
              {pageTitle}
            </span>
            {/* Lifecycle bucket badge — see ManagedByBadge. An authoring
                aid, drawn for an authoring caller only (objectui#12194).
                Why a locked form's fields are read-only is ObjectForm's own
                sentence (`ClosedAffordanceNotice`, objectui#11000), not
                this badge's. */}
            <ManagedByBadge
              managedBy={(objectDef as any)?.managedBy}
              className="ml-1"
            />
          </nav>
          {/* ADR-0105 group posture: reads span all the user's organizations
              but a new record lands in the ACTIVE one (engine-stamped), so
              create mode names the write target where the user commits. Only
              rendered for org-walled objects (they carry organization_id). */}
          {mode === 'create' &&
            features?.tenancyPosture === 'group' &&
            activeOrganization &&
            (objectDef as any)?.fields?.organization_id && (
              <span
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
                data-testid="record-form-write-target-org"
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                {t('form.createTargetOrg', { org: activeOrganization.name })}
              </span>
            )}
        </header>

        <div className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto max-w-4xl">
            <ObjectForm
              key={`${mode}:${objectName}:${recordId ?? 'new'}`}
              schema={{
                type: 'object-form',
                formType: pageFormType,
                ...formLayoutProps,
                objectName: objectDef.name,
                mode,
                recordId: mode === 'edit' ? recordId : undefined,
                title: pageTitle,
                fields,
                // Master-detail by config: if the object's form view declares
                // inline child collections, ObjectForm renders them as an atomic
                // master-detail form on this page — no bespoke page needed.
                subforms: (objectDef as any).form?.subforms
                  ?? (objectDef as any).formViews?.default?.subforms,
                onSuccess: handleSuccess,
                onCancel: handleCancel,
                ...formChrome,
              }}
              dataSource={dataSource ?? undefined}
            />
          </div>
        </div>
      </div>
    </ExpressionProvider>
  );
}

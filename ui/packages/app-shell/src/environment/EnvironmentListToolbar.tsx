/**
 * EnvironmentListToolbar — the state-aware replacement for the generic
 * `list_toolbar` action bar on the `sys_environment` list.
 *
 * The cloud serves ONE `create_environment` action; born-with-env makes its
 * meaning depend on org state (which the action metadata can't express). This
 * component reads the resolved entitlement state and renders the right
 * affordance:
 *   • no production env          → "Set up your production environment" (primary);
 *                                  the create POST provisions the org's one
 *                                  production env — the historical-data path that
 *                                  must never error.
 *   • has prod + dev allowed     → "Add development environment" (the create POST
 *                                  makes a dev env).
 *   • has prod + dev NOT allowed → for a viewer the summary sends an `upgradeUrl`
 *                                  to, an outline, LOCKED mark naming the tier
 *                                  development environments start at, linking
 *                                  to that URL; for a viewer it sends none, no
 *                                  mark (objectui#12983). Either way no button,
 *                                  no dialog, no POST (objectui#12190).
 *   • still resolving            → a SKELETON where the create button will land —
 *                                  no label at all (see below).
 *   • settled with no signal     → the action's metadata label (neutral), with the
 *                                  apiHandler entitlement dialog as the safety net.
 *
 * Create flows reuse the standard `action:bar` runner (name modal → apiHandler),
 * so only the label/variant changes — no duplicate POST logic here.
 *
 * ## Why a skeleton while resolving (cloud#1049 → objectui#3482)
 *
 * Rendering the metadata label while entitlements were in flight made the button
 * visibly change its wording mid-load: the cloud action metadata's "create
 * environment" label, replaced by `environment.setUpProduction` the moment
 * `/cloud/environment-entitlements` answered. Locale-independent by mechanism,
 * though it was reported against the Chinese console, where the two texts are
 * owned by different packages and the swap read as an inconsistency rather than
 * a load. The maintainer's ruling on cloud#1049 was option A — present nothing
 * rather than a label we are about to overwrite: loading → neutral skeleton
 * sized like the button, unknown/error → degrade to a working button. Option B (a neutral label for every state) was rejected: it is
 * semantically wrong for an org that already owns its production environment.
 *
 * ## Who owns this button's text (the "two sources" question)
 *
 * There is no longer one string with two owners — there are two DIFFERENT strings
 * for two different states, and each has exactly one owner:
 *
 *   • Every RESOLVED state → THIS package. `environment.setUpProduction` /
 *     `environment.addDevelopment` / `environment.developmentLocked` (with
 *     `planTier.teamAndUp`) in `packages/i18n/src/locales/*.ts` are the sole
 *     source of truth. The cloud
 *     action metadata's `_actions.create_environment.label` translation CANNOT
 *     reach the button here — `decideEnvironmentCta()` is total over `ready`
 *     state, so a resolved state always overrides the label.
 *   • Still resolving → nothing (skeleton).
 *   • Settled with NO usable signal (`ready: false`, `source: 'unknown'` — the
 *     summary endpoint was unusable AND the row-derivation threw) → the metadata
 *     label, deliberately. It is the one state where "which create is this?" is
 *     genuinely unknown, so the producer's neutral wording is the only honest
 *     text. This is the metadata label's ONLY surviving path on this button; the
 *     cloud-side bundle entry therefore still has a job and must not be deleted
 *     (reported back on cloud#1049 for the cloud seat).
 */

import { SchemaRenderer, useCapabilityGate } from '@object-ui/react';
import { actionRendersAt } from '@object-ui/types';
import type { ActionBarSchema } from '@object-ui/types';
import { Button, Skeleton } from '@object-ui/components';
import { Lock } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useNavRunAction } from '../hooks/useNavRunAction.js';
import { resolveCtaHref } from './EnvironmentEntitlementDialog.js';
import { decideEnvironmentCta, type EnvironmentEntitlementsState } from './entitlements.js';

const CREATE_ACTION = 'create_environment';

/**
 * Deep-link support (#844, re-based onto the DECLARED slot by objectui#5216):
 * an object nav entry declaring `runAction: 'create_environment'` resolves to
 * an environments href carrying `?runAction=`, and landing on it auto-opens the
 * create dialog once entitlements have resolved — so the welcome page's "Create
 * your environment" CTA lands the user IN the dialog instead of on the list,
 * hunting for a second create button.
 *
 * Read-once / consume-once now lives in {@link useNavRunAction}, shared with the
 * generic object list; this wrapper contributes only the environment-specific
 * arming condition. What it retires: the bare `'runAction'` literal read off
 * `window.location.search` and compared to a hard-coded action name — a private
 * convention with a second copy at the producing end and no schema behind
 * either.
 *
 * ## Arming is destructive — only arm when there is something to trigger (#4123)
 *
 * Consumption is modelled as "strip the param", so arming SPENDS a one-shot
 * user intent. Arm it when nothing can act on it and the intent is not merely
 * lost, it is unrecoverable: the URL no longer carries it, so a reload cannot
 * retry. Hence both conjuncts below: the create action must actually be on the
 * bar (`hasCreateAction`), AND entitlements must have resolved — while loading
 * we must not trigger an action whose meaning (prod vs dev create) isn't known
 * yet. In the `upgrade_for_development` state arming consumes the param and
 * runs NOTHING (objectui#12190: no dialog): the server has already answered
 * "create" there (no development environment on this plan), so the intent is
 * spent on that answer rather than lost. The answer is drawn as the locked
 * mark for a viewer who can upgrade, and as no create affordance at all for
 * one who cannot (objectui#12983). When either conjunct
 * fails, the honest degradation is to leave the URL alone: the next mount that
 * CAN act on the deep link still does.
 *
 * A requested name this toolbar does not answer to is the same "leave it alone"
 * case — see `useNavRunAction` on why the client degrades quietly while the
 * AUTHORING tier rejects the undefined reference loudly.
 */
function useAutoRunCreate(hasCreateAction: boolean, ctaKind: string | null): boolean {
  return (
    useNavRunAction(
      (requested) => requested === CREATE_ACTION && hasCreateAction && ctaKind != null,
    ) !== null
  );
}

/** Non-create toolbar actions, rendered through the normal bar in every state. */
function otherActions(toolbarActions: any[]): any[] {
  return toolbarActions.filter((a: any) => a?.name !== CREATE_ACTION);
}

function OtherActionsBar({ actions }: { actions: any[] }) {
  if (actions.length === 0) return null;
  // Typed as the `action:bar` node it is (objectui#11355), not as the
  // `BaseSchema` the `schema` prop accepts: a key `ActionBarSchema` does not
  // declare is refused here.
  const bar: ActionBarSchema = { type: 'action:bar', location: 'list_toolbar', actions, size: 'sm', variant: 'outline' };
  return <SchemaRenderer schema={bar} />;
}

const DEVELOPMENT_LOCKED_MARK = 'environment-development-locked';

/**
 * The plan-locked stand-in for the create action (objectui#12190): an outline
 * mark with a lock icon that names the tier development environments start at
 * ("Development environments · Team plan and up"; the zh value of the tier
 * label follows cloud's own zh bundle). The maintainer's rule is that no primary
 * button opens a paywall dialog (objectstack-ai/cloud#2775), so this is never a
 * primary button and opens nothing: it is a plain link to the upgrade page.
 *
 * The destination is the entitlement summary's `upgradeUrl`, verbatim, resolved
 * the way the entitlement dialog resolves its CTA (`resolveCtaHref`: a
 * control-plane-relative path is prefixed with the control-plane origin). The
 * URL is the control plane's to name and none is composed here (objectui#10437).
 *
 * The mark exists only as that link, so it is drawn only for a viewer the
 * summary sends an `upgradeUrl` to (objectui#12983, ruling B on
 * objectstack-ai/cloud#2917: the upsell reaches only whoever can upgrade). The
 * control plane trims `upgradeUrl` by role (cloud's `resolveSummaryCanManage`:
 * it is sent only to a viewer who manages the organization, such as its owner
 * or an admin), so its presence is the server's own answer to "can this viewer
 * upgrade?", and no viewer flag is read or added for it. A viewer it sends none
 * (a plain member) cannot upgrade, so no mark is drawn for them.
 */
function DevelopmentLockedMark({ upgradeUrl }: { upgradeUrl: string }) {
  const { t } = useObjectTranslation();
  const { href, external } = resolveCtaHref(
    upgradeUrl,
    (import.meta.env.VITE_SERVER_URL as string | undefined) || '',
  );
  return (
    <Button asChild size="sm" variant="outline" className="shadow-none gap-1.5 sm:gap-2 h-8 sm:h-9 text-muted-foreground">
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        data-testid={DEVELOPMENT_LOCKED_MARK}
      >
        <Lock className="h-4 w-4" aria-hidden="true" />
        <span>{t('environment.developmentLocked', { tier: t('planTier.teamAndUp') })}</span>
      </a>
    </Button>
  );
}

interface Props {
  /** Toolbar actions already localized by the caller (ObjectView). */
  actions: any[];
  /**
   * Resolved entitlement state, or `null` while the resolution is still in
   * flight. The distinction matters: `useEnvironmentEntitlements` holds `null`
   * only until its async resolution settles, and reports a settled-but-useless
   * result as `{ ready: false, source: 'unknown' }` — so `null` here means
   * "wait" (skeleton) and never "we gave up" (which must keep a usable button).
   */
  entitlements: EnvironmentEntitlementsState | null;
}

export function EnvironmentListToolbar({ actions, entitlements }: Props) {
  const { t } = useObjectTranslation();
  // [ADR-0066 D4] The same capability gate `action:bar` applies to the actions
  // it RENDERS. This toolbar is one more surface that filters its own action
  // list instead of routing through `ActionEngine.getActionsForLocation`, which
  // is precisely the case `useCapabilityGate` exists to keep from drifting.
  const mayInvoke = useCapabilityGate();
  // ONE list, built from both predicates the bar applies downstream
  // (`actionRendersAt` + the capability gate), so what this component decides
  // and what the bar renders cannot disagree by construction (#4123). The bar
  // re-applies both to the list it receives — idempotent on an already-filtered
  // list. Before this, placement was filtered here and capability only there,
  // so a create action the caller may not invoke was counted here and dropped
  // there.
  const toolbarActions = (actions || []).filter(
    (a: any) => actionRendersAt(a, 'list_toolbar') && mayInvoke(a?.requiredPermissions),
  );
  const hasCreateAction = toolbarActions.some((a: any) => a?.name === CREATE_ACTION);
  const ctaKind = entitlements?.ready ? decideEnvironmentCta(entitlements) : null;
  // Arm the deep link on the CREATE ACTION's presence — never on "the toolbar
  // has actions" (#4123). The old predicate armed on `toolbarActions.length > 0`,
  // so a toolbar carrying any other action consumed `?runAction=create_environment`
  // and triggered nothing (measured: `urlParam=null execute=0`), unrecoverably.
  const autoRunCreate = useAutoRunCreate(hasCreateAction, ctaKind);

  if (toolbarActions.length === 0) return null;

  // Still resolving: hold the create button's slot with a skeleton instead of a
  // label we are about to overwrite (objectui#3482). Only the create action is
  // withheld — the other toolbar actions are pure metadata and never re-label,
  // so blanking them would be a gratuitous loading flash. When the toolbar has
  // no create action at all, nothing can jump and no skeleton is rendered.
  if (entitlements === null) {
    const others = otherActions(toolbarActions);
    return (
      <>
        <OtherActionsBar actions={others} />
        {hasCreateAction && (
          // Sized like the `size="sm"` bar button it stands in for (h-9,
          // rounded-md). The width is an approximation of the resolved labels — the point is
          // that the header keeps its shape, not a pixel-exact match.
          <Skeleton className="h-9 w-44 rounded-md" data-testid="environment-create-cta-loading" />
        )}
      </>
    );
  }

  // Plan-locked state: a free-plan org must NOT POST-then-403, and no primary
  // button may open a paywall dialog (objectui#12190). The create action gives
  // way to the locked mark, drawn only for a viewer who can upgrade
  // (objectui#12983); any other (non-create) toolbar actions still render
  // through the normal bar, for every viewer.
  if (ctaKind === 'upgrade_for_development') {
    const upgradeUrl = entitlements.upgradeUrl;
    return (
      <>
        <OtherActionsBar actions={otherActions(toolbarActions)} />
        {/*
          The mark stands in for the create action. With no create action on
          the bar there is nothing to stand in for, so it must not appear either
          (#4123): same one-list rule as the arming predicate above. With no
          `upgradeUrl` the server has said this viewer cannot upgrade, and the
          upsell is not drawn (objectui#12983; see `DevelopmentLockedMark`).
        */}
        {hasCreateAction && upgradeUrl ? <DevelopmentLockedMark upgradeUrl={upgradeUrl} /> : null}
      </>
    );
  }

  // setup_production / add_development: render the bar, overriding only the
  // create action's label (and promoting production setup to a primary CTA).
  // Labels are locale-aware — the metadata label is already localized by the
  // caller, but these state-aware overrides used to be hard-coded English,
  // which flashed an English button in a zh console (#844). They now resolve
  // from the locale packs, so all ten languages work rather than just zh
  // (objectui#2871).
  //
  // `ctaKind == null` can only be the settled-with-no-signal state here (the
  // in-flight one returned above), so the metadata label passes through — see
  // the "who owns this button's text" note at the top of the file.
  const renderedActions = toolbarActions.map((a: any) => {
    if (a?.name !== CREATE_ACTION || ctaKind == null) return a;
    if (ctaKind === 'setup_production') {
      return {
        ...a,
        label: t('environment.setUpProduction'),
        variant: 'primary',
        ...(autoRunCreate ? { autoTrigger: true } : {}),
      };
    }
    // add_development
    return {
      ...a,
      label: t('environment.addDevelopment'),
      ...(autoRunCreate ? { autoTrigger: true } : {}),
    };
  });

  // Typed as the `action:bar` node it is (objectui#11355); see `OtherActionsBar`.
  const bar: ActionBarSchema = {
    type: 'action:bar',
    location: 'list_toolbar',
    actions: renderedActions,
    size: 'sm',
    variant: 'outline',
  };
  return <SchemaRenderer schema={bar} />;
}

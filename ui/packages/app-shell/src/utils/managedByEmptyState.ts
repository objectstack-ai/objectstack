/**
 * Derive a context-aware empty-state config for object lists whose
 * `managedBy` bucket means the user can't create rows directly from
 * this list view.
 *
 * Background: previously the entire affordance story was carried by a
 * full-width banner pinned to the top of every list/detail/form page.
 * That violated the principle most enterprise platforms (Salesforce,
 * ServiceNow, SAP Fiori, Notion, Linear) settled on long ago: hide the
 * affordance you don't want users to take, and use the *empty state* as
 * the only place to explain why the list is empty and where new entries
 * come from.
 *
 * This helper returns an `emptyState` payload compatible with the
 * `ListView` schema (`{ title, message, icon }`). It only fires for the
 * buckets where the default empty state ("No records yet") would be
 * misleading; for `platform`/`config` it returns `undefined` so the
 * caller falls back to the user-defined view-level empty state.
 *
 * The bucket → message mapping mirrors `ManagedByBadge` so that the badge
 * (in the header) and the empty state (in the body) tell a consistent
 * story without repeating themselves verbatim.
 */
import {
  ExpressionEvaluator,
  hasDeclaredPredicate,
  resolveEffectiveCrudAffordances,
  toPredicateInput,
  type UserActionsOverride,
} from '@object-ui/core';
// The one authority for the narrowed `t` (objectui#8261): a key and optional
// options (including a `defaultValue` used as the English fallback when a
// locale lacks the key) — imported, not re-declared.
import type { TranslateFn } from '@object-ui/i18n';
import { actionRendersAt } from '@object-ui/types';

export interface ManagedByEmptyState {
  title: string;
  message: string;
  icon: string;
}

/**
 * Does the list page's toolbar draw at least one of the object's declared
 * actions? (objectui#11687)
 *
 * The answer is the toolbar's own verdict, asked with the same predicates the
 * `action:bar` → `action:button` pair applies to `list_toolbar`: placement
 * through `actionRendersAt`, the capability gate the caller passes in (the
 * `useCapabilityGate` closure), and the action's `visible` gate, asked through
 * `hasDeclaredPredicate` and evaluated fail-closed with no row bound — a list
 * toolbar has no record. `requiresFeature` / `requiresMembershipReach` arrive
 * already lowered into that `visible` (spec `lowerRequiresFeature`), so a
 * multi-org-only "Invite User" counts in a multi-org deployment and not in a
 * single-org one, exactly as the button does.
 *
 * Why "the toolbar draws an action" may stand for "the page offers a way to
 * add a row" in the `better-auth` arm, without asking an action what it does:
 * read off objectstack's platform objects when objectui#11687 landed, every
 * `list_toolbar` action on a `better-auth` object either adds a row (Invite
 * User, Register OAuth Application, Create Team, Enable 2FA, …) or sits on a
 * list whose every view is filtered ("Sign out other devices" on sessions), so
 * an empty one gets the list's view-filter copy rather than first-run copy.
 * ⚠️ Nothing re-derives that reading (AGENTS.md #9); a `better-auth` object
 * that gains a toolbar action which adds nothing should revisit it.
 */
export function listToolbarDrawsAction(
  actions: readonly unknown[] | null | undefined,
  mayInvoke: (requiredPermissions: unknown) => boolean,
  predicateScope: Record<string, unknown>,
): boolean {
  if (!Array.isArray(actions)) return false;
  return actions.some((candidate) => {
    if (candidate == null || typeof candidate !== 'object') return false;
    const action = candidate as {
      locations?: readonly string[];
      requiredPermissions?: unknown;
      visible?: unknown;
    };
    if (!actionRendersAt(action, 'list_toolbar')) return false;
    if (!mayInvoke(action.requiredPermissions)) return false;
    if (!hasDeclaredPredicate(action.visible)) return true;
    try {
      return new ExpressionEvaluator({ ...predicateScope }).evaluateCondition(
        toPredicateInput(action.visible),
        { throwOnError: true },
      );
    } catch {
      // Fail-closed, as `action:button` hides a button whose `visible` throws.
      return false;
    }
  });
}

/**
 * @param pageOffersCreate The list page offers a way to add a row: its generic
 *   New button, or a `list_toolbar` action it draws
 *   ({@link listToolbarDrawsAction}). The `better-auth` arm's copy says rows
 *   are "not added by hand here", which that page contradicts (objectui#11687).
 */
export function resolveManagedByEmptyState(
  managedBy: string | undefined | null,
  t: TranslateFn,
  objectName?: string | null,
  userActions?: UserActionsOverride | null,
  pageOffersCreate = false,
): ManagedByEmptyState | undefined {
  switch (managedBy) {
    // ADR-0103 — rows a platform service owns end to end: "entries appear
    // automatically" is the whole story. It keeps the `system` i18n KEY (the copy
    // is unchanged and every locale bundle carries it), not the retired bucket
    // VALUE — objectstack#3355 renamed the writable half to `system-data`, which
    // now falls through to `default` and gets the generic empty state with its
    // New button, exactly as its full-CRUD bucket default implies.
    case 'engine-owned':
      // An `engine-owned` object that nonetheless opens creation via `userActions`
      // would make the "appear automatically" copy wrong; fall back to the generic
      // empty state. The resolved `create` affordance (shared @object-ui/core
      // policy) is the one place that reads the override.
      if (resolveEffectiveCrudAffordances({ managedBy, userActions }).create) return undefined;
      return {
        icon: 'Lock',
        title: t('list.managedBy.system.title', { defaultValue: 'Nothing here yet' }),
        message: t('list.managedBy.system.message', {
          defaultValue:
            'Entries appear automatically when their source action runs (e.g. Submit for Approval, Share, Invite). Trigger one of those on a source record to create a row.',
        }),
      };
    case 'append-only':
      return {
        icon: 'Archive',
        title: t('list.managedBy.appendOnly.title', { defaultValue: 'No events recorded' }),
        message: t('list.managedBy.appendOnly.message', {
          defaultValue:
            'This is an immutable audit log. Rows are written by the platform when events occur — you can export the history but cannot create entries from here.',
        }),
      };
    case 'better-auth':
      // `sys_team` is an identity table that CAN be created by hand —
      // the `create_team` toolbar action (multi-org gated) hits better-auth's
      // `organization/create-team`. The generic "not added by hand here" copy
      // below would flatly contradict that visible Create Team button
      // (objectui review — the reported empty-state/CTA mismatch). Give teams
      // their own accurate copy instead of the identity-record disclaimer.
      if (objectName === 'sys_team') {
        return {
          icon: 'Users',
          title: t('list.managedBy.betterAuthTeam.title', { defaultValue: 'No teams yet' }),
          message: t('list.managedBy.betterAuthTeam.message', {
            defaultValue:
              'Teams group members within an organization. Create one with “Create Team”, or they arrive through your auth provider’s organization and SSO provisioning flows.',
          }),
        };
      }
      // objectui#11687 — a page that offers a way to add a row (its New
      // button, or a toolbar action such as Invite User or Register OAuth
      // Application) is contradicted by every arm below except `sys_team`'s,
      // which names its own Create Team button. Yield to the list's own copy:
      // first-run, or the view-filter / user-filter wording, which the list
      // chooses from its query. The `engine-owned` arm above does the same for
      // an opened `create` affordance.
      if (pageOffersCreate) return undefined;
      // `sys_user` is the one identity table with a concrete onboarding
      // answer, so give it actionable guidance: teammates arrive via an
      // org-level invite + SSO just-in-time provisioning (ADR-0024 D9), and
      // app end-users self-register. We deliberately do NOT name the env-level
      // "Invite User" action — it is multi-org-gated and hidden in single-org —
      // nor a "Reset Password" toolbar action, which does not exist (cloud#580).
      // Every other identity table (sessions, accounts, tokens, jwks,
      // verifications, …) is written purely by auth flows, so keep the generic
      // copy — naming an invite/signup CTA on a token list would be wrong.
      if (objectName === 'sys_user') {
        return {
          icon: 'ShieldAlert',
          title: t('list.managedBy.betterAuthUser.title', { defaultValue: 'No users yet' }),
          message: t('list.managedBy.betterAuthUser.message', {
            defaultValue:
              'User accounts are provisioned by the authentication provider, not created here. Invite teammates to your organization and they appear automatically on first sign-in (SSO just-in-time provisioning). App end-users arrive when they sign up through your app.',
          }),
        };
      }
      return {
        icon: 'ShieldAlert',
        title: t('list.managedBy.betterAuth.title', { defaultValue: 'No identity records' }),
        message: t('list.managedBy.betterAuth.message', {
          defaultValue:
            'These records are created by the authentication provider — through sign-in, provisioning, and security flows — not added by hand here.',
        }),
      };
    default:
      return undefined;
  }
}

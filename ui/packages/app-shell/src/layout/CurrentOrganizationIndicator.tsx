/**
 * CurrentOrganizationIndicator — read-only "which organization am I in" for
 * users who have exactly ONE membership (objectui#5287).
 *
 * `WorkspaceSwitcher` is a multi-membership affordance: with one organization
 * there is nothing to switch to, so it renders nothing — and it is also the
 * only place the console ever showed the organization name. On a walled
 * deployment that left a single-membership business user with no indication
 * anywhere of which organization they were looking at, while every list on the
 * page was silently scoped to it. Found in a downstream multi-tenant
 * acceptance run (case S20-001).
 *
 * This is the other half of that surface, deliberately a SEPARATE component:
 *
 *   - the switcher's visibility rule is unchanged (`orgList.length <= 1` still
 *     renders nothing — a one-entry dropdown was the rejected option);
 *   - this renders in exactly the case the switcher declines, and renders no
 *     control at all: no trigger, no menu, no click target. The name is
 *     context, not navigation. Members / workspace management stay reachable
 *     from the avatar menu's "My Workspaces" entry (objectstack#8096), which
 *     is what covers this configuration.
 *
 * ## Why it is gated on the tenancy posture, not on "an org exists"
 *
 * Under `single` posture (ADR-0105) organizations may still exist as rows —
 * the Layer 0 wall is simply inert, one logical tenant, nothing scoped by
 * organization. Rendering an organization name there would grow new top-bar
 * chrome for every existing single-tenant deployment: a visible regression, and
 * a claim about scoping that the deployment does not make. So the predicate is
 * ADR-0105's own `postureEnforcesWall` rule — true for `group` and `isolated`,
 * false for `single` — spelled in `useTenancyPosture.ts` as `postureHasOrgWall`
 * and held to the protocol by a parity test instead of a runtime import of
 * `@objectstack/spec/security`, which measured +237 KB on the eager chunk. That
 * file's docblock carries the measurement and the reasoning.
 *
 * An absent or unrecognized posture (older server, config fetch still in
 * flight or failed) renders nothing, matching how every other posture-keyed
 * affordance in this repo fails toward today's rendering.
 */

import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { OrgBadge } from './OrgBadge.js';
import { postureHasOrgWall, useTenancyPosture } from '../hooks/useTenancyPosture.js';

export function CurrentOrganizationIndicator() {
  const { t } = useObjectTranslation();
  const { organizations, activeOrganization } = useAuth();
  const posture = useTenancyPosture();

  // No organization wall in force ⇒ the top bar stays organization-silent,
  // exactly as it is today. Also covers the not-yet-resolved config.
  if (!postureHasOrgWall(posture)) return null;

  const orgList = organizations ?? [];

  // Exactly one membership. Two or more is the switcher's case and it must
  // stay the only affordance there; zero means no organization context at all.
  if (orgList.length !== 1) return null;

  // The organization the SERVER reports as active, never a guess from the
  // membership list (objectui#12698): a session with no active organization —
  // e.g. after a refused `set-active`, or a refused ADR-0081 repair — names none.
  const current = activeOrganization;
  if (!current) return null;

  const label = t('organization.current.label', { defaultValue: 'Current organization' });

  return (
    <span
      data-testid="current-organization-indicator"
      className="ml-2 inline-flex max-w-[14rem] items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-foreground/80"
      title={`${label}: ${current.name}`}
    >
      <OrgBadge name={current.name} />
      <span className="sr-only">{label}</span>
      <span className="hidden truncate sm:inline">{current.name}</span>
    </span>
  );
}

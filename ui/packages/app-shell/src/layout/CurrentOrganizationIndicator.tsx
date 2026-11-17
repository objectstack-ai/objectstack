/**
 * CurrentOrganizationIndicator — read-only "which organization am I in" on a
 * walled deployment, at any membership count (objectui#5287).
 *
 * On a walled posture every list on the page is silently scoped to the active
 * organization, so the top bar must say which one without the user opening
 * anything. Found in a downstream multi-tenant acceptance run (case S20-001)
 * for a single-membership user, who had no organization name anywhere.
 *
 * The organization switcher is not in the top bar: the left of the bar is the
 * product mark and the app switcher, and switching lives in the avatar menu
 * (`WorkspaceSwitcherMenu`, objectstack-ai/objectstack#34591). So this
 * indicator is the bar's only organization name, at one membership and at two
 * or more alike (seat ruling repo:objectstack#3 on that card).
 *
 * It renders no control at all: no trigger, no menu, no click target. The name
 * is context, not navigation; a read-only name is not a switcher. Switching and
 * members / workspace management stay in the avatar menu ("Switch
 * organization", "My Organizations").
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
 * Inside the mobile shell, when it announces `showConnectionSwitcher`, this
 * renders nothing: `WorkspaceSwitcher` then draws the same badge and name, at
 * the same widths, as the top-bar button that opens the shell's native
 * switcher.
 *
 * An absent or unrecognized posture (older server, config fetch still in
 * flight or failed) renders nothing, matching how every other posture-keyed
 * affordance in this repo fails toward today's rendering.
 */

import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { nativeHostCan, useNativeHost } from '@object-ui/mobile';
import { OrgBadge } from './OrgBadge.js';
import { postureHasOrgWall, useTenancyPosture } from '../hooks/useTenancyPosture.js';

export function CurrentOrganizationIndicator() {
  const { t } = useObjectTranslation();
  const { organizations, activeOrganization } = useAuth();
  const posture = useTenancyPosture();
  const nativeSwitcher = nativeHostCan(useNativeHost(), 'showConnectionSwitcher');

  // The shell's switcher button carries the organization instead.
  if (nativeSwitcher) return null;

  // No organization wall in force ⇒ the top bar stays organization-silent,
  // exactly as it is today. Also covers the not-yet-resolved config.
  if (!postureHasOrgWall(posture)) return null;

  // Any membership count names the organization: the switcher is in the
  // avatar menu, so this is the bar's only organization name. Zero memberships
  // means no organization context at all.
  if ((organizations ?? []).length === 0) return null;

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

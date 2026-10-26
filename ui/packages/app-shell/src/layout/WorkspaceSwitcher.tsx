/**
 * WorkspaceSwitcher
 *
 * Header-left organization (workspace) switcher — the standard place users
 * expect "which org am I in / switch org" to live (Linear/Vercel/GitHub style).
 *
 * - Single-org users (the vast majority): render NOTHING. With one org there is
 *   nothing to switch to, so a dropdown here would control nothing. The
 *   switcher is a multi-org affordance. Where a tenancy wall IS in force the
 *   org name still matters at one membership — `CurrentOrganizationIndicator`
 *   renders it read-only there (objectui#5287), without a control.
 * - Multi-org users: the active org name + a dropdown to switch orgs inline
 *   (full-page reload so the active-org context refreshes app-wide, mirroring
 *   OrganizationsPage), plus shortcuts to manage members / create a workspace.
 * - No org context at all: renders nothing.
 *
 * Under `group` tenancy posture (ADR-0105) the switcher's meaning changes:
 * the active organization is only the WRITE target — reads span every
 * organization the member belongs to — so the dropdown labels it as the
 * working organization instead of implying it bounds what the user sees.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import type { AuthOrganization } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@object-ui/components';
import { ChevronsUpDown, Check, Plus, Users } from 'lucide-react';
import { resolveRootUrl } from '../console/organizations/resolveHomeUrl.js';
import { useTenancyPosture } from '../hooks/useTenancyPosture.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import { OrgBadge } from './OrgBadge.js';

export function WorkspaceSwitcher() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const { organizations, activeOrganization, switchOrganization, getAuthConfig } = useAuth();
  const [multiOrgDisabled, setMultiOrgDisabled] = useState(false);
  const isGroupPosture = useTenancyPosture() === 'group';

  useEffect(() => {
    let cancelled = false;
    getAuthConfig?.()
      .then((cfg) => {
        if (!cancelled) setMultiOrgDisabled(cfg?.features?.multiOrgEnabled === false);
      })
      .catch(() => {
        /* leave default — create entry stays available */
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig]);

  const orgList = organizations ?? [];
  // The organization the SERVER reports as active, never `orgList[0]`
  // (objectui#12698): that guess named an organization the session did not
  // hold — e.g. after a refused `set-active`.
  const current = activeOrganization;

  // No organization context (e.g. a brand-new user before provisioning, or a
  // session the server reports no active organization for) — show nothing
  // rather than an empty switcher or a guessed name.
  if (!current) return null;

  // Single-org: render nothing. With only one org there's nothing to switch to,
  // so a dropdown here would be a control that controls nothing. The switcher
  // appears only once a second org exists. On a walled deployment the org NAME
  // is still load-bearing context at one membership — `CurrentOrganizationIndicator`
  // renders it read-only for exactly this case (objectui#5287); this rule is
  // unchanged.
  if (orgList.length <= 1) return null;

  const handleSwitch = (org: AuthOrganization) => {
    if (org.id === current.id) return;
    // objectui#13231 — ask BEFORE `set-active` is sent. Asking at the reload
    // would be too late: the server has already switched, and the page holding
    // the edits reloads itself for the new organization (dropping them, and its
    // leave prompt with them) before the document load starts. On Cancel
    // nothing is sent: the organization, the URL and the edits stay.
    confirmUnsavedLeave(async () => {
      try {
        await switchOrganization(org.id);
        // switchOrganization only updates state; reload to the console root so the
        // new active org propagates to every data scope app-wide AND
        // RootLandingRedirect resolves the right landing (single-app workspace →
        // that app, not the redundant launcher). Same as OrganizationsPage.
        window.location.href = resolveRootUrl();
      } catch (err) {
        console.error('[WorkspaceSwitcher] switch failed', err);
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ml-2 inline-flex max-w-[14rem] items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
        data-testid="workspace-switcher"
      >
        <OrgBadge name={current.name} />
        <span className="hidden truncate sm:inline">{current.name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {isGroupPosture
            ? t('organization.switcher.groupLabel', { defaultValue: 'Working organization' })
            : t('organization.switcher.label', { defaultValue: 'Switch organization' })}
        </DropdownMenuLabel>
        {isGroupPosture && (
          <p
            className="px-2 pb-1.5 text-xs font-normal leading-snug text-muted-foreground"
            data-testid="workspace-switcher-group-hint"
          >
            {t('organization.switcher.groupHint', {
              defaultValue:
                'New records are created here. Views show data from all your organizations.',
            })}
          </p>
        )}
        {orgList.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => handleSwitch(org)}
            className="cursor-pointer gap-2"
          >
            <OrgBadge name={org.name} />
            <span className="flex-1 truncate">{org.name}</span>
            {org.id === current.id && <Check className="h-4 w-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => confirmUnsavedLeave(() => navigate(`/organizations/${current.slug}/members`))}
          className="cursor-pointer gap-2"
          data-testid="workspace-manage-members"
        >
          <Users className="h-4 w-4" />
          {t('organization.switcher.manageMembers', { defaultValue: 'Manage members' })}
        </DropdownMenuItem>
        {!multiOrgDisabled && (
          <DropdownMenuItem
            onClick={() => confirmUnsavedLeave(() => navigate('/organizations?create=1'))}
            className="cursor-pointer gap-2"
            data-testid="workspace-create"
          >
            <Plus className="h-4 w-4" />
            {t('organizations.create', { defaultValue: 'Create organization' })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

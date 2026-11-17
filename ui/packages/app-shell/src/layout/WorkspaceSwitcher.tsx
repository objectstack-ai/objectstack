/**
 * WorkspaceSwitcher — the organization switcher, in two places.
 *
 * ## `WorkspaceSwitcherMenu` — inside the avatar menu (the web switcher)
 *
 * The top bar's left side is the product mark and the app switcher; switching
 * organization is rare, so the switcher lives in the avatar menu as a
 * "Switch organization" submenu (objectstack-ai/objectstack#34591).
 * The avatar menu decides WHETHER it is offered from the served deployment
 * signals (`orgMenuEntries` in `hooks/useOrgMenuPosture.ts`: a multi-organization
 * deployment and two or more memberships). This component renders nothing
 * without an active organization, at one membership, or inside a mobile shell
 * that carries its own switcher (below).
 *
 * Under `group` tenancy posture (ADR-0105) the active organization is only the
 * WRITE target — reads span every organization the member belongs to — so the
 * submenu labels it as the working organization and says so. ADR-0105 requires
 * that write-context switcher to stay reachable in group posture; the avatar
 * menu is where it is reached.
 *
 * Below the phone breakpoint (`usePhoneViewport`) the rows render inline in the
 * avatar menu under a "Switch organization" label instead of in a submenu: a
 * submenu opens beside the menu, and at phone width the menu already spans the
 * screen, so neither side has room and the rows would open off the screen.
 *
 * Switching does a full-page reload to the console root so the active-org
 * context refreshes app-wide, mirroring OrganizationsPage.
 *
 * ## `WorkspaceSwitcher` — the mobile shell's button in the top bar
 *
 * Inside the ObjectStack mobile shell (`@object-ui/mobile`), when the shell
 * announces `showConnectionSwitcher`, the top bar keeps a button that opens the
 * shell's native switcher. It renders whenever there is an active
 * organization, at any membership count: the sheet lists the connections the
 * shell holds across company servers, which this server's membership list
 * cannot count — it is the shell's control, not this server's organization
 * menu. In a plain browser, or a shell without the capability, it renders
 * nothing; the web switcher is the avatar menu's.
 */

import { useAuth } from '@object-ui/auth';
import type { AuthOrganization } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { nativeHostCan, nativeShowConnectionSwitcher, useNativeHost } from '@object-ui/mobile';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@object-ui/components';
import { ArrowLeftRight, Check, ChevronsUpDown } from 'lucide-react';
import { resolveRootUrl } from '../console/organizations/resolveHomeUrl.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';
import { OrgBadge } from './OrgBadge.js';

/** The top bar's mobile-shell button; nothing in a plain browser. */
export function WorkspaceSwitcher() {
  const { activeOrganization } = useAuth();
  const nativeSwitcher = nativeHostCan(useNativeHost(), 'showConnectionSwitcher');

  // The organization the SERVER reports as active, never a membership-list
  // guess (objectui#12698); none ⇒ nothing to name.
  const current = activeOrganization;
  if (!nativeSwitcher || !current) return null;

  // The shell's sheet is the switcher; switching there is the shell's own
  // flow, so nothing is sent from here.
  return (
    <button
      type="button"
      className="ml-2 inline-flex max-w-[14rem] items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
      data-testid="workspace-switcher"
      data-native-switcher=""
      onClick={() => {
        void nativeShowConnectionSwitcher().then((result) => {
          if (result.status === 'failed') {
            console.warn('[WorkspaceSwitcher] native connection switcher failed', result.code, result.message);
          }
        });
      }}
    >
      <OrgBadge name={current.name} />
      <span className="hidden truncate sm:inline">{current.name}</span>
      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** The avatar menu's "Switch organization" submenu (inline rows on a phone). Render it inside a `DropdownMenuContent`. */
export function WorkspaceSwitcherMenu({ isGroupPosture }: { isGroupPosture: boolean }) {
  const { t } = useObjectTranslation();
  const { organizations, activeOrganization, switchOrganization } = useAuth();
  const nativeSwitcher = nativeHostCan(useNativeHost(), 'showConnectionSwitcher');
  const phone = usePhoneViewport();

  // The shell's button in the top bar replaces the web switcher there.
  if (nativeSwitcher) return null;

  const current = activeOrganization;
  if (!current) return null;

  // One membership: nothing to switch to, so no control that controls nothing.
  const orgList = organizations ?? [];
  if (orgList.length <= 1) return null;

  const handleSwitch = (org: AuthOrganization) => {
    if (org.id === current.id) return;
    // objectui#13231 — ask BEFORE `set-active` is sent: once the server has
    // switched, the page holding the edits reloads itself for the new
    // organization before any leave prompt could run. On Cancel nothing is
    // sent: the organization, the URL and the edits stay.
    confirmUnsavedLeave(async () => {
      try {
        await switchOrganization(org.id);
        // Reload to the console root so the new active org reaches every data
        // scope and RootLandingRedirect resolves the right landing. Same as
        // OrganizationsPage.
        window.location.href = resolveRootUrl();
      } catch (err) {
        console.error('[WorkspaceSwitcher] switch failed', err);
      }
    });
  };

  const groupHint = isGroupPosture ? (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        {t('organization.switcher.groupLabel', { defaultValue: 'Working organization' })}
      </DropdownMenuLabel>
      {/* Bounded width: the menu sizes to its content, so an unbounded line
          widens it past a phone screen instead of wrapping. */}
      <p
        className="max-w-60 px-2 pb-1.5 text-xs font-normal leading-snug text-muted-foreground"
        data-testid="workspace-switcher-group-hint"
      >
        {t('organization.switcher.groupHint', {
          defaultValue: 'New records are created here. Views show data from all your organizations.',
        })}
      </p>
    </>
  ) : null;
  const rows = orgList.map((org) => (
    <DropdownMenuItem
      key={org.id}
      onClick={() => handleSwitch(org)}
      className="cursor-pointer gap-2"
      data-testid={`workspace-switcher-org-${org.id}`}
    >
      <OrgBadge name={org.name} />
      <span className="flex-1 truncate">{org.name}</span>
      {org.id === current.id && <Check className="h-4 w-4 shrink-0" />}
    </DropdownMenuItem>
  ));
  const label = t('organization.switcher.label', { defaultValue: 'Switch organization' });

  // Phone: inline rows under a label — a submenu has no side with room there.
  if (phone) {
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuGroup data-testid="workspace-switcher-menu">
          <DropdownMenuLabel
            className="flex items-center text-xs font-medium text-muted-foreground"
            data-testid="header-switch-organization-label"
          >
            <ArrowLeftRight className="mr-2 h-3.5 w-3.5" />
            {label}
          </DropdownMenuLabel>
          {groupHint}
          {rows}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
      </>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="cursor-pointer" data-testid="header-switch-organization">
        <ArrowLeftRight className="mr-2 h-4 w-4" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60" data-testid="workspace-switcher-menu">
        {groupHint}
        {rows}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

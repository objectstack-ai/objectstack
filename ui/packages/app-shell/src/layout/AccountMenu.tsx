// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AccountMenu — the signed-in person's menu: who they are, Profile, the
 * organization entries their deployment offers, the hidden apps, theme,
 * language and inbox announcements, the platform stage, and Log out.
 *
 * One menu, two triggers (objectstack#36112): the phone top bar's avatar
 * (`trigger="avatar"`), and from 768 px up the row at the foot of the app
 * sidebar, the avatar with the person's name (`trigger="sidebar"`), where the
 * desktop draws no top bar.
 *
 * @module
 */

import { useNavigate } from 'react-router-dom';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  Avatar,
  AvatarImage,
  AvatarFallback,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  cn,
} from '@object-ui/components';
import { LogOut, Plus, Bot, User, Building2, ChevronsUpDown } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAuth, getUserInitials } from '@object-ui/auth';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useServedAppLabel } from '../hooks/useServedAppLabel.js';
import { appAddressSegment } from '../utils/appRoute.js';
import { connectAssistantPath } from '../console/connect/connectAssistantPath.js';
import { getIcon } from '../utils/getIcon.js';
import { orgMenuEntries, useOrgMenuPosture } from '../hooks/useOrgMenuPosture.js';
import { postureHasOrgWall } from '../hooks/useTenancyPosture.js';
import { getPlatformStage, getProductName } from '../runtime-config.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import { ModeToggle } from './ModeToggle.js';
import { WorkspaceSwitcherMenu } from './WorkspaceSwitcher.js';
import { LocaleSwitcher } from './LocaleSwitcher.js';
import { NotificationPreferencesMenu } from './NotificationPreferencesMenu.js';
import { PreviewBadge } from './PreviewBadge.js';

export interface AccountMenuProps {
  /** `avatar`: the top bar's round avatar button. `sidebar`: the sidebar foot's row, avatar and name. */
  trigger: 'avatar' | 'sidebar';
}

export function AccountMenu({ trigger }: AccountMenuProps) {
  const navigate = useNavigate();
  // The menu's entries navigate from a button, which no page's link guard
  // sees, so each departure asks first while a page holds unsaved edits.
  const leaveTo = (to: string) => confirmUnsavedLeave(() => navigate(to));
  const { t } = useObjectTranslation();
  const { appLabel } = useServedAppLabel();
  const { apps: metadataApps } = useMetadata();
  const { user, signOut, isAuthEnabled, organizations, activeOrganization, isOrganizationsLoading } = useAuth();
  const orgList = organizations ?? [];
  const hasOrgSection = isOrganizationsLoading || orgList.length > 0 || !!activeOrganization;
  // The organization entries follow the served deployment signals
  // (objectstack-ai/objectstack#34591): none on a single-tenant deployment, no
  // create entry on a cloud-managed one, and the switcher only at two or more
  // memberships. Until the config resolves, the spec's absent readings keep
  // the entries drawn; the server still enforces.
  const orgMenuPosture = useOrgMenuPosture();
  const orgMenu = orgMenuEntries({
    posture: orgMenuPosture,
    hasOrgSection,
    membershipCount: orgList.length,
  });
  // Connect an AI Assistant: drawn only while the served Account app carries
  // the page (`@objectstack/mcp` contributes the entry exactly when it
  // registers the page), so a deployment with MCP off shows no dead item.
  const connectAssistantHref = connectAssistantPath(metadataApps);
  // The platform stage rides here once the desktop has no top bar to carry it.
  const stage = getPlatformStage();
  const showsStage = trigger === 'sidebar' && (stage === 'preview' || stage === 'beta');
  // On a walled deployment the sidebar row names the active organization
  // under the person's name, read-only, as the top bar's indicator did.
  const walledOrganization =
    activeOrganization && postureHasOrgWall(orgMenuPosture.tenancyPosture) ? activeOrganization.name : undefined;
  const accountLabel = t('user.accountMenu', { defaultValue: 'Account menu' });

  const avatar = (size: 'sm' | 'md') => (
    <Avatar className={cn(size === 'sm' ? 'h-7 w-7' : 'h-8 w-8', 'rounded-full shrink-0')}>
      <AvatarImage src={user?.image} alt={user?.name ?? 'User'} />
      <AvatarFallback className="rounded-full bg-primary text-primary-foreground text-xs">
        {getUserInitials(user)}
      </AvatarFallback>
    </Avatar>
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger === 'avatar' ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 max-md:size-11 shrink-0 rounded-full"
            aria-label={accountLabel}
          >
            {avatar('sm')}
          </Button>
        ) : (
          <SidebarMenuButton
            size="lg"
            aria-label={accountLabel}
            data-testid="sidebar-account-menu"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            {avatar('md')}
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{user?.name ?? 'User'}</span>
              {walledOrganization && (
                <span className="truncate text-xs text-muted-foreground" data-testid="sidebar-account-organization">
                  {walledOrganization}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
          </SidebarMenuButton>
        )}
      </DropdownMenuTrigger>
      {/* 44 px rows below `md`, as the app switcher's menu (objectstack#29075). */}
      <DropdownMenuContent
        align={trigger === 'avatar' ? 'end' : 'start'}
        side={trigger === 'avatar' ? 'bottom' : 'top'}
        className="min-w-64 rounded-lg max-md:[&_[role=menuitem]]:min-h-11"
        sideOffset={4}
      >
        {/* User identity */}
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-2">
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage src={user?.image} alt={user?.name ?? 'User'} />
              <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                {getUserInitials(user)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user?.name ?? 'User'}</span>
              <span className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</span>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {/*
           * Profile — land directly on the Account app's profile_card
           * component. We link to the explicit component route rather than
           * `/apps/account` because the bare app path does not reliably
           * resolve to the first (component-type) nav item, leaving the
           * avatar menu's account entry dead. Entering at the component
           * route still mounts the Account app shell (Inbox / Security /
           * Developer remain reachable from its sidebar).
           */}
          <DropdownMenuItem
            onClick={() => leaveTo('/apps/account/component/account/profile_card')}
            className="cursor-pointer"
          >
            <User className="mr-2 h-4 w-4" />
            {t('user.profile', { defaultValue: 'Profile' })}
          </DropdownMenuItem>
          {connectAssistantHref && (
            <DropdownMenuItem
              onClick={() => leaveTo(connectAssistantHref)}
              className="cursor-pointer"
              data-testid="header-connect-ai-assistant"
            >
              <Bot className="mr-2 h-4 w-4" />
              {t('user.connectAiAssistant', { defaultValue: 'Connect an AI Assistant' })}
            </DropdownMenuItem>
          )}
          {/*
           * Organization entries, by deployment posture (`orgMenuEntries`,
           * objectstack-ai/objectstack#34591, ruling 6937513776).
           *
           * Single-tenant (`multiOrgEnabled` off): none. Member management
           * for the one organization is Setup → Organization (ruling
           * 6384629949), so dropping these closes no door.
           *
           * Multi-organization: "My Organizations" → `?manage=1`, which
           * OrganizationsPage reads as "came here to MANAGE" — a member of
           * one organization is deep-linked to its members page, since the
           * picker auto-skips at one organization (objectstack#8096: this
           * entry is that member's door, as the switcher is not offered at
           * one membership). Then the switcher, at two or more memberships,
           * and "Create organization" unless the cloud manages this
           * environment (organizations are created on the cloud there).
           *
           * On a walled posture the active organization's name also rides
           * under "My Organizations", beside the entries that act on it; the
           * bar names it read-only (`CurrentOrganizationIndicator`).
           */}
          {orgMenu.myOrganizations && (
            <DropdownMenuItem
              onClick={() => leaveTo('/organizations?manage=1')}
              className="cursor-pointer"
              data-testid="header-my-organizations"
            >
              <Building2 className="mr-2 h-4 w-4" />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span>{t('organizations.mine', { defaultValue: 'My Organizations' })}</span>
                {activeOrganization && postureHasOrgWall(orgMenuPosture.tenancyPosture) && (
                  <span
                    className="truncate text-xs text-muted-foreground"
                    data-testid="header-my-organizations-current"
                  >
                    {activeOrganization.name}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          )}
          {orgMenu.switchOrganization && (
            <WorkspaceSwitcherMenu isGroupPosture={orgMenuPosture.tenancyPosture === 'group'} />
          )}
          {orgMenu.createOrganization && (
            <DropdownMenuItem
              onClick={() => leaveTo('/organizations?create=1')}
              className="cursor-pointer"
              data-testid="header-create-workspace"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('organizations.create', { defaultValue: 'Create organization' })}
            </DropdownMenuItem>
          )}
          {/*
           * Hidden apps (App.hidden === true) surface here instead
           * of in the App Switcher. This is the standard pattern for
           * personal-settings-style apps that would feel out of place
           * next to business apps — Personal Settings, etc. The `account`
           * app is represented by the explicit Profile link above, so it
           * is filtered out here to avoid a duplicate (dead) entry.
           *
           * Each entry links to the app's one address (`appAddressSegment`),
           * never its bare package id: a hidden app that shares its package
           * with the package's first app is reached by its name alone, and
           * the package id would open that first app instead.
           */}
          {(metadataApps || [])
            .filter((a: any) => a.active !== false && a.hidden === true && a.name !== 'account')
            .map((app: any) => {
              const AppIcon = getIcon(app.icon);
              const label = appLabel(app);
              return (
                <DropdownMenuItem
                  key={`hidden_app_${app.name}`}
                  onClick={() => leaveTo(`/apps/${appAddressSegment(metadataApps, app)}`)}
                  className="cursor-pointer"
                >
                  <AppIcon className="mr-2 h-4 w-4" />
                  {label}
                </DropdownMenuItem>
              );
            })}
        </DropdownMenuGroup>

        {/*
         * UX P0-2: theme + locale switchers used to be standalone
         * top-bar buttons. They're rarely-used preferences so they live
         * under the avatar dropdown now, freeing top-bar real estate.
         * Each is rendered as a non-interactive label + the existing
         * control so the dropdown handles outside-click / esc cleanly.
         */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground uppercase tracking-wide px-2">
          {t('user.preferences', { defaultValue: 'Preferences' })}
        </DropdownMenuLabel>
        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          <span className="text-foreground/80">
            {t('user.theme', { defaultValue: 'Theme' })}
          </span>
          <ModeToggle />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          <span className="text-foreground/80">
            {t('user.language', { defaultValue: 'Language' })}
          </span>
          <LocaleSwitcher />
        </div>
        {/*
         * objectui#7011 — the two inbox announcement switches. They belong
         * beside theme and language for the same reason those moved here:
         * browser-local preferences a user sets once. The desktop switch is
         * also the ONLY path to `Notification.requestPermission()` in this
         * console, and keeping it behind a deliberate gesture is what stops
         * a load-time prompt from spending that channel permanently.
         */}
        <NotificationPreferencesMenu />

        {isAuthEnabled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => confirmUnsavedLeave(() => signOut())}>
              <LogOut className="mr-2 h-4 w-4" />
              {t('user.logout', { defaultValue: 'Log out' })}
            </DropdownMenuItem>
          </>
        )}
        {showsStage && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground" data-testid="account-menu-stage">
              <span className="truncate">{getProductName()}</span>
              <PreviewBadge />
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (trigger === 'avatar') return menu;
  return (
    <SidebarMenu>
      <SidebarMenuItem>{menu}</SidebarMenuItem>
    </SidebarMenu>
  );
}

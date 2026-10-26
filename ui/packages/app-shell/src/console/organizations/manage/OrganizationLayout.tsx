/**
 * OrganizationLayout
 *
 * Layout for `/organizations/:slug/*` management pages.
 * Resolves the org by slug, ensures it is the active organization,
 * renders nav tabs (Members / Invitations / Settings) and an Outlet.
 */

import { useEffect, useMemo } from 'react';
import { Outlet, useParams, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@object-ui/components';
import { useNavigationContext } from '../../../context/NavigationContext.js';
import { AppHeader } from '../../../layout/AppHeader.js';
import { CONSOLE_TOP_BAR } from '../../../layout/consoleTopBar.js';

export function OrganizationLayout() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const {
    organizations,
    activeOrganization,
    isOrganizationsLoading,
    switchOrganization,
  } = useAuth();
  const { setContext } = useNavigationContext();

  useEffect(() => {
    setContext('home');
  }, [setContext]);

  const org = useMemo(
    () => (organizations ?? []).find((o) => o.slug === slug) ?? null,
    [organizations, slug],
  );

  // Ensure the slug-matched org is the active one
  useEffect(() => {
    if (org && activeOrganization?.id !== org.id) {
      switchOrganization(org.id).catch((err) => {
        console.error('[OrganizationLayout] switch failed', err);
      });
    }
  }, [org, activeOrganization, switchOrganization]);

  if (isOrganizationsLoading) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 text-center">
        <h1 className="text-xl font-semibold">
          {t('organization.notFound', { defaultValue: 'Organization not found' })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('organization.notFoundDescription', {
            defaultValue: 'This organization does not exist or you do not have access.',
          })}
        </p>
        <Button className="mt-6" onClick={() => navigate('/organizations')}>
          {t('organization.backToList', { defaultValue: 'Back to organizations' })}
        </Button>
      </div>
    );
  }

  const tabs = [
    { to: 'members', label: t('organization.tabs.members', { defaultValue: 'Members' }) },
    { to: 'invitations', label: t('organization.tabs.invitations', { defaultValue: 'Invitations' }) },
    { to: 'settings', label: t('organization.tabs.settings', { defaultValue: 'Settings' }) },
  ];

  return (
    <div className="flex min-h-svh w-full flex-col bg-background" data-testid="organization-layout">
      <header className={CONSOLE_TOP_BAR}>
        <AppHeader variant="orgs" />
      </header>

      <div className="border-b">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 pt-6">
          {/* "Back to organizations" only makes sense when there IS a list to
              return to. Single-org users (the vast majority) have no picker —
              `/organizations` auto-skips them straight to home — so the button
              would just dump them on home. Hide it for them; they leave via the
              global header (logo / app switcher). */}
          {(organizations ?? []).length > 1 && (
            <button type="button"
              onClick={() => navigate('/organizations')}
              className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('organization.backToList', { defaultValue: 'Back to organizations' })}
            </button>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight">{org.name}</h1>
              <p className="text-xs text-muted-foreground">{org.slug}</p>
            </div>
          </div>
          <nav className="mt-4 flex gap-1 -mb-px">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end
                className={({ isActive }) =>
                  `border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      <main className="flex-1 min-w-0 overflow-auto">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6">
          <Outlet context={{ org }} />
        </div>
      </main>
    </div>
  );
}

/**
 * HomeLayout
 *
 * Home (workspace) landing layout. Uses the unified `AppHeader` top bar in
 * `home` variant so that `/home` shares chrome with the rest of the console;
 * deliberately omits the sidebar.
 *
 * It mounts the console's command palette (objectui#12601), so the bar draws
 * its search field and `⌘K` opens the palette here as it does inside an app —
 * the SAME `CommandPalette`, not a second search. Home is outside every app,
 * and the palette's scope is an app: it is given Home's host app, the app the
 * user was last in (re-checked against the live list), else their first
 * openable app — `resolveHostAppSegment`, the resolution Home already uses for
 * the app-independent pages it links into. With no app to host it (the
 * zero-app workspace, or the app list still loading) no palette is mounted, so
 * the bar draws no search field that would open nothing (objectui#11912).
 *
 * It is also Home's navigation predicate scope (objectui#12700). The bell and
 * the activity card build their roster from every app's navigation, and the
 * palette lists the host app's, so every `visible` gate on those entries is
 * evaluated HERE. The `ExpressionProvider` below binds the caller's
 * `/auth/me/permissions` answer (`useExpressionPermissions`) for
 * `current_user.can(object, verb)`: with a permission provider above Home (the
 * console mounts one over `/home` and `/apps/…`), a denied gate withholds its
 * entry as a verdict and a granted one includes it. With none above, nothing is
 * bound and the gate faults and is withheld, as before. `current_user` is the
 * signed-in user through the shared normaliser `buildExpressionUser`, as at
 * every other mount site (objectui#6515), so a gate naming `current_user.id` or
 * `current_user.positions` answers here as it does in the sidebar. `features`
 * is not bound: Home reads no deployment config, as the scope it replaces did.
 *
 * @module
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNavigationContext } from '../../context/NavigationContext.js';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider.js';
import { CommandPalette } from '../../chrome/CommandPalette.js';
import { AppHeader } from '../../layout/AppHeader.js';
import { CONSOLE_TOP_BAR } from '../../layout/consoleTopBar.js';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { filterActiveApps, matchAppBySegment, resolveHostAppSegment } from '../../utils/index.js';
import { useAiSurfaceEnabled } from '../../hooks/useAiSurface.js';
import { ExpressionProvider } from '../../providers/ExpressionProvider.js';
import { buildExpressionUser } from '../../providers/expressionUser.js';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';

// The ChatDock's launcher (dependency-free button).
import { ConsoleChatbotFab } from '../../layout/ConsoleChatbotFab.js';
import { rememberDockReturnLocation } from '../../layout/chatDockState.js';

/**
 * Home's `app`, `data` and `features`: none. Module constants, not the
 * provider's `= {}` defaults, which mint a new object on every render and so a
 * new evaluator for every gate below.
 */
const NO_SCOPE_INPUT: Record<string, never> = {};

interface HomeLayoutProps {
  children: React.ReactNode;
  /**
   * Signed-in user id. Kept for API stability (callers pass it); the full-page
   * chat surface resolves the user itself via useAuth.
   */
  userId?: string;
}

export function HomeLayout({ children }: HomeLayoutProps) {
  const { setContext, currentAppName } = useNavigationContext();
  const { user } = useAuth();
  // The shared `current_user` normaliser, keyed on the session user (objectui#6515).
  const expressionUser = useMemo(() => buildExpressionUser(user), [user]);
  const { apps, objects } = useMetadata();
  const dataSource = useAdapter();
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // ADR-0057: Home has no AppShell to host the docked rail, so its FAB opens
  // the full-page surface — which IS the dock maximized, same thread. The
  // origin is remembered so `/ai`'s collapse-to-dock lands back here.
  const openAssistant = useCallback(() => {
    rememberDockReturnLocation(`${location.pathname}${location.search}`);
    navigate('/ai');
  }, [location.pathname, location.search, navigate]);
  // Render the chatbot only when the server serves AI (or an explicit
  // `VITE_AI_BASE_URL` opt-in is set) — same runtime signal as the rest of the
  // console's AI surface. See useAiSurfaceEnabled.
  const { enabled: showChatbot } = useAiSurfaceEnabled();

  useEffect(() => {
    setContext('home');
  }, [setContext]);

  // The app the palette searches — see the module doc.
  const activeApps = filterActiveApps(apps);
  const hostApp =
    activeApps.length > 0
      ? matchAppBySegment(activeApps, resolveHostAppSegment(activeApps, currentAppName))
      : undefined;

  const header = (
    <header className={CONSOLE_TOP_BAR}>
      <AppHeader variant="home" />
    </header>
  );

  return (
    <ExpressionProvider user={expressionUser} app={NO_SCOPE_INPUT} data={NO_SCOPE_INPUT} features={NO_SCOPE_INPUT}>
    <div className="flex min-h-svh w-full flex-col bg-background" data-testid="home-layout">
      {/* The provider wraps the bar and the palette only: the page below
          reads neither, so mounting it once the app list arrives re-mounts
          the bar and leaves the page as it is. */}
      {hostApp ? (
        <CommandPaletteProvider>
          {header}
          <CommandPalette
            apps={apps ?? []}
            activeApp={hostApp}
            objects={objects ?? []}
            onAppChange={(segment) => navigate(`/apps/${segment}`)}
            dataSource={dataSource}
          />
        </CommandPaletteProvider>
      ) : (
        header
      )}
      <main className="flex-1 min-w-0 overflow-auto pb-20 sm:pb-0">
        {children}
      </main>

      {/* Assistant entry on the home/workspace screen — opens the full-page
          chat (the dock maximized; Home has no shell to dock a rail into). */}
      {showChatbot && (
        <ConsoleChatbotFab
          appLabel={t('workspace.default', { defaultValue: 'My Organization' })}
          onOpenDock={openAssistant}
        />
      )}
    </div>
    </ExpressionProvider>
  );
}

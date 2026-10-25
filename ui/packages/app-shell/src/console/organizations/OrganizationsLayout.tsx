/**
 * OrganizationsLayout
 *
 * Landing layout for `/organizations`. Uses the unified `AppHeader` in `orgs`
 * variant and has no sidebar. Shown when the user has not selected an
 * organization or explicitly navigates to browse/create organizations.
 *
 * @module
 */

import React, { useEffect } from 'react';
import { useNavigationContext } from '../../context/NavigationContext.js';
import { AppHeader } from '../../layout/AppHeader.js';
import { CONSOLE_TOP_BAR } from '../../layout/consoleTopBar.js';

interface OrganizationsLayoutProps {
  children: React.ReactNode;
}

export function OrganizationsLayout({ children }: OrganizationsLayoutProps) {
  const { setContext } = useNavigationContext();

  useEffect(() => {
    setContext('home');
  }, [setContext]);

  return (
    <div className="flex min-h-svh w-full flex-col bg-background" data-testid="organizations-layout">
      <header className={CONSOLE_TOP_BAR}>
        <AppHeader variant="orgs" />
      </header>
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}

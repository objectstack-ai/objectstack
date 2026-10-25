import type { ReactNode } from 'react';
import type { MinimalAppShellProps } from '../types.js';

/**
 * AppShell - Minimal layout container
 *
 * Provides basic application structure without routing or console-specific logic.
 * Third-party systems can customize or replace this with their own layout.
 */
export function AppShell({
  sidebar,
  header,
  footer,
  children,
  className = '',
}: MinimalAppShellProps): ReactNode {
  return (
    <div className={`app-shell flex h-screen flex-col ${className}`}>
      {header && <div className="app-shell-header">{header}</div>}
      <div className="app-shell-body flex flex-1 overflow-hidden">
        {sidebar && (
          <div className="app-shell-sidebar border-r">{sidebar}</div>
        )}
        <main className="app-shell-main flex-1 overflow-auto">
          {children}
        </main>
      </div>
      {footer && <div className="app-shell-footer">{footer}</div>}
    </div>
  );
}

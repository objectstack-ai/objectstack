/**
 * NavigationContext
 *
 * Provides global navigation state for the unified sidebar and breadcrumb.
 * Tracks whether the user is in "Home" context (workspace view) or "App"
 * context (specific app), plus an optional record-detail title that record
 * pages publish so the top-bar breadcrumb can show the human-readable title
 * (e.g. "Acme Platform Upgrade") instead of the raw record ID.
 *
 * @module
 */

import { createContext, useContext, useState, useMemo, useEffect, type ReactNode } from 'react';

export type NavigationContextType = 'home' | 'app';

interface NavigationContextValue {
  /** Current navigation context (home or app) */
  context: NavigationContextType;
  /** Set the navigation context */
  setContext: (context: NavigationContextType) => void;
  /** Current app name when in app context */
  currentAppName?: string;
  /** Set the current app name */
  setCurrentAppName: (appName?: string) => void;
  /**
   * Human-readable title of the currently displayed record (when on a record
   * detail page). Published by RecordDetailView once data loads; consumed by
   * AppHeader to replace the raw `#shortId` segment in the breadcrumb.
   */
  recordTitle?: string;
  /** Update the current record title (or clear it when leaving a record page). */
  setRecordTitle: (title?: string) => void;
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined);

interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  const [context, setContext] = useState<NavigationContextType>('home');
  const [currentAppName, setCurrentAppName] = useState<string | undefined>();
  const [recordTitle, setRecordTitle] = useState<string | undefined>();

  const value = useMemo(
    () => ({
      context,
      setContext,
      currentAppName,
      setCurrentAppName,
      recordTitle,
      setRecordTitle,
    }),
    [context, currentAppName, recordTitle]
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * Hook to access navigation context
 */
export function useNavigationContext(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    // Graceful fallback for consumers rendered outside <NavigationProvider>
    // (common in lightweight unit tests). Production paths always wrap.
    return {
      context: 'app',
      setContext: () => {},
      currentAppName: undefined,
      setCurrentAppName: () => {},
      recordTitle: undefined,
      setRecordTitle: () => {},
    };
  }
  return context;
}

/**
 * Helper hook for record pages: sets the record title on mount and clears it
 * on unmount, so the breadcrumb only shows a record title while a record page
 * is actually visible.
 */
export function useRecordBreadcrumbTitle(title: string | undefined): void {
  const { setRecordTitle } = useNavigationContext();
  useEffect(() => {
    setRecordTitle(title);
    return () => setRecordTitle(undefined);
  }, [title, setRecordTitle]);
}

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectStack React Context
 * 
 * Provides ObjectStackClient instance to React components via Context API
 */

import * as React from 'react';
import { createContext, useContext, useRef, ReactNode } from 'react';
import { ObjectStackClient } from '@objectstack/client';

export interface ObjectStackProviderProps {
  client: ObjectStackClient;
  /**
   * Active UI locale (BCP-47, e.g. `'zh-CN'`). Keep this in sync with your
   * language switcher — the provider pushes it into the client (so requests
   * carry `Accept-Language`) and metadata hooks (`useObject`, `useView`,
   * `useMetadata`) re-fetch when it changes, so switching language relabels
   * the UI without a page refresh (issue #1319).
   */
  locale?: string;
  children: ReactNode;
}

export const ObjectStackContext = createContext<ObjectStackClient | null>(null);

/**
 * Carries the active UI locale separately from the client so existing
 * `useContext(ObjectStackContext)` consumers keep receiving the bare client
 * (no breaking change to that context's shape).
 */
export const ObjectStackLocaleContext = createContext<string | undefined>(undefined);

/**
 * Provider component that makes ObjectStackClient available to all child components
 * 
 * @example
 * <!-- os:check -->
 * ```tsx
 * import { ObjectStackClient } from '@objectstack/client';
 * import { ObjectStackProvider } from '@objectstack/client-react';
 *
 * const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
 * const language = 'en';
 *
 * function YourComponents() {
 *   return <div>Your app</div>;
 * }
 *
 * function App() {
 *   return (
 *     <ObjectStackProvider client={client} locale={language}>
 *       <YourComponents />
 *     </ObjectStackProvider>
 *   );
 * }
 * ```
 */
export function ObjectStackProvider({ client, locale, children }: ObjectStackProviderProps) {
  // Mirror the active locale onto the client so every request carries the
  // matching `Accept-Language`.
  //
  // This MUST run during render, not in a `useEffect`. The child metadata
  // hooks read `locale` from context and re-fetch via their own effects, and
  // React flushes child effects *before* parent effects — so syncing the
  // client in an effect here would update it only after the refetch already
  // fired, sending the stale `Accept-Language`. Render runs parent-before-
  // child, so updating the client here guarantees it is current before any
  // child fetches. The ref keeps the write idempotent across re-renders /
  // StrictMode double-invokes.
  const synced = useRef<{ client: ObjectStackClient; locale: string | undefined } | null>(null);
  if (synced.current?.client !== client || synced.current?.locale !== locale) {
    synced.current = { client, locale };
    client.setLocale?.(locale);
  }

  return (
    <ObjectStackContext.Provider value={client}>
      <ObjectStackLocaleContext.Provider value={locale}>
        {children}
      </ObjectStackLocaleContext.Provider>
    </ObjectStackContext.Provider>
  );
}

/**
 * Hook to read the active UI locale provided to {@link ObjectStackProvider}.
 * Returns `undefined` when no locale was supplied. Metadata hooks fold this
 * into their fetch dependencies so a locale change triggers a re-fetch.
 */
export function useObjectStackLocale(): string | undefined {
  return useContext(ObjectStackLocaleContext);
}

/**
 * Hook to access the ObjectStackClient instance from context
 * 
 * @throws Error if used outside of ObjectStackProvider
 * 
 * @example
 * <!-- os:check -->
 * ```tsx
 * import { useClient } from '@objectstack/client-react';
 *
 * function MyComponent() {
 *   const client = useClient();
 *   // Use client.data.find(), etc.
 * }
 * ```
 */
export function useClient(): ObjectStackClient {
  const client = useContext(ObjectStackContext);
  
  if (!client) {
    throw new Error(
      'useClient must be used within an ObjectStackProvider. ' +
      'Make sure your component is wrapped with <ObjectStackProvider client={...}>.'
    );
  }
  
  return client;
}

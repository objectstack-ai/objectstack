/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { createContext, useContext, useMemo } from 'react';
import type { PWAConfig, PWAOfflineConfig } from '@object-ui/types';
import { useBreakpoint, type BreakpointState } from './useBreakpoint.js';

export interface MobileContextValue extends BreakpointState {
  /** PWA configuration */
  pwa?: PWAConfig;
  /** Offline configuration */
  offline?: PWAOfflineConfig;
}

const MobileCtx = createContext<MobileContextValue | null>(null);
MobileCtx.displayName = 'MobileContext';

export interface MobileProviderProps {
  /** PWA configuration */
  pwa?: PWAConfig;
  /** Offline configuration */
  offline?: PWAOfflineConfig;
  /** Children */
  children: React.ReactNode;
}

/**
 * Provider that combines breakpoint detection with mobile configuration.
 */
export function MobileProvider({ pwa, offline, children }: MobileProviderProps) {
  const breakpoint = useBreakpoint();

  const value = useMemo<MobileContextValue>(
    () => ({
      ...breakpoint,
      pwa,
      offline,
    }),
    [breakpoint, pwa, offline],
  );

  return <MobileCtx.Provider value={value}>{children}</MobileCtx.Provider>;
}

/**
 * Hook to access the mobile context.
 */
export function useMobileContext(): MobileContextValue | null {
  return useContext(MobileCtx);
}

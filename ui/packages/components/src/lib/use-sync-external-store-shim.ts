/**
 * ESM re-export of useSyncExternalStore from React.
 *
 * React 18+ ships useSyncExternalStore natively. The CJS shim package
 * (`use-sync-external-store/shim`) uses `require("react")` which
 * produces a Rolldown `require` polyfill incompatible with Next.js
 * Turbopack SSR. This module provides the same API surface using a
 * static ESM import instead.
 */
export { useSyncExternalStore } from 'react';

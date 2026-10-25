import type { ReactNode } from 'react';

// `DataSource` is `@object-ui/types`' — the one authority, the
// backend-agnostic contract every adapter implements. This module used to
// declare an older, looser copy of the same contract (`any`-typed doors, a
// `delete` resolving `void` where the authority resolves `boolean`, no
// `getObjectSchema`, an optional `getMetadata` nothing calls, and an open
// index signature). No file imported it and this package's entry never
// published it, so it re-exports the authority rather than declaring a second
// one (objectui#6349, batch 11).
export type { DataSource } from '@object-ui/types';

/**
 * Props of this package's minimal `AppShell` container: header, body and
 * footer slots, with no routing.
 *
 * Not `AppShellProps`: `@object-ui/layout` publishes that name for the props of
 * its own sidebar `AppShell`, the shell the console's `ConsoleLayout` composes,
 * which takes `navbar`, `defaultOpen`, `branding` and `rightRail` where this
 * one takes `header` and `footer`. One exported name stood for both until this
 * declaration was renamed (objectui#6349, batch 9).
 */
export interface MinimalAppShellProps {
  /** Sidebar component (optional) */
  sidebar?: ReactNode;
  /** Header component (optional) */
  header?: ReactNode;
  /** Footer component (optional) */
  footer?: ReactNode;
  /** Main content */
  children: ReactNode;
  /** Custom className */
  className?: string;
}

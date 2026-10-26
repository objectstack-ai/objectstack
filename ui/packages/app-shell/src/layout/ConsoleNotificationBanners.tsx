/**
 * ConsoleNotificationBanners
 *
 * `<NotificationBanners />` for the console content area, guarded so
 * `ConsoleLayout` stays usable outside a `NotificationProvider`.
 *
 * The guard is not defensive noise: `ConsoleShell` is deliberately a set of
 * composable pieces consumers assemble in their own `App.tsx` (see that
 * module's header), so a host can legitimately render `ConsoleLayout` without
 * the shell above it. `useNotifications()` THROWS outside its provider — that
 * would turn "no notification system configured" into a white screen for the
 * whole app. `useHasNotificationProvider()` reads the context without throwing,
 * so the banners simply don't render.
 * @module
 */

import { useHasNotificationProvider } from '@object-ui/react';
import { NotificationBanners } from '@object-ui/components';

export function ConsoleNotificationBanners() {
  // Must gate on RENDERING <NotificationBanners />, not on an early return
  // inside it — its own hooks throw before any guard we could put there.
  const hasProvider = useHasNotificationProvider();
  if (!hasProvider) return null;
  return <NotificationBanners />;
}

ConsoleNotificationBanners.displayName = 'ConsoleNotificationBanners';

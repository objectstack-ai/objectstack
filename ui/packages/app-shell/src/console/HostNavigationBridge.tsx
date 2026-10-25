/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * HostNavigationBridge — the console's supply side of
 * `HostNavigationContext` (`@object-ui/react`).
 *
 * Published renderers hold in-app destinations they cannot travel to
 * correctly: their only dependency-free navigation is `window.location.assign`,
 * which resolves a rooted path against the ORIGIN and so leaves a console
 * mounted at a sub-path (`<BrowserRouter basename="/_console">`, which the
 * framework CLI configures for every embedded deployment). That is
 * objectui#4989 defect 4; the maintainer ruled the fix on 2026-08-17 as
 * OPTIONAL INJECTION — the host offers its navigate, the renderer uses it when
 * present and keeps its old behaviour when absent.
 *
 * This bridge is what makes the seam do anything: a seam with no supplier
 * changes nothing. It hands over React Router's own `navigate`, so the
 * basename is applied by the same router that owns the console's routes, and
 * a post-submit redirect becomes an SPA transition instead of a full page load.
 *
 * Mounted in `ConsoleShell`, i.e. above every console route, because the
 * renderers that read it are reached from many of them (record create/edit
 * pages, screens, SDUI pages, modal forms opened from a lookup field) and
 * several arrive through `ComponentRegistry` where the shell never constructs
 * the element and so could not pass a prop.
 *
 * ## Why it tolerates having no router above it
 *
 * `ConsoleShell`'s contract already says to mount it inside a `BrowserRouter`,
 * and every real console does — everything below it (`AppContent`'s own
 * `useNavigate`, the `Routes`) needs one anyway. But partial trees are rendered
 * without one (a test that mounts the shell to exercise notifications, a
 * storybook), and `useNavigate()` THROWS outside a router. Turning a documented
 * convention into a crash is a behaviour change this card did not ask for and
 * would buy nothing: a console with no router is already broken one component
 * lower, so the crash carries no diagnosis.
 *
 * So with no router above, this supplies NO navigate — which is precisely the
 * seam's documented absent state, and leaves every renderer on the fallback it
 * had before. Note what this is not: the "router-presence sniffing" the ruling
 * rejected was a RENDERER discovering a router implicitly and thereby making
 * mount-awareness magic. Here the mechanism is unchanged and explicit — a
 * console deliberately supplying its navigate — and the check only decides
 * whether this supplier has anything to offer.
 */

import { useMemo, type ReactNode } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { HostNavigationProvider, type HostNavigationValue } from '@object-ui/react';

export function HostNavigationBridge({ children }: { children: ReactNode }) {
  // Rules-of-hooks safe: the branch is on whether a Router sits ABOVE this
  // component, which is a fact about the mount and cannot flip under it.
  return useInRouterContext() ? (
    <RouterNavigationBridge>{children}</RouterNavigationBridge>
  ) : (
    <>{children}</>
  );
}

function RouterNavigationBridge({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const value = useMemo<HostNavigationValue>(
    () => ({
      // Wrapped rather than passed through: React Router's `navigate` is
      // overloaded (it also takes a history delta number), and the seam's
      // contract is deliberately narrower — an already-resolved in-app path,
      // judged by the caller. Keeping the adapter here means widening the
      // router's surface cannot silently widen the seam's.
      navigate: (to: string, options?: { replace?: boolean }) =>
        navigate(to, { replace: options?.replace ?? false }),
    }),
    [navigate],
  );

  return <HostNavigationProvider value={value}>{children}</HostNavigationProvider>;
}

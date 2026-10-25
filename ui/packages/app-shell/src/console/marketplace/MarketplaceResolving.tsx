/**
 * The marketplace surface's "the admin verdict has not landed yet" frame
 * (objectui#5619).
 *
 * Both marketplace pages decide between a catalog and `MarketplaceAccessDenied`
 * on one predicate, and that predicate has a third state: the active member row
 * `useWorkspaceAdminStatus` reads is fetched after the session, so on the paths
 * where it is the only leg carrying adminship the verdict is genuinely unknown
 * for the first frames. Painting a refusal there tells a real administrator
 * they lack a grant they hold.
 *
 * Deliberately shaped like the package page's own load skeleton rather than
 * like `MarketplaceAccessDenied`: what is happening IS a wait, and a wait that
 * looks like a verdict is the thing this fixes. No copy, for the same reason —
 * there is nothing true to say yet beyond "not done".
 *
 * Not to be confused with the incidental skeleton objectui#5621 removed: that
 * one was a package fetch that happened to cover the window for as long as the
 * network took. This renders for exactly as long as the verdict is unresolved,
 * and `useWorkspaceAdminStatus` reports resolved immediately for any admin the
 * session itself identifies.
 */

import { Skeleton } from '@object-ui/components';

export function MarketplaceResolving() {
  return (
    <div
      className="mx-auto w-full max-w-6xl flex flex-col gap-6 p-4 sm:p-6"
      data-testid="marketplace-resolving"
    >
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

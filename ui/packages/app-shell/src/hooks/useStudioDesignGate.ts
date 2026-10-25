// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `useStudioDesignGate(path)` — the one gate the app → Studio "design this"
 * entries read (objectui#12615): the app bar's Edit app pencil (and the app
 * switcher's Studio row, which takes the pencil's own target), the sidebar
 * ⋯ menu's Design entry and a page's Edit in studio pencil (`PageView`).
 * Hand it the Studio path the entry would open
 * (`appStudioRoutePath`'s answer); it hands the path back when the entry may
 * be drawn, and `null` when it may not.
 *
 * An entry is drawn only when BOTH hold:
 *
 *  1. the principal may author metadata: a workspace admin holding the
 *     server-reported `manage_metadata` capability (`useCanAuthorMetadata`,
 *     objectui#10899), the check Home's builder CTAs read (objectui#5521);
 *  2. the package the path opens is one Studio lists as WRITABLE: the server's
 *     `writable` verdict as `fetchPackages` reads it (`PkgEntry.writable`,
 *     ADR-0070 D2), the answer Studio's own read-only posture reads.
 *     ⛔ Never a second derivation of "writable" here.
 *
 * Studio opened a read-only package in its browse-only posture with nothing
 * to edit, so an entry drawn there promised an edit Studio cannot deliver.
 *
 * ## A package the list does not carry is not designable
 *
 * `parsePackages` leaves out the kernel packages (manifest scope `system` or
 * `cloud`), and the server judges those read-only by the same scopes
 * (`READ_ONLY_PACKAGE_SCOPES` in the server's package-writability predicate).
 * The console's own Setup, Studio and Account apps belong to such packages, so
 * they fall out of this read with no app-id list (ADR-0060). An id the list
 * does not name has no Studio package page to open either.
 *
 * ## Unknown is not designable
 *
 * While the list is being read, and when the read fails, the entry is absent.
 * That is the opposite of `useCanAuthorMetadata`'s fail-open, on purpose: an
 * unreported capability set is a deployment that never reports one, where
 * failing closed would remove the builder CTAs for good, while this read is
 * one request that answers or fails per visit. The entry is a shortcut, not
 * the only way in (Studio's landing lists every package), so a missing entry
 * costs a click; an entry drawn without a verdict is the dead end this gate
 * exists to remove. The server's write gate stays the authority either way.
 *
 * ## Cost
 *
 * One `GET /api/v1/packages` per package asked about, and only for a principal
 * who passes (1): the list is read when the asked package changes (an app
 * switch), never per render. Readers mounted in one commit (the app bar, the
 * sidebar's rows and a page's pencil) share one request through `fetchPackages`' in-flight
 * read (objectui#11797). Nothing caches the answer: `fetchPackages` is
 * deliberately not a response cache, and no provider holds the package list
 * outside Studio.
 *
 * @module
 */

import { useEffect, useState } from 'react';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useCanAuthorMetadata } from './useCanAuthorMetadata.js';
import { fetchPackages, type PkgEntry } from '../views/studio-design/packages-io.js';

/**
 * The package a Studio path opens: its first segment after `/studio/`, decoded
 * the way `appStudioRoutePath` encoded it. `null` for a path that names none.
 */
export function studioPathPackageId(path: string | null | undefined): string | null {
  const segment = path ? /^\/studio\/([^/?#]+)/.exec(path)?.[1] : undefined;
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * May `packageId` be designed? Only when Studio's package list carries it with
 * a writable verdict; a package the list leaves out (a kernel package) is not.
 */
export function isDesignablePackage(packages: readonly PkgEntry[], packageId: string): boolean {
  return packages.some((pkg) => pkg.id === packageId && pkg.writable);
}

/**
 * The verdict for `packageId`, read once per id. It carries the id it answers
 * for, so an answer for the previous app is never read as this one's.
 */
function usePackageDesignable(packageId: string | null): boolean {
  const [verdict, setVerdict] = useState<{ packageId: string; designable: boolean } | null>(null);
  useEffect(() => {
    if (packageId === null) return undefined;
    let cancelled = false;
    fetchPackages().then(
      (packages) => {
        if (!cancelled) setVerdict({ packageId, designable: isDesignablePackage(packages, packageId) });
      },
      () => {
        if (!cancelled) setVerdict({ packageId, designable: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [packageId]);
  return packageId !== null && verdict?.packageId === packageId && verdict.designable;
}

/** `path` when this principal may design the package it opens, else `null`. */
export function useStudioDesignGate(path: string | null | undefined): string | null {
  const { isAdmin } = useWorkspaceAdminStatus();
  const canAuthorMetadata = useCanAuthorMetadata();
  const packageId = isAdmin && canAuthorMetadata ? studioPathPackageId(path) : null;
  const designable = usePackageDesignable(packageId);
  return designable && path ? path : null;
}

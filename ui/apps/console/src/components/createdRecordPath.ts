// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where an internal `/forms/:name` submit lands — the console path of the
 * record it just created (objectui#4109, maintainer ruling 2026-08-10 on
 * objectstack#7245: "an internal submit lands on the record").
 *
 * Pure, router-free and metadata-free so the policy is unit-testable without
 * rendering the shell; `InternalFormRoute` feeds it the live app catalog.
 *
 * ## Why this needs an app at all
 *
 * A record page is app-scoped: `/apps/<segment>/<object>/record/<id>`, with the
 * segment being the owning package id and the app name as the runtime/DB
 * fallback (ADR-0048). There is no app-independent record route anywhere in the
 * console — every producer of a record link in `@object-ui/app-shell`
 * (`RecordDetailView`, `SearchResultsPage`, `useObjectActions`,
 * `InterfaceListPage`, …) builds this same shape. But `/forms/:name` names no
 * app, so one has to be chosen.
 *
 * ## Which app — app-shell's resolver, and nothing local (objectui#4280)
 *
 * `resolveHostAppSegment` answers exactly this question for framework-owned,
 * app-independent pages, and its docblock (`app-shell/src/utils/appRoute.ts`)
 * is the contract: prefer the app the user is in or last had open, RE-CHECKED
 * against the live active list; else their first active app; else the two last
 * resorts below. This module holds NO copy of that order — it builds the URL
 * shape and delegates the choice.
 *
 * ### What #4280 deleted, and the behaviour that changed with it
 *
 * #4109 could not import the resolver (`@object-ui/app-shell` published only
 * its package root, and that root re-exported `./utils` nowhere), so it shipped
 * a documented local subset: steps 1–2 only, returning `null` where upstream
 * falls through further. #4280 published the resolver from the package root and
 * deleted the subset, and the divergence went with it — deliberately, since a
 * second reader of one prose contract is the failure this repo keeps paying for
 * (#3367 / #3842). The two cases that used to answer `null` now answer:
 *
 *   - **an EMPTY openable list with a `preferred` app** → `preferred`,
 *     unchecked. An empty list means "not loaded yet" at least as often as it
 *     means "this user has no apps", and a caller rendering inside
 *     `/apps/{preferred}/…` is demonstrably in that app;
 *   - **anything else unresolvable** (no apps and nothing preferred, or apps
 *     carrying neither `_packageId` nor `name`) → `setup`, the least-surprising
 *     last resort rather than a broken link.
 *
 * The user-visible delta is on the created-record redirect: `FormPage` treats a
 * `null` path as "cannot name the record's page" and confirms the submit in
 * place instead of navigating (`setSubmitted(true)`). With the host app now
 * always named, a submit that used to stop on that confirmation navigates to
 * the record under the resolved app instead. The write itself was never at
 * stake — only where the user is put afterwards — and this is the same answer
 * every other record link in the console already gives, which is the point.
 */

import { resolveHostAppSegment } from '@object-ui/app-shell';

/**
 * The app records this module hands to app-shell's resolver, DERIVED from that
 * resolver's own signature — the package publishes the function, not its
 * parameter type, and re-declaring the field set here (what `name`,
 * `_packageId`, `active` and `hidden` mean) is precisely the duplication
 * objectui#4280 removed. Deriving it means this call site cannot drift from the
 * shape the resolver accepts.
 */
export type HostAppLike = NonNullable<Parameters<typeof resolveHostAppSegment>[0]>[number];

/**
 * The console path of a freshly created record, or `null` when there is no
 * record to point at — a caller with no object or no id. That null is a
 * supported answer, not a failure: `FormPage` confirms the submit instead of
 * navigating to a path that names nothing.
 *
 * The host app is never a reason to return null any more — see the module
 * docblock — because `resolveHostAppSegment` always names one.
 *
 * `recordId` is percent-encoded (ids are opaque and may carry `/` or `#`);
 * `objectName` and the app segment are metadata identifiers, encoded for the
 * same reason every other producer of this shape does.
 */
export function buildCreatedRecordPath(
  apps: readonly HostAppLike[] | null | undefined,
  preferredAppName: string | null | undefined,
  objectName: string | null | undefined,
  recordId: string | null | undefined,
): string | null {
  if (!objectName || !recordId) return null;
  const appSegment = resolveHostAppSegment(apps, preferredAppName);
  return `/apps/${encodeURIComponent(appSegment)}/${encodeURIComponent(objectName)}/record/${encodeURIComponent(recordId)}`;
}

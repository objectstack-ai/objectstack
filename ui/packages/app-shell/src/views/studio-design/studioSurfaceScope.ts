// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's scope resolution, moved out of `StudioDesignSurface.tsx`
 * unchanged by objectstack#37553 (a move-only split): the route segment read as
 * a package, the package-less scope (`~org`) or the cross-package leg (`~all`);
 * what the package list answers about the open package (writable, its name,
 * missing, a read-only base's facts and its `.custom` pair); the base's
 * customization; and the package's apps.
 */

import * as React from 'react';
import { useParams } from 'react-router-dom';
import { formatMetadataError } from '@object-ui/data-objectstack';
import type { MetadataClient } from '@object-ui/data-objectstack';
import type { I18nLabel } from '@objectstack/spec/ui';
import { toast } from 'sonner';
import type { AppMarkApp } from '../../layout/AppMark.js';
import { subscribeMetadataRefresh } from '../../assistant/assistantBus.js';
import { PACKAGE_LIST_TOAST_ID } from './PackageSwitcher.js';
import { type StudioAppTarget } from './StudioBackToApp.js';
import type { StudioBaseCustomization } from './StudioPillarKit.js';
import { STUDIO_HOME_PILLAR } from './studioInterfacesRetired.js';
import { isStudioOrgScope } from './studioScope.js';
import { STUDIO_METADATA_AREA, isStudioAllPackagesScope } from './metadataArea.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
// objectui#11787 — the shared draft autosave, moved to its own module unchanged.
import {
  ensureCustomizationPackage,
  fetchListedPackageIds,
  fetchListedPackageManifests,
  fetchPackages,
  listedCustomizationPairOf,
  listedPackageEntry,
  listedPackageVersion,
  type EnsuredCustomizationPackage,
  type PkgEntry,
} from './packages-io.js';
import { usePackageCustomizations } from './CustomizationMark.js';
import { useCustomizeDoorWalled } from './StudioCustomizeControls.js';

/** What the route segment names: the scope, the package (or none) and the page. */
export function useStudioSurfaceScope(area: typeof STUDIO_METADATA_AREA | undefined) {
  const params = useParams<{ packageId?: string; tab?: string }>();
  // The route segment: a package id, or the package-less scope's reserved
  // segment (objectui#11553, `studioScope.ts`). URLs are built from it.
  const scopeSegment = params.packageId ?? 'com.example.showcase';
  // objectstack#36899 — the "All metadata" area's cross-package leg (`~all`)
  // is drawn in this shell too, so the left menu is the same on every Studio
  // page: the area alone, with no package, no package actions and no slot.
  const allScope = isStudioAllPackagesScope(scopeSegment);
  // `null` in the package-less scope and on the cross-package leg. Every
  // package-scoped read, write and publish below keys on this value, so none
  // of them can be handed a reserved segment as though it named a package.
  const packageId: string | null = isStudioOrgScope(scopeSegment) || allScope ? null : scopeSegment;
  const tab = area ?? params.tab ?? STUDIO_HOME_PILLAR;
  return { scopeSegment, allScope, packageId, tab };
}

/** A read-only base's facts off the package list, held with the id they answered for. */
export type StudioBaseFacts = { for: string; basedOn: string | null; listedPair: string | null };

/** What the package list answers about the open package, and its `.custom` pair. */
export function useStudioPackageFacts(packageId: string | null) {
  // Courtesy gate (the framework's ADR-0124 D1 — server enforces, client is
  // courtesy): a read-only code/installed package refuses authoring
  // server-side (ADR-0070), so don't let the user build up doomed local edits
  // first — disable the authoring affordances up front. Unknown writability
  // (fetch failed / still loading) stays ungated; the server gate remains the
  // authority either way. `undefined` is "still asking" and `null` is "could
  // not find out": the gate reads both as ungated, and only the Interfaces
  // pillar's `?sel=nav:` deep link tells them apart, so that it does not act
  // on a write state nobody has answered yet (objectui#11153).
  const [pkgWritable, setPkgWritable] = React.useState<boolean | null | undefined>(undefined);
  // objectui#12718 — the package's display name, from the same answer: the
  // Interfaces pillar names a package that has no app yet by it. Held with
  // the id it answered for, so a switch never hands the next package the
  // previous one's name while its own read is in flight.
  const [pkgEntry, setPkgEntry] = React.useState<PkgEntry | null>(null);
  // objectstack#26708 — the package list answered and lists no package with
  // this id: the surface renders "package not found" instead of a builder
  // whose every save the server refuses. Only a positive answer sets it — a
  // read still in flight or one that failed leaves the builder as it was, the
  // same fail direction as the writability gate above. A switcher entry is
  // installed; an id with none is then looked up in every id the list serves
  // (`fetchListedPackageIds`, the same request), because the switcher's
  // entries hide the kernel packages that ARE installed.
  const [pkgMissing, setPkgMissing] = React.useState(false);
  // objectstack#28562 (ADR-0146 D2, D3) — what customizing a read-only base
  // reads off the same list: the version its manifest declares (an override's
  // `basedOn`) and its paired customization package when one is listed. Held
  // with the id it answered for; `null` until read, and on a writable package.
  const [baseFacts, setBaseFacts] = React.useState<{
    for: string;
    basedOn: string | null;
    listedPair: string | null;
  } | null>(null);
  React.useEffect(() => {
    // objectui#11553 — the package-less scope has no package to look up; its
    // writability is decided below, not fetched.
    if (packageId === null) return;
    let cancelled = false;
    setPkgWritable(undefined);
    setPkgMissing(false);
    setBaseFacts(null);
    // Asked beside the entries read, so both share its one request. A failure
    // is reported once, by the entries read below.
    const listedIds = fetchListedPackageIds();
    listedIds.catch(() => {});
    const listedManifests = fetchListedPackageManifests();
    listedManifests.catch(() => {});
    const settle = (entry: PkgEntry | null) => {
      setPkgWritable(entry?.writable ?? null);
      setPkgEntry(entry);
      if (!entry || entry.writable) return;
      listedManifests.then(
        (manifests) => {
          if (cancelled) return;
          setBaseFacts({
            for: packageId,
            basedOn: listedPackageVersion(manifests, packageId),
            listedPair: listedCustomizationPairOf(manifests, packageId),
          });
        },
        () => {},
      );
    };
    fetchPackages()
      .then((list) => {
        if (cancelled) return;
        const entry = list.find((p) => p.id === packageId) ?? null;
        if (entry) {
          settle(entry);
          return;
        }
        // objectstack#29567 — the switcher's entries leave the kernel packages
        // out, but an open one is still judged: the listed row carries the
        // server's verdict (read-only by scope), so the surface reads it
        // read-only and offers Customize, as for a code-booted base.
        // `pkgWritable` stays "still asking" until that answer lands.
        listedManifests.then(
          (manifests) => {
            if (!cancelled) settle(listedPackageEntry(manifests, packageId));
          },
          () => {
            if (!cancelled) settle(null);
          },
        );
        listedIds.then(
          (ids) => {
            if (!cancelled) setPkgMissing(!ids.has(packageId));
          },
          () => {},
        );
      })
      .catch((e: unknown) => {
        // Staying ungated is still right — the server gate is the authority
        // and a failed probe must not lock the author out of their own
        // package. But "I could not find out" is not the same event as "still
        // asking", and until objectui#7368 neither one said anything at all.
        // Same toast id as the switcher: one outage, one toast.
        if (cancelled) return;
        setPkgWritable(null);
        toast.error(formatMetadataError(e), { id: PACKAGE_LIST_TOAST_ID });
      });
    return () => {
      cancelled = true;
    };
  }, [packageId]);
  // objectui#11553 — the package-less scope's flows are the organization's
  // own, so they open editable whatever the last package answered. The
  // server's write gate stays the authority, exactly as for a writable package.
  const readOnly = packageId !== null && pkgWritable === false;
  // objectstack#28562 — the base's pair: the ensure door's answer once this
  // surface has asked it, else the listed one. Pending, the changes panel and
  // Publish act on its drafts (`draftScope`); with no pair, on the base's own,
  // as before. ⛔ A write names the door's answer only (`ensurePair`).
  const [ensuredPair, setEnsuredPair] = React.useState<{ base: string; packageId: string } | null>(null);
  const baseRead = readOnly && baseFacts !== null && baseFacts.for === packageId ? baseFacts : null;
  const pairId =
    !readOnly || packageId === null
      ? null
      : ensuredPair?.base === packageId
        ? ensuredPair.packageId
        : (baseRead?.listedPair ?? null);
  const draftScope = pairId ?? packageId;
  // A read-only base with no pair has nothing of its own to publish.
  const publishReadOnly = readOnly && pairId === null;
  const customizeWalled = useCustomizeDoorWalled();
  const ensurePairPackage = React.useCallback(async (): Promise<EnsuredCustomizationPackage> => {
    if (packageId === null) throw new Error('No package is open.');
    const answer = await ensureCustomizationPackage(packageId);
    setEnsuredPair({ base: packageId, packageId: answer.packageId });
    return answer;
  }, [packageId]);
  const ensurePair = React.useCallback(async (): Promise<string> => (await ensurePairPackage()).packageId, [ensurePairPackage]);
  const baseLabel = pkgEntry?.id === packageId ? pkgEntry.name : (packageId ?? '');
  return {
    pkgWritable,
    pkgEntry,
    setPkgEntry,
    pkgMissing,
    readOnly,
    baseRead,
    pairId,
    draftScope,
    publishReadOnly,
    customizeWalled,
    ensurePairPackage,
    ensurePair,
    baseLabel,
  };
}

/** A read-only base's customization: its pair, its door and its served marks. */
export function useStudioBaseCustomization({
  baseRead,
  packageId,
  baseLabel,
  customizeWalled,
  pairId,
  ensurePair,
  ensurePairPackage,
}: {
  baseRead: StudioBaseFacts | null;
  packageId: string | null;
  baseLabel: string;
  customizeWalled: StudioBaseCustomization['walled'];
  pairId: string | null;
  ensurePair: () => Promise<string>;
  ensurePairPackage: () => Promise<EnsuredCustomizationPackage>;
}): StudioBaseCustomization | null {
  // objectstack#28572 (ADR-0146 D3) — the base's served customization read
  // (N-15), which every pillar rail marks its rows from; read again whenever
  // the served overrides may have moved. objectstack#30238 — that is the
  // metadata-refresh pulse, not `publishNonce`: a publish moves the nonce AND
  // announces itself on the bus, but "Restore package original" (every
  // pillar's, and the bundle item editor's) deletes the pair's row and only
  // announces, so a read keyed on the nonce left the rail's marks and the
  // "only customizations" count stale until a reload. Keyed on the pulse
  // alone, a publish reads once, not twice; a copilot publish is read too.
  const customizationsRefresh = useMetadataRefreshNonce();
  const baseCustomizations = usePackageCustomizations(
    baseRead && packageId !== null ? packageId : null,
    customizationsRefresh,
  );
  const customization = React.useMemo<StudioBaseCustomization | null>(
    () =>
      baseRead && packageId !== null
        ? {
            base: packageId,
            baseLabel,
            basedOn: baseRead.basedOn,
            walled: customizeWalled,
            pairId,
            ensure: ensurePair,
            ensurePackage: ensurePairPackage,
            marks: baseCustomizations,
          }
        : null,
    [baseRead, packageId, baseLabel, customizeWalled, pairId, ensurePair, ensurePairPackage, baseCustomizations],
  );
  return customization;
}

/** The package's app (published first, else a draft one) and its published apps. */
export function useStudioPackageApps(
  shellClient: MetadataClient,
  packageId: string | null,
  publishNonce: number,
  draftNonce: number,
) {
  // objectui#11181 — `label` is the app's own `I18nLabel` (a plain string or an
  // inline locale map), held as the spec types it and never `String()`ed: a map
  // would read `[object Object]`. Only the presence of `packageApp` is read
  // today; a reader of `label` resolves it in the designer locale at render,
  // through `navItemLabelText`, as the Interfaces rail heading does.
  const [packageApp, setPackageApp] = React.useState<{ name: string; label: I18nLabel; icon?: string; branding?: AppMarkApp['branding'] } | null>(null);
  // objectstack#36501 — the package's PUBLISHED apps, where the header's
  // 「‹ Back to app」 goes when the author did not come from an app: a draft
  // app has no running front-end to open. Read off the same list as
  // `packageApp`.
  const [publishedApps, setPublishedApps] = React.useState<readonly StudioAppTarget[]>([]);
  // objectstack#37456 — the top bar's 「create app」 button and its 「app waits
  // for a publish」 label went with the bar, and have no new home (ADR-0084,
  // amended 2026-11-26, `#amendment-2026-11-26-homes`, silent item 5).

  // objectui#5800, fixed in passing — the topbar's app detection used to
  // disagree with the Interfaces pillar's (published-only read, no draftNonce
  // dep, no refresh subscription, and never re-run on a pillar switch since
  // /data and /access share one route element): a deep-link to /access could
  // report "This package has no app yet." while /data showed the app at the
  // same moment. Same resolution as the pillar now: published first, DRAFT app
  // fallback, re-resolved on draft saves and on the metadata-refresh pulse.
  const resolvePackageApp = React.useCallback(async (): Promise<void> => {
    // objectui#11553 — no package, so no package app to resolve.
    if (packageId === null) {
      setPackageApp(null);
      setPublishedApps([]);
      return;
    }
    try {
      const apps = (await shellClient.list('app', { packageId })) as Array<Record<string, unknown>>;
      setPublishedApps(
        (apps || [])
          .filter((a) => a?.name)
          .map((a) => ({ name: String(a.name), label: (a.label ?? a.name) as I18nLabel })),
      );
      let first = (apps || [])
        .map((a) => ({
          name: String(a.name ?? ''),
          label: (a.label ?? a.name ?? '') as I18nLabel,
          // objectui#12459 — the chip in the shell header draws the app's own
          // tile (icon on its brand color), as Home's app tile and the app
          // switcher do through `AppMark`.
          icon: typeof a.icon === 'string' ? a.icon : undefined,
          branding: a.branding && typeof a.branding === 'object' ? (a.branding as AppMarkApp['branding']) : undefined,
        }))
        .filter((a) => a.name)[0];
      if (!first) {
        const drafts = await shellClient.listDrafts?.({ packageId, type: 'app' });
        const d = drafts?.[0] as { name?: unknown; label?: I18nLabel } | undefined;
        if (d?.name) first = { name: String(d.name), label: d.label ?? String(d.name), icon: undefined, branding: undefined };
      }
      setPackageApp(first ?? null);
    } catch {
      setPackageApp(null);
      setPublishedApps([]);
    }
  }, [shellClient, packageId]);
  React.useEffect(() => {
    void resolvePackageApp();
    return subscribeMetadataRefresh(() => {
      void resolvePackageApp();
    });
  }, [resolvePackageApp, publishNonce, draftNonce]);
  return { packageApp, publishedApps };
}

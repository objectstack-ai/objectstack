// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio landing's 「新建应用」 door (objectstack#36748): one confirm
 * creates the package AND its app, so the door the landing calls "New app"
 * ends with an app. It used to open the package form unchanged and stop at a
 * package; the author then had to find 「创建应用」 in the top bar, which saved
 * a draft that opened only after a package publish.
 *
 * Built from the two existing doors, nothing new on the server:
 *
 *   1. before anything is written, {@link NewAppStep.reserve} picks a free
 *      app name (the package's namespace, else `NAMESPACE_app`), read with
 *      the same {@link findTakenIdentifier} every Studio create reads, so a
 *      taken name refuses the whole confirm and writes nothing;
 *   2. the package is created by `PackageFormDialog`'s own `POST`;
 *   3. {@link NewAppStep.create} writes the app as the top bar's Create app
 *      does (a draft under the first-write pin), then publishes that one item
 *      (`publishSavedItem`, objectstack#36511): a human-created item is live
 *      at once, so the app opens as soon as the dialog closes. A refused
 *      publish takes back the draft it wrote.
 *
 * The app is the package's one app, so it is addressed by the package id
 * (ADR-0048 option A) and its navigation starts empty: the package has no
 * objects yet.
 */

import type { MetadataClient } from '@object-ui/data-objectstack';
import { findTakenIdentifier } from './StudioPillarKit.js';
import { buildAppSkeleton } from './skeletons.js';
import { publishSavedItem } from './studioSaveBar.js';
import { draftReceiptVersion } from '../metadata-admin/DraftConflictDialog.js';

/** What `reserve` answers: a free app name, or the app holding the first candidate. */
export type AppNameReservation = { name: string } | { taken: { name: string; label: string } };

/** The app half of the landing's 「新建应用」 door, handed to `PackageFormDialog`. */
export interface NewAppStep {
  /** A free app name for a package of `namespace`; reads only, writes nothing. */
  reserve(namespace: string): Promise<AppNameReservation>;
  /** Create the package's app under `name` and make it live. Throws on refusal. */
  create(packageId: string, name: string, label: string): Promise<void>;
}

/** The app names tried for a package of `namespace`, in order. */
export function appNameCandidates(namespace: string): string[] {
  const ns = namespace.trim();
  return ns ? [ns, `${ns}_app`] : [];
}

export function newAppStep(
  client: Pick<MetadataClient, 'list' | 'listDrafts' | 'save' | 'publish' | 'reset'>,
  locale: string,
): NewAppStep {
  return {
    async reserve(namespace) {
      let first: { name: string; label: string } | null = null;
      for (const name of appNameCandidates(namespace)) {
        const taken = await findTakenIdentifier(client, 'app', name, locale);
        if (!taken) return { name };
        first ??= taken;
      }
      return { taken: first ?? { name: namespace, label: namespace } };
    },
    async create(packageId, name, label) {
      // The first-write pin refuses a draft that landed since `reserve`.
      const receipt = await client.save('app', name, buildAppSkeleton(name, label), {
        mode: 'draft',
        packageId,
        ifNoneMatch: '*',
        surface: 'studio',
      });
      // objectstack#37440 — the publish is pinned to the draft this create wrote (its receipt).
      const live = await publishSavedItem(
        client,
        { type: 'app', name, packageId, draftVersion: draftReceiptVersion(receipt) },
        false,
      );
      if (!live.ok) throw live.error;
    },
  };
}

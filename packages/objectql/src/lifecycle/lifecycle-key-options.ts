// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { LifecycleClassSchema } from '@objectstack/spec/data';

/**
 * The key columns of the three `lifecycle` map settings (#30208), served from
 * the running system: the keys a `retention_overrides`, `quotas` or
 * `quota_defaults` row may name are what this deployment has, never a list
 * written in the manifest (ruling 6715997428, constraint 3).
 *
 * Each source has the shape of `@objectstack/service-settings`'
 * `SettingsOptionSource`, spelled structurally here so this package takes no
 * dependency on the settings service. The settings service registers them per
 * map key; both of its doors (a save, an `OS_LIFECYCLE_*` override) judge each
 * entry's key against the answer, and every manifest read serves the answer as
 * the map's `options`, the key picker's list.
 */

/** One option a source serves: the stored key and its name. */
export interface LifecycleKeyOption {
  value: string;
  label: string;
}

/** What a key source answers — `SettingsOptionSourceAnswer`'s shape. */
export interface LifecycleKeyAnswer {
  options: LifecycleKeyOption[];
  admits(value: string): boolean;
}

/** A key source — `SettingsOptionSource`'s shape. */
export type LifecycleKeySource = (input?: { current?: unknown; locale?: string }) => LifecycleKeyAnswer | undefined;

/** The registry surface the object source reads: the objects the sweep reads. */
export interface LifecycleKeyRegistryLike {
  getAllObjects(): Array<{ name: string; label?: unknown; lifecycle?: { class?: string } | null }>;
  getAllStorageObjects?(): Array<{ name: string; label?: unknown; lifecycle?: { class?: string } | null }>;
}

function answerOf(options: LifecycleKeyOption[]): LifecycleKeyAnswer {
  const values = new Set(options.map((o) => o.value));
  return { options, admits: (value) => values.has(value) };
}

/**
 * The objects a lifecycle map row may name: every object that declares a
 * lifecycle class other than `record`, which is exactly the set the sweep walks
 * (`LifecycleService.sweep`). An object outside it is never read under its
 * override or its quota, so naming it would be stored and silently do nothing.
 *
 * Asked at the moment it is used (each save, each override read, each page
 * read), so an object a package registers later is admitted from then on.
 * `undefined` while the registry is not reachable: the settings service then
 * falls back to the manifest's declared table, which declares none, so every
 * key is admitted rather than every save refused.
 */
export function lifecycleObjectKeySource(getRegistry: () => LifecycleKeyRegistryLike | undefined): LifecycleKeySource {
  return () => {
    const registry = getRegistry();
    if (!registry) return undefined;
    const objects = typeof registry.getAllStorageObjects === 'function'
      ? registry.getAllStorageObjects()
      : registry.getAllObjects();
    const options = objects
      .filter((o) => o?.lifecycle && o.lifecycle.class && o.lifecycle.class !== 'record')
      .map((o) => ({ value: o.name, label: typeof o.label === 'string' && o.label !== '' ? o.label : o.name }))
      .sort((a, b) => a.value.localeCompare(b.value));
    return answerOf(options);
  };
}

/**
 * The lifecycle classes a `quota_defaults` row may name: `LifecycleClassSchema`
 * without `record`. A `record` object is never swept (its data is business
 * truth, immortal by contract), so a `record` default is never read.
 */
export function lifecycleClassKeySource(): LifecycleKeySource {
  const options = LifecycleClassSchema.options
    .filter((c) => c !== 'record')
    .map((c) => ({ value: c, label: c }));
  return () => answerOf(options);
}

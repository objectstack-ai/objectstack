// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] The one classification of a package body's keys for an
 * `unmanaged` install (`unmanaged-install.ts`) — read by `defineStack`'s
 * authoring refusal and by the install door's import planner
 * (`@objectstack/metadata-protocol`).
 *
 * Held TOTAL here, beside the three schemas a package body is read with, so the
 * PR that adds a key to `ManifestSchema`, to the stack definition or to the
 * package export's fixed keys is the PR that reddens — not a later install that
 * refuses the key with no reason on record.
 */
import { describe, expect, it } from 'vitest';
import { ManifestSchema } from './manifest.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';
import { PackageExportManifestSchema } from '../api/package-lifecycle.zod';
import { PLURAL_TO_SINGULAR } from '../meta-spelling/manifest-collection-spelling';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../ui/assembled-views.zod';
import {
  UNMANAGED_INSTALL_KEY_DISPOSITIONS,
  UNMANAGED_INSTALL_REFUSING_DISPOSITIONS,
  unmanagedInstallValueCarries,
} from './unmanaged-install';

/** The collections — judged by their type's registry flag, never by this table. */
const collections = new Set([...Object.keys(PLURAL_TO_SINGULAR), ASSEMBLED_VIEW_ITEMS_KEY]);
/** A key retired with a tombstone (ADR-0049) is refused as unrecognised, never classified. */
const tombstoned = (schema: unknown) =>
  /^\[REMOVED\]/.test(String((schema as { description?: unknown } | undefined)?.description ?? ''));
const stackShape = (ObjectStackDefinitionSchema as unknown as { shape: Record<string, unknown> }).shape;
/** The export's FIXED keys — its open catch-all carries the collections, judged by the registry. */
const exportShape = PackageExportManifestSchema.shape;

describe('the unmanaged-install key classification is total against the three schemas a package body is read with', () => {
  it('classifies every live ManifestSchema key', () => {
    const missing = Object.entries(ManifestSchema.shape)
      .filter(([key, schema]) => !collections.has(key) && !tombstoned(schema) && !(key in UNMANAGED_INSTALL_KEY_DISPOSITIONS))
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  it('classifies every stack-definition key', () => {
    const missing = Object.keys(stackShape).filter((key) => !collections.has(key) && !(key in UNMANAGED_INSTALL_KEY_DISPOSITIONS));
    expect(missing).toEqual([]);
  });

  it('classifies every fixed key of the package export — the body an import elsewhere is handed', () => {
    const missing = Object.keys(exportShape).filter((key) => !(key in UNMANAGED_INSTALL_KEY_DISPOSITIONS));
    expect(missing).toEqual([]);
  });

  it('classifies nothing no schema declares — a stale row is a lie about a key', () => {
    const declared = new Set([...Object.keys(ManifestSchema.shape), ...Object.keys(stackShape), ...Object.keys(exportShape)]);
    expect(Object.keys(UNMANAGED_INSTALL_KEY_DISPOSITIONS).filter((key) => !declared.has(key))).toEqual([]);
  });

  it('classifies `installModes` as the door\'s — read to judge the requested mode, never written onto the base', () => {
    expect(UNMANAGED_INSTALL_KEY_DISPOSITIONS.installModes).toBe('door');
  });

  it('copies `translations` (converted), and leaves `data` to the door', () => {
    expect(UNMANAGED_INSTALL_KEY_DISPOSITIONS.translations).toBe('converted');
    expect(UNMANAGED_INSTALL_KEY_DISPOSITIONS.data).toBe('door');
  });

  it('leaves the export\'s `withheldMaps` and `label` to the door — an export is importable as written', () => {
    // `withheldMaps` (#28640 ruling ③A) is read by the door to name each incomplete map; the
    // export's `label` has no slot on the base's closed install manifest. Either one left
    // unclassified refuses every export that carries it as an unrecognised key.
    expect(UNMANAGED_INSTALL_KEY_DISPOSITIONS.withheldMaps).toBe('door');
    expect(UNMANAGED_INSTALL_KEY_DISPOSITIONS.label).toBe('door');
  });

  it('refuses exactly code, uncopyable content and an artifact envelope', () => {
    expect([...UNMANAGED_INSTALL_REFUSING_DISPOSITIONS].sort()).toEqual(['code', 'envelope', 'uncopyable']);
  });
});

describe('unmanagedInstallValueCarries — a refusal names content, never the spelling of a key', () => {
  it('reads an absent, null or empty value as carrying nothing', () => {
    for (const value of [undefined, null, [], {}, '']) {
      expect(unmanagedInstallValueCarries(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('reads a non-empty list, map or string, a function and a scalar as carrying something', () => {
    for (const value of [[{}], { fn: 'ref' }, 'hook', () => undefined, true, 0]) {
      expect(unmanagedInstallValueCarries(value), String(value)).toBe(true);
    }
  });
});

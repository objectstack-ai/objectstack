// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { useEffect, useState } from 'react';
import type { SuggestedBinding } from '../services/suggestedBindingsApi.js';
import { useMetadataClient } from '../views/metadata-admin/useMetadata.js';

/**
 * How a suggested audience binding (ADR-0090 D5) names its permission set to
 * a person: by the set's label (`ux-conventions.labels-over-machine-names`).
 *
 * A suggestion row carries only `permission_set_name`, so every mount of
 * `SuggestedBindingsPanel` supplies the sets it can read and draws the
 * prompt, the toasts and the state lines through this one function. A set
 * the mount did not read, or one with an empty label, is named by its machine
 * name.
 */
export interface PermissionSetLabelSource {
  name: string;
  label?: string;
}

export function suggestedSetLabel(
  s: Pick<SuggestedBinding, 'permission_set_name'>,
  sets: ReadonlyArray<PermissionSetLabelSource>,
): string {
  return sets.find((p) => p.name === s.permission_set_name)?.label || s.permission_set_name;
}

/**
 * The permission sets a package ships, as this runtime serves them, for a
 * mount that holds no list of its own. A suggestion names one of the
 * package's own sets (a set the package declares `isDefault`), so the read is
 * scoped to the package server-side, the same `client.list('permission',
 * { packageId })` the Studio Access rail makes.
 *
 * Read once per mount and per package, beside the panel's own read of the
 * suggestions: a mount drawn right after an install reads the sets the
 * install registered. A refused or failed read answers no sets, and every set
 * is then named by its machine name.
 */
export function usePackagePermissionSets(packageId: string): ReadonlyArray<PermissionSetLabelSource> {
  const client = useMetadataClient();
  const [sets, setSets] = useState<ReadonlyArray<PermissionSetLabelSource>>([]);
  // Keyed on the `packageId` primitive; the client is read through the
  // effect's closure, never as a dependency (ui/AGENTS.md #10).
  useEffect(() => {
    let cancelled = false;
    (client.list('permission', { packageId }) as Promise<Array<Record<string, unknown>> | null | undefined>)
      .then((rows) => {
        if (cancelled) return;
        const next: PermissionSetLabelSource[] = [];
        for (const row of rows ?? []) {
          const name = typeof row?.name === 'string' ? row.name : '';
          if (!name) continue;
          next.push({ name, label: typeof row.label === 'string' ? row.label : undefined });
        }
        setSets(next);
      })
      .catch(() => {
        /* refused or unavailable: every set is named by its machine name */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);
  return sets;
}

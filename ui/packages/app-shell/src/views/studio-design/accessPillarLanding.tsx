// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36905 — where an Access pillar address lands, with the reads
 * {@link accessPillarRedirect} needs for a set a base's `.custom` pair adds
 * (ADR-0146 D3): the retired pillar listed those on the base and opened them at
 * the pair, writable, so an old bookmark of one opens at the pair's address.
 *
 * Only an address that names a set of a package with a pair reads anything:
 * the base's and the pair's sets, published and draft, as the pillar listed
 * them. Every other address redirects at once.
 */

import * as React from 'react';
import { Navigate } from 'react-router-dom';
import { customizationPackageId } from '@objectstack/spec/kernel';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { accessPillarRedirect, accessPillarSetHolder, accessPillarSetName } from './accessPillarRedirect.js';

type MetadataClient = ReturnType<typeof useMetadataClient>;

/** The names of a package's permission sets, published and draft; `null` when the list read failed. */
async function permissionSetNames(client: MetadataClient, packageId: string): Promise<Set<string> | null> {
  try {
    const [list, drafts] = await Promise.all([
      client.list('permission', { packageId }) as Promise<Array<Record<string, unknown>>>,
      client.listDrafts({ packageId, type: 'permission' }).catch(() => []),
    ]);
    const names = new Set<string>();
    for (const p of list || []) names.add(String(p?.name ?? p?.id ?? ''));
    for (const d of (drafts as Array<{ name?: string }>) || []) names.add(String(d?.name ?? ''));
    names.delete('');
    return names;
  } catch {
    return null;
  }
}

export function AccessPillarLanding({
  packageId,
  search,
  state,
}: {
  packageId: string;
  /** The pillar address's query. */
  search: string;
  /** The router state the address arrived with, carried to where it lands. */
  state?: unknown;
}): React.ReactElement | null {
  const client = useMetadataClient();
  const name = accessPillarSetName(search);
  const pair = React.useMemo(() => {
    const derived = customizationPackageId(packageId);
    return derived.ok ? derived.value : null;
  }, [packageId]);
  // The package holding the set, once read; `null` while the reads are out.
  const [holder, setHolder] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (name === null || pair === null) return;
    let cancelled = false;
    void Promise.all([permissionSetNames(client, packageId), permissionSetNames(client, pair)]).then(
      ([baseSets, pairSets]) => {
        if (!cancelled) setHolder(accessPillarSetHolder(packageId, name, baseSets, { id: pair, sets: pairSets }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, packageId, pair, name]);
  if (name !== null && pair !== null && holder === null) return null;
  return <Navigate to={accessPillarRedirect(packageId, search, { setHeldIn: holder ?? packageId })} state={state} replace />;
}

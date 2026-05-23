// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useClient } from '@objectstack/client-react';
import { PluginHost } from '../plugins';
import { usePackages } from '../hooks/usePackages';
import { useSetInspectorTarget } from '@/hooks/useInspector';
import { useRecentItems } from '@/hooks/useRecentItems';
import { ResourceActionsMenu } from '@/components/ResourceActionsMenu';
import { iconForMetadataType, typeLabel } from '@/components/studio-nav';
import { pickLabel, pickDescription, humanizeName } from '@/lib/metadata-display';
import { Badge } from '@/components/ui/badge';

function MetadataViewComponent() {
  const { package: packageId, type, name } = Route.useParams();
  const { selectedPackage } = usePackages(packageId);
  const resolvedPkgId = selectedPackage?.manifest?.id ?? packageId;
  useSetInspectorTarget({ type, name, packageId: resolvedPkgId });
  const { record: recordRecent } = useRecentItems(resolvedPkgId);

  const client = useClient();
  const [item, setItem] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const it: any = await client.meta.getItem(
          type,
          name,
          resolvedPkgId ? { packageId: resolvedPkgId } : undefined,
        );
        if (cancelled) return;
        setItem(it);
        const label = pickLabel({ ...(it || {}), name }) || humanizeName(name) || name;
        recordRecent({ type, name, label });
      } catch {
        if (!cancelled) setItem(null);
      }
    })();
    return () => { cancelled = true; };
  }, [client, type, name, resolvedPkgId, recordRecent]);

  const label = item ? pickLabel({ ...item, name }) : humanizeName(name) || name;
  const description = item ? pickDescription(item, type) : undefined;
  const Icon = iconForMetadataType(type);

  // For views the metadata registry indexes items by the *bound object*
  // (e.g. `account`) but each item carries a more specific identifier
  // in `item.list.name` / `item.form.name` (e.g. `all_accounts`). When
  // they differ, prefer the specific id in the header chip and surface
  // the binding as a separate "on …" badge — otherwise the chip would
  // mislead the user into thinking they're looking at "the account
  // view" when really they're looking at "All Accounts".
  const specificName: string | undefined =
    (type === 'view'
      ? item?.list?.name || item?.form?.name || item?.spec?.name
      : item?.spec?.name) ?? undefined;
  const boundObject: string | undefined =
    type === 'view'
      ? item?.object ?? item?.data?.object ?? item?.list?.data?.object ?? item?.form?.data?.object
      : undefined;
  const displayId = specificName && specificName !== name ? specificName : name;
  const showBinding = Boolean(boundObject && boundObject !== displayId);
  // Hide the redundant machine-name chip when it'd just repeat the label
  // (e.g. labelless items where label was humanised from the same name).
  const showNameChip = label !== displayId;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b px-6 pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1
              className="flex items-center gap-2 text-xl font-semibold tracking-tight"
              title={label}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="truncate">{label}</span>
              {showNameChip && (
                <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {displayId}
                </code>
              )}
              <Badge variant="secondary" className="text-[10px]">
                {typeLabel(type)}
              </Badge>
              {showBinding && (
                <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                  on {boundObject}
                </Badge>
              )}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ResourceActionsMenu type={type} name={name} packageId={resolvedPkgId} />
          </div>
        </div>
      </div>
      <PluginHost metadataType={type} metadataName={name} packageId={resolvedPkgId} />
    </div>
  );
}

export const Route = createFileRoute('/$package/metadata/$type/$name')({
  component: MetadataViewComponent,
});

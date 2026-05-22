// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useClient } from '@objectstack/client-react';
import { PluginHost } from '../plugins';
import { usePackages } from '../hooks/usePackages';
import { useSetInspectorTarget } from '@/hooks/useInspector';
import { ResourceActionsMenu } from '@/components/ResourceActionsMenu';
import { navItemForType, typeLabel } from '@/components/studio-nav';
import { Badge } from '@/components/ui/badge';

function resolveLabel(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'defaultValue' in val) return String((val as any).defaultValue);
  if (val && typeof val === 'object' && 'key' in val) return String((val as any).key);
  return '';
}

function MetadataViewComponent() {
  const { package: packageId, type, name } = Route.useParams();
  const { selectedPackage } = usePackages(packageId);
  const resolvedPkgId = selectedPackage?.manifest?.id ?? packageId;
  useSetInspectorTarget({ type, name, packageId: resolvedPkgId });

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
        if (!cancelled) setItem(it);
      } catch {
        if (!cancelled) setItem(null);
      }
    })();
    return () => { cancelled = true; };
  }, [client, type, name, resolvedPkgId]);

  const label = resolveLabel(item?.label) || name;
  const description = resolveLabel(item?.description);
  const Icon = navItemForType(type)?.icon;

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
              <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {name}
              </code>
              <Badge variant="secondary" className="text-[10px]">
                {typeLabel(type)}
              </Badge>
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

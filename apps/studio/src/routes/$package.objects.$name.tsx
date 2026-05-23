// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Object Hub — Salesforce-style "everything about this object" page.
 *
 * Two tabs:
 *   • Designer — embeds PluginHost (schema / data / api modes).
 *   • Related  — master-detail browser surfacing every metadata item
 *                (views, forms, hooks, flows, approvals, dashboards,
 *                agents, …) that references this object.
 */

import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useClient } from '@objectstack/client-react';
import { PluginHost } from '../plugins';
import { ObjectRelatedPanel } from '@/components/object-related/ObjectRelatedPanel';
import { ResourceActionsMenu } from '@/components/ResourceActionsMenu';
import { useSetInspectorTarget } from '@/hooks/useInspector';
import { usePackages } from '@/hooks/usePackages';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Database, Layers, Code2, Columns3, Hash } from 'lucide-react';
import { RELATED_TYPES, itemReferencesObject } from '@/components/object-related/detector';

function resolveLabel(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'defaultValue' in val) return String((val as any).defaultValue);
  return '';
}

function ObjectHubComponent() {
  const { package: packageId, name } = Route.useParams();
  const client = useClient();
  const { selectedPackage } = usePackages(packageId);
  const resolvedPackageId = selectedPackage?.manifest?.id ?? packageId;
  const { version: hmrVersion } = useMetadataHmr();
  const [tab, setTab] = useState<string>('designer');
  const [object, setObject] = useState<any>(null);
  const [relatedCount, setRelatedCount] = useState<number | null>(null);
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const [recordCountIsLowerBound, setRecordCountIsLowerBound] = useState(false);

  useSetInspectorTarget({ type: 'object', name, packageId: resolvedPackageId });

  useEffect(() => {
    let cancelled = false;
    client.meta
      .getItem('object', name)
      .then((obj: any) => { if (!cancelled) setObject(obj?.spec ?? obj ?? null); })
      .catch(() => { if (!cancelled) setObject(null); });
    return () => { cancelled = true; };
  }, [client, name, hmrVersion]);

  // Background: tally related-metadata items + live record count for the header chips.
  useEffect(() => {
    let cancelled = false;
    setRelatedCount(null);
    setRecordCount(null);
    setRecordCountIsLowerBound(false);
    async function loadStats() {
      let related = 0;
      await Promise.all(
        RELATED_TYPES.map(async ({ type }) => {
          try {
            const r: any = await client.meta.getItems(type, { packageId: resolvedPackageId });
            const arr = r?.items || (Array.isArray(r) ? r : []);
            for (const raw of arr) {
              if (itemReferencesObject(type, raw, name)) related += 1;
            }
          } catch { /* type not enabled — skip */ }
        }),
      );
      if (!cancelled) setRelatedCount(related);
      try {
        // Best-effort record count for the header chip. We ask for a generous
        // page (no top hint) and use server-reported `total` when available,
        // otherwise fall back to `records.length` with a "+" hint when the
        // response indicates more records exist.
        const r: any = await (client as any).data.find(name, {});
        if (!cancelled) {
          if (typeof r?.total === 'number') {
            setRecordCount(r.total);
          } else if (Array.isArray(r?.records)) {
            setRecordCount(r.records.length);
            if (r.hasMore) setRecordCountIsLowerBound(true);
          }
        }
      } catch { /* count is best-effort */ }
    }
    loadStats();
    return () => { cancelled = true; };
  }, [client, name, resolvedPackageId, hmrVersion]);

  const objectLabel = useMemo(() => resolveLabel(object?.label) || name, [object, name]);
  const fieldCount = useMemo(() => {
    const f = object?.fields;
    if (Array.isArray(f)) return f.length;
    if (f && typeof f === 'object') return Object.keys(f).length;
    return null;
  }, [object]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col overflow-hidden">
        <div className="border-b px-6 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <Database className="h-4 w-4 text-muted-foreground" />
                {objectLabel}
                <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {name}
                </code>
              </h1>
              {object?.description && (
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{object.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {fieldCount !== null && (
                  <span className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5">
                    <Columns3 className="h-3 w-3" />
                    <span className="font-medium tabular-nums text-foreground">{fieldCount}</span>
                    <span>field{fieldCount === 1 ? '' : 's'}</span>
                  </span>
                )}
                {relatedCount !== null && relatedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setTab('related')}
                    className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 transition hover:border-primary/40 hover:text-foreground"
                  >
                    <Layers className="h-3 w-3" />
                    <span className="font-medium tabular-nums text-foreground">{relatedCount}</span>
                    <span>related</span>
                  </button>
                )}
                {recordCount !== null && (
                  <span className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5">
                    <Hash className="h-3 w-3" />
                    <span className="font-medium tabular-nums text-foreground">
                      {recordCount.toLocaleString()}{recordCountIsLowerBound ? '+' : ''}
                    </span>
                    <span>record{recordCount === 1 ? '' : 's'}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/$package/metadata/$type/$name"
                  params={{ package: packageId, type: 'object', name }}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  <span className="ml-1.5">View source</span>
                </Link>
              </Button>
              <ResourceActionsMenu type="object" name={name} packageId={packageId} />
            </div>
          </div>
          <TabsList className="mt-3">
            <TabsTrigger value="designer" className="gap-1.5">
              <Database className="h-3.5 w-3.5" /> Designer
            </TabsTrigger>
            <TabsTrigger value="related" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Related
              {relatedCount !== null && relatedCount > 0 && (
                <span className="ml-1 rounded-sm bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {relatedCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="designer" className="m-0 h-full overflow-hidden">
            <PluginHost metadataType="object" metadataName={name} packageId={packageId} />
          </TabsContent>
          <TabsContent value="related" className="m-0 h-full overflow-hidden">
            <ObjectRelatedPanel packageId={resolvedPackageId} objectName={name} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export const Route = createFileRoute('/$package/objects/$name')({
  component: ObjectHubComponent,
});

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
import { createFileRoute } from '@tanstack/react-router';
import { useClient } from '@objectstack/client-react';
import { PluginHost } from '../plugins';
import { ObjectRelatedPanel } from '@/components/object-related/ObjectRelatedPanel';
import { ResourceActionsMenu } from '@/components/ResourceActionsMenu';
import { useSetInspectorTarget } from '@/hooks/useInspector';
import { usePackages } from '@/hooks/usePackages';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';
import { useRecentItems } from '@/hooks/useRecentItems';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Database, Layers, Columns3, Hash, ArrowRight, Sparkles, X } from 'lucide-react';
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
  // Sessions-scoped: once the user dismisses or visits the Related tab,
  // stop nagging them with the discovery callout in the Designer view.
  const [relatedNudgeDismissed, setRelatedNudgeDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(`studio:object-related-nudge:${name}`) === '1';
  });
  const dismissRelatedNudge = () => {
    setRelatedNudgeDismissed(true);
    try { sessionStorage.setItem(`studio:object-related-nudge:${name}`, '1'); } catch {}
  };
  const [object, setObject] = useState<any>(null);
  const [relatedCount, setRelatedCount] = useState<number | null>(null);
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const [recordCountIsLowerBound, setRecordCountIsLowerBound] = useState(false);

  useSetInspectorTarget({ type: 'object', name, packageId: resolvedPackageId });
  const { record: recordRecent } = useRecentItems(resolvedPackageId);

  useEffect(() => {
    let cancelled = false;
    client.meta
      .getItem('object', name)
      .then((obj: any) => {
        if (cancelled) return;
        const spec = obj?.spec ?? obj ?? null;
        setObject(spec);
        // Record the visit in the recent-items MRU so the home page
        // surface it. We only have a useful label after the spec loads.
        const label = resolveLabel(spec?.label) || spec?.name || name;
        recordRecent({ type: 'object', name, label });
      })
      .catch(() => { if (!cancelled) setObject(null); });
    return () => { cancelled = true; };
  }, [client, name, hmrVersion, recordRecent]);

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
      <Tabs value={tab} onValueChange={(v) => { setTab(v); if (v === 'related') dismissRelatedNudge(); }} className="flex h-full flex-col overflow-hidden">
        <div className="border-b">
          {/* Title row */}
          <div className="px-6 pt-3 pb-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Database className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 items-baseline gap-2">
                  <h1 className="truncate text-lg font-semibold tracking-tight" title={object?.description || undefined}>
                    {objectLabel}
                  </h1>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {name}
                  </code>
                </div>
                <div className="hidden items-center gap-3 text-[11px] text-muted-foreground lg:flex">
                  {fieldCount !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Columns3 className="h-3 w-3" />
                      <span className="font-medium tabular-nums text-foreground">{fieldCount}</span>
                      <span>fields</span>
                    </span>
                  )}
                  {recordCount !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Hash className="h-3 w-3" />
                      <span className="font-medium tabular-nums text-foreground">
                        {recordCount.toLocaleString()}{recordCountIsLowerBound ? '+' : ''}
                      </span>
                      <span>records</span>
                    </span>
                  )}
                </div>
              </div>
              <ResourceActionsMenu type="object" name={name} packageId={packageId} />
            </div>
          </div>

          {/* Primary tab strip — bottom-border style, visually dominant */}
          <div className="px-6">
            <TabsList className="h-auto rounded-none border-0 bg-transparent p-0">
              <TabsTrigger
                value="designer"
                className="relative h-9 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-4 text-sm font-medium text-muted-foreground transition data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Database className="h-4 w-4" />
                Designer
              </TabsTrigger>
              <TabsTrigger
                value="related"
                className="relative h-9 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-4 text-sm font-medium text-muted-foreground transition data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Layers className="h-4 w-4" />
                Related
                {relatedCount !== null && relatedCount > 0 && (
                  <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground">
                    {relatedCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="designer" className="m-0 flex h-full flex-col overflow-hidden">
            {/* Discovery callout — gently nudges users toward Related when items exist */}
            {tab === 'designer' && relatedCount !== null && relatedCount > 0 && !relatedNudgeDismissed && (
              <div className="flex items-center gap-3 border-b bg-primary/5 px-6 py-2 text-xs">
                <Sparkles className="h-4 w-4 flex-shrink-0 text-primary" />
                <span className="flex-1 text-foreground/80">
                  <span className="font-medium text-foreground">{relatedCount} item{relatedCount === 1 ? '' : 's'}</span>{' '}
                  reference this object —
                  view its forms, dashboards, hooks, flows and more.
                </span>
                <button
                  type="button"
                  onClick={() => setTab('related')}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90"
                >
                  View Related
                  <ArrowRight className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={dismissRelatedNudge}
                  className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Dismiss"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <PluginHost metadataType="object" metadataName={name} packageId={packageId} />
            </div>
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

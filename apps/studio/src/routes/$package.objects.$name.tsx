// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Object Hub — Salesforce-style "everything about this object" page.
 *
 * Tabs:
 *   • Schema      — embeds PluginHost for the canonical metadata viewer
 *                   (preview / design / code modes).
 *   • Data        — ObjectDataTable for live records.
 *   • Views       — FormViews + non-form views bound to this object.
 *   • Forms       — FormViews for this object (public + internal).
 *   • Hooks       — hook/trigger metadata referencing this object.
 *   • Permissions — Coming soon: profile / sharing rule cross-reference.
 *
 * The tab strip is the *only* nesting we add — each tab's body is a
 * single existing component (no fancy panel layout), so each one stays
 * easy to maintain.
 */

import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useClient } from '@objectstack/client-react';
import { PluginHost } from '../plugins';
import { MetadataPreview } from '@/components/MetadataPreview';
import { ResourceActionsMenu } from '@/components/ResourceActionsMenu';
import { useSetInspectorTarget } from '@/hooks/useInspector';
import { usePackages } from '@/hooks/usePackages';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Database,
  Eye,
  FormInput,
  Workflow,
  Shield,
  ExternalLink,
  Code2,
} from 'lucide-react';

interface FilteredItem {
  name: string;
  label?: string;
  spec: any;
  type: string;
}

function resolveLabel(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'defaultValue' in val) return String((val as any).defaultValue);
  return '';
}

function ObjectHubComponent() {
  const { package: packageId, name } = Route.useParams();
  const client = useClient();
  const navigate = useNavigate();
  const { selectedPackage } = usePackages(packageId);
  // Resolve URL slug → full package id ("crm" → "com.example.crm"); fall back
  // to the raw slug if package list hasn't loaded yet.
  const resolvedPackageId = selectedPackage?.manifest?.id ?? packageId;
  const { version: hmrVersion } = useMetadataHmr();
  const [tab, setTab] = useState<string>('designer');

  // Surface this object to the Inspector drawer.
  useSetInspectorTarget({ type: 'object', name, packageId: resolvedPackageId });

  const [views, setViews] = useState<FilteredItem[]>([]);
  const [forms, setForms] = useState<FilteredItem[]>([]);
  const [hooks, setHooks] = useState<FilteredItem[]>([]);
  const [object, setObject] = useState<any>(null);
  const [previewItem, setPreviewItem] = useState<FilteredItem | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const obj: any = await client.meta.getItem('object', name).catch(() => null);
        setObject(obj?.spec ?? obj ?? null);
      } catch {
        /* ignore */
      }
      try {
        const r = await client.meta.getItems('view', { packageId: resolvedPackageId });
        const items = r?.items || (Array.isArray(r) ? r : []);
        // Multi-view docs expose nested list/form/listViews with their own
        // data.object reference; the object on the doc spec is the *primary*
        // bound object. Match on any sub-view's object as well.
        const getDocObject = (it: any): string | undefined =>
          it?.spec?.object ??
          it?.spec?.spec?.object ??
          it?.spec?.list?.data?.object ??
          it?.spec?.form?.data?.object ??
          it?.spec?.data?.object;
        const mine = items
          .map((it: any) => ({
            name: it.name,
            label: resolveLabel(it.label) || it.spec?.label,
            spec: it.spec ?? it,
            type: 'view',
          }))
          .filter((it: FilteredItem) => getDocObject(it) === name);
        const isForm = (s: any) =>
          !!(s?.sections || s?.groups || s?.form || s?.type === 'simple' || s?.type === 'tabbed' || s?.type === 'wizard' || s?.viewType === 'form');
        const isView = (s: any) =>
          !!(s?.list || s?.listViews || (s?.type && ['grid', 'kanban', 'calendar', 'gantt', 'list', 'table'].includes(s?.type)) || s?.viewType === 'list' || s?.viewType === 'kanban');
        setForms(mine.filter((it: FilteredItem) => isForm(it.spec)));
        setViews(mine.filter((it: FilteredItem) => isView(it.spec) || !isForm(it.spec)));
      } catch {
        setViews([]);
        setForms([]);
      }
      try {
        const r = await client.meta.getItems('hook', { packageId: resolvedPackageId }).catch(() => null);
        const items = r?.items || (Array.isArray(r) ? r : []);
        const mine = items
          .map((it: any) => ({
            name: it.name,
            label: resolveLabel(it.label) || it.spec?.label,
            spec: it.spec ?? it,
            type: 'hook',
          }))
          .filter((it: FilteredItem) => (it.spec?.object ?? it.spec?.target) === name);
        setHooks(mine);
      } catch {
        setHooks([]);
      }
    }
    load();
  }, [client, name, packageId, resolvedPackageId, hmrVersion]);

  const objectLabel = useMemo(() => resolveLabel(object?.label) || name, [object, name]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
        <Tabs value={tab} onValueChange={setTab} className="mt-3">
          <TabsList>
            <TabsTrigger value="designer" className="gap-1.5">
              <Database className="h-3.5 w-3.5" /> Designer
            </TabsTrigger>
            <TabsTrigger value="views" className="gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Views ({views.length})
            </TabsTrigger>
            <TabsTrigger value="forms" className="gap-1.5">
              <FormInput className="h-3.5 w-3.5" /> Forms ({forms.length})
            </TabsTrigger>
            <TabsTrigger value="hooks" className="gap-1.5">
              <Workflow className="h-3.5 w-3.5" /> Hooks ({hooks.length})
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Permissions
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs value={tab} className="h-full">
          <TabsContent value="designer" className="m-0 h-full overflow-hidden">
            {/* The embedded object-designer plugin owns Schema / Data / API
                sub-tabs — we surface it as a single "Designer" canvas to
                avoid duplicate tab rows. */}
            <PluginHost metadataType="object" metadataName={name} packageId={packageId} />
          </TabsContent>
          <TabsContent value="views" className="m-0 h-full overflow-auto p-6">
            <RelatedList
              items={views}
              empty="No views bound to this object yet."
              onOpen={(n) => navigate({ to: `/${packageId}/metadata/view/${n}` })}
              extraActions={(it) => (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewItem(it);
                  }}
                >
                  <Eye className="h-3 w-3" /> Preview
                </Button>
              )}
            />
          </TabsContent>
          <TabsContent value="forms" className="m-0 h-full overflow-auto p-6">
            <RelatedList
              items={forms}
              empty="No forms bound to this object yet."
              onOpen={(n) => navigate({ to: `/${packageId}/metadata/view/${n}` })}
              extraActions={(it) => {
                const slug = it.spec?.sharing?.publicLink?.replace(/^\/+forms\//, '');
                const isPublic = !!(slug && it.spec?.sharing?.allowAnonymous);
                const url = isPublic ? `${window.location.origin}/console/f/${slug}` : null;
                return (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewItem(it);
                      }}
                    >
                      <Eye className="h-3 w-3" /> Preview
                    </Button>
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                );
              }}
            />
          </TabsContent>
          <TabsContent value="hooks" className="m-0 h-full overflow-auto p-6">
            <RelatedList
              items={hooks}
              empty="No hooks reference this object."
              onOpen={(n) => navigate({ to: `/${packageId}/metadata/hook/${n}` })}
            />
          </TabsContent>
          <TabsContent value="permissions" className="m-0 h-full overflow-auto p-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Permission matrix</CardTitle>
                <CardDescription>
                  Cross-reference of profiles × CRUD against this object. Coming soon.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  Awaiting permission-evaluation API.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!previewItem} onOpenChange={(o) => !o && setPreviewItem(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewItem?.label ?? previewItem?.name}</DialogTitle>
            <DialogDescription>
              Live preview rendered with @object-ui against the configured backend.
            </DialogDescription>
          </DialogHeader>
          {previewItem && (
            <div className="h-[70vh] overflow-hidden">
              <MetadataPreview
                type="view"
                name={previewItem.name}
                spec={previewItem.spec}
                objectName={name}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface RelatedListProps {
  items: FilteredItem[];
  empty: string;
  onOpen: (name: string) => void;
  extraActions?: (item: FilteredItem) => React.ReactNode;
}

function RelatedList({ items, empty, onOpen, extraActions }: RelatedListProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => (
        <Card
          key={it.name}
          className="cursor-pointer transition hover:border-primary hover:shadow-sm"
          onClick={() => onOpen(it.name)}
        >
          <CardContent className="flex flex-col gap-1.5 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{it.label ?? it.name}</span>
              <Badge variant="secondary" className="text-[10px]">{it.type}</Badge>
            </div>
            <code className="truncate text-xs text-muted-foreground">{it.name}</code>
            {extraActions?.(it)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export const Route = createFileRoute('/$package/objects/$name')({
  component: ObjectHubComponent,
});

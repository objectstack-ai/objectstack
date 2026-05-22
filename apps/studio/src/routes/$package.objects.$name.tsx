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
import { FormPreview } from '@/components/FormPreview';
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
  Table2,
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
  const [tab, setTab] = useState<string>('schema');

  const [views, setViews] = useState<FilteredItem[]>([]);
  const [forms, setForms] = useState<FilteredItem[]>([]);
  const [hooks, setHooks] = useState<FilteredItem[]>([]);
  const [object, setObject] = useState<any>(null);
  const [previewForm, setPreviewForm] = useState<FilteredItem | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const obj: any = await client.meta.getItem('object', name).catch(() => null);
        setObject(obj?.spec ?? obj ?? null);
      } catch {
        /* ignore */
      }
      try {
        const r = await client.meta.getItems('view', { packageId });
        const items = r?.items || (Array.isArray(r) ? r : []);
        const mine = items
          .map((it: any) => ({
            name: it.name,
            label: resolveLabel(it.label) || it.spec?.label,
            spec: it.spec ?? it,
            type: 'view',
          }))
          .filter((it: FilteredItem) => (it.spec?.object ?? it.spec?.spec?.object) === name);
        const isForm = (s: any) =>
          !!(s?.sections || s?.groups || s?.type === 'simple' || s?.type === 'tabbed' || s?.type === 'wizard' || s?.viewType === 'form');
        setForms(mine.filter((it: FilteredItem) => isForm(it.spec)));
        setViews(mine.filter((it: FilteredItem) => !isForm(it.spec)));
      } catch {
        setViews([]);
        setForms([]);
      }
      try {
        const r = await client.meta.getItems('hook', { packageId }).catch(() => null);
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
  }, [client, name, packageId]);

  const objectLabel = useMemo(() => resolveLabel(object?.label) || name, [object, name]);
  const fieldCount = useMemo(() => (object?.fields ? Object.keys(object.fields).length : 0), [object]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Object</div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Database className="h-5 w-5 text-muted-foreground" />
              {objectLabel}
              <code className="ml-2 rounded bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
                {name}
              </code>
            </h1>
            {object?.description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{object.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">{fieldCount} fields</Badge>
              <Badge variant="secondary">{views.length} views</Badge>
              <Badge variant="secondary">{forms.length} forms</Badge>
              <Badge variant="secondary">{hooks.length} hooks</Badge>
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
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="mt-3">
          <TabsList>
            <TabsTrigger value="schema" className="gap-1.5">
              <Database className="h-3.5 w-3.5" /> Schema
            </TabsTrigger>
            <TabsTrigger value="data" className="gap-1.5">
              <Table2 className="h-3.5 w-3.5" /> Data
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
          <TabsContent value="schema" className="m-0 h-full overflow-hidden">
            <PluginHost metadataType="object" metadataName={name} packageId={packageId} />
          </TabsContent>
          <TabsContent value="data" className="m-0 h-full overflow-auto">
            <PluginHost metadataType="object" metadataName={name} packageId={packageId} />
            {/* Note: PluginHost has a built-in "Data" mode that uses ObjectDataTable. */}
          </TabsContent>
          <TabsContent value="views" className="m-0 h-full overflow-auto p-6">
            <RelatedList
              items={views}
              empty="No views bound to this object yet."
              onOpen={(n) => navigate({ to: `/${packageId}/metadata/view/${n}` })}
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
                        setPreviewForm(it);
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

      <Dialog open={!!previewForm} onOpenChange={(o) => !o && setPreviewForm(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewForm?.label ?? previewForm?.name}</DialogTitle>
            <DialogDescription>
              Read-only preview rendered from the FormView spec.
            </DialogDescription>
          </DialogHeader>
          {previewForm && (
            <div className="max-h-[70vh] overflow-y-auto">
              <FormPreview
                spec={previewForm.spec}
                objectSchema={object}
                showBadge={false}
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

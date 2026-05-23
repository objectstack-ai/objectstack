// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectRelatedPanel — master-detail browser for every metadata item
 * that references a given object.
 *
 * Left sidebar lists Views / Forms / Dashboards / Hooks / Flows /
 * Approvals / Agents / Tools / etc grouped by domain. Right pane
 * inline-renders MetadataPreview for previewable types, or a quick
 * spec card with a "Open" link for the rest.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useClient } from '@objectstack/client-react';
import { MetadataPreview } from '@/components/MetadataPreview';
import { CreateMetadataDialog } from '@/components/CreateMetadataDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';
import {
  Eye, FormInput, Workflow, Bell, BarChart3, FileText, Bot, Wrench, Mail,
  Shield, Zap, ListChecks, GitBranch, ExternalLink, Search, Code2, Copy, Check,
  Plus,
} from 'lucide-react';
import { RELATED_TYPES, itemReferencesObject, isFormView, type RelatedDomain } from './detector';

interface RelatedItem {
  type: string;       // metadata type (view, flow, …)
  bucket: string;     // display bucket (view, form, dashboard, …) — splits form/view
  name: string;
  label: string;
  spec: any;
}

interface ObjectRelatedPanelProps {
  packageId: string;
  objectName: string;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  view: Eye, form: FormInput, dashboard: BarChart3, report: FileText,
  action: Zap, hook: Workflow, trigger: Bell, validation: ListChecks,
  flow: GitBranch, workflow: GitBranch, approval: Shield,
  email_template: Mail, agent: Bot, tool: Wrench,
};

const DOMAIN_ORDER: RelatedDomain[] = ['ui', 'data', 'automation', 'ai', 'system', 'security'];
const DOMAIN_LABEL: Record<RelatedDomain, string> = {
  ui: 'Interface', data: 'Data', automation: 'Automation',
  ai: 'AI', system: 'System', security: 'Security',
};

function resolveLabel(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'defaultValue' in val) return String((val as any).defaultValue);
  return '';
}

export function ObjectRelatedPanel({ packageId, objectName }: ObjectRelatedPanelProps) {
  const client = useClient();
  const { version: hmrVersion } = useMetadataHmr();
  const [items, setItems] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Metadata types that meaningfully reference an object — used to
  // filter the Create dialog's type picker. Anything beyond this set
  // doesn't have a notion of objectName.
  const CREATABLE_TYPES = useMemo(
    () => ['view', 'dashboard', 'report', 'hook', 'approval', 'flow', 'app'],
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const out: RelatedItem[] = [];
      await Promise.all(
        RELATED_TYPES.map(async ({ type }) => {
          try {
            const r: any = await client.meta.getItems(type, { packageId });
            const arr = r?.items || (Array.isArray(r) ? r : []);
            for (const raw of arr) {
              if (!itemReferencesObject(type, raw, objectName)) continue;
              const spec = raw.spec ?? raw;
              const bucket = type === 'view' && isFormView(spec) ? 'form' : type;
              out.push({
                type,
                bucket,
                name: raw.name,
                label: resolveLabel(raw.label) || resolveLabel(spec?.label) || raw.name,
                spec,
              });
            }
          } catch { /* type may not be enabled — skip silently */ }
        }),
      );
      if (!cancelled) {
        out.sort((a, b) => a.label.localeCompare(b.label));
        setItems(out);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [client, packageId, objectName, hmrVersion]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      it.name.toLowerCase().includes(q) || it.label.toLowerCase().includes(q),
    );
  }, [items, filter]);

  const grouped = useMemo(() => {
    const map = new Map<RelatedDomain, Map<string, RelatedItem[]>>();
    for (const it of filtered) {
      const cfg = RELATED_TYPES.find((t) => t.type === it.type);
      const domain: RelatedDomain = cfg?.domain ?? 'system';
      if (!map.has(domain)) map.set(domain, new Map());
      const bucketMap = map.get(domain)!;
      const key = it.bucket;
      if (!bucketMap.has(key)) bucketMap.set(key, []);
      bucketMap.get(key)!.push(it);
    }
    return map;
  }, [filtered]);

  // Default selection: first item in the first non-empty group.
  useEffect(() => {
    if (selected && filtered.some((it) => `${it.type}:${it.name}` === selected)) return;
    if (filtered.length > 0) setSelected(`${filtered[0].type}:${filtered[0].name}`);
    else setSelected(null);
  }, [filtered, selected]);

  const active = useMemo(
    () => filtered.find((it) => `${it.type}:${it.name}` === selected) ?? null,
    [filtered, selected],
  );

  const bucketLabel = (bucket: string): string => {
    if (bucket === 'form') return 'Forms';
    return RELATED_TYPES.find((t) => t.type === bucket)?.label ?? bucket;
  };
  const bucketIcon = (bucket: string) => ICONS[bucket] ?? FileText;

  return (
    <>
      <div className="flex h-full overflow-hidden">
      <aside className="flex w-72 flex-shrink-0 flex-col border-r bg-muted/20">
        <div className="border-b p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Related
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
              className="h-6 gap-1 px-2 text-[11px]"
              title={`Create new metadata that references ${objectName}`}
            >
              <Plus className="h-3 w-3" />
              New
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter related…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {loading ? 'Scanning metadata…' : `${items.length} item${items.length === 1 ? '' : 's'} reference this object`}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {DOMAIN_ORDER.map((domain) => {
              const buckets = grouped.get(domain);
              if (!buckets || buckets.size === 0) return null;
              return (
                <div key={domain} className="mb-3">
                  <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {DOMAIN_LABEL[domain]}
                  </div>
                  {Array.from(buckets.entries()).map(([bucket, list]) => {
                    const Icon = bucketIcon(bucket);
                    return (
                      <div key={bucket} className="mb-2">
                        <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                          <Icon className="h-3 w-3" />
                          <span>{bucketLabel(bucket)}</span>
                          <Badge variant="secondary" className="ml-auto h-4 px-1 text-[10px]">{list.length}</Badge>
                        </div>
                        <ul>
                          {list.map((it) => {
                            const key = `${it.type}:${it.name}`;
                            const isActive = key === selected;
                            return (
                              <li key={key}>
                                <button
                                  type="button"
                                  onClick={() => setSelected(key)}
                                  className={`group relative flex w-full flex-col gap-0.5 rounded-md py-1.5 pl-3 pr-2 text-left text-xs transition focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                                    isActive
                                      ? 'bg-primary/10 text-primary'
                                      : 'hover:bg-muted-foreground/10'
                                  }`}
                                >
                                  {isActive && (
                                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary" />
                                  )}
                                  <span className="truncate font-medium">{it.label}</span>
                                  {it.label !== it.name && (
                                    <code className="truncate text-[10px] text-muted-foreground">{it.name}</code>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {!loading && items.length === 0 && (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                <p>Nothing references <code>{objectName}</code> yet.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCreateOpen(true)}
                  className="mt-3 h-7 gap-1 text-[11px]"
                >
                  <Plus className="h-3 w-3" />
                  Create the first one
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {active ? (
          <RelatedDetail packageId={packageId} objectName={objectName} item={active} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            Select an item to preview.
          </div>
        )}
      </main>
    </div>
    <CreateMetadataDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      types={CREATABLE_TYPES}
      packageId={packageId}
      prefillObjectName={objectName}
    />
    </>
  );
}

interface RelatedDetailProps {
  packageId: string;
  objectName: string;
  item: RelatedItem;
}

function RelatedDetail({ packageId, objectName, item }: RelatedDetailProps) {
  const cfg = RELATED_TYPES.find((t) => t.type === item.type);
  const previewable = !!cfg?.previewable;
  const Icon = ICONS[item.bucket] ?? FileText;
  return (
    <>
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{item.label}</h2>
            <Badge variant="outline" className="text-[10px]">{item.bucket}</Badge>
          </div>
          <code className="text-[11px] text-muted-foreground">{item.name}</code>
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link
            to="/$package/metadata/$type/$name"
            params={{ package: packageId, type: item.type, name: item.name }}
          >
            <Code2 className="h-3.5 w-3.5" />
            Open editor
            <ExternalLink className="ml-0.5 h-3 w-3" />
          </Link>
        </Button>
      </header>
      <div className="flex-1 overflow-hidden">
        {previewable ? (
          <div className="h-full overflow-hidden">
            <MetadataPreview
              type={item.type}
              name={item.name}
              spec={item.spec}
              objectName={objectName}
            />
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="p-5">
              <SpecCard spec={item.spec} />
            </div>
          </ScrollArea>
        )}
      </div>
    </>
  );
}

function SpecCard({ spec }: { spec: any }) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => {
    try { return JSON.stringify(spec, null, 2); } catch { return String(spec); }
  }, [spec]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="overflow-hidden rounded-md border bg-muted/30">
      <div className="flex items-center justify-between border-b bg-muted/30 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Spec</span>
        <Button
          type="button"
          onClick={copy}
          size="sm"
          variant="ghost"
          className="mr-8 h-6 gap-1 text-[11px]"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-auto p-3 text-[11px] leading-relaxed">
        <code>{json}</code>
      </pre>
    </div>
  );
}

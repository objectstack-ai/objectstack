// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { useState, useEffect, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { useScopedClient } from '@/hooks/useObjectStackClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Package, Database, Layers, Globe, Box,
  RefreshCw, ExternalLink, Code2
} from 'lucide-react';
import type { InstalledPackage } from '@objectstack/spec/kernel';
import { WelcomeOnboarding } from '@/components/WelcomeOnboarding';
import { iconForMetadataType, typeLabel, navItemForType } from '@/components/studio-nav';

/**
 * The metadata backend currently exposes both the canonical camelCase
 * type name (e.g. `sharingRule`) and a legacy snake_case alias
 * (`sharing_rule`) for the same underlying type. Surfacing both in the
 * registry view confuses users into thinking they are different
 * things, so we collapse alias pairs by their normalized key, keep the
 * camelCase variant where available, and sum the counts.
 */
function dedupeRegistryEntries(
  types: string[],
  counts: Record<string, number>,
): Array<[string, number]> {
  const byKey = new Map<string, { name: string; count: number }>();
  const norm = (t: string) => t.replace(/_/g, '').toLowerCase();
  const isCamel = (t: string) => !t.includes('_');
  for (const t of types) {
    const key = norm(t);
    const count = counts[t] ?? 0;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { name: t, count });
      continue;
    }
    // Prefer the camelCase variant for display; sum counts.
    const preferred = isCamel(t) && !isCamel(existing.name) ? t : existing.name;
    byKey.set(key, { name: preferred, count: existing.count + count });
  }
  return Array.from(byKey.values()).map(({ name, count }) => [name, count] as [string, number]);
}

interface DeveloperOverviewProps {
  packages: InstalledPackage[];
  selectedPackage?: InstalledPackage | null;
  /** Optional navigation callback; defaults to a no-op. */
  onNavigate?: (view: string, detail?: string) => void;
}

interface SystemStats {
  packages: { total: number; enabled: number; disabled: number; byType: Record<string, number> };
  metadata: { types: string[]; counts: Record<string, number> };
  loading: boolean;
}

export function DeveloperOverview({ packages, selectedPackage, onNavigate = () => {} }: DeveloperOverviewProps) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const client = useScopedClient(params.projectId);
  const [stats, setStats] = useState<SystemStats>({
    packages: { total: 0, enabled: 0, disabled: 0, byType: {} },
    metadata: { types: [], counts: {} },
    loading: true,
  });

  const loadStats = useCallback(async () => {
    if (!client) return;
    setStats(prev => ({ ...prev, loading: true }));
    try {
      // Fetch metadata types
      const typesResult = await client.meta.getTypes();
      const types: string[] = typesResult?.types || (Array.isArray(typesResult) ? typesResult : []);

      // Package scope: filter metadata by selected package
      const packageId = selectedPackage?.manifest?.id;

      // Fetch counts for each type
      const countEntries = await Promise.all(
        types.map(async (type) => {
          try {
            const result = await client.meta.getItems(type, packageId ? { packageId } : undefined);
            const items = result?.items || (Array.isArray(result) ? result : []);
            return [type, items.length] as const;
          } catch {
            return [type, 0] as const;
          }
        })
      );
      const counts = Object.fromEntries(countEntries);

      // Package stats
      const enabled = packages.filter(p => p.enabled).length;
      const byType: Record<string, number> = {};
      packages.forEach(p => {
        const t = p.manifest?.type || 'unknown';
        byType[t] = (byType[t] || 0) + 1;
      });

      setStats({
        packages: { total: packages.length, enabled, disabled: packages.length - enabled, byType },
        metadata: { types, counts },
        loading: false,
      });
    } catch (err) {
      console.error('[DeveloperOverview] Failed to load stats:', err);
      setStats(prev => ({ ...prev, loading: false }));
    }
  }, [client, packages, selectedPackage]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const objectCount = stats.metadata.counts['object'] || 0;
  const totalMetaItems = Object.values(stats.metadata.counts).reduce((a, b) => a + b, 0);

  // First-run onboarding: no metadata authored yet for this package.
  if (!stats.loading && totalMetaItems === 0 && selectedPackage?.manifest?.id) {
    return <WelcomeOnboarding packageId={selectedPackage.manifest.id} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {selectedPackage?.manifest?.name || 'Overview'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedPackage?.manifest?.id
              ? `Everything in ${selectedPackage.manifest.id} at a glance.`
              : 'Everything installed across this runtime at a glance.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadStats} disabled={stats.loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${stats.loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => onNavigate('packages')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Packages</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.packages.total}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.packages.enabled} enabled · {stats.packages.disabled} disabled
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Objects</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{objectCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Data model definitions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Metadata Types</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.metadata.types.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalMetaItems} total items registered
            </p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => onNavigate('apis')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">REST API</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Live</div>
            <p className="text-xs text-muted-foreground mt-1">
              Auto-generated under <code className="font-mono">/api/v1</code>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Installed Packages */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Installed Packages</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => onNavigate('packages')}>
                View all <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
            <CardDescription>Runtime package registry</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {packages.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No packages installed</p>
            ) : (
              packages.slice(0, 6).map(pkg => (
                <div
                  key={pkg.manifest?.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Box className={`h-4 w-4 shrink-0 ${pkg.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{pkg.manifest?.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{pkg.manifest?.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {pkg.manifest?.version}
                    </Badge>
                    <Badge variant={pkg.enabled ? "default" : "secondary"} className="text-[10px]">
                      {pkg.manifest?.type}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Metadata Registry */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Metadata Registry</CardTitle>
            <CardDescription>
              {selectedPackage
                ? `Metadata from ${selectedPackage.manifest?.name || selectedPackage.manifest?.id}`
                : 'All registered metadata types and item counts'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {stats.metadata.types.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading...</p>
              ) : (
                dedupeRegistryEntries(stats.metadata.types, stats.metadata.counts)
                  .filter(([, count]) => count > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => {
                    const Icon = iconForMetadataType(type) ?? Code2;
                    const label = typeLabel(type);
                    const showRawKey = label.toLowerCase() !== type.toLowerCase();
                    const nav = navItemForType(type);
                    const clickable = !!nav;
                    return (
                      <button
                        type="button"
                        key={type}
                        disabled={!clickable}
                        onClick={clickable ? () => onNavigate(nav!.key) : undefined}
                        className={
                          'flex w-full items-center justify-between py-2 px-3 rounded-md text-left transition-colors ' +
                          (clickable
                            ? 'hover:bg-muted/50 cursor-pointer'
                            : 'cursor-default opacity-90')
                        }
                        title={clickable ? `Open ${nav!.label}` : undefined}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{label}</span>
                          {showRawKey && (
                            <code className="text-[10px] text-muted-foreground/60 font-mono">{type}</code>
                          )}
                        </div>
                        <Badge variant="secondary" className="text-xs font-mono">
                          {count}
                        </Badge>
                      </button>
                    );
                  })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Reference</CardTitle>
          <CardDescription>Common API endpoints for this runtime</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {[
              { method: 'GET', path: '/api/v1/meta/types', desc: 'List metadata types' },
              { method: 'GET', path: '/api/v1/meta/objects', desc: 'List object definitions' },
              { method: 'GET', path: '/api/v1/data/{object}', desc: 'Query records' },
              { method: 'POST', path: '/api/v1/data/{object}', desc: 'Create record' },
              { method: 'GET', path: '/api/v1/packages', desc: 'List packages' },
              { method: 'GET', path: '/api/v1/discovery', desc: 'API discovery' },
            ].map((ep, i) => (
              <div key={i} className="flex items-start gap-2 py-2 px-3 rounded-md bg-muted/30 border border-transparent hover:border-border transition-colors">
                <Badge
                  variant="outline"
                  className={`text-[10px] font-mono shrink-0 mt-0.5 ${
                    ep.method === 'GET' ? 'text-emerald-600 border-emerald-300 dark:text-emerald-400' :
                    ep.method === 'POST' ? 'text-blue-600 border-blue-300 dark:text-blue-400' :
                    'text-amber-600 border-amber-300'
                  }`}
                >
                  {ep.method}
                </Badge>
                <div>
                  <p className="text-xs font-mono">{ep.path}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{ep.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

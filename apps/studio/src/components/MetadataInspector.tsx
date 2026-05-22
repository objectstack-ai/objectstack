// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { useState, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { useScopedClient } from '@/hooks/useObjectStackClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search, Copy, Check, ChevronRight, ChevronDown,
  Zap, BarChart3, FileText, Workflow, Bot, Globe, BookOpen, Shield, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MetadataInspectorProps {
  metaType: string;
  metaName: string;
  packageId?: string;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  actions: Zap,
  dashboards: BarChart3,
  reports: FileText,
  flows: Workflow,
  agent: Bot,
  agents: Bot,
  tool: Wrench,
  tools: Wrench,
  apis: Globe,
  ragPipeline: BookOpen,
  ragPipelines: BookOpen,
  profiles: Shield,
  sharingRules: Shield,
};

const TYPE_LABELS: Record<string, string> = {
  actions: 'Action',
  dashboards: 'Dashboard',
  reports: 'Report',
  flows: 'Flow',
  agent: 'Agent',
  agents: 'Agent',
  tool: 'Tool',
  tools: 'Tool',
  apis: 'API',
  ragPipeline: 'RAG Pipeline',
  ragPipelines: 'RAG Pipeline',
  profiles: 'Profile',
  sharingRules: 'Sharing Rule',
};

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Recursively render an object as a collapsible tree */
export function JsonTree({ data, depth = 0 }: { data: any; depth?: number }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (data === null || data === undefined) {
    return <span className="text-muted-foreground italic">null</span>;
  }

  if (typeof data === 'boolean') {
    return (
      <Badge variant="outline" className={`text-[10px] font-mono ${data ? 'text-emerald-600 border-emerald-300' : 'text-red-500 border-red-300'}`}>
        {String(data)}
      </Badge>
    );
  }

  if (typeof data === 'number') {
    return <span className="text-amber-600 dark:text-amber-400 font-mono text-sm">{data}</span>;
  }

  if (typeof data === 'string') {
    if (data.length > 120) {
      return (
        <span className="text-emerald-700 dark:text-emerald-400 font-mono text-sm break-all">
          "{data.slice(0, 120)}…"
        </span>
      );
    }
    return <span className="text-emerald-700 dark:text-emerald-400 font-mono text-sm">"{data}"</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-muted-foreground font-mono text-sm">[]</span>;
    // For small primitive arrays, show inline
    if (data.length <= 5 && data.every(d => typeof d !== 'object')) {
      return (
        <span className="font-mono text-sm">
          [{data.map((v, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <JsonTree data={v} depth={depth + 1} />
            </span>
          ))}]
        </span>
      );
    }
    return (
      <div className="space-y-0.5">
        <span className="text-muted-foreground font-mono text-xs">Array({data.length})</span>
        <div className="ml-4 border-l pl-3 space-y-0.5">
          {data.map((item, idx) => (
            <div key={idx} className="flex items-start gap-1">
              <span className="text-muted-foreground font-mono text-xs shrink-0 mt-0.5">[{idx}]</span>
              <JsonTree data={item} depth={depth + 1} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) return <span className="text-muted-foreground font-mono text-sm">{'{}'}</span>;

    return (
      <div className="space-y-0.5">
        {keys.map(key => {
          const value = data[key];
          const isComplex = typeof value === 'object' && value !== null;
          const isCollapsed = collapsed[key] ?? (depth > 1 && isComplex);

          return (
            <div key={key}>
              <div className="flex items-start gap-1 group">
                {isComplex ? (
                  <button
                    onClick={() => setCollapsed(prev => ({ ...prev, [key]: !isCollapsed }))}
                    className="shrink-0 mt-0.5 p-0.5 rounded hover:bg-muted"
                  >
                    {isCollapsed
                      ? <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    }
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className="text-blue-600 dark:text-blue-400 font-mono text-sm shrink-0">{key}:</span>
                {isComplex && isCollapsed ? (
                  <span className="text-muted-foreground font-mono text-xs">
                    {Array.isArray(value) ? `Array(${value.length})` : `{${Object.keys(value).length} keys}`}
                  </span>
                ) : (
                  <div className="min-w-0"><JsonTree data={value} depth={depth + 1} /></div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return <span className="font-mono text-sm">{String(data)}</span>;
}


export function MetadataInspector({ metaType, metaName, packageId }: MetadataInspectorProps) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const client = useScopedClient(params.projectId);
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const TypeIcon = TYPE_ICONS[metaType] || FileText;
  const typeLabel = TYPE_LABELS[metaType] || metaType.charAt(0).toUpperCase() + metaType.slice(1);
  // TypeIcon is currently unused since the route header owns the icon; keep the
  // lookup for forward-compatibility with future inline contexts.
  void TypeIcon;

  useEffect(() => {
    if (!client) return;
    let mounted = true;
    setLoading(true);
    setItem(null);

    async function load() {
      try {
        const result: any = await client!.meta.getItem(metaType, metaName, packageId ? { packageId } : undefined);
        if (mounted) {
          setItem(result?.item || result);
        }
      } catch (err) {
        console.error(`[MetadataInspector] Failed to load ${metaType}/${metaName}:`, err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [client, metaType, metaName, packageId]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{typeLabel} not found</p>
            <p className="mt-1">
              We couldn't load{' '}
              <code className="font-mono text-xs">{metaName}</code>. It may have been
              deleted or moved to another package.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Build a filtered view of all properties
  const allKeys = Object.keys(item);
  const filteredKeys = searchQuery
    ? allKeys.filter(k =>
        k.toLowerCase().includes(searchQuery.toLowerCase()) ||
        JSON.stringify(item[k]).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allKeys;

  return (
    <div className="space-y-4 p-4">
      {/* Property inspector */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Properties</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {filteredKeys.length} / {allKeys.length} keys
            </Badge>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter properties..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3">
              {filteredKeys.map(key => (
                <div key={key} className="group rounded-md border p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-blue-600 dark:text-blue-400 font-mono text-sm font-medium">{key}</span>
                    <CopyButton text={JSON.stringify(item[key], null, 2)} />
                    <Badge variant="outline" className="text-[10px] font-mono ml-auto">
                      {Array.isArray(item[key]) ? `array(${item[key].length})` : typeof item[key]}
                    </Badge>
                  </div>
                  <div className="pl-1">
                    <JsonTree data={item[key]} />
                  </div>
                </div>
              ))}
              {filteredKeys.length === 0 && (
                <p className="text-sm text-center text-muted-foreground py-8">
                  {searchQuery ? 'No properties match filter' : 'No properties'}
                </p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

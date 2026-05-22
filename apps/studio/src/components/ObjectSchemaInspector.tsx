// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { useState, useEffect } from 'react';
import { useClient } from '@objectstack/client-react';
import { useParams } from '@tanstack/react-router';
import { useScopedClient } from '@/hooks/useObjectStackClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search, Copy, Check, Key, Hash, Type, ToggleLeft,
  List, Link, Calculator, Calendar, FileText, CircleDot, Code2
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ObjectSchemaInspectorProps {
  objectApiName: string;
}

const FIELD_TYPE_ICONS: Record<string, React.ElementType> = {
  text: Type,
  textarea: FileText,
  number: Hash,
  boolean: ToggleLeft,
  select: List,
  lookup: Link,
  formula: Calculator,
  date: Calendar,
  datetime: Calendar,
  autonumber: Hash,
};

const FIELD_TYPE_COLORS: Record<string, string> = {
  text: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800',
  textarea: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800',
  number: 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800',
  boolean: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800',
  select: 'text-purple-600 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950 dark:border-purple-800',
  lookup: 'text-cyan-600 bg-cyan-50 border-cyan-200 dark:text-cyan-400 dark:bg-cyan-950 dark:border-cyan-800',
  formula: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950 dark:border-orange-800',
  date: 'text-pink-600 bg-pink-50 border-pink-200 dark:text-pink-400 dark:bg-pink-950 dark:border-pink-800',
  datetime: 'text-pink-600 bg-pink-50 border-pink-200 dark:text-pink-400 dark:bg-pink-950 dark:border-pink-800',
};

function CopyButton({ text }: { text: string }) {
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
          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={handleCopy}>
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy field name</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ObjectSchemaInspector({ objectApiName }: ObjectSchemaInspectorProps) {
  const unscopedClient = useClient();
  const params = useParams({ strict: false }) as { projectId?: string };
  const scopedClient = useScopedClient(params.projectId);
  const client: any = scopedClient ?? unscopedClient;
  const [def, setDef] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    async function loadDef() {
      try {
        const found: any = await client.meta.getItem('object', objectApiName);
        if (mounted && found) {
          setDef(found.item || found);
        }
      } catch (err) {
        console.error('Failed to load schema:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadDef();
    return () => { mounted = false; };
  }, [client, objectApiName]);

  if (loading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!def) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Object definition not found: <code className="font-mono">{objectApiName}</code>
        </CardContent>
      </Card>
    );
  }

  const fields = def.fields || {};
  const fieldEntries = Object.entries(fields).map(([key, f]: [string, any]) => ({
    name: f.name || key,
    label: f.label || key,
    type: f.type || 'text',
    required: f.required || false,
    multiple: f.multiple || false,
    reference: f.reference,
    defaultValue: f.defaultValue,
    description: f.description,
    options: f.options,
    formula: f.formula,
    maxLength: f.maxLength,
    sortOrder: f.sortOrder,
  }));

  // Parse FQN: namespace__shortName (used elsewhere; namespace/shortName intentionally derived even if unused)
  const objectName = def.name || objectApiName;

  const filtered = searchQuery
    ? fieldEntries.filter(f =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.type.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : fieldEntries;

  return (
    <div className="space-y-4 p-4">
      {/* Field search + table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Code2 className="h-4 w-4" />
              Field Definitions
            </CardTitle>
            <Badge variant="secondary" className="text-xs">{filtered.length} / {fieldEntries.length}</Badge>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter fields by name, label, or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="font-medium">Field Name</TableHead>
                  <TableHead className="font-medium">Label</TableHead>
                  <TableHead className="font-medium">Type</TableHead>
                  <TableHead className="font-medium">Required</TableHead>
                  <TableHead className="font-medium">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((field, idx) => {
                  const FieldIcon = FIELD_TYPE_ICONS[field.type] || CircleDot;
                  const colorClass = FIELD_TYPE_COLORS[field.type] || 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-950 dark:border-gray-800';
                  return (
                    <TableRow key={field.name} className="group">
                      <TableCell className="py-2 text-center text-xs text-muted-foreground tabular-nums">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-sm font-medium">{field.name}</code>
                          <CopyButton text={field.name} />
                          {field.required && (
                            <Key className="h-3 w-3 text-amber-500" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-sm">{field.label}</TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className={`gap-1 text-xs ${colorClass}`}>
                          <FieldIcon className="h-3 w-3" />
                          {field.type}
                          {field.multiple && '[]'}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        {field.required ? (
                          <Badge variant="default" className="text-[10px] bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
                            Required
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Optional</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {field.reference && (
                            <Badge variant="outline" className="text-[10px] font-mono gap-1">
                              <Link className="h-2.5 w-2.5" /> → {field.reference}
                            </Badge>
                          )}
                          {field.defaultValue !== undefined && (
                            <Badge variant="outline" className="text-[10px] font-mono">
                              default: {JSON.stringify(field.defaultValue)}
                            </Badge>
                          )}
                          {field.maxLength && (
                            <Badge variant="outline" className="text-[10px] font-mono">
                              max: {field.maxLength}
                            </Badge>
                          )}
                          {field.options && (
                            <Badge variant="outline" className="text-[10px]">
                              {field.options.length} options
                            </Badge>
                          )}
                          {field.formula && (
                            <Badge variant="outline" className="text-[10px] font-mono">
                              ƒ {String(field.formula).slice(0, 30)}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-sm">
                      {searchQuery ? 'No fields matching filter' : 'No fields defined'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

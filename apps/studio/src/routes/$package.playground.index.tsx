// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Playground — keyboard-friendly sandbox for trying things live.
 *
 * Currently surfaces the existing ApiConsolePage as the "REST" tab.
 * ObjectQL / Formula / Agent / Tool / Form tabs are reserved for the
 * follow-up sprints and shown as "Coming soon" cards so the IA is
 * visible to developers from day one.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useClient } from '@objectstack/client-react';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';
import { ApiConsolePage } from '@/components/ApiConsolePage';
import { LiveFormPreview } from '@/components/LiveFormPreview';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FlaskConical, Terminal, Search, FunctionSquare, Bot, Wrench, FormInput } from 'lucide-react';

function ComingSoon({ title, hint }: { title: string; hint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Coming soon.
        </div>
      </CardContent>
    </Card>
  );
}

function PlaygroundPage() {
  const { package: packageId } = Route.useParams();
  const [tab, setTab] = useState('rest');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <FlaskConical className="h-5 w-5" />
          Playground
        </h1>
        <p className="text-sm text-muted-foreground">
          Try REST, ObjectQL, formulas, forms, and AI agents against your running
          backend without leaving Studio.
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
          <TabsList className="mx-6 mt-3 self-start">
            <TabsTrigger value="rest" className="gap-1.5">
              <Terminal className="h-3.5 w-3.5" /> REST
            </TabsTrigger>
            <TabsTrigger value="objectql" className="gap-1.5">
              <Search className="h-3.5 w-3.5" /> ObjectQL
            </TabsTrigger>
            <TabsTrigger value="formula" className="gap-1.5">
              <FunctionSquare className="h-3.5 w-3.5" /> Formula
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-1.5">
              <Bot className="h-3.5 w-3.5" /> Agent
            </TabsTrigger>
            <TabsTrigger value="tool" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" /> Tool
            </TabsTrigger>
            <TabsTrigger value="form" className="gap-1.5">
              <FormInput className="h-3.5 w-3.5" /> Form preview
            </TabsTrigger>
          </TabsList>
          <div className="flex-1 overflow-auto p-6">
            <TabsContent value="rest" className="mt-0">
              <ApiConsolePage />
            </TabsContent>
            <TabsContent value="objectql" className="mt-0">
              <ComingSoon
                title="ObjectQL playground"
                hint="Build filter / sort / pagination queries against any object and inspect the raw response."
              />
            </TabsContent>
            <TabsContent value="formula" className="mt-0">
              <ComingSoon
                title="Formula REPL (CEL)"
                hint="Try expressions, predicates, and seed-value formulas against sample data."
              />
            </TabsContent>
            <TabsContent value="agent" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Agent playground</CardTitle>
                  <CardDescription>
                    Pick an agent from the{' '}
                    <Link
                      to="/$package/ai"
                      params={{ package: packageId }}
                      className="underline underline-offset-2"
                    >
                      AI list
                    </Link>{' '}
                    and use the assistant panel on the right to chat with it.
                  </CardDescription>
                </CardHeader>
              </Card>
            </TabsContent>
            <TabsContent value="tool" className="mt-0">
              <ComingSoon
                title="Tool playground"
                hint="Invoke any registered Tool with arbitrary input and see the response + telemetry."
              />
            </TabsContent>
            <TabsContent value="form" className="mt-0">
              <FormPreviewTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/$package/playground/')({
  component: PlaygroundPage,
});

interface FormRow {
  name: string;
  label?: string;
  object?: string;
  spec: any;
}

/** Renders a list of FormViews + an interactive preview pane. */
function FormPreviewTab() {
  const client = useClient();
  const { version: hmrVersion } = useMetadataHmr();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await (client as any).meta.getItems('view');
        const items: any[] = Array.isArray(resp)
          ? resp
          : Array.isArray(resp?.items)
            ? resp.items
            : Array.isArray(resp?.data?.items)
              ? resp.data.items
              : [];
        const rows: FormRow[] = items
          .map((it: any) => ({
            name: it.name,
            label: it.label ?? it.spec?.label,
            object: it.spec?.object,
            spec: it.spec ?? it,
          }))
          .filter((r: FormRow) => {
            const s = r.spec ?? {};
            return (
              s.viewType === 'form' ||
              !!s.sections ||
              !!s.groups ||
              !!s.form ||
              ['simple', 'tabbed', 'wizard'].includes(s.type)
            );
          });
        if (!cancelled) {
          setForms(rows);
          if (rows[0] && !selected) setSelected(rows[0].name);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, hmrVersion]);

  const current = useMemo(() => forms.find((f) => f.name === selected), [forms, selected]);

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Loading forms…
      </div>
    );
  }

  if (!forms.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No forms yet</CardTitle>
          <CardDescription>
            Create a view with <code className="text-xs">viewType: 'form'</code> (or
            with <code className="text-xs">sections</code> / <code className="text-xs">groups</code>)
            to preview it here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Form preview</CardTitle>
          <CardDescription>
            Read-only render of any FormView spec. Pick a form and see exactly
            what the user would see — without leaving Studio.
          </CardDescription>
          <div className="pt-2">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder="Pick a form…" />
              </SelectTrigger>
              <SelectContent>
                {forms.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.label ?? f.name}
                    {f.object && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        → {f.object}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>
      {current && (
        <div className="h-[640px] overflow-hidden rounded-lg border">
          <LiveFormPreview
            spec={current.spec?.form ?? current.spec}
            objectName={current.object ?? current.spec?.object ?? ''}
          />
        </div>
      )}
    </div>
  );
}

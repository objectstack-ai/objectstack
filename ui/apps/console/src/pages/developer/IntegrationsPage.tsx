/**
 * Integrations & APIs Page (ADR-0036, Phase 1b)
 *
 * Surfaces the fact that every published ObjectStack object is already a REST
 * API: shows this environment's base URL, the auto-generated CRUD endpoints per
 * object, a jump to the interactive API Console, and copy-paste samples.
 *
 * Also the env's agent surface (ADR-0036 Phase 2b): the <AgentConnectSection>
 * shows the MCP endpoint, mints a show-once `sys_api_key`, and offers a portable
 * Skill download — one connection per environment covers every app.
 *
 * Self-serve API keys are live (Phase 1a hand-rolled `sys_api_key` auth + the
 * generation endpoint); send them as the `x-api-key` header (a session Bearer is
 * not an API key). The in-console API Console (session-authed) remains for
 * interactive exploration.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConsolePageHeader } from '@object-ui/app-shell';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
} from '@object-ui/components';
import { Terminal, Copy, Check, Plug, Database, KeyRound } from 'lucide-react';

import { AgentConnectSection } from './AgentConnectSection';

interface ConsoleObjectMeta {
  name: string;
  label?: string;
}

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  POST: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  PATCH: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  DELETE: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={`Copy ${label ?? 'value'}`}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function IntegrationsPage() {
  const navigate = useNavigate();
  const { appName } = useParams();
  const basePath = appName ? `/apps/${appName}` : '';

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const [objects, setObjects] = useState<ConsoleObjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/meta/object', { credentials: 'include' });
        if (!res.ok) throw new Error(`meta/object ${res.status}`);
        const json = await res.json();
        const raw = (json?.data ?? json?.items ?? json ?? []) as Array<Record<string, unknown>>;
        const list = (Array.isArray(raw) ? raw : [])
          .map((o) => ({ name: String(o.name ?? ''), label: (o.label as string) || undefined }))
          .filter((o) => o.name && !o.name.startsWith('sys_'));
        if (!cancelled) setObjects(list);
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message ?? 'failed to load objects');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sampleObject = objects[0]?.name ?? 'your_object';
  const curl = useMemo(
    () =>
      `# List ${sampleObject} records\n` +
      `curl "${baseUrl}/api/v1/data/${sampleObject}?$top=10" \\\n` +
      `  -H "x-api-key: <YOUR_API_KEY>"`,
    [baseUrl, sampleObject],
  );

  const endpointsFor = (obj: string) => [
    { method: 'GET', path: `/api/v1/data/${obj}`, desc: 'List / query' },
    { method: 'POST', path: `/api/v1/data/${obj}`, desc: 'Create' },
    { method: 'GET', path: `/api/v1/data/${obj}/:id`, desc: 'Read one' },
    { method: 'PATCH', path: `/api/v1/data/${obj}/:id`, desc: 'Update' },
    { method: 'DELETE', path: `/api/v1/data/${obj}/:id`, desc: 'Delete' },
  ];

  return (
    <div>
    {/* The console's one page header (objectui#12553), the one an object list,
        a dashboard and the Approvals Inbox draw: icon chip, title, and the
        subtitle beside the title from `sm` up, in one row across the page
        above the padded body. Below `sm` the header hides the subtitle. */}
    <ConsolePageHeader
      title="Integrations & APIs"
      subtitle="Every object you build is instantly a REST API. Drive your app from code or an agent."
      icon={<Plug className="h-4 w-4" />}
    />
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      {/* Base URL */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Base URL</CardTitle>
          <CardDescription className="text-xs">This environment's API root.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">{baseUrl}/api/v1</code>
          <CopyButton value={`${baseUrl}/api/v1`} label="base URL" />
        </CardContent>
      </Card>

      {/* Connect an AI agent (MCP) — ADR-0036 Phase 2b */}
      <AgentConnectSection />

      {/* Endpoints per object */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="size-4" /> REST endpoints
            </CardTitle>
            <CardDescription className="text-xs">
              Auto-generated CRUD for every published object (OData query params on list).
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`${basePath}/developer/api-console`)}>
            <Terminal className="size-4" /> Open API Console
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading && <p className="text-sm text-muted-foreground">Loading objects…</p>}
          {error && <p className="text-sm text-destructive">Couldn't load objects: {error}</p>}
          {!loading && !error && objects.length === 0 && (
            <p className="text-sm text-muted-foreground">No business objects yet — build one with the AI assistant, publish it, and it appears here as an API.</p>
          )}
          {objects.map((obj) => (
            <div key={obj.name} className="rounded-lg border">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <span className="font-medium text-sm">{obj.label || obj.name}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{obj.name}</code>
              </div>
              <div className="divide-y">
                {endpointsFor(obj.name).map((ep) => (
                  <div key={ep.method + ep.path} className="flex items-center gap-3 px-3 py-1.5">
                    <Badge className={`w-16 justify-center font-mono text-[10px] ${METHOD_STYLES[ep.method] ?? ''}`}>{ep.method}</Badge>
                    <code className="flex-1 truncate font-mono text-xs">{ep.path}</code>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{ep.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Auth (Phase 1a placeholder — honest) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="size-4" /> Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            In the console you're already authenticated — use <strong>Open API Console</strong> above to call these endpoints now.
          </p>
          <p>
            For external programs and AI agents, generate a <strong>self-serve API key</strong> in
            the <strong>Connect an AI agent</strong> section above. Send it as the{' '}
            <code className="font-mono text-xs">x-api-key</code> header; it runs under your
            permissions and row-level security, and is revocable.
          </p>
        </CardContent>
      </Card>

      {/* Sample */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Sample (cURL)</CardTitle>
          <CopyButton value={curl} label="cURL sample" />
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs leading-relaxed">{curl}</pre>
        </CardContent>
      </Card>
    </div>
    </div>
  );
}

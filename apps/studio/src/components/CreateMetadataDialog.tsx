// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CreateMetadataDialog — single "+ New …" affordance shared by every
 * Studio list page (Objects, Forms, Views, Automations, AI, Security,
 * APIs).
 *
 * Same low-leverage philosophy as AddFieldDialog: metadata is code, so
 * we don't write to the filesystem from the browser. We just lower the
 * onboarding cliff: pick a type, fill name/label, get a real snippet +
 * the canonical file path, paste it into your editor, save → HMR picks
 * it up.
 *
 * Each TEMPLATE below maps a metadata type to:
 *   - the directory convention (e.g. `src/views/`)
 *   - the source-file suffix (e.g. `.view.ts`)
 *   - a runnable defineX(...) snippet pre-filled with the user's name
 *
 * If we later add a vscode://...?action=create command or a backend
 * scaffold endpoint, we swap the body of `handlePrimary` without
 * touching the dialog's contract.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Database, Table, FileText, LayoutDashboard, BarChart3,
  Workflow, Webhook, Stamp, Bot, Wrench, Sparkles, Lock, Shield,
  Globe, Layers, Copy, Check,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface CreateMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Metadata types the host page deals with. Used to filter the type picker. */
  types: string[];
  /** Package id — embedded in the generated file path. */
  packageId?: string | null;
  /**
   * When set, snippets that reference an object (view, form, hook,
   * report, approval, flow widget, app tab…) substitute this name in
   * place of the generic `account` placeholder, and the dialog title
   * advertises the affiliation. Used from `ObjectRelatedPanel` to
   * scaffold metadata that already references the current object.
   */
  prefillObjectName?: string;
}

interface TypeTemplate {
  type: string;
  label: string;
  icon: React.ElementType;
  description: string;
  /** Directory under `packages/<pkg>/src/` */
  dir: string;
  /** Source-file suffix, e.g. ".view.ts" */
  suffix: string;
  /** Generate the file body. `name` is snake_case, `label` is human. `object` is an optional prefilled object name. */
  snippet: (name: string, label: string, object?: string) => string;
}

const TEMPLATES: TypeTemplate[] = [
  {
    type: 'object', label: 'Object', icon: Database,
    description: 'A table of records with fields, validations, and permissions.',
    dir: 'objects', suffix: '.object.ts',
    snippet: (n, l) => `import { defineObject } from '@objectstack/spec';

export default defineObject({
  name: '${n}',
  label: '${l}',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true, maxLength: 255 },
  },
});
`,
  },
  {
    type: 'view', label: 'Grid view', icon: Table,
    description: 'A data table over an existing object.',
    dir: 'views', suffix: '.view.ts',
    snippet: (n, l, o) => `import { defineView } from '@objectstack/spec';

export default defineView({
  name: '${n}',
  label: '${l}',
  objectName: '${o ?? 'account'}',${o ? '' : ' // ⚠ replace with your object'}
  viewType: 'grid',
  columns: ['name'],
});
`,
  },
  {
    type: 'app', label: 'App', icon: Layers,
    description: 'Top-level navigation container with tabs.',
    dir: 'apps', suffix: '.app.ts',
    snippet: (n, l, o) => `import { defineApp } from '@objectstack/spec';

export default defineApp({
  name: '${n}',
  label: '${l}',
  tabs: [
    { type: 'object', objectName: '${o ?? 'account'}' },
  ],
});
`,
  },
  {
    type: 'page', label: 'Page', icon: FileText,
    description: 'A custom screen composed of SDUI blocks.',
    dir: 'pages', suffix: '.page.ts',
    snippet: (n, l) => `import { definePage } from '@objectstack/spec';

export default definePage({
  name: '${n}',
  label: '${l}',
  route: '/${n.replace(/_/g, '-')}',
  blocks: [
    { type: 'heading', level: 1, text: '${l}' },
  ],
});
`,
  },
  {
    type: 'dashboard', label: 'Dashboard', icon: LayoutDashboard,
    description: 'A grid of widgets, charts, and KPIs.',
    dir: 'dashboards', suffix: '.dashboard.ts',
    snippet: (n, l) => `import { defineDashboard } from '@objectstack/spec';

export default defineDashboard({
  name: '${n}',
  label: '${l}',
  widgets: [],
});
`,
  },
  {
    type: 'report', label: 'Report', icon: BarChart3,
    description: 'A saved query with columns, filters, sorts, and grouping.',
    dir: 'reports', suffix: '.report.ts',
    snippet: (n, l, o) => `import { defineReport } from '@objectstack/spec';

export default defineReport({
  name: '${n}',
  label: '${l}',
  objectName: '${o ?? 'account'}',${o ? '' : ' // ⚠ replace with your object'}
  columns: ['name'],
});
`,
  },
  {
    type: 'flow', label: 'Flow', icon: Workflow,
    description: 'A multi-step automation triggered by events or schedules.',
    dir: 'flows', suffix: '.flow.ts',
    snippet: (n, l) => `import { defineFlow } from '@objectstack/spec';

export default defineFlow({
  name: '${n}',
  label: '${l}',
  trigger: { type: 'manual' },
  steps: [],
});
`,
  },
  {
    type: 'hook', label: 'Hook', icon: Webhook,
    description: 'A side-effect that fires on object lifecycle events.',
    dir: 'hooks', suffix: '.hook.ts',
    snippet: (n, l, o) => `import { defineHook } from '@objectstack/spec';

export default defineHook({
  name: '${n}',
  label: '${l}',
  objectName: '${o ?? 'account'}',${o ? '' : ' // ⚠ replace with your object'}
  on: 'after-create',
  run: async (ctx) => {
    // your side-effect here
  },
});
`,
  },
  {
    type: 'approval', label: 'Approval', icon: Stamp,
    description: 'A multi-step approval chain on an object.',
    dir: 'approvals', suffix: '.approval.ts',
    snippet: (n, l, o) => `import { defineApproval } from '@objectstack/spec';

export default defineApproval({
  name: '${n}',
  label: '${l}',
  objectName: '${o ?? 'account'}',${o ? '' : ' // ⚠ replace with your object'}
  entryCriteria: { all: [] },
  steps: [],
});
`,
  },
  {
    type: 'agent', label: 'Agent', icon: Bot,
    description: 'An LLM-backed assistant with tools and instructions.',
    dir: 'agents', suffix: '.agent.ts',
    snippet: (n, l) => `import { defineAgent } from '@objectstack/spec';

export default defineAgent({
  name: '${n}',
  label: '${l}',
  model: 'openai/gpt-4',
  instructions: 'You are a helpful assistant.',
  tools: [],
});
`,
  },
  {
    type: 'tool', label: 'Tool', icon: Wrench,
    description: 'A typed function an Agent can invoke.',
    dir: 'tools', suffix: '.tool.ts',
    snippet: (n, l) => `import { defineTool } from '@objectstack/spec';
import { z } from 'zod';

export default defineTool({
  name: '${n}',
  label: '${l}',
  description: 'Describe what this tool does.',
  parameters: z.object({}),
  run: async (input, ctx) => {
    return { ok: true };
  },
});
`,
  },
  {
    type: 'skill', label: 'Skill', icon: Sparkles,
    description: 'A composable agent capability.',
    dir: 'skills', suffix: '.skill.ts',
    snippet: (n, l) => `import { defineSkill } from '@objectstack/spec';

export default defineSkill({
  name: '${n}',
  label: '${l}',
  description: '',
  tools: [],
});
`,
  },
  {
    type: 'permission', label: 'Permission', icon: Lock,
    description: 'A capability that can be granted to a role.',
    dir: 'security', suffix: '.permission.ts',
    snippet: (n, l) => `import { definePermission } from '@objectstack/spec';

export default definePermission({
  name: '${n}',
  label: '${l}',
});
`,
  },
  {
    type: 'role', label: 'Role', icon: Shield,
    description: 'A set of permissions assigned to users.',
    dir: 'security', suffix: '.role.ts',
    snippet: (n, l) => `import { defineRole } from '@objectstack/spec';

export default defineRole({
  name: '${n}',
  label: '${l}',
  permissions: [],
});
`,
  },
  {
    type: 'api', label: 'API endpoint', icon: Globe,
    description: 'A custom REST endpoint.',
    dir: 'apis', suffix: '.api.ts',
    snippet: (n, l) => `import { defineEndpoint } from '@objectstack/spec';

export default defineEndpoint({
  name: '${n}',
  label: '${l}',
  method: 'GET',
  path: '/${n.replace(/_/g, '-')}',
  handler: async (ctx) => ({ ok: true }),
});
`,
  },
];

function toSnakeCase(s: string) {
  return s
    .trim()
    .replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function CreateMetadataDialog({
  open, onOpenChange, types, packageId, prefillObjectName,
}: CreateMetadataDialogProps) {
  // Pre-select the first allowed type when the dialog opens.
  const allowed = useMemo(
    () => TEMPLATES.filter(t => types.includes(t.type)),
    [types],
  );
  const [selectedType, setSelectedType] = useState<string>(allowed[0]?.type ?? '');
  const [label, setLabel] = useState('');
  const [machineName, setMachineName] = useState('');
  const [machineEdited, setMachineEdited] = useState(false);
  const [copied, setCopied] = useState<'snippet' | 'path' | null>(null);
  const [creating, setCreating] = useState(false);
  const [srcRoot, setSrcRoot] = useState<string | null>(null);

  // Probe the host for the on-disk source root once per dialog open.
  // If the host doesn't expose the dev write API (production, custom
  // hosts) the endpoint 404s and we fall back to a placeholder path.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const url = packageId && packageId !== 'all'
          ? `/_studio/api/metadata/layout?package=${encodeURIComponent(packageId)}`
          : '/_studio/api/metadata/layout';
        const resp = await fetch(url);
        if (!resp.ok) { if (!cancelled) setSrcRoot(null); return; }
        const data = await resp.json().catch(() => null);
        if (!cancelled) setSrcRoot(data?.srcRoot ?? null);
      } catch {
        if (!cancelled) setSrcRoot(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, packageId]);

  // When user changes the type, ensure selection stays in allowed list.
  useEffect(() => {
    if (allowed.length === 0) return;
    if (!allowed.find(a => a.type === selectedType)) {
      setSelectedType(allowed[0].type);
    }
  }, [allowed, selectedType]);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setLabel('');
      setMachineName('');
      setMachineEdited(false);
      setCopied(null);
    }
  }, [open]);

  // Auto-derive the snake_case machine name from the label until the
  // user manually edits the machine-name field.
  useEffect(() => {
    if (!machineEdited) setMachineName(toSnakeCase(label));
  }, [label, machineEdited]);

  const template = allowed.find(t => t.type === selectedType);

  const finalName = machineName || 'new_item';
  const finalLabel = label || 'New Item';

  const snippet = useMemo(
    () => template?.snippet(finalName, finalLabel, prefillObjectName) ?? '',
    [template, finalName, finalLabel, prefillObjectName],
  );

  const filePath = useMemo(() => {
    if (!template) return '';
    if (srcRoot) {
      // Real on-disk location returned by the host.
      return `${srcRoot}/${template.dir}/${finalName}${template.suffix}`;
    }
    const pkg = packageId && packageId !== 'all' ? packageId : '<package>';
    return `packages/${pkg}/src/${template.dir}/${finalName}${template.suffix}`;
  }, [template, packageId, finalName, srcRoot]);

  const copySnippet = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied('snippet');
      toast({ title: 'Snippet copied to clipboard' });
      window.setTimeout(() => setCopied(null), 1500);
    } catch (err: any) {
      toast({ title: 'Copy failed', description: err?.message ?? String(err), variant: 'destructive' as any });
    }
  }, [snippet]);

  const copyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(filePath);
      setCopied('path');
      toast({ title: 'File path copied to clipboard' });
      window.setTimeout(() => setCopied(null), 1500);
    } catch (err: any) {
      toast({ title: 'Copy failed', description: err?.message ?? String(err), variant: 'destructive' as any });
    }
  }, [filePath]);

  // Whether the host runtime exposes the dev-only write API. Probed
  // via the layout endpoint — when present, we have a real srcRoot.
  const canCreateFile = srcRoot != null && template != null;

  const createFile = useCallback(async () => {
    if (!canCreateFile) return;
    setCreating(true);
    try {
      const resp = await fetch('/_studio/api/metadata/file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: snippet, mode: 'create' }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok) {
        if (resp.status === 409) {
          toast({
            title: 'File already exists',
            description: `${filePath} is already on disk — pick a different name or open the existing file.`,
            variant: 'destructive' as any,
          });
        } else if (resp.status === 404) {
          toast({
            title: 'Write API unavailable',
            description: 'Run the studio in dev mode (objectstack dev) to enable filesystem writes.',
            variant: 'destructive' as any,
          });
        } else {
          toast({
            title: 'Create failed',
            description: data?.error ?? `HTTP ${resp.status}`,
            variant: 'destructive' as any,
          });
        }
        return;
      }
      toast({
        title: 'File created',
        description: `${filePath} — HMR will reload momentarily.`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: 'Create failed',
        description: err?.message ?? String(err),
        variant: 'destructive' as any,
      });
    } finally {
      setCreating(false);
    }
  }, [canCreateFile, filePath, snippet, onOpenChange]);

  if (allowed.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {prefillObjectName ? `Create related metadata for ${prefillObjectName}` : 'Create new metadata'}
          </DialogTitle>
          <DialogDescription>
            {prefillObjectName ? (
              <>
                Scaffold a new view, dashboard, hook, approval or flow that already
                references <code className="rounded bg-muted px-1 font-mono text-[11px]">{prefillObjectName}</code>.
                Fill in a name &amp; label, click <strong>Create file</strong> and HMR picks it up.
              </>
            ) : (
              <>
                ObjectStack treats metadata as code. Fill in a name &amp; label below to
                generate a runnable snippet — paste it into the suggested file path
                and HMR will pick up your change immediately.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Type picker (hidden if there's only one option). */}
        {allowed.length > 1 && (
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Type
            </Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {allowed.map(t => {
                const Icon = t.icon;
                const active = t.type === selectedType;
                return (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => setSelectedType(t.type)}
                    className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                      active
                        ? 'border-foreground/40 bg-accent text-accent-foreground'
                        : 'hover:bg-accent/40'
                    }`}
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{t.label}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {t.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cmd-label" className="text-xs">Label</Label>
            <Input
              id="cmd-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="My new view"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">
              Human-readable display name. Anything you like.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmd-name" className="text-xs">Machine name</Label>
            <Input
              id="cmd-name"
              value={machineName}
              onChange={e => { setMachineName(toSnakeCase(e.target.value)); setMachineEdited(true); }}
              placeholder="my_new_view"
              className="font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              snake_case, used everywhere (URL, ObjectQL, file name).
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">File path</Label>
            <Button size="sm" variant="ghost" onClick={copyPath} className="h-6 gap-1 text-[10px]">
              {copied === 'path' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              Copy path
            </Button>
          </div>
          <code className="block truncate rounded border bg-muted/40 px-2 py-1.5 font-mono text-[11px]">
            {filePath}
          </code>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Snippet</Label>
            <Badge variant="outline" className="font-mono text-[10px]">
              {template?.type}
            </Badge>
          </div>
          <pre className="max-h-64 overflow-auto rounded border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
            {snippet}
          </pre>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={copySnippet} className="gap-1.5">
            {copied === 'snippet' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Copy snippet
          </Button>
          <Button onClick={createFile} disabled={!canCreateFile || creating} className="gap-1.5">
            {creating ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            {creating ? 'Creating…' : 'Create file'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

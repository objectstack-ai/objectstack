// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ToolPreview — read-only summary of an AI Tool metadata draft.
 *
 * AI tools are LLM-callable functions whose contract is a JSON Schema
 * in `parameters`. The preview renders:
 *
 *   1. A header strip: machine name, label, target object.
 *   2. The description verbatim (this is what the LLM reads to decide
 *      when to call the tool, so authors must be able to skim it).
 *   3. An **input parameters** table extracted from the JSON Schema:
 *      one row per top-level property with type, required marker,
 *      description, enum hints, and default value.
 *   4. An **output schema** mirror table when `outputSchema` is set.
 *   5. A skeletal "example invocation" panel showing what the LLM
 *      would emit if it called the tool with required fields stubbed.
 *
 * We do not run the tool from the preview — invocation requires auth,
 * permission checks, and live datasource access that the preview
 * sandbox doesn't provide. Authors get an `Open in API Console` link
 * for end-to-end testing — see `ApiConsoleLink` below for where it points
 * and what it carries (objectui#10591).
 *
 * NO FLAG PILLS — deliberate (objectstack#3715 / objectstack-ai/objectstack#3896, objectui#3236).
 * The header strip used to render `requiresConfirmation`, `active`,
 * `builtIn` and `category`. All four were removed from the spec's
 * `ToolSchema`, which is now `.strict()` and rejects them by name with an
 * upgrade prescription, so no new tool metadata can carry them. Rendering
 * them for stale stored rows was worse than useless: `Requires
 * confirmation` advertised a safety pause no execution path has ever
 * performed (a real gate is `action.ai.requiresConfirmation` + the HITL
 * approval queue), and `Disabled` claimed a tool had been withdrawn while
 * the registry kept handing it to the LLM. Do not re-add a pill for any
 * of these names — the "stale draft" tests in `ToolPreview.test.tsx` fail
 * if you do. Any new pill must correspond to a key the spec still accepts
 * AND a behavior the runtime actually performs.
 */

import * as React from 'react';
import {
  Box,
  CheckCircle2,
  ChevronRight,
  Database,
  ExternalLink,
  FileJson,
  Wrench,
} from 'lucide-react';
import { Link, useInRouterContext, useParams } from 'react-router-dom';
import { EmptyDescription } from '@object-ui/components';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { componentRefToUrlSegments } from '../../../services/componentRegistry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';

interface JsonSchemaProp {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  format?: string;
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  $ref?: string;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  description?: string;
}

function isObjectSchema(s: unknown): s is JsonSchema {
  return !!s && typeof s === 'object' && typeof (s as JsonSchema).properties === 'object';
}

function typeLabel(p: JsonSchemaProp): string {
  if (!p) return 'any';
  if (Array.isArray(p.type)) return p.type.join('|');
  if (p.type === 'array' && p.items) return `${typeLabel(p.items)}[]`;
  if (p.$ref) return p.$ref.split('/').pop() || 'ref';
  return p.type ?? 'any';
}

function stubValue(p: JsonSchemaProp): unknown {
  if (p.default !== undefined) return p.default;
  if (Array.isArray(p.enum) && p.enum.length) return p.enum[0];
  const t = Array.isArray(p.type) ? p.type[0] : p.type;
  switch (t) {
    case 'string':
      return p.format ? `<${p.format}>` : '<string>';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

/**
 * The API console's component-registry key — the one Studio's Developer
 * navigation names, and the host-neutral way into the page: app-shell serves
 * every registered key at `component/<ns>/<name>` inside any app, while the
 * console's own `developer/api-console` route is a detail of that host.
 */
const API_CONSOLE_REF = 'developer:api-console';

/**
 * "Open in API Console" (objectui#10591).
 *
 * The link used to be the bare `/developer/api-console?path=…`. The console
 * declares no root `/developer` route, so its catch-all sent the author home.
 * It now points at the API console's registry key inside the app the author is
 * in: `/apps/APP/component/developer/api-console`, the same path the Studio
 * sidebar's "API Console" entry builds from that key.
 *
 * The query is the request preset `ApiConsolePage` reads once on mount:
 * `path` is the tool's execute endpoint (`/execute` is the verb service-ai
 * mounts in `buildToolRoutes`; an earlier `/invoke` spelling could only 404),
 * and `method` is `POST`, the verb that endpoint answers. `URLSearchParams`
 * encodes both, so the page reads back exactly the path built here.
 *
 * Rendered through `Link`, so the router's basename is applied: the console
 * ships under a mount path (`/_console`), which a bare rooted `href` would
 * step outside of. The anchor still opens in a new tab.
 *
 * With no router above the preview (the designer gallery harness), or a route
 * that names no `:appName`, there is no app to open the console in, so no link
 * is drawn rather than one that goes nowhere.
 */
function ApiConsoleLink({ toolName, locale }: { toolName: string; locale?: string }) {
  // Rules-of-hooks safe: whether a router sits above is a fact about the
  // mount, and cannot change under it.
  return useInRouterContext() ? <RoutedApiConsoleLink toolName={toolName} locale={locale} /> : null;
}

function RoutedApiConsoleLink({ toolName, locale }: { toolName: string; locale?: string }) {
  const { appName } = useParams<{ appName?: string }>();
  if (!appName) return null;
  const preset = new URLSearchParams({
    path: `/api/v1/ai/tools/${encodeURIComponent(toolName)}/execute`,
    method: 'POST',
  });
  const segments = componentRefToUrlSegments(API_CONSOLE_REF).join('/');
  return (
    <Link
      to={`/apps/${encodeURIComponent(appName)}/component/${segments}?${preset.toString()}`}
      target="_blank"
      rel="noreferrer"
      className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      title={tr('engine.toolPreview.openApiConsoleTitle', locale)}
    >
      {tr('engine.toolPreview.openApiConsole', locale)} <ExternalLink className="h-3 w-3" />
    </Link>
  );
}

export function ToolPreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  const toolName = String(d.name ?? name ?? '');
  const label = String(d.label ?? toolName);
  const description = String(d.description ?? '');
  const objectName = (d.objectName as string | undefined) || undefined;

  const parameters = (d.parameters ?? {}) as JsonSchema;
  const outputSchema = (d.outputSchema ?? undefined) as JsonSchema | undefined;
  const props = isObjectSchema(parameters) ? parameters.properties ?? {} : {};
  const required = new Set(Array.isArray(parameters.required) ? parameters.required : []);

  const exampleArgs = React.useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const key of required) {
      if (props[key]) out[key] = stubValue(props[key]);
    }
    // If there are no required fields, show the first optional one to
    // give the LLM a reasonable example shape.
    if (Object.keys(out).length === 0) {
      const firstKey = Object.keys(props)[0];
      if (firstKey) out[firstKey] = stubValue(props[firstKey]);
    }
    return out;
  }, [props, required]);

  if (!toolName && !description && Object.keys(props).length === 0) {
    return (
      <PreviewShell hint="tool">
        <PreviewMessage>{tr('engine.toolPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell
      hint="tool"
      toolbar={toolName && <ApiConsoleLink toolName={toolName} locale={locale} />}
    >
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="rounded border bg-muted/30 p-3 space-y-1">
            <div className="flex items-start gap-2">
              <Wrench className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium truncate">{label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{toolName}</span>
                </div>
                {objectName && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    <Pill icon={Database} label={objectName} mono />
                  </div>
                )}
              </div>
            </div>
            {description && (
              <div className="pl-6 text-xs text-foreground whitespace-pre-wrap">{description}</div>
            )}
          </div>

          {/* Parameters */}
          <Section title={tr('engine.toolPreview.inputParameters', locale)} count={Object.keys(props).length}>
            {Object.keys(props).length === 0 ? (
              <EmptyDescription className="text-xs italic">{tr('engine.toolPreview.noParameters', locale)}</EmptyDescription>
            ) : (
              <ParamTable props={props} required={required} locale={locale} />
            )}
          </Section>

          {/* Example invocation */}
          {Object.keys(props).length > 0 && (
            <Section title={tr('engine.toolPreview.exampleCall', locale)} icon={FileJson}>
              <pre className="m-0 rounded border bg-background p-2.5 text-xs font-mono overflow-auto max-h-[200px]">
{`{
  "tool": "${toolName}",
  "arguments": ${JSON.stringify(exampleArgs, null, 2).replace(/\n/g, '\n  ')}
}`}
              </pre>
            </Section>
          )}

          {/* Output */}
          {isObjectSchema(outputSchema) && outputSchema.properties && Object.keys(outputSchema.properties).length > 0 && (
            <Section
              title={tr('engine.toolPreview.outputSchema', locale)}
              count={Object.keys(outputSchema.properties).length}
              icon={Box}
            >
              <ParamTable
                props={outputSchema.properties}
                required={new Set(Array.isArray(outputSchema.required) ? outputSchema.required : [])}
                locale={locale}
              />
            </Section>
          )}
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function ParamTable({
  props,
  required,
  locale,
}: {
  props: Record<string, JsonSchemaProp>;
  required: Set<string>;
  locale?: string;
}) {
  const keys = Object.keys(props);
  return (
    <div className="rounded border bg-background overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2.5 py-1.5 font-medium">{tr('engine.toolPreview.col.name', locale)}</th>
            <th className="px-2.5 py-1.5 font-medium">{tr('engine.toolPreview.col.type', locale)}</th>
            <th className="px-2.5 py-1.5 font-medium">{tr('engine.toolPreview.col.description', locale)}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {keys.map((k) => {
            const p = props[k];
            const isReq = required.has(k);
            return (
              <tr key={k} className="align-top">
                <td className="px-2.5 py-1.5 font-mono">
                  <div className="flex items-center gap-1">
                    {isReq ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                    {k}
                    {isReq && (
                      <span className="text-[9px] uppercase text-emerald-700 ml-1">{tr('engine.toolPreview.required', locale)}</span>
                    )}
                  </div>
                </td>
                <td className="px-2.5 py-1.5 font-mono text-muted-foreground">{typeLabel(p)}</td>
                <td className="px-2.5 py-1.5">
                  {p.description && <div>{p.description}</div>}
                  {Array.isArray(p.enum) && p.enum.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {tFormat('engine.toolPreview.enum', locale, { values: p.enum.map((v) => JSON.stringify(v)).join(' | ') })}
                    </div>
                  )}
                  {p.default !== undefined && (
                    <div className="text-[10px] text-muted-foreground">
                      {tr('engine.toolPreview.default', locale)} <code className="font-mono">{JSON.stringify(p.default)}</code>
                    </div>
                  )}
                  {p.format && (
                    <div className="text-[10px] text-muted-foreground">
                      {tFormat('engine.toolPreview.format', locale, { format: p.format })}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon className="h-3 w-3" />}
        <span>{title}</span>
        {count != null && <span className="opacity-70">({count})</span>}
      </div>
      {children}
    </div>
  );
}

// `tone` ('green' for Active, 'amber' for Requires confirmation) went away with
// the flag pills themselves — the surviving caller is the neutral object-name
// pill. A tone vocabulary kept alive with no caller is how the removed pills
// grow back.
function Pill({
  icon: Icon,
  label,
  mono = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  mono?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className={`text-foreground ${mono ? 'font-mono' : ''}`}>{label}</span>
    </span>
  );
}

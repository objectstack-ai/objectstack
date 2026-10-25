// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * EmailTemplatePreview — sandboxed HTML preview with `{{var}}` and
 * `${var}` substitution from a tiny variables editor.
 *
 * Why an iframe? Email HTML is full-document content (`<html>`, inline
 * styles, sometimes `<head>` blocks). Injecting it inline would let it
 * style the host page. `srcdoc` + `sandbox="allow-same-origin"` gives
 * us a clean visual without exposing the admin UI to template CSS.
 *
 * Subject / from / to are surfaced above the body so authors can see
 * the full envelope at a glance.
 */

import * as React from 'react';
import { Mail } from 'lucide-react';
import { EmptyDescription } from '@object-ui/components';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';
import { withNodes } from './row-nodes.js';

function detectVariables(text: string): string[] {
  const out = new Set<string>();
  // {{ var }}  — Handlebars/Mustache style
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g)) out.add(m[1]);
  // ${ var } — JS template style
  for (const m of text.matchAll(/\$\{\s*([a-zA-Z_][\w.]*)\s*\}/g)) out.add(m[1]);
  return Array.from(out).sort();
}

function resolveVar(path: string, scope: Record<string, string>): string {
  return scope[path] ?? '';
}

function substitute(text: string, scope: Record<string, string>): string {
  return text
    .replace(/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g, (_, p) => resolveVar(p, scope))
    .replace(/\$\{\s*([a-zA-Z_][\w.]*)\s*\}/g, (_, p) => resolveVar(p, scope));
}

export function EmailTemplatePreview({ draft, locale }: MetadataPreviewProps) {
  const subject = String((draft as any).subject ?? '');
  const from = String((draft as any).from ?? (draft as any).fromAddress ?? '');
  const to = String((draft as any).to ?? '');
  const bodyHtml = String((draft as any).bodyHtml ?? (draft as any).html ?? (draft as any).body ?? '');
  const bodyText = String((draft as any).bodyText ?? (draft as any).text ?? '');

  const variables = React.useMemo(() => {
    const all = new Set<string>();
    for (const v of detectVariables(subject)) all.add(v);
    for (const v of detectVariables(bodyHtml)) all.add(v);
    for (const v of detectVariables(bodyText)) all.add(v);
    return Array.from(all).sort();
  }, [subject, bodyHtml, bodyText]);

  const [scope, setScope] = React.useState<Record<string, string>>({});

  const resolvedSubject = substitute(subject, scope);
  const resolvedHtml = bodyHtml ? substitute(bodyHtml, scope) : substitute(bodyText, scope).replace(/\n/g, '<br/>');

  // Wrap the body in a minimal HTML doc so emails missing their own
  // `<html>` shell still render with a sensible default font.
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:16px;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#fff;}
    a{color:#2563eb;}
  </style></head><body>${resolvedHtml || `<p style="color:#888">${tr('engine.emailTemplatePreview.emptyBody', locale)}</p>`}</body></html>`;

  if (!bodyHtml && !bodyText && !subject) {
    return (
      <PreviewShell hint="email_template">
        <PreviewMessage>{tr('engine.emailTemplatePreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint="email_template">
      <PreviewErrorBoundary>
        <div className="grid lg:grid-cols-[1fr_220px] gap-0">
          <div className="p-3 space-y-3 min-w-0">
            <div className="rounded border bg-muted/30 px-3 py-2 text-xs space-y-0.5">
              <div className="flex gap-2"><span className="w-12 text-muted-foreground shrink-0">{tr('engine.emailTemplatePreview.from', locale)}</span><span className="font-mono truncate">{from || '—'}</span></div>
              <div className="flex gap-2"><span className="w-12 text-muted-foreground shrink-0">{tr('engine.emailTemplatePreview.to', locale)}</span><span className="font-mono truncate">{to || '—'}</span></div>
              <div className="flex gap-2"><span className="w-12 text-muted-foreground shrink-0">{tr('engine.emailTemplatePreview.subject', locale)}</span><span className="font-medium truncate">{resolvedSubject || '—'}</span></div>
            </div>
            <iframe
              title={tr('engine.emailTemplatePreview.frameTitle', locale)}
              srcDoc={srcDoc}
              sandbox="allow-same-origin"
              className="w-full min-h-[400px] max-h-[60vh] border rounded bg-white"
            />
          </div>

          <div className="border-l bg-muted/20 p-3 text-xs space-y-2">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Mail className="h-3 w-3" /> {tr('engine.emailTemplatePreview.variables', locale)}
            </div>
            {variables.length === 0 ? (
              <EmptyDescription className="text-xs italic">
                {withNodes(tr('engine.emailTemplatePreview.noVariables', locale), { var: <code>{'{{var}}'}</code> })}
              </EmptyDescription>
            ) : (
              <div className="space-y-2">
                {variables.map((v) => (
                  <label key={v} className="block">
                    <span className="block font-mono text-[10px] text-muted-foreground mb-0.5">{v}</span>
                    <input
                      type="text"
                      value={scope[v] ?? ''}
                      onChange={(e) => setScope((s) => ({ ...s, [v]: e.target.value }))}
                      placeholder={tFormat('engine.emailTemplatePreview.samplePlaceholder', locale, { name: v })}
                      className="w-full text-xs px-2 py-1 border rounded bg-background"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

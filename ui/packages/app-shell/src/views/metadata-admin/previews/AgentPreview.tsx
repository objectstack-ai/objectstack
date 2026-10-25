// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AgentPreview — read-only summary of an AI Agent metadata draft.
 *
 * Shows the configuration an operator needs to sanity-check an agent
 * before saving:
 *   • Persona header (avatar, label, role, active flag).
 *   • Model config (provider, model id, temperature, max tokens).
 *   • System prompt / instructions in a scrollable monospace block.
 *   • Skills as a chip list.
 *   • Planning + guardrails callouts.
 *
 * NOT shown — `agent.tools` and `agent.knowledge` (objectui#3275).
 * Both are `retiredKey()` tombstones in `@objectstack/spec` 17
 * (objectstack#3894 / objectstack-ai/objectstack#3896): `AgentSchema` rejects them BY NAME, so a
 * draft carrying either cannot be saved. This preview used to read both
 * and paint a TOOLS chip strip plus a `KNOWLEDGE (RAG)` block, which told
 * the author their draft was fine right up until publish refused it —
 * the tolerant-consumer shape AGENTS.md #0.1 forbids. An agent reaches
 * exactly the tools its skills declare (ADR-0064), and grounding is
 * described in `instructions`, so the Skills list below is the whole
 * truth about what this agent can do.
 *
 * We intentionally do **not** wire a live chat into this preview:
 *   1. The draft may reference unsaved skills/tools the runtime can't
 *      resolve, so a chat would just error.
 *   2. AI calls cost real money; a preview tab that silently spends
 *      tokens whenever someone clicks the tab is bad UX.
 * Instead the toolbar carries a "Try in chat" link to the console's agent
 * chat, where the saved version of this agent can be exercised properly —
 * see `AgentChatLink` below for where it points (objectui#10640).
 */

import * as React from 'react';
import {
  Activity,
  Bot,
  BrainCircuit,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Lock,
  ScrollText,
  Shield,
  Sparkles,
} from 'lucide-react';
import { Link, useInRouterContext } from 'react-router-dom';
import { cn, EmptyDescription } from '@object-ui/components';
import { agentRouteName } from '@object-ui/plugin-chatbot/core';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';

interface ModelConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * "Try in chat" (objectui#10640).
 *
 * The link used to be the plain anchor `/console/ai/agents/NAME/chat`. The
 * console declares no path beginning with `/console`, so its root catch-all
 * sent the author home. It now points at the agent chat route the console
 * declares, `/ai/:agent`, which `AiChatPage` resolves against the live agent
 * catalog. The segment comes from `agentRouteName`, the helper that builds
 * `/ai/:agent` links: a custom agent routes by its own name, a built-in by its
 * friendly alias, the form the chat page canonicalizes to. The chat route is
 * app-less, so no app segment is carried.
 *
 * `new=1` is the chat page's explicit new-conversation intent (the same flag
 * its sidebar's New button sends), so the link opens the fresh chat its title
 * promises instead of resuming whatever thread was cached for the chat scope.
 *
 * Rendered through `Link`, so the router's basename is applied: the console
 * ships under a mount path (`/_console`), which a bare rooted `href` would step
 * outside of. The anchor still opens in a new tab, as the tool preview's
 * "Open in API Console" link does.
 *
 * With no router above the preview (the designer gallery harness) there is no
 * console to open the chat in, so no link is drawn rather than one that goes
 * nowhere.
 */
function AgentChatLink({ agentName, locale }: { agentName: string; locale?: string }) {
  // Rules-of-hooks safe: whether a router sits above is a fact about the
  // mount, and cannot change under it.
  return useInRouterContext() ? (
    <Link
      to={`/ai/${encodeURIComponent(agentRouteName(agentName))}?new=1`}
      target="_blank"
      rel="noreferrer"
      className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      title={tr('engine.agentPreview.tryInChatTitle', locale)}
    >
      {tr('engine.agentPreview.tryInChat', locale)} <ExternalLink className="h-3 w-3" />
    </Link>
  ) : null;
}

export function AgentPreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  const agentName = String(d.name ?? name ?? '');
  const label = String(d.label ?? agentName);
  const role = String(d.role ?? '');
  const avatar = (d.avatar as string | undefined) || undefined;
  const instructions = String(d.instructions ?? '');
  const active = d.active !== false;
  const model = (d.model ?? {}) as ModelConfig;
  const skills: string[] = Array.isArray(d.skills) ? (d.skills as string[]) : [];
  const planning = d.planning as Record<string, unknown> | undefined;
  const memory = d.memory as Record<string, unknown> | undefined;
  const guardrails = d.guardrails as Record<string, unknown> | undefined;
  const permissions = Array.isArray(d.permissions) ? (d.permissions as string[]) : [];

  if (!agentName && !instructions && skills.length === 0) {
    return (
      <PreviewShell hint="agent">
        <PreviewMessage>{tr('engine.agentPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell
      hint="agent"
      toolbar={agentName && <AgentChatLink agentName={agentName} locale={locale} />}
    >
      <PreviewErrorBoundary>
        <div className="grid lg:grid-cols-[1fr_240px] gap-0">
          <div className="p-3 space-y-3 min-w-0">
            {/* Persona header */}
            <div className="rounded border bg-muted/30 p-3 flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-background border flex items-center justify-center shrink-0 overflow-hidden">
                {avatar ? (
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Bot className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium truncate">{label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{agentName}</span>
                </div>
                {role && <div className="text-xs text-muted-foreground mt-0.5">{role}</div>}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <Pill
                    icon={active ? Eye : EyeOff}
                    label={tr(active ? 'engine.agentPreview.active' : 'engine.agentPreview.disabled', locale)}
                    tone={active ? 'green' : 'gray'}
                  />
                  {model.provider && <Pill icon={Sparkles} label={`${model.provider}${model.model ? ` · ${model.model}` : ''}`} mono />}
                  {model.temperature != null && (
                    <Pill icon={Gauge} label={tFormat('engine.agentPreview.temperature', locale, { value: String(model.temperature) })} />
                  )}
                  {model.maxTokens != null && (
                    <Pill label={tFormat('engine.agentPreview.maxTokens', locale, { count: String(model.maxTokens) })} />
                  )}
                </div>
              </div>
            </div>

            {/* System prompt */}
            <Section title={tr('engine.agentPreview.instructions', locale)} icon={ScrollText}>
              {instructions ? (
                <pre className="m-0 rounded border bg-background p-2.5 text-xs whitespace-pre-wrap font-mono max-h-[40vh] overflow-auto">
                  {instructions}
                </pre>
              ) : (
                <EmptyDescription className="text-xs italic">{tr('engine.agentPreview.noInstructions', locale)}</EmptyDescription>
              )}
            </Section>

            {/* Capabilities — skills only. `tools` is a retired tombstone
                (objectstack#3894); an agent's reachable tool surface IS the
                union of its skills' own `tools` (ADR-0064). */}
            <Section title={tr('engine.agentPreview.capabilities', locale)} icon={Sparkles}>
              <div className="space-y-2">
                <ChipList
                  label={tr('engine.agentPreview.skills', locale)}
                  emptyHint={tr('engine.agentPreview.noSkills', locale)}
                  items={skills.map((s) => ({ key: s, label: s }))}
                  icon={Sparkles}
                  tone="violet"
                  mono
                />
                <div className="text-[10px] text-muted-foreground">
                  {tr('engine.agentPreview.toolsNote', locale)}
                </div>
              </div>
            </Section>
          </div>

          {/* Side rail: planning / memory / guardrails / permissions */}
          <div className="border-l bg-muted/20 p-3 text-xs space-y-3">
            {planning && Object.keys(planning).length > 0 && (
              <RailBlock icon={BrainCircuit} title={tr('engine.agentPreview.planning', locale)}>
                <KeyVals data={planning} keys={['maxIterations']} locale={locale} />
              </RailBlock>
            )}
            {memory && Object.keys(memory).length > 0 && (
              <RailBlock icon={Activity} title={tr('engine.agentPreview.memory', locale)}>
                <KeyVals
                  data={{
                    'short.maxMessages': (memory.shortTerm as any)?.maxMessages,
                    'long.enabled': (memory.longTerm as any)?.enabled,
                    'long.store': (memory.longTerm as any)?.store,
                  }}
                  keys={['short.maxMessages', 'long.enabled', 'long.store']}
                  locale={locale}
                />
              </RailBlock>
            )}
            {guardrails && Object.keys(guardrails).length > 0 && (
              <RailBlock icon={Shield} title={tr('engine.agentPreview.guardrails', locale)}>
                <KeyVals
                  data={guardrails as Record<string, unknown>}
                  keys={Object.keys(guardrails).slice(0, 6)}
                  locale={locale}
                />
              </RailBlock>
            )}
            {permissions.length > 0 && (
              <RailBlock icon={Lock} title={tr('engine.agentPreview.permissions', locale)}>
                <ul className="space-y-0.5">
                  {permissions.map((p) => <li key={p} className="font-mono">{p}</li>)}
                </ul>
              </RailBlock>
            )}
            {!planning && !memory && !guardrails && permissions.length === 0 && (
              <EmptyDescription className="text-xs italic">{tr('engine.agentPreview.defaults', locale)}</EmptyDescription>
            )}
          </div>
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon className="h-3 w-3" />}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Tone preset for capability chips. Full Tailwind class strings (JIT)
 * with light + dark variants.
 */
const CHIP_TONE = {
  violet: {
    chip: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
    icon: 'text-violet-500 dark:text-violet-400',
  },
} as const;

function ChipList({
  label,
  emptyHint,
  items,
  icon: Icon,
  tone,
  mono = false,
}: {
  label: string;
  emptyHint: string;
  items: Array<{ key: string; label: string; hint?: string }>;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof CHIP_TONE;
  mono?: boolean;
}) {
  const t = tone ? CHIP_TONE[tone] : null;
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">{label}</div>
      {items.length === 0 ? (
        <EmptyDescription className="text-xs italic">{emptyHint}</EmptyDescription>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((it) => (
            <span
              key={it.key}
              className={cn(
                'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]',
                t ? t.chip : 'bg-background',
                mono && 'font-mono',
              )}
            >
              {Icon && <Icon className={cn('h-3 w-3 shrink-0', t?.icon)} />}
              {it.label}
              {it.hint && <span className="text-[9px] uppercase opacity-70">{it.hint}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RailBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground tracking-wider mb-1">
        <Icon className="h-3 w-3" /> {title}
      </div>
      {children}
    </div>
  );
}

function KeyVals({ data, keys, locale }: { data: Record<string, unknown>; keys: string[]; locale?: string }) {
  const rows = keys
    .map((k) => [k, getPath(data, k)] as const)
    .filter(([, v]) => v !== undefined && v !== null);
  // Empty COLLECTION, not an empty field value: every requested key resolved
  // to undefined/null, i.e. this rail block has no key/values at all. It used
  // to render a bare `—` in a plain <div>, which a screen reader reaches as an
  // unnamed punctuation mark (objectui#8520). `EmptyValue` is the wrong member
  // of the family here — its docblock scopes it to a missing cell/field VALUE
  // and its aria-label resolves `detail.noValue` ("No value"), a false
  // statement about a collection. `EmptyDescription` is the family's
  // block-level text slot and states the condition in words; the container
  // `Empty` is deliberately NOT used — measured at this rail's real 215px
  // width it is 118.8px tall against the 16px row it replaces (objectui#8520
  // PR body has the numbers). `text-xs italic` matches the sibling empty
  // states in this file and this directory.
  if (rows.length === 0)
    return <EmptyDescription className="text-xs italic">{tr('engine.agentPreview.noValues', locale)}</EmptyDescription>;
  return (
    <dl className="space-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <dt className="text-muted-foreground font-mono truncate">{k}</dt>
          <dd className="font-mono text-right truncate">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function Pill({
  icon: Icon,
  label,
  tone = 'gray',
  mono = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: 'gray' | 'green' | 'amber';
  mono?: boolean;
}) {
  const cls =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-foreground';
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className={`${cls} ${mono ? 'font-mono' : ''}`}>{label}</span>
    </span>
  );
}

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Connect an agent" — registered as the SDUI widget `mcp:connect-agent`
 * (framework#2714 Phase 1, #2363).
 *
 * The Setup page ships as METADATA with `@objectstack/mcp` (plugin-carried,
 * like the marketplace pages); this widget is the interactive body. It turns
 * the deployment's default-on MCP surface into a three-minute connect flow
 * for people who don't know what MCP is:
 *
 *   0. on top, in plain words, what a connected assistant can do (look up,
 *      create, change and delete the records you may, run actions — always
 *      as you), a few example requests to paste into the client, and which
 *      one to try first to see the connection work. The page cannot tell
 *      whether you have connected (#30894 owns that read), so the hint is
 *      shown to everyone and never derived from a click. Protocol words
 *      (MCP, OAuth, Streamable HTTP) appear only where a client's own form
 *      or menu asks for them,
 *   1. the environment's MCP URL (from `/discovery` → `routes.mcp`) + copy,
 *   2. the portable SKILL.md download (`GET /api/v1/mcp/skill`), beside the
 *      URL, for everyone,
 *   3. a picker that asks which client the person uses and shows only that
 *      client's steps — Claude (claude.ai / Claude Desktop and Claude Code),
 *      the Codex app, Cursor, then the Chinese clients WorkBuddy, Doubao Work
 *      and QwenWork. The choice is the reader's, kept on this browser
 *      (`CONNECT_CLIENT_PREFERENCE`); switching is one click.
 *      OAuth is the default story for every client (the deployment is its own
 *      authorization server; you sign in as yourself); the Chinese clients'
 *      steps name the API-key header as the fallback for a client version
 *      without the OAuth flow. claude.ai (web) and Doubao Work's cloud tasks
 *      connect from their vendor's servers, so on an address that is not
 *      public HTTPS (`deploymentReach.ts`) both are marked not available,
 *      with the reason and what makes them available; the local clients stay
 *      as they are,
 *   4. API-key minting for headless callers (CI, machine accounts) via the
 *      existing `POST /api/v1/keys`, in a collapsed "Advanced: scripts and CI"
 *      section at the bottom — no client, so not a peer of the clients.
 *      Shown once, copy-once. As on Setup → API Keys → Create Key, the key
 *      must be named (Create stays disabled on a blank name; nothing is
 *      minted under a default name), and an in-app confirm naming the key
 *      stands between the click and the mint.
 *
 * When `/discovery` does not advertise `routes.mcp` (deployment opted out via
 * `OS_MCP_SERVER_ENABLED=false`) the widget renders a disabled empty state —
 * mirroring the server, which 404s the whole surface.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  cn,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@object-ui/components';
import {
  Ban,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { TokenStorage } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
import { notifyDataChanged } from '@object-ui/react';
import { useWorkspacePreference } from '../../utils/workspacePreference.js';
import {
  CONNECT_CLIENT_IDS,
  CONNECT_CLIENT_PREFERENCE,
  DEFAULT_CONNECT_CLIENT,
  isConnectClientId,
  type ConnectClientId,
} from './connectClientPreference.js';
import { isPublicHttpsAddress } from './deploymentReach.js';
import { AuthorizedAccessList } from './AuthorizedAccessList.js';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');

/** Same-origin API calls need the Bearer token (see marketplaceApi.ts). */
function withEnvAuth(headers: Record<string, string>): Record<string, string> {
  const token = TokenStorage.get();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

/** Absolute MCP URL from the discovery-relative route. */
function absoluteUrl(path: string): string {
  const base = SERVER_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  try {
    return new URL(path, base || undefined).toString();
  } catch {
    return path;
  }
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable (non-secure context) — leave as-is */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label ? <span className="ml-1">{label}</span> : null}
    </Button>
  );
}

function Snippet({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} />
    </div>
  );
}

/**
 * Form-based clients (a "new connector" dialog rather than a config file):
 * the values to type into each field, each one copyable on its own.
 */
function FieldRows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <dt className="w-24 shrink-0 text-xs text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
            {row.value}
          </dd>
          <CopyButton text={row.value} />
        </div>
      ))}
    </dl>
  );
}

/** The scheme and host a reader recognises (`http://localhost:3000`), not the full MCP path. */
function addressOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * A way in this deployment's address cannot offer: what is not available,
 * why in one sentence, and what makes it available.
 */
function Unavailable({ title, reason, remedy }: { title: string; reason: string; remedy: string }) {
  return (
    <div role="note" className="flex gap-2 rounded-md border border-dashed px-3 py-2 text-xs">
      <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="space-y-0.5">
        <div className="font-medium">{title}</div>
        <p className="text-muted-foreground">{reason}</p>
        <p className="text-muted-foreground">{remedy}</p>
      </div>
    </div>
  );
}

/** The example requests the capabilities card offers, in the order shown; the first is the one to try first. */
const EXAMPLE_REQUEST_KEYS = [
  'connectAgent.capabilities.example1',
  'connectAgent.capabilities.example2',
  'connectAgent.capabilities.example3',
] as const;

/** The `mcpServers` JSON shape most clients import, with the client's own transport spelling. */
function mcpServersJson(type: string | null, url: string): string {
  const server = type ? { type, url } : { url };
  return JSON.stringify({ mcpServers: { objectstack: server } }, null, 2);
}

export function ConnectAgent() {
  const { t } = useObjectTranslation();
  const [loading, setLoading] = useState(true);
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [client, setClient] = useWorkspacePreference(
    CONNECT_CLIENT_PREFERENCE,
    'user',
    DEFAULT_CONNECT_CLIENT,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // API-key minting state
  const [keyName, setKeyName] = useState('');
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<{ name: string; key: string } | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  // The name the open confirm asks about; `null` = no confirm open. Captured
  // when the confirm opens so the name posted is the name the dialog showed.
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const trimmedKeyName = keyName.trim();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/v1/discovery`, { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        const routes = (json?.data ?? json)?.routes ?? {};
        setMcpUrl(typeof routes.mcp === 'string' ? absoluteUrl(routes.mcp) : null);
      } catch (e: any) {
        setLoadError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const skillUrl = mcpUrl ? `${mcpUrl}/skill` : null;
  // claude.ai (web) and Doubao Work's cloud tasks connect from their vendor's
  // servers: they reach only a public HTTPS address.
  const cloudReachable = mcpUrl ? isPublicHttpsAddress(mcpUrl) : false;
  const shownAddress = mcpUrl ? addressOf(mcpUrl) : '';

  const cursorDeeplink = useMemo(() => {
    if (!mcpUrl) return null;
    // Cursor install deeplink: base64(JSON server config) in the query.
    const config = btoa(JSON.stringify({ url: mcpUrl }));
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=objectstack&config=${encodeURIComponent(config)}`;
  }, [mcpUrl]);

  // Brand names stay as the client spells them; the two Chinese clients'
  // names are translated (their English names differ from their Chinese ones).
  const clientLabels: Record<ConnectClientId, string> = {
    claude: 'Claude',
    codex: 'Codex',
    cursor: 'Cursor',
    workbuddy: 'WorkBuddy',
    doubao: t('connectAgent.doubao.title'),
    qwenwork: t('connectAgent.qwenwork.title'),
  };

  const mintKey = async (name: string) => {
    // A key is always minted under the name the administrator typed — never
    // a default one (the route would otherwise store an anonymous key).
    if (!name) return;
    setMinting(true);
    setMintError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/v1/keys`, {
        method: 'POST',
        credentials: 'include',
        headers: withEnvAuth({ 'content-type': 'application/json' }),
        body: JSON.stringify({ name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error?.message ?? json?.error ?? `HTTP ${res.status}`);
      }
      const data = json?.data ?? json;
      setMinted({ name: data?.name ?? name, key: data?.key ?? '' });
      setKeyName('');
      // The mint bypasses the adapter, so tell the key list below it changed.
      notifyDataChanged({ objectName: 'sys_api_key' });
    } catch (e: any) {
      setMintError(e?.message ?? String(e));
    } finally {
      setMinting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!mcpUrl) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <div className="font-medium text-foreground">{t('connectAgent.disabled.title')}</div>
            <div className="text-sm">
              {loadError ? loadError : t('connectAgent.disabled.body')}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── What a connected assistant can do, and what to ask it first ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            {t('connectAgent.capabilities.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{t('connectAgent.capabilities.body')}</p>
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">
              {t('connectAgent.capabilities.examplesTitle')}
            </h4>
            <ul className="space-y-1.5">
              {EXAMPLE_REQUEST_KEYS.map((key) => {
                const request = t(key);
                return (
                  <li key={key} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 rounded-md bg-muted px-3 py-1.5">{request}</span>
                    <CopyButton text={request} />
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">{t('connectAgent.capabilities.tryFirst')}</p>
        </CardContent>
      </Card>

      {/* ── Connection address + skill download ──────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            {t('connectAgent.url.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('connectAgent.url.body')}</p>
          <Snippet text={mcpUrl} />
          <div className="flex flex-wrap items-center gap-2">
            {skillUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={skillUrl} download="SKILL.md">
                  <Download className="mr-1 h-3.5 w-3.5" />
                  {t('connectAgent.url.downloadSkill')}
                </a>
              </Button>
            )}
            <span className="text-xs text-muted-foreground">{t('connectAgent.url.skillHint')}</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Which client: one client's steps at a time ─────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('connectAgent.client.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('connectAgent.client.hint')}</p>
        </CardHeader>
        <CardContent>
          <Tabs
            value={client}
            onValueChange={(next) => {
              if (isConnectClientId(next)) setClient(next);
            }}
          >
            <TabsList className="h-auto flex-wrap justify-start">
              {CONNECT_CLIENT_IDS.map((id) => (
                <TabsTrigger key={id} value={id}>
                  {clientLabels[id]}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Claude: two ways in — the claude.ai / Desktop connector and the
                Claude Code CLI. */}
            <TabsContent value="claude" className="grid gap-4 text-sm lg:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <h4 className="font-medium">claude.ai / Claude Desktop</h4>
                <p className="text-muted-foreground">{t('connectAgent.claude.body')}</p>
                <Snippet text={mcpUrl} />
                {cloudReachable ? (
                  <p className="text-xs text-muted-foreground">{t('connectAgent.claude.reachability')}</p>
                ) : (
                  <Unavailable
                    title={t('connectAgent.unreachable.claudeWebTitle')}
                    reason={t('connectAgent.unreachable.claudeWebReason', { address: shownAddress })}
                    remedy={t('connectAgent.unreachable.remedy')}
                  />
                )}
              </div>
              <div className="min-w-0 space-y-2">
                <h4 className="font-medium">Claude Code</h4>
                <p className="text-muted-foreground">{t('connectAgent.claudeCode.body')}</p>
                <Snippet text={`claude mcp add --transport http objectstack ${mcpUrl}`} />
                <p className="text-muted-foreground">{t('connectAgent.claudeCode.plugin')}</p>
                <Snippet text={'claude plugin marketplace add objectstack-ai/claude-plugin'} />
              </div>
            </TabsContent>

            <TabsContent value="codex" className="space-y-2 text-sm">
              <p className="text-muted-foreground">{t('connectAgent.codex.body')}</p>
              <FieldRows
                rows={[
                  { label: t('connectAgent.fields.name'), value: 'objectstack' },
                  { label: t('connectAgent.fields.transport'), value: 'Streamable HTTP' },
                  { label: t('connectAgent.fields.url'), value: mcpUrl },
                ]}
              />
              <p className="text-xs text-muted-foreground">{t('connectAgent.codex.hint')}</p>
            </TabsContent>

            <TabsContent value="cursor" className="space-y-2 text-sm">
              {cursorDeeplink && (
                <Button variant="outline" size="sm" asChild>
                  <a href={cursorDeeplink}>
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    {t('connectAgent.cursor.addButton')}
                  </a>
                </Button>
              )}
              <p className="text-muted-foreground">{t('connectAgent.cursor.body')}</p>
              <Snippet text={mcpServersJson(null, mcpUrl)} />
            </TabsContent>

            <TabsContent value="workbuddy" className="space-y-2 text-sm">
              <p className="text-muted-foreground">{t('connectAgent.workbuddy.body')}</p>
              <Snippet text={mcpServersJson('streamableHttp', mcpUrl)} />
              <p className="text-xs text-muted-foreground">{t('connectAgent.workbuddy.hint')}</p>
            </TabsContent>

            <TabsContent value="doubao" className="space-y-2 text-sm">
              <p className="text-muted-foreground">{t('connectAgent.doubao.body')}</p>
              <FieldRows
                rows={[
                  { label: t('connectAgent.fields.name'), value: 'objectstack' },
                  { label: t('connectAgent.fields.transport'), value: 'HTTP' },
                  { label: t('connectAgent.fields.url'), value: mcpUrl },
                ]}
              />
              <p className="text-xs text-muted-foreground">{t('connectAgent.doubao.hint')}</p>
              {!cloudReachable && (
                <Unavailable
                  title={t('connectAgent.unreachable.doubaoCloudTitle')}
                  reason={t('connectAgent.unreachable.doubaoCloudReason', { address: shownAddress })}
                  remedy={t('connectAgent.unreachable.remedy')}
                />
              )}
            </TabsContent>

            <TabsContent value="qwenwork" className="space-y-2 text-sm">
              <p className="text-muted-foreground">{t('connectAgent.qwenwork.body')}</p>
              <Snippet text={mcpServersJson('streamable-http', mcpUrl)} />
              <p className="text-xs text-muted-foreground">{t('connectAgent.qwenwork.hint')}</p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ── Advanced: API keys for scripts and CI, collapsed ─────────────── */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground">
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-90')}
            />
            {t('connectAgent.advanced.title')}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                {t('connectAgent.apiKey.title')}
                <Badge variant="secondary">{t('connectAgent.apiKey.badge')}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{t('connectAgent.apiKey.body')}</p>
              {minted ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {t('connectAgent.apiKey.showOnce', { name: minted.name })}
                  </p>
                  <Snippet text={minted.key} />
                  <Snippet text={`x-api-key: ${minted.key}`} />
                  <Snippet text={`Authorization: Bearer ${minted.key}`} />
                  <Button variant="outline" size="sm" onClick={() => setMinted(null)}>
                    {t('connectAgent.apiKey.done')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    value={keyName}
                    onChange={(e: any) => setKeyName(e.target.value)}
                    placeholder={t('connectAgent.apiKey.namePlaceholder')}
                    className="h-8 max-w-56"
                  />
                  <Button
                    size="sm"
                    onClick={() => setConfirmName(trimmedKeyName)}
                    disabled={minting || !trimmedKeyName}
                  >
                    {minting ? t('connectAgent.apiKey.minting') : t('connectAgent.apiKey.mint')}
                  </Button>
                </div>
              )}
              <AlertDialog
                open={confirmName !== null}
                onOpenChange={(open) => {
                  if (!open) setConfirmName(null);
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t('connectAgent.apiKey.confirmTitle', { name: confirmName ?? '' })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{t('connectAgent.apiKey.body')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        const name = confirmName ?? '';
                        setConfirmName(null);
                        void mintKey(name);
                      }}
                    >
                      {t('connectAgent.apiKey.mint')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {mintError && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" /> {mintError}
                </p>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* ── What can act as you: authorized assistants and API keys ──────── */}
      <AuthorizedAccessList />
    </div>
  );
}

// SDUI registration — the metadata page shipped by @objectstack/mcp
// references this widget by type.
ComponentRegistry.register('mcp:connect-agent', () => <ConnectAgent />, {
  namespace: 'app-shell',
  label: 'Connect an Agent',
  category: 'plugin',
  inputs: [],
});

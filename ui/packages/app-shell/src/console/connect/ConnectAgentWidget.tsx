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
 *   1. the environment's MCP URL (from `/discovery` → `routes.mcp`) + copy,
 *   2. per-client connect cards (claude.ai / Claude Desktop / Claude Code /
 *      Cursor deeplink / VS Code / Codex CLI) with copy-paste-ready content —
 *      OAuth is the default story on every card (the deployment is its own
 *      authorization server; you sign in as yourself),
 *   3. the portable SKILL.md download (`GET /api/v1/mcp/skill`),
 *   4. API-key minting for headless callers (CI, machine accounts) via the
 *      existing `POST /api/v1/keys` — shown once, copy-once. As on Setup →
 *      API Keys → Create Key, the key must be named (Create stays disabled
 *      on a blank name; nothing is minted under a default name), and an
 *      in-app confirm naming the key stands between the click and the mint.
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
  Input,
  Skeleton,
} from '@object-ui/components';
import {
  Bot,
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  AlertCircle,
} from 'lucide-react';
import { TokenStorage } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';

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
      <pre className="flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} />
    </div>
  );
}

export function ConnectAgent() {
  const { t } = useObjectTranslation();
  const [loading, setLoading] = useState(true);
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const cursorDeeplink = useMemo(() => {
    if (!mcpUrl) return null;
    // Cursor install deeplink: base64(JSON server config) in the query.
    const config = btoa(JSON.stringify({ url: mcpUrl }));
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=objectstack&config=${encodeURIComponent(config)}`;
  }, [mcpUrl]);

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
      {/* ── MCP URL + skill download ─────────────────────────────────── */}
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

      {/* ── Per-client cards ─────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Claude (claude.ai / Desktop)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">{t('connectAgent.claude.body')}</p>
            <Snippet text={mcpUrl} />
            <p className="text-xs text-muted-foreground">{t('connectAgent.claude.reachability')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Claude Code</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">{t('connectAgent.claudeCode.body')}</p>
            <Snippet text={`claude mcp add --transport http objectstack ${mcpUrl}`} />
            <p className="text-muted-foreground">{t('connectAgent.claudeCode.plugin')}</p>
            <Snippet text={'claude plugin marketplace add objectstack-ai/claude-plugin'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              Cursor
              {cursorDeeplink && (
                <Button variant="outline" size="sm" asChild>
                  <a href={cursorDeeplink}>
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    {t('connectAgent.cursor.addButton')}
                  </a>
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">{t('connectAgent.cursor.body')}</p>
            <Snippet
              text={JSON.stringify({ mcpServers: { objectstack: { url: mcpUrl } } }, null, 2)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">VS Code / Copilot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">{t('connectAgent.vscode.body')}</p>
            <Snippet
              text={JSON.stringify(
                { servers: { objectstack: { type: 'http', url: mcpUrl } } },
                null,
                2,
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Codex CLI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">{t('connectAgent.codex.body')}</p>
            <Snippet text={`[mcp_servers.objectstack]\nurl = "${mcpUrl}"`} />
          </CardContent>
        </Card>

        {/* ── API keys (headless) ──────────────────────────────────── */}
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
      </div>
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

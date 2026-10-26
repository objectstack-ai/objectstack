/**
 * AgentConnectSection (ADR-0036 Phase 2b)
 *
 * Surfaces "connect an AI agent to this environment over MCP" on the
 * Integrations page: shows the env's MCP endpoint (from /discovery, opt-in via
 * OS_MCP_SERVER_ENABLED), mints a show-once API key (POST /api/v1/keys), offers
 * a one-click portable Skill download, and gives copy-paste connect steps.
 *
 * The key is minted only under a name the administrator chose, and only after
 * an in-app confirm naming it (objectui#13383, the sibling of the Connect an
 * Agent card's objectui#13355): "Generate key" stays disabled on a blank name,
 * the name is posted trimmed with no default, and the confirm stands between
 * the click and the mint. The `Agent key` prefill stays: a prefilled name the
 * administrator confirms in that dialog is a chosen name.
 *
 * One connection per ENVIRONMENT (not per app) — the agent discovers apps/
 * objects live via the MCP tools, so a new app needs no reinstall.
 */

import { useEffect, useState, type ChangeEvent } from 'react';
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
  CardDescription,
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Alert,
  AlertTitle,
  AlertDescription,
} from '@object-ui/components';
import { Bot, KeyRound, Copy, Check, Download, ShieldAlert } from 'lucide-react';
import { readEnvelopeFailureText } from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';

import { SLOT, withSlots } from '../../lib/inlineSlots';
import { renderObjectStackSkill } from './objectstack-skill';

interface GeneratedKey {
  id?: string;
  name?: string;
  prefix?: string;
  key: string;
}

function useCopy(): [boolean, (v: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (v: string) => {
    void navigator.clipboard?.writeText(v);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return [copied, copy];
}

/** `ariaLabel` is the button's whole translated name (objectui#13460), never glued from parts. */
function InlineCopy({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const { t } = useObjectTranslation();
  const [copied, copy] = useCopy();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={() => copy(value)}
      aria-label={ariaLabel}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? t('console.developer.integrations.copied', { defaultValue: 'Copied' }) : t('console.developer.integrations.copy', { defaultValue: 'Copy' })}
    </Button>
  );
}

export function AgentConnectSection() {
  const { t } = useObjectTranslation();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [mcpEnabled, setMcpEnabled] = useState<boolean | null>(null);

  const [keyName, setKeyName] = useState('Agent key');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedKey | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keyCopied, copyKey] = useCopy();
  // The name the open confirm asks about; `null` = no confirm open. Captured
  // when the confirm opens so the name posted is the name the dialog showed.
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const trimmedKeyName = keyName.trim();

  // Discover whether MCP is enabled + its URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/discovery', { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        const route: string | undefined = json?.data?.routes?.mcp ?? json?.routes?.mcp;
        if (cancelled) return;
        if (route) {
          setMcpUrl(route.startsWith('http') ? route : `${origin}${route}`);
          setMcpEnabled(true);
        } else {
          setMcpEnabled(false);
        }
      } catch {
        if (!cancelled) setMcpEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [origin]);

  const generateKey = async (name: string) => {
    // A key is always minted under the name the administrator confirmed —
    // never a default one.
    if (!name) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json().catch(() => ({}));
      const data = json?.data;
      // Two failure modes, two sentences (objectui#8782). They used to share
      // one `throw`, so a SUCCESSFUL response that simply carried no key was
      // reported as `Request failed (200)` -- naming the one layer known to
      // have worked, and sending the reader to the transport, which is the
      // wrong layer. A wrong pointer costs more than no pointer.
      if (!res.ok) {
        // objectui#7980 — the ADR-0112 failure envelope is read by the ONE
        // shared rule (`readEnvelopeFailureText`, pinned in app-shell's
        // `apiErrorEnvelope.test.ts`), not by a fourth local reading of it.
        // This used to be `json?.error?.message`, which dropped two declared
        // things: the producer's marked `error.userMessage` — the #9934 channel
        // whose PRESENCE is the marking, and which rides through the 5xx prose
        // withhold untouched, so a marked 500/503 showed the developer the
        // generic `Internal server error` and discarded the sentence written
        // for them — and `error.code`, which never reached the surface at all.
        // `??`, not `||`: the helper answers `null` for a body carrying no
        // prose (never an empty string), and that `null` is exactly the signal
        // to state this caller's own fallback below.
        throw new Error(
          readEnvelopeFailureText(json)
            ?? t('console.developer.agentConnect.requestFailed', {
              defaultValue: 'Request failed ({{status}})',
              status: res.status,
            }),
        );
      }
      if (!data?.key) {
        // Reachability of this arm, measured rather than assumed: the mint
        // route's ONLY success is `201` and it always carries `data.key`
        // (objectstack `packages/runtime/src/domains/keys.ts`, pinned in
        // `http-dispatcher.keys.test.ts`), so this is not the route emitting a
        // keyless success -- it cannot. This is where the `.catch(() => ({}))`
        // three lines above lands every 2xx whose body is NOT that envelope:
        // an SSO or proxy interstitial answering `200` with HTML, an empty
        // body, a gateway page. Those are exactly the responses for which
        // "request failed" misdirects hardest, so the status is deliberately
        // absent from the sentence below -- quoting a 2xx here is what made
        // the old message read as a transport failure that never happened.
        throw new Error(
          t('console.developer.agentConnect.noKeyInResponse', {
            defaultValue:
              'The request succeeded but the response carried no API key. Nothing failed in transit — inspect the response body of {{route}}.',
            route: 'POST /api/v1/keys',
          }),
        );
      }
      setGenerated(data as GeneratedKey);
      setDialogOpen(true);
    } catch (e) {
      setError(
        (e as Error)?.message
          ?? t('console.developer.agentConnect.generateFailed', { defaultValue: 'Failed to generate key' }),
      );
    } finally {
      setGenerating(false);
    }
  };

  const downloadSkill = () => {
    const md = renderObjectStackSkill({ mcpUrl: mcpUrl ?? undefined });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'SKILL.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const effectiveUrl = mcpUrl ?? `${origin}/api/v1/mcp`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="size-4" /> {t('console.developer.agentConnect.title', { defaultValue: 'Connect an AI agent (MCP)' })}
        </CardTitle>
        <CardDescription className="text-xs">
          {t('console.developer.agentConnect.description', {
            defaultValue:
              'Every app in this environment is an agent-ready toolset. Connect Claude, Cursor, Codex or any MCP client — one connection covers all your apps (new ones appear automatically).',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* MCP endpoint */}
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t('console.developer.agentConnect.endpoint', { defaultValue: 'MCP endpoint' })}</div>
          {mcpEnabled === false ? (
            <Alert>
              <ShieldAlert className="size-4" />
              <AlertTitle>{t('console.developer.agentConnect.disabledTitle', { defaultValue: 'MCP is not enabled for this environment' })}</AlertTitle>
              <AlertDescription className="text-xs">
                {withSlots(
                  t('console.developer.agentConnect.disabledBody', {
                    defaultValue:
                      'Connecting agents is opt-in. An admin can enable it by setting {{flag}}. You can still generate a key and download the skill below.',
                    flag: SLOT[0],
                  }),
                  [<code key="flag" className="font-mono">OS_MCP_SERVER_ENABLED=true</code>],
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">
                {effectiveUrl}
              </code>
              <InlineCopy
                value={effectiveUrl}
                ariaLabel={t('console.developer.agentConnect.copyMcpUrl', { defaultValue: 'Copy MCP URL' })}
              />
            </div>
          )}
        </div>

        {/* Generate key */}
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <KeyRound className="size-3.5" /> {t('console.developer.agentConnect.apiKey', { defaultValue: 'API key' })}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={keyName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyName(e.target.value)}
              placeholder={t('console.developer.agentConnect.keyNamePlaceholder', {
                defaultValue: 'Key name (e.g. Claude desktop)',
              })}
              className="h-8 max-w-xs text-sm"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => setConfirmName(trimmedKeyName)}
              disabled={generating || !trimmedKeyName}
            >
              {generating
                ? t('console.developer.agentConnect.generating', { defaultValue: 'Generating…' })
                : t('console.developer.agentConnect.generateKey', { defaultValue: 'Generate key' })}
            </Button>
          </div>
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
                    void generateKey(name);
                  }}
                >
                  {t('connectAgent.apiKey.mint')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('console.developer.agentConnect.keyHint', {
              defaultValue:
                'The key acts as you (your permissions + row-level security). Shown once — copy it immediately. Revoke anytime from the API Keys list.',
            })}
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>

        {/* Skill */}
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t('console.developer.agentConnect.skillTitle', { defaultValue: 'Agent skill (portable)' })}</div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={downloadSkill}>
              <Download className="size-4" /> {t('connectAgent.url.downloadSkill', { defaultValue: 'Download SKILL.md' })}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('console.developer.agentConnect.skillHint', {
                defaultValue: 'Works with any skills-capable agent (Claude, Codex, Gemini, Cursor…).',
              })}
            </span>
          </div>
        </div>

        {/* Connect steps */}
        <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed">
          <div className="mb-1 font-medium">{t('console.developer.agentConnect.stepsTitle', { defaultValue: 'Connect in 3 steps' })}</div>
          <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
            <li>{t('console.developer.agentConnect.step1', { defaultValue: 'Add a remote MCP server pointing at the endpoint above.' })}</li>
            <li>
              {withSlots(
                t('console.developer.agentConnect.step2', {
                  defaultValue: 'Set the header {{header}} (a session Bearer token is not an API key).',
                  header: SLOT[0],
                }),
                [<code key="header" className="font-mono">x-api-key: &lt;your key&gt;</code>],
              )}
            </li>
            <li>
              {withSlots(
                t('console.developer.agentConnect.step3', {
                  defaultValue: 'Drop in {{file}} so the agent knows how to drive your data.',
                  file: SLOT[0],
                }),
                [<code key="file" className="font-mono">SKILL.md</code>],
              )}
            </li>
          </ol>
        </div>
      </CardContent>

      {/* Show-once key dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> {t('console.developer.agentConnect.newKeyTitle', { defaultValue: 'Your new API key' })}
            </DialogTitle>
            <DialogDescription>
              {withSlots(
                t('console.developer.agentConnect.newKeyDescription', {
                  defaultValue: 'Copy this now — {{notice}}',
                  notice: SLOT[0],
                }),
                [
                  <strong key="notice">
                    {t('console.developer.agentConnect.newKeyNotice', {
                      defaultValue: 'for your security it will not be shown again.',
                    })}
                  </strong>,
                ],
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-muted px-2 py-2 font-mono text-xs">
                {generated?.key}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => generated && copyKey(generated.key)}
              >
                {keyCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {keyCopied ? t('console.developer.integrations.copied', { defaultValue: 'Copied' }) : t('console.developer.integrations.copy', { defaultValue: 'Copy' })}
              </Button>
            </div>
            <Alert>
              <ShieldAlert className="size-4" />
              <AlertDescription className="text-xs">
                {withSlots(
                  t('console.developer.agentConnect.sendAs', {
                    defaultValue:
                      'Send it as {{header}}. It carries your permissions — store it like a password and revoke it if leaked.',
                    header: SLOT[0],
                  }),
                  [<code key="header" className="font-mono">x-api-key</code>],
                )}
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setDialogOpen(false)}>
              {t('common.done', { defaultValue: 'Done' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

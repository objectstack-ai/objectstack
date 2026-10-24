/**
 * ObjectUI — ShareDialog
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Platform-level share-link dialog. Mirrors the "anyone with the link"
 * pattern from Notion / Figma:
 *
 *   • Object opts in via `publicSharing.enabled` on the spec.
 *   • Each record can mint one or more capability tokens.
 *   • Tokens carry a permission, an audience, an optional expiry,
 *     an optional password, and an optional email allowlist.
 *
 * The dialog is intentionally driven by props rather than a hook so it
 * can be reused from the AI page, the floating chatbot panel, record
 * detail views, and any other surface — all of which already know their
 * `apiBase`, `objectName`, and `recordId`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Link2, Loader2, ShieldOff, Trash2 } from 'lucide-react';
import type {
  ShareLink as SpecShareLink,
  ShareLinkAudience,
  ShareLinkPermission,
} from '@objectstack/spec/contracts';

import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Badge } from '../ui/badge';
import { cn } from '../lib/utils';

/**
 * The share-link vocabulary is the framework's, so this dialog uses the
 * framework's bindings rather than the copies it used to declare
 * (objectstack#4115). The two enums were member-for-member identical — the
 * comment further down already said "audience values match the framework's
 * `ShareLinkAudience` contract", which is a claim only an import can keep.
 */
export type { ShareLinkPermission, ShareLinkAudience };

/**
 * A share link as the BROWSER receives it.
 *
 * The spec's `ShareLink` is the stored row; this is the same row minus the one
 * field that must never cross the wire. Deriving means a new spec field is
 * typed here the day it ships, while the two deltas stay visible and bounded:
 *
 *  - `password_hash` is omitted, not optional. It is the credential itself;
 *    typing it in a browser package is an invitation to render it.
 *  - `password_protected` is the boolean projection the UI needs in its place.
 *  - `created_at` is widened to `| null`, matching every other timestamp on the
 *    spec's own row (`expires_at`, `revoked_at`, `last_used_at`).
 *
 * Pinned by `__tests__/share-filter-sort-spec-parity.test.ts`.
 */
export type ShareLink = Omit<SpecShareLink, 'password_hash' | 'created_at'> & {
  /** Whether a password is set — the server's stand-in for `password_hash`. */
  password_protected?: boolean;
  /** ISO timestamp; `null` when the row predates audit stamping. */
  created_at?: string | null;
};

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** Object machine name, e.g. `'ai_conversations'`. */
  objectName: string;
  /** Record primary key. */
  recordId: string;
  /** Human label used in the dialog header (defaults to "this record"). */
  recordLabel?: string;

  /** Absolute API base for the framework, e.g. `'/api'`. */
  apiBase: string;
  /**
   * Where the public landing page lives, used to build the copyable URL.
   * Defaults to `${origin}/s/:token`.
   */
  publicBaseUrl?: string;

  /** Extra headers merged into every fetch (auth, tenant, etc). */
  fetchHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

interface CreateLinkDraft {
  permission: ShareLinkPermission;
  audience: ShareLinkAudience;
  expiresInDays: number | null;
  password: string;
  label: string;
}

const DEFAULT_DRAFT: CreateLinkDraft = {
  permission: 'view',
  audience: 'link_only',
  expiresInDays: 7,
  password: '',
  label: '',
};

const EXPIRY_OPTIONS: { label: string; value: number | null }[] = [
  { label: '1 day', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: 'Never', value: null },
];

// Audience values match the framework's ShareLinkAudience contract
// (@objectstack/spec). Only the two that need no extra input are offered;
// 'email' (allowlist) / 'public' require UI not yet built. The target
// object's `publicSharing.allowedAudiences` further constrains this — the
// server returns 422 AUDIENCE_NOT_ALLOWED if a value is not permitted.
const AUDIENCE_OPTIONS: { value: ShareLinkAudience; label: string; help: string }[] = [
  { value: 'link_only', label: 'Anyone with the link', help: 'No sign-in required' },
  { value: 'signed_in', label: 'Signed-in users', help: 'Must be logged in to view' },
];

function buildPublicUrl(base: string | undefined, token: string): string {
  const root =
    base ?? (typeof window !== 'undefined' ? `${window.location.origin}/s` : `/s`);
  return `${root.replace(/\/+$/, '')}/${token}`;
}

async function copyToClipboard(text: string) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      document.body.removeChild(ta);
    }
  }
  return false;
}

export function ShareDialog({
  open,
  onOpenChange,
  objectName,
  recordId,
  recordLabel,
  apiBase,
  publicBaseUrl,
  fetchHeaders,
}: ShareDialogProps) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreateLinkDraft>(DEFAULT_DRAFT);
  const [justCopied, setJustCopied] = useState<string | null>(null);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const base: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!fetchHeaders) return base;
    const extra = await fetchHeaders();
    return { ...base, ...extra };
  }, [fetchHeaders]);

  const listUrl = useMemo(
    () =>
      `${apiBase.replace(/\/+$/, '')}/v1/share-links?object=${encodeURIComponent(
        objectName,
      )}&recordId=${encodeURIComponent(recordId)}`,
    [apiBase, objectName, recordId],
  );

  const loadLinks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await headers();
      const res = await fetch(listUrl, { headers: h, credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { links?: ShareLink[]; data?: ShareLink[] };
      setLinks(body.links ?? body.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load share links');
    } finally {
      setLoading(false);
    }
  }, [listUrl, headers]);

  useEffect(() => {
    if (open) {
      void loadLinks();
      setDraft(DEFAULT_DRAFT);
    }
  }, [open, loadLinks]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const expiresAt =
        draft.expiresInDays == null
          ? undefined
          : new Date(Date.now() + draft.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
      const h = await headers();
      const res = await fetch(`${apiBase.replace(/\/+$/, '')}/v1/share-links`, {
        method: 'POST',
        headers: h,
        credentials: 'include',
        body: JSON.stringify({
          object: objectName,
          recordId,
          permission: draft.permission,
          audience: draft.audience,
          expiresAt,
          password: draft.password.trim() || undefined,
          label: draft.label.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      const created = (await res.json()) as { link?: ShareLink; data?: ShareLink };
      const newLink = created.link ?? created.data;
      if (!newLink) throw new Error('Share link create response missing link payload');
      setLinks((prev) => [newLink, ...prev]);
      const url = buildPublicUrl(publicBaseUrl, newLink.token);
      const copied = await copyToClipboard(url);
      if (copied) {
        setJustCopied(newLink.id);
        setTimeout(() => setJustCopied(null), 1500);
      }
      setDraft(DEFAULT_DRAFT);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create share link');
    } finally {
      setCreating(false);
    }
  }, [apiBase, headers, objectName, recordId, draft, publicBaseUrl]);

  const handleRevoke = useCallback(
    async (link: ShareLink) => {
      try {
        const h = await headers();
        const res = await fetch(
          `${apiBase.replace(/\/+$/, '')}/v1/share-links/${encodeURIComponent(link.id)}`,
          { method: 'DELETE', headers: h, credentials: 'include' },
        );
        if (!res.ok && res.status !== 204) {
          throw new Error(`HTTP ${res.status}`);
        }
        setLinks((prev) =>
          prev.map((l) =>
            l.id === link.id ? { ...l, revoked_at: new Date().toISOString() } : l,
          ),
        );
      } catch (err: any) {
        setError(err?.message ?? 'Failed to revoke link');
      }
    },
    [apiBase, headers],
  );

  const handleCopy = useCallback(
    async (link: ShareLink) => {
      const url = buildPublicUrl(publicBaseUrl, link.token);
      const ok = await copyToClipboard(url);
      if (ok) {
        setJustCopied(link.id);
        setTimeout(() => setJustCopied(null), 1500);
      }
    },
    [publicBaseUrl],
  );

  const activeLinks = links.filter((l) => !l.revoked_at);
  const revokedLinks = links.filter((l) => l.revoked_at);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Share {recordLabel ?? 'this record'}
          </DialogTitle>
          <DialogDescription>
            Generate a link anyone (or selected people) can use to open this record.
            Links can be revoked at any time.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="share-dialog-error"
          >
            {error}
          </div>
        )}

        {/* Create form */}
        <section className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Who can access</Label>
              <Select
                value={draft.audience}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, audience: v as ShareLinkAudience }))
                }
              >
                <SelectTrigger className="h-8 text-xs" data-testid="share-audience">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground">{opt.help}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Expires in</Label>
              <Select
                value={draft.expiresInDays == null ? 'never' : String(draft.expiresInDays)}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    expiresInDays: v === 'never' ? null : Number(v),
                  }))
                }
              >
                <SelectTrigger className="h-8 text-xs" data-testid="share-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem
                      key={String(opt.value)}
                      value={opt.value == null ? 'never' : String(opt.value)}
                      className="text-xs"
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Password (optional)</Label>
              <Input
                type="password"
                value={draft.password}
                onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
                placeholder="Require a password to open"
                className="h-8 text-xs"
                data-testid="share-password"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Label (only you see this)</Label>
              <Input
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="e.g. Sent to design review"
                className="h-8 text-xs"
                data-testid="share-label"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={creating}
              data-testid="share-create"
            >
              {creating ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Link2 className="mr-1 h-3 w-3" />
              )}
              Create link
            </Button>
          </div>
        </section>

        {/* Existing links */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">
              Existing links{activeLinks.length ? ` (${activeLinks.length})` : ''}
            </h4>
            {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          {!loading && activeLinks.length === 0 && revokedLinks.length === 0 && (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              No share links yet. Create one above.
            </p>
          )}
          <ul className="space-y-2">
            {activeLinks.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                copied={justCopied === link.id}
                onCopy={() => handleCopy(link)}
                onRevoke={() => handleRevoke(link)}
                publicBaseUrl={publicBaseUrl}
              />
            ))}
            {revokedLinks.length > 0 && (
              <li className="pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                Revoked
              </li>
            )}
            {revokedLinks.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                copied={false}
                onCopy={() => handleCopy(link)}
                onRevoke={() => handleRevoke(link)}
                publicBaseUrl={publicBaseUrl}
                disabled
              />
            ))}
          </ul>
        </section>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface LinkRowProps {
  link: ShareLink;
  copied: boolean;
  onCopy: () => void;
  onRevoke: () => void;
  publicBaseUrl?: string;
  disabled?: boolean;
}

function LinkRow({ link, copied, onCopy, onRevoke, publicBaseUrl, disabled }: LinkRowProps) {
  const url = buildPublicUrl(publicBaseUrl, link.token);
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-md border bg-card px-2 py-2 text-xs',
        disabled && 'opacity-60',
      )}
      data-testid="share-link-row"
    >
      <Badge variant="secondary" className="text-[10px] capitalize">
        {link.audience.replace('_', ' ')}
      </Badge>
      <Badge variant="outline" className="text-[10px] capitalize">
        {link.permission}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11px]" title={url}>
          {url}
        </div>
        {link.label && (
          <div className="truncate text-[10px] text-muted-foreground">{link.label}</div>
        )}
      </div>
      {!disabled && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onCopy}
            data-testid="share-link-copy"
          >
            <Copy className="mr-1 h-3 w-3" />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={onRevoke}
            data-testid="share-link-revoke"
            title="Revoke"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </>
      )}
      {disabled && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <ShieldOff className="h-3 w-3" />
          revoked
        </span>
      )}
    </li>
  );
}

export default ShareDialog;

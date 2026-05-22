// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Public Forms preset — surfaces every `view` metadata item with
 * `sharing.allowAnonymous === true && sharing.publicLink`.
 *
 * Each row exposes:
 *   • the public URL (`/console/f/:slug`)
 *   • copy actions for raw URL, `<iframe>`, and React snippets
 *   • a preview link that opens the form in a new tab
 *
 * This is the customer-facing entry point for the Web-to-Lead /
 * Web-to-Case shape documented in `content/docs/guides/public-forms.mdx`.
 */

import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useClient } from '@objectstack/client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, ExternalLink, FormInput, RefreshCw, Code2, Link2, Settings2, Plus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

/** Shape of a `view` metadata row, narrowed for the Public Forms lens. */
interface PublicFormRow {
  name: string;
  label?: string;
  object?: string;
  slug: string;
  publicLink: string;
  updatedAt?: string;
  spec: any;
}

/** Non-public FormView candidate for the "Publish form" picker. */
interface PublishableFormRow {
  name: string;
  label?: string;
  object?: string;
  spec: any;
}

/** Extract a slug from a `publicLink` like '/forms/contact-us' → 'contact-us'. */
function slugFromLink(link?: string): string | null {
  if (!link) return null;
  const m = link.replace(/^\/+/, '').match(/^forms\/([^/?#]+)/i);
  return m?.[1] ?? null;
}

function PublicFormsList() {
  const client = useClient();
  const packageId = Route.useParams().package;
  const [rows, setRows] = useState<PublicFormRow[]>([]);
  const [publishable, setPublishable] = useState<PublishableFormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Publish dialog state
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishView, setPublishView] = useState<string>('');
  const [publishSlug, setPublishSlug] = useState('');
  const [publishing, setPublishing] = useState(false);

  // Sharing/submitBehavior editor state
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<PublicFormRow | null>(null);
  const [editSlug, setEditSlug] = useState('');
  const [editBehavior, setEditBehavior] = useState<'thank-you' | 'redirect' | 'continue' | 'next-record'>('thank-you');
  const [editBehaviorTitle, setEditBehaviorTitle] = useState('');
  const [editBehaviorMessage, setEditBehaviorMessage] = useState('');
  const [editBehaviorUrl, setEditBehaviorUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.meta.getItems('view');
      const items: any[] = Array.isArray(result)
        ? (result as any)
        : Array.isArray((result as any)?.items)
          ? (result as any).items
          : [];
      const forms: PublicFormRow[] = [];
      const candidates: PublishableFormRow[] = [];
      for (const it of items) {
        const spec = it?.spec ?? it;
        // Only proper FormViews are publishable (skip list / kanban / etc.)
        const isForm = !!(spec?.sections || spec?.groups || spec?.type === 'simple' || spec?.type === 'tabbed' || spec?.type === 'wizard');
        if (!isForm) continue;
        const sharing = spec?.sharing;
        const link: string | undefined = sharing?.publicLink;
        const slug = slugFromLink(link);
        if (sharing?.allowAnonymous && slug && link) {
          forms.push({
            name: spec?.name ?? it?.name,
            label: spec?.label,
            object: spec?.object,
            slug,
            publicLink: link,
            updatedAt: it?.updatedAt ?? it?.updated_at,
            spec,
          });
        } else {
          candidates.push({
            name: spec?.name ?? it?.name,
            label: spec?.label,
            object: spec?.object,
            spec,
          });
        }
      }
      setRows(forms);
      setPublishable(candidates);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const formatPublicUrl = (slug: string) => `${origin}/console/f/${slug}`;
  const formatIframe = (slug: string) =>
    `<iframe src="${formatPublicUrl(slug)}" width="100%" height="640" frameborder="0" style="border:0;"></iframe>`;
  const formatReact = (slug: string) =>
    `<iframe\n  src={\`${formatPublicUrl(slug)}\`}\n  title="Public form"\n  style={{ width: '100%', height: 640, border: 0 }}\n/>`;

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `Copied ${label}` });
    } catch {
      toast({ title: 'Clipboard unavailable', variant: 'destructive' as any });
    }
  };

  /** Sanitize a free-text slug into a URL-safe lowercase token. */
  const sanitizeSlug = (s: string) =>
    s.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');

  /** Publish a non-public FormView by injecting sharing.allowAnonymous + publicLink. */
  const publish = async () => {
    if (!publishView || !publishSlug) return;
    const cand = publishable.find((p) => p.name === publishView);
    if (!cand) return;
    const slug = sanitizeSlug(publishSlug);
    if (!slug) {
      toast({ title: 'Invalid slug', variant: 'destructive' as any });
      return;
    }
    const next = {
      ...cand.spec,
      sharing: {
        ...(cand.spec.sharing ?? {}),
        enabled: true,
        allowAnonymous: true,
        publicLink: `/forms/${slug}`,
      },
    };
    setPublishing(true);
    try {
      await client.meta.saveItem('view', cand.name, next);
      toast({ title: `Published ${cand.name}` });
      setPublishOpen(false);
      setPublishView('');
      setPublishSlug('');
      await load();
    } catch (e: any) {
      toast({ title: `Publish failed: ${e?.message ?? e}`, variant: 'destructive' as any });
    } finally {
      setPublishing(false);
    }
  };

  /** Open the sharing/submitBehavior editor for an existing public form. */
  const openEditor = (row: PublicFormRow) => {
    setEditRow(row);
    setEditSlug(row.slug);
    const sb = row.spec?.submitBehavior;
    const kind = (sb?.kind as any) ?? 'thank-you';
    setEditBehavior(kind);
    setEditBehaviorTitle(sb?.title ?? '');
    setEditBehaviorMessage(sb?.message ?? '');
    setEditBehaviorUrl(sb?.url ?? '');
    setEditOpen(true);
  };

  /** Persist sharing slug + submitBehavior edits. */
  const saveEdit = async () => {
    if (!editRow) return;
    const slug = sanitizeSlug(editSlug);
    if (!slug) {
      toast({ title: 'Invalid slug', variant: 'destructive' as any });
      return;
    }
    let submitBehavior: any;
    switch (editBehavior) {
      case 'thank-you':
        submitBehavior = { kind: 'thank-you' };
        if (editBehaviorTitle) submitBehavior.title = editBehaviorTitle;
        if (editBehaviorMessage) submitBehavior.message = editBehaviorMessage;
        break;
      case 'redirect':
        if (!editBehaviorUrl) {
          toast({ title: 'Redirect URL is required', variant: 'destructive' as any });
          return;
        }
        submitBehavior = { kind: 'redirect', url: editBehaviorUrl };
        break;
      case 'continue':
      case 'next-record':
        submitBehavior = { kind: editBehavior };
        break;
    }
    const next = {
      ...editRow.spec,
      sharing: {
        ...(editRow.spec.sharing ?? {}),
        enabled: true,
        allowAnonymous: true,
        publicLink: `/forms/${slug}`,
      },
      submitBehavior,
    };
    setSaving(true);
    try {
      await client.meta.saveItem('view', editRow.name, next);
      toast({ title: `Saved ${editRow.name}` });
      setEditOpen(false);
      setEditRow(null);
      await load();
    } catch (e: any) {
      toast({ title: `Save failed: ${e?.message ?? e}`, variant: 'destructive' as any });
    } finally {
      setSaving(false);
    }
  };

  const hasRows = rows.length > 0;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6 overflow-auto">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FormInput className="h-4 w-4" />
              Public forms
            </CardTitle>
            <CardDescription>
              Anonymous form views with{' '}
              <code className="text-xs">sharing.allowAnonymous</code> enabled. Each
              row is wired to{' '}
              <code className="text-xs">GET / POST /api/v1/forms/:slug</code>.{' '}
              <a
                href="/docs/guides/public-forms"
                className="underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                Read the guide →
              </a>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => setPublishOpen(true)}
              disabled={publishable.length === 0}
              title={publishable.length === 0 ? 'No non-public FormViews available' : 'Publish a FormView'}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="ml-1.5">Publish form…</span>
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="ml-1.5">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {!loading && !hasRows && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No public forms yet</p>
              <p className="mt-1">
                Declare a <code className="text-xs">FormView</code> with{' '}
                <code className="text-xs">sharing.allowAnonymous: true</code> and a{' '}
                <code className="text-xs">publicLink</code>, then refresh.
              </p>
            </div>
          )}
          {hasRows && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Object</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Public URL</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const url = formatPublicUrl(row.slug);
                  return (
                    <TableRow key={row.name}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{row.label ?? row.name}</span>
                          <code className="text-xs text-muted-foreground">{row.name}</code>
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.object ? (
                          <Badge variant="secondary">{row.object}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{row.slug}</code>
                      </TableCell>
                      <TableCell>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                        >
                          {url}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Copy URL"
                            onClick={() => copy('URL', url)}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Copy <iframe> embed"
                            onClick={() => copy('iframe snippet', formatIframe(row.slug))}
                          >
                            <Code2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Copy React snippet"
                            onClick={() => copy('React snippet', formatReact(row.slug))}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit sharing & post-submit behavior"
                            onClick={() => openEditor(row)}
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button asChild variant="ghost" size="sm" title="Open metadata">
                            <Link
                              to="/$package/metadata/$type/$name"
                              params={{ package: packageId, type: 'view', name: row.name }}
                            >
                              <FormInput className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Publish FormView dialog */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish a FormView</DialogTitle>
            <DialogDescription>
              Picks an existing FormView and turns it into a public form by
              enabling <code className="text-xs">sharing.allowAnonymous</code>{' '}
              and setting <code className="text-xs">publicLink</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="publish-view">FormView</Label>
              <select
                id="publish-view"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={publishView}
                onChange={(e) => setPublishView(e.target.value)}
              >
                <option value="">— Select a FormView —</option>
                {publishable.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label ?? p.name} ({p.name}) {p.object ? `· ${p.object}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-slug">URL slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">/console/f/</span>
                <Input
                  id="publish-slug"
                  placeholder="contact-us"
                  value={publishSlug}
                  onChange={(e) => setPublishSlug(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, dashes and underscores only.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)} disabled={publishing}>
              Cancel
            </Button>
            <Button onClick={publish} disabled={publishing || !publishView || !publishSlug}>
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sharing / submitBehavior editor dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editRow ? `Edit ${editRow.label ?? editRow.name}` : 'Edit form'}
            </DialogTitle>
            <DialogDescription>
              Configure the public URL and what happens after submit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-slug">URL slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">/console/f/</span>
                <Input
                  id="edit-slug"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-behavior">After submit</Label>
              <select
                id="edit-behavior"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={editBehavior}
                onChange={(e) => setEditBehavior(e.target.value as any)}
              >
                <option value="thank-you">Show a thank-you panel</option>
                <option value="redirect">Redirect to a URL</option>
                <option value="continue">Reset for another response</option>
                <option value="next-record">Advance to next record (internal queues)</option>
              </select>
            </div>
            {editBehavior === 'thank-you' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-tytitle">Title</Label>
                  <Input
                    id="edit-tytitle"
                    placeholder="Thanks!"
                    value={editBehaviorTitle}
                    onChange={(e) => setEditBehaviorTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-tymsg">Message</Label>
                  <Input
                    id="edit-tymsg"
                    placeholder="Your submission has been received."
                    value={editBehaviorMessage}
                    onChange={(e) => setEditBehaviorMessage(e.target.value)}
                  />
                </div>
              </>
            )}
            {editBehavior === 'redirect' && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-url">Redirect URL</Label>
                <Input
                  id="edit-url"
                  type="url"
                  placeholder="https://example.com/thanks"
                  value={editBehaviorUrl}
                  onChange={(e) => setEditBehaviorUrl(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving || !editSlug}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Route definition — file-based `/$package/public-forms`. */
export const Route = createFileRoute('/$package/public-forms')({
  component: PublicFormsList,
});

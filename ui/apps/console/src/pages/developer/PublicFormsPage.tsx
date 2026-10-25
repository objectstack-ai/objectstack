/**
 * Public Forms — lists every form the server's anonymous form routes serve,
 * and lets devs publish a FormView those routes do not serve yet, or tweak a
 * published one's sharing / submitBehavior.
 *
 * ## "Published" is the server's one rule, imported, never a second reading
 *
 * The anonymous routes (`GET /forms/:slug`, `POST /forms/:slug/submit`) serve a
 * form only when its `sharing` declares all three of `enabled === true`,
 * `allowAnonymous === true` and a `publicLink` slug. That rule is
 * `anonymousFormIntakeCandidates`, exported by `@objectstack/spec/ui` and
 * re-exported by `@objectstack/metadata-core` to the routes themselves, which
 * scan the same `GET /meta/view` list this page reads. So the page lists a form
 * exactly when that function yields it for a served item, under the slug it
 * yields. The page used to decide on `allowAnonymous` and a parseable link
 * alone (objectui#11545): a form withdrawn by clearing `enabled`, which the
 * routes answer with a 404, still showed as published. ⛔ No local reading of
 * the three keys here: a copy agrees with the routes only until either moves.
 *
 * Two inputs the routes also consult are not on the list read, so they are not
 * reflected here: a withdrawal in another metadata layer, and whether the
 * deployment's tenancy posture lets the bound object take an anonymous
 * submission. A form in either state is listed, and the routes answer it 404.
 *
 * ## The list serves ViewItems, so the form lives under `config`
 *
 * `GET /meta/view` enumerates `ViewItem`s (`name`, `object`, `viewKind`,
 * `config`) and never the aggregated `defineView` container, so a form view
 * reaches this page as `viewKind: 'form'` with its body, its `sharing` and its
 * `submitBehavior` under `config`. The page used to look for the form at the
 * item's top level, which matched no served form at all, and its two writers
 * put `sharing` and `submitBehavior` there: `ViewItemSchema` refuses both keys
 * at that level, and the save path's wire schema drops them, so a publish saved
 * without publishing anything. Both writers now write the item's `config`,
 * which is the `form` the rule reads on a served item.
 *
 * Console is not project-scoped, so there is no `useParams().package`, no
 * `<Link>` to the legacy metadata editor, and no `useMetadataHmr` polling —
 * refresh is driven by the explicit Refresh button.
 *
 * ## The redirect field is an authoring door, so it states the contract
 *
 * `submitBehavior.url` is ruled relative-only (objectstack#7496, landed by
 * objectstack#7657 in the `@objectstack/spec` 17.0.0 GA pin this repo installs),
 * and the spec refuses seven families of value with an author-facing
 * prescription for each. This dialog used to enforce one of them — non-empty —
 * and save the rest into view metadata unexamined (objectui#4990), so an admin
 * could type `https://example.com/thanks`, or `javascript:alert(1)`, and be
 * told nothing.
 *
 * `checkSubmitRedirectUrl` (from the renderer's own `submitRedirect`) is asked
 * instead, at save time, and its refusal — the spec's prose, verbatim — is shown
 * next to the field. That reuse is the point: a hand-written mirror of the seven
 * families here is exactly the shape `scripts/check-spec-symbol-derivation.mjs`
 * exists to discourage, and it would be a second spelling of a security rule
 * that passes every value comparison right up to the release that moves the
 * original. The door and the renderer now refuse identically because they are
 * one parse.
 *
 * `thank-you`'s `title` / `message` stay unvalidated deliberately: the spec
 * declares both as free-form strings, so there is no contract for a door to
 * state.
 *
 * ## The anonymous URL is the router's answer, not a hard-coded mount
 *
 * The anonymous route is `/f/:slug` UNDER the console router's basename (the
 * `<Route path="/f/:slug">` in `App.tsx`, inside `BrowserRouter
 * basename={BASENAME}`), and that basename comes from the host's injected
 * `<base href>`: `/_console` on every framework- and cloud-served mount, `/`
 * on a standalone run. This page used to print `${origin}/console/f/SLUG`, a
 * mount no host serves (objectui#11769). It now asks the router where `/f`
 * lives (`useHref`, which prefixes the basename), so the copied URL, both
 * snippets and the two slug-field prefixes are one value, and they follow the
 * mount the page is actually running under.
 */

import { useEffect, useState } from 'react';
import { useHref } from 'react-router-dom';
import { useAdapter } from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  EmptyValue,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { Copy, ExternalLink, FormInput, RefreshCw, Code2, Link2, Settings2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { anonymousFormIntakeCandidates } from '@objectstack/spec/ui';
import { checkSubmitRedirectUrl } from '../../components/submitRedirect';
import { SLOT, withSlots } from '../../lib/inlineSlots';

/** One `view` item as `GET /meta/view` serves it: a `ViewItem` (module header). */
type ServedViewItem = Record<string, any>;

interface PublicFormRow {
  name: string;
  label?: string;
  object?: string;
  /** The slug the server's rule yields for this form. */
  slug: string;
  /** The served item, saved back whole with its `config` replaced. */
  item: ServedViewItem;
  /** The form the rule found open: the item's `config` on a served ViewItem. */
  form: Record<string, any>;
}

interface PublishableFormRow {
  name: string;
  label?: string;
  object?: string;
  item: ServedViewItem;
}

function sanitizeSlug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The anonymous form route's prefix, as `App.tsx` declares it (`/f/:slug`). */
const PUBLIC_FORM_ROUTE = '/f';

type SubmitBehaviorKind = 'thank-you' | 'redirect' | 'continue' | 'next-record';

/** The "After submit" picker's options, in the order the dialog offers them; labels are translated at render. */
const SUBMIT_BEHAVIOR_KINDS: readonly SubmitBehaviorKind[] = ['thank-you', 'redirect', 'continue', 'next-record'];

/** The item a value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the two dialogs' pickers (the FormView to publish, and what
 * happens after submit), drawn with the shared `Select` the rest of the
 * console picks with. They used to be browser-native `<select>`s. What a pick
 * writes is unchanged: `onPick` receives the picked option's own `value`, the
 * string the native control's `change` carried. Re-picking the current option
 * writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value. The FormView picker opens
 *   on "— Select a FormView —", whose value is `''`, which `SelectItem`
 *   refuses; an index cannot collide with a view's name, as any stand-in
 *   string could.
 * - A value none of the options carries gets an item of its own, labelled with
 *   the value, so the trigger shows what the dialog holds and would save. The
 *   native control showed its first option there. Picking that item writes
 *   nothing.
 * - `id` lands on the trigger, so the field's `<Label htmlFor>` names it as it
 *   named the native control.
 * - Neither dialog has a read-only state: both are reached only from this
 *   page's own Publish and Edit buttons.
 */
function FormsPicker<V extends string>({
  id,
  value,
  options,
  onPick,
}: {
  id: string;
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  onPick: (value: V) => void;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the dialog's own value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger id={id} className="h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PublicFormsPage() {
  // objectui#13460 — the page's copy reads `console.developer.publicForms.*`
  // (and `common.*` for Refresh / Actions / Cancel / Save); each inline
  // `defaultValue` is the `en` pack's value, held byte-identical to it by
  // `pnpm check:i18n-keys`, so a provider-less mount still reads English.
  // Left as written: the snippets (code), the example slugs and paths in the
  // placeholders, and the redirect refusal, which is the spec's own prose.
  const { t } = useObjectTranslation();
  const adapter = useAdapter();
  const client: any = adapter?.getClient?.();

  const [rows, setRows] = useState<PublicFormRow[]>([]);
  const [publishable, setPublishable] = useState<PublishableFormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishView, setPublishView] = useState<string>('');
  const [publishSlug, setPublishSlug] = useState('');
  const [publishing, setPublishing] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<PublicFormRow | null>(null);
  const [editSlug, setEditSlug] = useState('');
  const [editBehavior, setEditBehavior] = useState<SubmitBehaviorKind>('thank-you');
  const [editBehaviorTitle, setEditBehaviorTitle] = useState('');
  const [editBehaviorMessage, setEditBehaviorMessage] = useState('');
  const [editBehaviorUrl, setEditBehaviorUrl] = useState('');
  /**
   * The contract's refusal for the value currently in the Redirect URL field,
   * or null while there is nothing to say. Set only by a save attempt — typing
   * clears it, so the author is corrected once, at the moment they asked to
   * commit, rather than nagged mid-keystroke.
   */
  const [editUrlRefusal, setEditUrlRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!client?.meta?.getItems) {
      setError('meta.getItems is not available on this client');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result: any = await client.meta.getItems('view');
      // `meta.getItems` answers `{ type, items: [...] }`, or a bare array on
      // the ADR-0037 preview path. The trailing `value` arm is gone on a
      // measured zero at this seam (objectui#6917).
      const items: any[] = Array.isArray(result)
        ? result
        : Array.isArray(result?.items)
          ? result.items
          : [];
      const forms: PublicFormRow[] = [];
      const candidates: PublishableFormRow[] = [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        // The server's own rule, asked of the item exactly as it was served
        // (module header): what it yields is what the anonymous routes serve.
        const open = anonymousFormIntakeCandidates(item);
        for (const candidate of open) {
          forms.push({
            name: item.name,
            label: item.label,
            object: item.object,
            slug: candidate.slug,
            item,
            form: candidate.form,
          });
        }
        // A served form view the rule does not open is what Publish offers:
        // its form body is its `config`, which is where Publish writes.
        if (
          open.length === 0 &&
          item.viewKind === 'form' &&
          item.config &&
          typeof item.config === 'object'
        ) {
          candidates.push({
            name: item.name,
            label: item.label,
            object: item.object,
            item,
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

  // `load` is intentionally omitted from the dependency array: this effect is a
  // mount-once fetch. Refresh is driven by the explicit Refresh button
  // (`onClick={load}` below) and by explicit `await load()` calls after
  // publish/save (see the file-level doc comment), not by re-running on every
  // `load` identity change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Basename-prefixed by the router itself: `/_console/f` under a `/_console`
  // mount, `/f` on a root-mounted console. Every URL below is built from it.
  const publicFormPath = useHref(PUBLIC_FORM_ROUTE);

  const formatPublicUrl = (slug: string) => `${origin}${publicFormPath}/${slug}`;
  const formatIframe = (slug: string) =>
    `<iframe src="${formatPublicUrl(slug)}" width="100%" height="640" frameborder="0" style="border:0;"></iframe>`;
  const formatReact = (slug: string) =>
    `<iframe\n  src={\`${formatPublicUrl(slug)}\`}\n  title="Public form"\n  style={{ width: '100%', height: 640, border: 0 }}\n/>`;

  /** `label` is the whole translated toast ("Copied URL"). */
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error(t('console.developer.publicForms.clipboardUnavailable', { defaultValue: 'Clipboard unavailable' }));
    }
  };

  const publish = async () => {
    if (!publishView || !publishSlug) return;
    const cand = publishable.find((p) => p.name === publishView);
    if (!cand) return;
    const slug = sanitizeSlug(publishSlug);
    if (!slug) {
      toast.error(t('console.developer.publicForms.invalidSlug', { defaultValue: 'Invalid slug' }));
      return;
    }
    // The form body of a served ViewItem is its `config` (module header).
    const config = cand.item.config;
    const next = {
      ...cand.item,
      config: {
        ...config,
        sharing: {
          ...(config.sharing ?? {}),
          enabled: true,
          allowAnonymous: true,
          publicLink: `/forms/${slug}`,
        },
      },
    };
    setPublishing(true);
    try {
      await client.meta.saveItem('view', cand.name, next);
      toast.success(t('console.developer.publicForms.published', { defaultValue: 'Published {{name}}', name: cand.name }));
      setPublishOpen(false);
      setPublishView('');
      setPublishSlug('');
      await load();
    } catch (e: any) {
      toast.error(t('console.developer.publicForms.publishFailed', { defaultValue: 'Publish failed: {{message}}', message: String(e?.message ?? e) }));
    } finally {
      setPublishing(false);
    }
  };

  const openEditor = (row: PublicFormRow) => {
    setEditRow(row);
    setEditSlug(row.slug);
    const sb = row.form.submitBehavior;
    const kind = (sb?.kind as any) ?? 'thank-you';
    setEditBehavior(kind);
    setEditBehaviorTitle(sb?.title ?? '');
    setEditBehaviorMessage(sb?.message ?? '');
    setEditBehaviorUrl(sb?.url ?? '');
    setEditUrlRefusal(null);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editRow) return;
    const slug = sanitizeSlug(editSlug);
    if (!slug) {
      toast.error(t('console.developer.publicForms.invalidSlug', { defaultValue: 'Invalid slug' }));
      return;
    }
    setEditUrlRefusal(null);
    let submitBehavior: any;
    switch (editBehavior) {
      case 'thank-you':
        submitBehavior = { kind: 'thank-you' };
        if (editBehaviorTitle) submitBehavior.title = editBehaviorTitle;
        if (editBehaviorMessage) submitBehavior.message = editBehaviorMessage;
        break;
      case 'redirect': {
        // The contract's verdict, not this dialog's: empty is one of the seven
        // families the spec refuses, so it comes back through here too rather
        // than keeping a local `required` message that says less.
        const verdict = checkSubmitRedirectUrl(editBehaviorUrl);
        if (!verdict.ok) {
          setEditUrlRefusal(verdict.refusal);
          return;
        }
        // The value the schema accepted, so a future normalisation in the spec
        // is what gets saved — the same read-back the renderer does.
        submitBehavior = { kind: 'redirect', url: verdict.url };
        break;
      }
      case 'continue':
      case 'next-record':
        submitBehavior = { kind: editBehavior };
        break;
    }
    // `sharing` and `submitBehavior` both belong to the form, which on a served
    // ViewItem is its `config` (module header).
    const form = editRow.form;
    const next = {
      ...editRow.item,
      config: {
        ...form,
        sharing: {
          ...(form.sharing ?? {}),
          enabled: true,
          allowAnonymous: true,
          publicLink: `/forms/${slug}`,
        },
        submitBehavior,
      },
    };
    setSaving(true);
    try {
      await client.meta.saveItem('view', editRow.name, next);
      toast.success(t('console.developer.publicForms.saved', { defaultValue: 'Saved {{name}}', name: editRow.name }));
      setEditOpen(false);
      setEditRow(null);
      await load();
    } catch (e: any) {
      toast.error(t('console.developer.publicForms.saveFailed', { defaultValue: 'Save failed: {{message}}', message: String(e?.message ?? e) }));
    } finally {
      setSaving(false);
    }
  };

  const hasRows = rows.length > 0;

  const behaviorLabels: Record<SubmitBehaviorKind, string> = {
    'thank-you': t('console.developer.publicForms.behaviorThankYou', { defaultValue: 'Show a thank-you panel' }),
    redirect: t('console.developer.publicForms.behaviorRedirect', { defaultValue: 'Redirect to a URL' }),
    continue: t('console.developer.publicForms.behaviorContinue', { defaultValue: 'Reset for another response' }),
    'next-record': t('console.developer.publicForms.behaviorNextRecord', { defaultValue: 'Advance to next record (internal queues)' }),
  };
  const submitBehaviorOptions = SUBMIT_BEHAVIOR_KINDS.map((value) => ({ value, label: behaviorLabels[value] }));
  const publishLabel = t('console.developer.publicForms.publishButton', { defaultValue: 'Publish form…' });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6 overflow-auto">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FormInput className="h-4 w-4" />
              {t('console.developer.publicForms.title', { defaultValue: 'Public Forms' })}
            </CardTitle>
            <CardDescription>
              {t('console.developer.publicForms.description', {
                defaultValue:
                  'Forms anyone can fill out — no login required. Publish a form to get a shareable link; submissions land directly in the bound object.',
              })}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => setPublishOpen(true)}
              disabled={publishable.length === 0}
              title={
                publishable.length === 0
                  ? t('console.developer.publicForms.publishNone', { defaultValue: 'No non-public FormViews available' })
                  : t('console.developer.publicForms.publishTooltip', { defaultValue: 'Publish a FormView' })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="ml-1.5">{publishLabel}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="ml-1.5">{t('common.refresh', { defaultValue: 'Refresh' })}</span>
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
              <p className="font-medium text-foreground">{t('console.developer.publicForms.emptyTitle', { defaultValue: 'No public forms yet' })}</p>
              <p className="mt-1">
                {withSlots(
                  t('console.developer.publicForms.emptyBody', {
                    defaultValue:
                      'Click {{action}} above to share an existing form, or build a new one in Views & Apps and mark it public.',
                    action: SLOT[0],
                  }),
                  [<strong key="action">{publishLabel}</strong>],
                )}
              </p>
            </div>
          )}
          {hasRows && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('console.developer.publicForms.columnName', { defaultValue: 'Name' })}</TableHead>
                  <TableHead>{t('console.developer.publicForms.columnObject', { defaultValue: 'Object' })}</TableHead>
                  <TableHead>{t('console.developer.publicForms.columnSlug', { defaultValue: 'Slug' })}</TableHead>
                  <TableHead>{t('console.developer.publicForms.columnPublicUrl', { defaultValue: 'Public URL' })}</TableHead>
                  <TableHead className="text-right">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const url = formatPublicUrl(row.slug);
                  return (
                    <TableRow key={`${row.name}:${row.slug}`}>
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
                          <EmptyValue />
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
                            title={t('console.developer.publicForms.copyUrl', { defaultValue: 'Copy URL' })}
                            onClick={() => copy(t('console.developer.publicForms.copiedUrl', { defaultValue: 'Copied URL' }), url)}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('console.developer.publicForms.copyIframe', { defaultValue: 'Copy <iframe> embed' })}
                            onClick={() => copy(t('console.developer.publicForms.copiedIframe', { defaultValue: 'Copied iframe snippet' }), formatIframe(row.slug))}
                          >
                            <Code2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('console.developer.publicForms.copyReact', { defaultValue: 'Copy React snippet' })}
                            onClick={() => copy(t('console.developer.publicForms.copiedReact', { defaultValue: 'Copied React snippet' }), formatReact(row.slug))}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('console.developer.publicForms.editSharing', { defaultValue: 'Edit sharing & post-submit behavior' })}
                            onClick={() => openEditor(row)}
                          >
                            <Settings2 className="h-3.5 w-3.5" />
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

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('console.developer.publicForms.publishDialogTitle', { defaultValue: 'Publish a FormView' })}</DialogTitle>
            <DialogDescription>
              {withSlots(
                t('console.developer.publicForms.publishDialogDescription', {
                  defaultValue:
                    'Pick an existing FormView to open it to anonymous visitors. Publishing sets {{enabled}}, {{allowAnonymous}} and {{publicLink}} in its config: the public form route serves a form only when all three are set.',
                  enabled: SLOT[0],
                  allowAnonymous: SLOT[1],
                  publicLink: SLOT[2],
                }),
                [
                  <code key="enabled" className="text-xs">sharing.enabled</code>,
                  <code key="allowAnonymous" className="text-xs">sharing.allowAnonymous</code>,
                  <code key="publicLink" className="text-xs">sharing.publicLink</code>,
                ],
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="publish-view">{t('console.developer.publicForms.formView', { defaultValue: 'FormView' })}</Label>
              <FormsPicker
                id="publish-view"
                value={publishView}
                options={[
                  { value: '', label: t('console.developer.publicForms.selectFormView', { defaultValue: '— Select a FormView —' }) },
                  ...publishable.map((p) => ({
                    value: p.name,
                    label: `${p.label ?? p.name} (${p.name}) ${p.object ? `· ${p.object}` : ''}`,
                  })),
                ]}
                onPick={setPublishView}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-slug">{t('console.developer.publicForms.urlSlug', { defaultValue: 'URL slug' })}</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{`${publicFormPath}/`}</span>
                <Input
                  id="publish-slug"
                  placeholder="contact-us"
                  value={publishSlug}
                  onChange={(e) => setPublishSlug(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('console.developer.publicForms.slugHint', { defaultValue: 'Lowercase letters, digits, dashes and underscores only.' })}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)} disabled={publishing}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={publish} disabled={publishing || !publishView || !publishSlug}>
              {publishing ? t('console.developer.publicForms.publishing', { defaultValue: 'Publishing…' }) : t('console.developer.publicForms.publish', { defaultValue: 'Publish' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editRow
                ? t('console.developer.publicForms.editTitle', { defaultValue: 'Edit {{name}}', name: editRow.label ?? editRow.name })
                : t('console.developer.publicForms.editTitleFallback', { defaultValue: 'Edit form' })}
            </DialogTitle>
            <DialogDescription>
              {t('console.developer.publicForms.editDescription', { defaultValue: 'Configure the public URL and what happens after submit.' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-slug">{t('console.developer.publicForms.urlSlug', { defaultValue: 'URL slug' })}</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{`${publicFormPath}/`}</span>
                <Input
                  id="edit-slug"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-behavior">{t('console.developer.publicForms.afterSubmit', { defaultValue: 'After submit' })}</Label>
              <FormsPicker
                id="edit-behavior"
                value={editBehavior}
                options={submitBehaviorOptions}
                onPick={(kind) => {
                  setEditBehavior(kind);
                  setEditUrlRefusal(null);
                }}
              />
            </div>
            {editBehavior === 'thank-you' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-tytitle">{t('console.developer.publicForms.thankYouTitle', { defaultValue: 'Title' })}</Label>
                  <Input
                    id="edit-tytitle"
                    placeholder={t('console.developer.publicForms.thankYouTitlePlaceholder', { defaultValue: 'Thanks!' })}
                    value={editBehaviorTitle}
                    onChange={(e) => setEditBehaviorTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-tymsg">{t('console.developer.publicForms.thankYouMessage', { defaultValue: 'Message' })}</Label>
                  <Input
                    id="edit-tymsg"
                    placeholder={t('console.developer.publicForms.thankYouMessagePlaceholder', { defaultValue: 'Your submission has been received.' })}
                    value={editBehaviorMessage}
                    onChange={(e) => setEditBehaviorMessage(e.target.value)}
                  />
                </div>
              </>
            )}
            {editBehavior === 'redirect' && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-url">{t('console.developer.publicForms.redirectUrl', { defaultValue: 'Redirect URL' })}</Label>
                {/*
                  Not `type="url"`: that type's own notion of valid is an
                  ABSOLUTE URL, which is the one thing this key refuses, so it
                  pulled the author the wrong way — as did the former
                  `https://example.com/thanks` placeholder.
                */}
                <Input
                  id="edit-url"
                  type="text"
                  placeholder="/thanks"
                  value={editBehaviorUrl}
                  onChange={(e) => {
                    setEditBehaviorUrl(e.target.value);
                    setEditUrlRefusal(null);
                  }}
                  aria-invalid={editUrlRefusal ? true : undefined}
                  aria-describedby={editUrlRefusal ? 'edit-url-refusal' : 'edit-url-hint'}
                />
                {editUrlRefusal ? (
                  <p
                    id="edit-url-refusal"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {editUrlRefusal}
                  </p>
                ) : (
                  <p id="edit-url-hint" className="text-xs text-muted-foreground">
                    {withSlots(
                      t('console.developer.publicForms.redirectHint', {
                        defaultValue:
                          'An in-app path, starting with {{slash}} — interpolate a field of the submitted record as {{token}}. To send the browser out of the app, use an app navigation item instead.',
                        slash: SLOT[0],
                        token: SLOT[1],
                      }),
                      [<code key="slash">/</code>, <code key="token">{'{{record.field_name}}'}</code>],
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={saveEdit} disabled={saving || !editSlug}>
              {saving ? t('console.developer.publicForms.saving', { defaultValue: 'Saving…' }) : t('common.save', { defaultValue: 'Save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

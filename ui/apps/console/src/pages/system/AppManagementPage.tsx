/**
 * App Management Page
 *
 * Lists all configured applications with search, enable/disable toggle,
 * delete, set-default, and navigation to create/edit pages.
 *
 * ## The writes are real (objectui#4233)
 *
 * Every mutating control here used to carry `// TODO: Replace with real API
 * call when backend supports app management` immediately before a
 * `toast.success(...)`, then `refresh()`. Zero non-GET requests reached the
 * wire, and reloading showed the server unchanged — so the page reported
 * success for work it had not done, and `refresh()` re-rendered the SAME
 * server state underneath the confirmation, which is what made it look like it
 * had worked.
 *
 * The premise of that TODO was measured against `@objectstack/client`
 * 17.0.0-rc.6 and is false: the metadata write surface exists and is the same
 * one the rest of this console already writes through —
 * `PUT /api/v1/meta/:type/:name` (`meta.saveItem`) and
 * `DELETE /api/v1/meta/:type/:name` (`meta.deleteItem`), both gated on
 * `manage_metadata` (ADR-0066 D1). `useNavigationSync` in `@object-ui/app-shell`
 * has been persisting app schemas through `meta.saveItem('app', …)` all along.
 *
 * So each handler now awaits a real mutation and only then reports success; a
 * rejection (403 from the permission gate, 5xx, offline) surfaces the server's
 * own message instead of a lie. This is deliberately the LAST link of
 * objectui#4233's other half: because these controls never wrote, an operator
 * could not set `isDefault` from the UI at all — the app had to be republished
 * through metadata — so the landing bug had no in-product workaround.
 *
 * ## The chrome is keyed, the server's words are not (objectui#4307)
 *
 * Every string this page AUTHORS goes through `t('appManagement.…')`. Every
 * string the SERVER authored is interpolated raw, and the split is deliberate
 * rather than incidental: a refusal like `forbidden: manage_metadata required`
 * is the server's diagnosis of a specific request, so keying it would mean
 * inventing a fixed catalogue of sentences the server does not promise to keep
 * sending. So the failure toasts are keyed **templates with a `{{reason}}`
 * hole** — the frame is localized, what fills it is passed through byte for
 * byte. `AppManagementPage.i18n.test.tsx` pins both halves at once, against a
 * `t` that answers in no natural language at all.
 *
 * ## A write is reported as what the server did with it (objectui#12300)
 *
 * Wiring the writes was not enough: two of them answered 200 for a write that
 * changed nothing the page shows, and the page still said it had worked.
 *
 * - **Delete.** `DELETE /meta/app/:name` resets the app to what its package
 *   ships, by removing the customization overlay row. When there is no such row
 *   the door answers `reset: false` and says so in `message`. Nothing was
 *   removed, so the page says that in a neutral toast, with the server's own
 *   sentence in the `{{reason}}` hole, and never says "deleted".
 * - **Disable, Set default and the bulk toggles.** An app that a package owns
 *   is served from that package's row. A save that names no package lands on a
 *   package-less row the reader never serves, so the app did not change. Each
 *   save now names the owning package (`?package=`, read off the served
 *   `_packageId`), as the console's other package-aware writes do, and a
 *   package-less app sends no scope at all.
 *
 * ## A delete names the package whose row it removes (objectui#12397)
 *
 * Since objectstack#23165, a delete that names no package of an app two
 * packages hold is refused `409 RESOURCE_CONFLICT`: nothing is deleted, and the
 * refusal names `?package=` as the remedy. The page already knows the owner, so
 * Delete sends it the way the saves do, through the client's
 * `DeleteMetaItemOptions.packageId` (objectstack#23293). A package-less app
 * sends no scope, and a refusal is still shown in the server's own words.
 *
 * After every write, whatever it answered, the page re-reads the list, so each
 * row shows the state the server serves. No row is patched locally ahead of
 * that read.
 */

import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  CardContent,
  Badge,
  Input,
  Checkbox,
} from '@object-ui/components';
import {
  Plus,
  LayoutGrid,
  Trash2,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Star,
  ExternalLink,
  Search,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ObjectStackClient } from '@objectstack/client';
import { ConsolePageHeader, useMetadata, useAdapter } from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveKeyedI18nLabel } from '../../utils';

/**
 * The two metadata writes this page needs, named rather than reached for
 * through `any` — these are the calls whose ABSENCE was the defect, so the
 * shape they are called with is part of what this file now guarantees.
 *
 * Taken from the SDK's own declaration rather than restated, so the options
 * bag `saveItem` takes (`packageId` among them) and the `reset` / `message`
 * that `deleteItem` answers with are the client's types, not a local copy.
 */
type MetaWriteClient = Pick<ObjectStackClient['meta'], 'saveItem' | 'deleteItem'>;

interface AdapterWithClient {
  getClient?: () => { meta?: MetaWriteClient } | null | undefined;
}

/**
 * The value the server stamps as `_packageId` on a row bound to NO package.
 * It names no package, so it is never sent as a scope: the server's own
 * write path folds a missing binding into it, and its readers treat it as
 * "no package". The console's Studio bridge for an app reads it the same way.
 */
const PACKAGELESS_SENTINEL = 'sys_metadata';

/**
 * The package that owns an app's served row, or `undefined` for an app no
 * package owns.
 */
function owningPackage(app: { _packageId?: unknown }): string | undefined {
  const packageId = app._packageId;
  return typeof packageId === 'string' && packageId !== '' && packageId !== PACKAGELESS_SENTINEL
    ? packageId
    : undefined;
}

/**
 * Save one app in the scope it is served from (objectui#12300).
 *
 * A package-owned app is saved with `{ packageId }`, which the SDK sends as
 * `?package=`. That is the row the reader serves, so the change is what the
 * next read shows. A package-less app is saved exactly as before, with no
 * fourth argument, because there is no package to name.
 */
function saveApp(
  meta: MetaWriteClient,
  app: { name: string; _packageId?: unknown },
  body: Record<string, unknown>,
) {
  const packageId = owningPackage(app);
  return packageId
    ? meta.saveItem('app', app.name, body, { packageId })
    : meta.saveItem('app', app.name, body);
}

/**
 * Delete one app's row in the scope it is served from (objectui#12397).
 *
 * The same reading as {@link saveApp}: a package-owned app is deleted with
 * `{ packageId }`, which the SDK sends as `?package=`, so a name two packages
 * hold is not refused for naming neither. A package-less app is deleted with
 * no third argument, because there is no package to name. Never a guess: the
 * scope comes only from the served `_packageId`.
 */
function deleteApp(meta: MetaWriteClient, app: { name: string; _packageId?: unknown }) {
  const packageId = owningPackage(app);
  return packageId
    ? meta.deleteItem('app', app.name, { packageId })
    : meta.deleteItem('app', app.name);
}

/**
 * What the server said, when it said anything — never a swallowed failure.
 *
 * The message is returned UNTRANSLATED by construction (objectui#4307): it is
 * the server's own sentence about this request, and the only localized part is
 * `unknown`, which is what this page says when the server said nothing at all.
 */
function reason(e: unknown, unknown: string): string {
  const message = e instanceof Error ? e.message : String(e ?? '');
  return message || unknown;
}

export function AppManagementPage() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const { appName } = useParams();
  const basePath = appName ? `/apps/${appName}` : '';
  const { apps, refresh } = useMetadata();
  const adapter = useAdapter();

  /**
   * The metadata write surface, or `null` when this page is mounted without an
   * adapter. Returning `null` rather than throwing keeps the read-only surface
   * (search, badges, navigation) usable; each handler refuses loudly instead —
   * which is the whole point of this card: no control may report success it
   * cannot substantiate.
   */
  const metaClient = useCallback((): MetaWriteClient | null => {
    const client = (adapter as AdapterWithClient | null | undefined)?.getClient?.();
    return client?.meta ?? null;
  }, [adapter]);

  /** The page's own word for "the server told us nothing" — see `reason`. */
  const unknownError = t('appManagement.toast.unknownError', { defaultValue: 'unknown error' });

  /**
   * One display name for an app, used by every label and toast below.
   *
   * `t` is passed on deliberately: an app's `label` may be objectui's KEYED
   * form (`{ key, defaultValue }`), and the resolver only reaches the pack when
   * it is handed a translator — the same call shape `AppSwitcher` and
   * `DashboardView` already use. Without it a keyed label renders its authoring
   * `defaultValue` on every locale; interpolating `app.label` directly (what
   * these labels did before this page was keyed) renders `[object Object]`.
   */
  const appTitle = useCallback(
    (app: any): string => resolveKeyedI18nLabel(app?.label, t) || app?.name || '',
    [t],
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  /**
   * Filter apps by search query — through the SAME resolver the rows render
   * with (objectui#4343).
   *
   * `label` and `description` are `I18nLabel` in `AppSchema`
   * (`string | Record< string, string >` in `@objectstack/spec` 17.0.0-rc.6), so
   * an authored non-string label is spec-legal. An object is TRUTHY, so the
   * `(app.label || '')` guard this filter used to carry never fired for one — it
   * handed the object straight to `.toLowerCase()`:
   *
   *     TypeError: (l || "").toLowerCase is not a function
   *
   * thrown inside `filter` **during render**, so it took the whole page out
   * rather than degrading search. And only on the first keystroke, because
   * `if (!searchQuery) return true` short-circuits the empty case — the page
   * loaded fine and died the moment anyone used it.
   *
   * The fix is not a wider guard, it is the SAME reading the rows already use:
   * `appTitle` (the one display-name helper #4307 introduced) and the identical
   * `resolveKeyedI18nLabel(…, t)` call the description `< p >` makes below. So
   * search now matches what the operator can actually SEE — the pack's answer
   * for a keyed label rather than its authoring `defaultValue`, and `app.name`
   * wherever the row heading itself falls back to it — and any future widening
   * of the resolver (objectui#4163's inline-locale-map form) reaches search and
   * display in the same commit, instead of leaving this filter behind again.
   */
  const filteredApps = (apps || []).filter((app: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (app.name || '').toLowerCase().includes(q) ||
      appTitle(app).toLowerCase().includes(q) ||
      (resolveKeyedI18nLabel(app.description, t) || '').toLowerCase().includes(q)
    );
  });

  const toggleSelect = useCallback((name: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredApps.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredApps.map((a: any) => a.name)));
    }
  }, [selectedIds.size, filteredApps]);

  const handleToggleActive = useCallback(async (app: any) => {
    const meta = metaClient();
    if (!meta) {
      toast.error(t('appManagement.toast.noClient', { defaultValue: 'Cannot reach the metadata service' }));
      return;
    }
    setProcessing(true);
    try {
      const newActive = app.active === false;
      // Spread the record the server gave us and override the ONE key this
      // control owns — the same round trip `useNavigationSync.saveApp` performs
      // for the `navigation` key. Rebuilding a minimal payload instead would
      // drop every field of the app the console does not model.
      await saveApp(meta, app, { ...app, active: newActive });
      toast.success(
        newActive
          ? t('appManagement.toast.appEnabled', { defaultValue: '{{name}} enabled', name: appTitle(app) })
          : t('appManagement.toast.appDisabled', { defaultValue: '{{name}} disabled', name: appTitle(app) }),
      );
    } catch (e: unknown) {
      // The frame is localized; `{{reason}}` is the server's own sentence, raw.
      toast.error(t('appManagement.toast.toggleFailed', {
        defaultValue: 'Failed to toggle app status: {{reason}}',
        reason: reason(e, unknownError),
      }));
    } finally {
      // Re-read whatever the write answered: the row shows the served state.
      await refresh();
      setProcessing(false);
    }
  }, [refresh, metaClient, t, appTitle, unknownError]);

  const handleSetDefault = useCallback(async (app: any) => {
    const meta = metaClient();
    if (!meta) {
      toast.error(t('appManagement.toast.noClient', { defaultValue: 'Cannot reach the metadata service' }));
      return;
    }
    setProcessing(true);
    try {
      // `isDefault` ROUTES (`resolveLandingPath` rule 1 takes the FIRST match),
      // so it is single-valued in effect but not by construction: leaving the
      // previous holder set would make the landing depend on the order the
      // server happens to list apps in. Demote first, promote second — that
      // ordering is what makes a failure mid-way leave the deployment with NO
      // default (falls through to `/home`, the documented rule-3 answer) rather
      // than with two.
      const outgoing = (apps || []).filter(
        (a: any) => a?.isDefault === true && a.name !== app.name,
      );
      // Each app is saved in ITS OWN package's scope: the outgoing default and
      // the incoming one may belong to different packages, or to none.
      for (const prev of outgoing) {
        await saveApp(meta, prev, { ...prev, isDefault: false });
      }
      await saveApp(meta, app, { ...app, isDefault: true });
      toast.success(t('appManagement.toast.setDefaultDone', {
        defaultValue: '{{name}} set as default',
        name: appTitle(app),
      }));
    } catch (e: unknown) {
      toast.error(t('appManagement.toast.setDefaultFailed', {
        defaultValue: 'Failed to set default app: {{reason}}',
        reason: reason(e, unknownError),
      }));
    } finally {
      // Re-read on failure too: a failure after the demotion has already
      // changed the server, and the list must show the deployment as it now is.
      await refresh();
      setProcessing(false);
    }
  }, [apps, refresh, metaClient, t, appTitle, unknownError]);

  const handleDelete = useCallback(async (appToDelete: any) => {
    if (confirmDelete !== appToDelete.name) {
      setConfirmDelete(appToDelete.name);
      return;
    }
    const meta = metaClient();
    if (!meta) {
      toast.error(t('appManagement.toast.noClient', { defaultValue: 'Cannot reach the metadata service' }));
      return;
    }
    setProcessing(true);
    try {
      const answer = await deleteApp(meta, appToDelete);
      setConfirmDelete(null);
      if (answer.reset === false) {
        // The door found no customization row to remove: the app already is
        // what its package ships, and nothing was deleted. Said neutrally, in
        // the server's own words, which only the frame around them localizes.
        // When the server gives no sentence, the page states what `reset: false`
        // means.
        toast.info(t('appManagement.toast.nothingToDelete', {
          defaultValue: 'Nothing to delete for {{name}}: {{reason}}',
          name: appTitle(appToDelete),
          reason: answer.message || t('appManagement.toast.alreadyAtDefault', {
            defaultValue: 'it is already at its package default',
          }),
        }));
      } else {
        toast.success(t('appManagement.toast.appDeleted', {
          defaultValue: '{{name}} deleted',
          name: appTitle(appToDelete),
        }));
      }
    } catch (e: unknown) {
      toast.error(t('appManagement.toast.deleteFailed', {
        defaultValue: 'Failed to delete app: {{reason}}',
        reason: reason(e, unknownError),
      }));
    } finally {
      // The list is re-read, never edited: a row leaves only when the server
      // stops serving it.
      await refresh();
      setProcessing(false);
    }
  }, [confirmDelete, refresh, metaClient, t, appTitle, unknownError]);

  const handleBulkToggle = useCallback(async (active: boolean) => {
    const meta = metaClient();
    if (!meta) {
      toast.error(t('appManagement.toast.noClient', { defaultValue: 'Cannot reach the metadata service' }));
      return;
    }
    setProcessing(true);
    // Report what actually landed. A bulk toggle is N independent writes with
    // no transaction behind them, so "12 apps disabled" after 9 successes and 3
    // permission failures would be the same class of lie this card is closing —
    // just harder to notice.
    let saved = 0;
    const failures: string[] = [];
    try {
      const byName = new Map((apps || []).map((a: any) => [a?.name, a]));
      for (const name of selectedIds) {
        const app = byName.get(name);
        if (!app) continue;
        try {
          await saveApp(meta, app, { ...app, active });
          saved += 1;
        } catch (e: unknown) {
          // Keyed for its PUNCTUATION as much as its words — the CJK packs set
          // the bracket pair and the space before it, exactly as
          // `detail.userStatusTitle` does. `{{reason}}` stays the server's.
          failures.push(t('appManagement.toast.bulkFailureEntry', {
            defaultValue: '{{name}} ({{reason}})',
            name: appTitle(app),
            reason: reason(e, unknownError),
          }));
        }
      }
      if (saved > 0) {
        toast.success(
          active
            ? t('appManagement.toast.bulkEnabled', { defaultValue: '{{n}} apps enabled', n: saved })
            : t('appManagement.toast.bulkDisabled', { defaultValue: '{{n}} apps disabled', n: saved }),
        );
        setSelectedIds(new Set());
      }
      if (failures.length > 0) {
        // The joiner is a locale property, not a code constant — same rule (and
        // same past defect) as `validation.formInvalidJoiner`.
        const joiner = t('appManagement.toast.bulkFailureJoiner', { defaultValue: '; ' });
        toast.error(t('appManagement.toast.bulkFailed', {
          defaultValue: 'Failed for {{n}}: {{details}}',
          n: failures.length,
          details: failures.join(joiner),
        }));
      }
    } catch (e: unknown) {
      toast.error(t('appManagement.toast.bulkOperationFailed', {
        defaultValue: 'Bulk operation failed: {{reason}}',
        reason: reason(e, unknownError),
      }));
    } finally {
      await refresh();
      setProcessing(false);
    }
  }, [apps, selectedIds, refresh, metaClient, t, appTitle, unknownError]);

  return (
    <div>
    {/* The console's one page header (objectui#12553), the one an object list,
        a dashboard and the Approvals Inbox draw: the title, the subtitle
        beside it from `sm` up, and New App at the right, in one row across
        the page above the padded body. This page draws no icon, so the header
        draws no chip. New App is `size="sm"`, as every header action is, so
        it does not make this header taller than the others. Below `sm` the
        header hides the subtitle and keeps the title and New App in its one
        row. */}
    <ConsolePageHeader
      title={t('appManagement.title', { defaultValue: 'Applications' })}
      subtitle={t('appManagement.subtitle', { defaultValue: 'Manage all configured applications' })}
      actions={
        <Button size="sm" onClick={() => navigate(`${basePath}/create-app`)} data-testid="create-app-btn">
          <Plus className="h-4 w-4 mr-2" />
          {t('appManagement.newApp', { defaultValue: 'New App' })}
        </Button>
      }
    />
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      {/* Search & Bulk Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <label htmlFor="app-search" className="sr-only">
            {t('appManagement.searchLabel', { defaultValue: 'Search apps' })}
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="app-search"
            placeholder={t('appManagement.searchPlaceholder', { defaultValue: 'Search apps…' })}
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="pl-8"
            data-testid="app-search-input"
          />
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {t('appManagement.selectedCount', { defaultValue: '{{n}} selected', n: selectedIds.size })}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => handleBulkToggle(true)} disabled={processing}>
              {t('appManagement.bulkEnable', { defaultValue: 'Enable' })}
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleBulkToggle(false)} disabled={processing}>
              {t('appManagement.bulkDisable', { defaultValue: 'Disable' })}
            </Button>
          </div>
        )}
      </div>

      {/* Select All */}
      {filteredApps.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            id="select-all-apps"
            checked={selectedIds.size === filteredApps.length && filteredApps.length > 0}
            onCheckedChange={() => toggleSelectAll()}
          />
          <label htmlFor="select-all-apps" className="cursor-pointer">
            {t('appManagement.selectAll', { defaultValue: 'Select all ({{n}})', n: filteredApps.length })}
          </label>
        </div>
      )}

      {/* App List */}
      {filteredApps.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground" data-testid="no-apps-message">
          <LayoutGrid className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>{t('appManagement.empty', { defaultValue: 'No apps found.' })}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredApps.map((app: any) => {
            const isActive = app.active !== false;
            const isDefault = app.isDefault === true;
            const isDeleting = confirmDelete === app.name;
            // One resolved display name for the row: the visible heading and
            // all six control labels below name the app the SAME way.
            const title = appTitle(app);

            return (
              <Card key={app.name} className={!isActive ? 'opacity-60' : ''} data-testid={`app-card-${app.name}`}>
                <CardContent className="flex items-center gap-3 py-3 px-4">
                  <Checkbox
                    id={`select-app-${app.name}`}
                    checked={selectedIds.has(app.name)}
                    onCheckedChange={() => toggleSelect(app.name)}
                    aria-label={t('appManagement.selectApp', { defaultValue: 'Select {{name}}', name: title })}
                    className="shrink-0"
                  />
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <LayoutGrid className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{title}</span>
                      {isDefault && (
                        <Badge variant="default" className="text-xs">
                          {t('appManagement.defaultBadge', { defaultValue: 'Default' })}
                        </Badge>
                      )}
                      <Badge variant={isActive ? 'secondary' : 'outline'} className="text-xs">
                        {isActive
                          ? t('appManagement.active', { defaultValue: 'Active' })
                          : t('appManagement.inactive', { defaultValue: 'Inactive' })}
                      </Badge>
                    </div>
                    {app.description && (
                      <p className="text-xs text-muted-foreground truncate">{resolveKeyedI18nLabel(app.description, t)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('appManagement.openApp', { defaultValue: 'Open app' })}
                      aria-label={t('appManagement.openAppNamed', { defaultValue: 'Open {{name}}', name: title })}
                      // ADR-0048 — open via the canonical package-id route segment
                      // (falls back to name for runtime apps without a package id).
                      onClick={() => navigate(`/apps/${app._packageId ?? app.name}`)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('appManagement.editApp', { defaultValue: 'Edit app' })}
                      aria-label={t('appManagement.editAppNamed', { defaultValue: 'Edit {{name}}', name: title })}
                      onClick={() => navigate(`${basePath}/edit-app/${app.name}`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {app._packageId ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('appManagement.editWithAi', { defaultValue: 'Edit with AI' })}
                        aria-label={t('appManagement.editWithAiNamed', {
                          defaultValue: 'Edit {{name}} with AI',
                          name: title,
                        })}
                        // ADR-0070 — open the build agent in a fresh conversation
                        // pre-scoped to this app's package (passed as the chat
                        // context.packageId the cloud seeds as the active package),
                        // so the AI iterates within THIS app, not the whole env.
                        onClick={() =>
                          navigate(`/ai/build?package=${encodeURIComponent(app._packageId!)}&new=1`)
                        }
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      title={isActive
                        ? t('appManagement.disableApp', { defaultValue: 'Disable app' })
                        : t('appManagement.enableApp', { defaultValue: 'Enable app' })}
                      aria-label={isActive
                        ? t('appManagement.disableAppNamed', { defaultValue: 'Disable {{name}}', name: title })
                        : t('appManagement.enableAppNamed', { defaultValue: 'Enable {{name}}', name: title })}
                      onClick={() => handleToggleActive(app)}
                      disabled={processing}
                    >
                      {isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('appManagement.setDefault', { defaultValue: 'Set as default' })}
                      aria-label={t('appManagement.setDefaultNamed', {
                        defaultValue: 'Set {{name}} as default',
                        name: title,
                      })}
                      onClick={() => handleSetDefault(app)}
                      disabled={processing || isDefault}
                    >
                      <Star className={`h-4 w-4 ${isDefault ? 'fill-current text-yellow-500' : ''}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={isDeleting
                        ? t('appManagement.confirmDelete', { defaultValue: 'Click again to confirm delete' })
                        : t('appManagement.deleteApp', { defaultValue: 'Delete app' })}
                      aria-label={isDeleting
                        ? t('appManagement.confirmDeleteNamed', {
                            defaultValue: 'Confirm delete {{name}}',
                            name: title,
                          })
                        : t('appManagement.deleteAppNamed', { defaultValue: 'Delete {{name}}', name: title })}
                      onClick={() => handleDelete(app)}
                      disabled={processing}
                      className={isDeleting ? 'text-destructive' : ''}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}

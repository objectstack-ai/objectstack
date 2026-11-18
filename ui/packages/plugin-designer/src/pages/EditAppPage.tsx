/**
 * EditAppPage
 *
 * Console page that reuses AppCreationWizard in edit mode.
 * Loads the existing app configuration as `initialDraft` and
 * updates the app on completion.
 * @module
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppCreationWizard, navObjectNames } from '../AppCreationWizard';
import { wizardDraftToAppSchema } from '@object-ui/types';
import type { AppWizardDraft, ObjectSelection } from '@object-ui/types';
import { AppSchema as SpecAppSchema, AppBrandingSchema as SpecAppBrandingSchema } from '@objectstack/spec/ui';
import { useMetadata } from '@object-ui/react';
import { useAdapter } from '@object-ui/react';
// Declares the ObjectStackAdapter this page reads `getClient` off.
import '../adapter-context-register';
import { toast } from 'sonner';

/**
 * The keys an app document may carry — read off `@objectstack/spec`'s own
 * strict `AppSchema`, never hand-listed, so the set moves with the spec (the
 * `getListViewConfigKeys` precedent in app-shell's `ObjectView`). Computed on
 * first use: the schema is a lazy proxy.
 */
let appDeclaredKeys: ReadonlySet<string> | undefined;
function getAppDeclaredKeys(): ReadonlySet<string> {
  appDeclaredKeys ??= new Set(Object.keys(SpecAppSchema.shape));
  return appDeclaredKeys;
}

/**
 * The keys an app's `branding` may carry, read off the spec's strict
 * `AppBrandingSchema` the same way (objectui#10867).
 */
let brandingDeclaredKeys: ReadonlySet<string> | undefined;
function getBrandingDeclaredKeys(): ReadonlySet<string> {
  brandingDeclaredKeys ??= new Set(Object.keys(SpecAppBrandingSchema.shape));
  return brandingDeclaredKeys;
}

/**
 * The value the server stamps as `_packageId` on a row bound to NO package. It
 * names no package, so it is never sent as one.
 */
const PACKAGELESS_SENTINEL = 'sys_metadata';

/**
 * The package that owns the served app, or `undefined` for an app no package
 * owns: the one address this page reads the app at and saves it to
 * (objectstack#35115). The same reading as App management's `owningPackage`
 * (objectui#12300), so one served value means one scope across the console.
 */
function owningPackage(app: { _packageId?: unknown } | undefined): string | undefined {
  const packageId = app?._packageId;
  return typeof packageId === 'string' && packageId !== '' && packageId !== PACKAGELESS_SENTINEL
    ? packageId
    : undefined;
}

/** The entries of `record` whose key `declared` holds. */
function pickDeclared(record: unknown, declared: ReadonlySet<string>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return {};
  return Object.fromEntries(Object.entries(record).filter(([key]) => declared.has(key)));
}

export function EditAppPage() {
  const navigate = useNavigate();
  const { appName, editAppName } = useParams();
  const { apps, objects, refresh } = useMetadata();
  const adapter = useAdapter();

  const targetAppName = editAppName || appName;

  // Find the app to edit. The served list only says the app exists and where
  // it is served from: its words are translated for the console's locale.
  const servedApp = apps.find((a: any) => a.name === targetAppName);
  // objectstack#35115 — the app's package is its address for the read below
  // AND the save: a packaged app is saved with `{ packageId }` (`?package=`),
  // the row the read came from. A package-less app is read and saved with no
  // package, as before. A managed package's sealed app (ADR-0131 D6) is still
  // refused by the server at either address; naming its package writes
  // nothing the package-less save did not.
  const servedPackageId = owningPackage(servedApp);

  // objectstack#35054 (route D) — the wizard edits the app as its author
  // stored it, read from the untranslated layers (`getAuthoredItem`). The
  // served app is translated for the console's locale (its label and every
  // navigation label), and the save below sends a whole document the door
  // stores verbatim, so seeding the wizard with it stored the translations as
  // the app's source text. A read that fails or finds nothing opens nothing.
  const [authored, setAuthored] = useState<
    { for: string; app: Record<string, any> | null; error?: string } | null
  >(null);
  useEffect(() => {
    if (!servedApp?.name) return;
    let cancelled = false;
    const name = servedApp.name as string;
    const read = adapter?.getAuthoredItem
      ? adapter.getAuthoredItem('app', name, servedPackageId ? { packageId: servedPackageId } : {})
      : Promise.reject(new Error('No metadata client'));
    read.then(
      (app) => { if (!cancelled) setAuthored({ for: name, app }); },
      (err: any) => { if (!cancelled) setAuthored({ for: name, app: null, error: String(err?.message ?? err) }); },
    );
    return () => { cancelled = true; };
  }, [adapter, servedApp?.name, servedPackageId]);
  const appToEdit: Record<string, any> | undefined =
    authored && authored.for === servedApp?.name && authored.app ? authored.app : undefined;

  // Map metadata objects to ObjectSelection format. An object is selected when
  // the stored navigation has an object entry for it ANYWHERE, a group's
  // children included (objectui#10894): leaving the Objects step drops the
  // entries of every object listed as deselected, so a grouped entry read as
  // unselected would be lost on an edit that never touched it.
  const storedObjectNames = navObjectNames(appToEdit?.navigation || []);
  const availableObjects: ObjectSelection[] = (objects || []).map((obj: any) => ({
    name: obj.name,
    label: obj.label || obj.name,
    pluralLabel: obj.pluralLabel,
    icon: obj.icon,
    selected: storedObjectNames.has(obj.name),
  }));

  // Convert existing app to wizard draft
  const initialDraft = useMemo((): Partial<AppWizardDraft> | undefined => {
    if (!appToEdit) return undefined;
    return {
      name: appToEdit.name,
      title: appToEdit.label || '',
      description: appToEdit.description || '',
      icon: appToEdit.icon || '',
      navigation: appToEdit.navigation || [],
      branding: {
        logo: appToEdit.branding?.logo || '',
        primaryColor: appToEdit.branding?.primaryColor || '#3b82f6',
        favicon: appToEdit.branding?.favicon || '',
      },
    };
  }, [appToEdit]);

  const handleComplete = useCallback(
    async (draft: AppWizardDraft) => {
      try {
        const appSchema = wizardDraftToAppSchema(draft);
        // Keep what the wizard does not maintain (areas, permissions, the
        // package envelope, …), but only keys the spec's `AppSchema` declares
        // (objectui#10842). A row stored before that schema closed is served
        // with the old wizard's top-level `type` / `title` / `logo` / `favicon`
        // / `layout`, and the door refuses a save that echoes them back.
        const preserved = pickDeclared(appToEdit, getAppDeclaredKeys());
        // The same rule one level down (objectui#10867): the wizard maintains
        // the logo, primary colour and favicon, and its `branding` would
        // otherwise REPLACE the stored block, dropping every other declared
        // key — `accentColor`, which the console reads, on every edit.
        const branding = {
          ...pickDeclared(appToEdit?.branding, getBrandingDeclaredKeys()),
          ...appSchema.branding,
        };
        const merged = { ...preserved, ...appSchema, branding };
        // Persist app metadata to backend
        const client = adapter?.getClient();
        if (client) {
          await (servedPackageId
            ? client.meta.saveItem('app', draft.name, merged, { packageId: servedPackageId })
            : client.meta.saveItem('app', draft.name, merged));
        }
        toast.success(`Application "${draft.title}" updated successfully`);
        await refresh?.();
        navigate(`/apps/${draft.name}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to update application');
      }
    },
    [navigate, refresh, adapter, appToEdit, servedPackageId],
  );

  const handleCancel = useCallback(() => {
    if (appName) {
      navigate(`/apps/${appName}`);
    } else {
      navigate('/');
    }
  }, [navigate, appName]);

  const handleSaveDraft = useCallback((draft: AppWizardDraft) => {
    try {
      localStorage.setItem(`objectui-edit-draft-${targetAppName}`, JSON.stringify(draft));
      toast.info('Draft saved');
    } catch {
      // localStorage full
    }
  }, [targetAppName]);

  if (servedApp && (!authored || authored.for !== servedApp.name)) {
    return <div className="mx-auto max-w-4xl py-8 px-4" data-testid="edit-app-loading" />;
  }

  if (servedApp && !appToEdit) {
    return (
      <div className="mx-auto max-w-4xl py-8 px-4 text-center" data-testid="edit-app-load-failed">
        <p className="text-muted-foreground">
          Application &quot;{targetAppName}&quot; could not be read for editing{authored?.error ? `: ${authored.error}` : '.'}
        </p>
      </div>
    );
  }

  if (!appToEdit) {
    return (
      <div className="mx-auto max-w-4xl py-8 px-4 text-center" data-testid="edit-app-not-found">
        <p className="text-muted-foreground">Application &quot;{targetAppName}&quot; not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl py-8 px-4" data-testid="edit-app-page">
      <AppCreationWizard
        availableObjects={availableObjects}
        initialDraft={initialDraft}
        onComplete={handleComplete}
        onCancel={handleCancel}
        onSaveDraft={handleSaveDraft}
      />
    </div>
  );
}

/**
 * EditAppPage
 *
 * Console page that reuses AppCreationWizard in edit mode.
 * Loads the existing app configuration as `initialDraft` and
 * updates the app on completion.
 * @module
 */

import { useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppCreationWizard, navObjectNames } from '../AppCreationWizard';
import { wizardDraftToAppSchema } from '@object-ui/types';
import type { AppWizardDraft, ObjectSelection } from '@object-ui/types';
import { AppSchema as SpecAppSchema, AppBrandingSchema as SpecAppBrandingSchema } from '@objectstack/spec/ui';
import { useMetadata } from '@object-ui/react';
import { useAdapter } from '@object-ui/react';
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

  // Find the app to edit
  const appToEdit = apps.find((a: any) => a.name === targetAppName);

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
          await client.meta.saveItem('app', draft.name, merged);
        }
        toast.success(`Application "${draft.title}" updated successfully`);
        await refresh?.();
        navigate(`/apps/${draft.name}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to update application');
      }
    },
    [navigate, refresh, adapter, appToEdit],
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

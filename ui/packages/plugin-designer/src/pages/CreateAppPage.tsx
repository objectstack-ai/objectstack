/**
 * CreateAppPage
 *
 * Console page that renders the AppCreationWizard from @object-ui/plugin-designer.
 * Handles wizard callbacks: onComplete (create app), onCancel (navigate back),
 * onSaveDraft (persist to localStorage).
 * @module
 */

import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppCreationWizard } from '../AppCreationWizard';
import { wizardDraftToAppSchema } from '@object-ui/types';
import type { AppWizardDraft, ObjectSelection } from '@object-ui/types';
import { useMetadata } from '@object-ui/react';
import { useAdapter } from '@object-ui/react';
import { toast } from 'sonner';

const DRAFT_STORAGE_KEY = 'objectui-app-wizard-draft';

export function CreateAppPage() {
  const navigate = useNavigate();
  const { appName } = useParams();
  const { objects, refresh } = useMetadata();
  const adapter = useAdapter();

  // Map metadata objects to ObjectSelection format
  const availableObjects: ObjectSelection[] = (objects || []).map((obj: any) => ({
    name: obj.name,
    label: obj.label || obj.name,
    pluralLabel: obj.pluralLabel,
    icon: obj.icon,
    selected: false,
  }));

  // Load saved draft from localStorage (if any)
  const loadDraft = useCallback((): Partial<AppWizardDraft> | undefined => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as Partial<AppWizardDraft>;
      }
    } catch {
      // ignore
    }
    return undefined;
  }, []);

  const handleComplete = useCallback(
    async (draft: AppWizardDraft) => {
      try {
        const appSchema = wizardDraftToAppSchema(draft);
        // Persist app metadata to backend
        const client = adapter?.getClient();
        if (client) {
          await client.meta.saveItem('app', draft.name, appSchema);
        }
        // Clear draft from localStorage on successful creation
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        toast.success(`Application "${draft.title}" created successfully`);
        // Refresh metadata so the new app shows up
        await refresh?.();
        // Navigate to the new app
        navigate(`/apps/${draft.name}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to create application');
      }
    },
    [navigate, refresh, adapter],
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
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      toast.info('Draft saved');
    } catch {
      // localStorage full — ignore
    }
  }, []);

  return (
    <div className="mx-auto max-w-4xl py-8 px-4" data-testid="create-app-page">
      <AppCreationWizard
        availableObjects={availableObjects}
        initialDraft={loadDraft()}
        onComplete={handleComplete}
        onCancel={handleCancel}
        onSaveDraft={handleSaveDraft}
      />
    </div>
  );
}

/**
 * useObjectActions Hook
 *
 * Provides action handlers for CRUD operations on an object, backed by
 * the ActionRunner from @object-ui/core via the useActionRunner hook.
 *
 * Supports:
 * - create: Open create dialog
 * - delete: Delete a record with confirmation
 * - navigate: Route to a specific view or record
 * - refresh: Trigger a data refresh
 */

import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useActionRunner } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { toast } from 'sonner';
import {
  recordDelete,
  type ActionDef,
  type ActionResult,
  type ConfirmationHandler,
  type RecordDeleteConfirmCopy,
} from '@object-ui/core';

/** The browser's native box — the fallback when the host passes no `onConfirm`. */
const nativeConfirm: ConfirmationHandler = async (message) => window.confirm(message);

interface ObjectActionConfig {
  objectName: string;
  objectLabel?: string;
  /**
   * The object definition, so the delete confirmation names the record by its
   * declared name field (ADR-0079) rather than a guessed record key.
   */
  objectDef?: unknown;
  dataSource: any;
  onEdit?: (record: any) => void;
  onRefresh?: () => void;
  /** Optional shadcn-style confirm handler — falls back to window.confirm */
  onConfirm?: ConfirmationHandler;
  /** Optional toast handler — falls back to sonner */
  onToast?: (message: string, options?: { type?: string }) => void;
}

interface ObjectActions {
  /** Run an action by schema or type string */
  execute: (action: ActionDef) => Promise<ActionResult>;
  /** Create new record — opens the create dialog */
  create: () => void;
  /**
   * Delete a record by id. Pass the row (`record`) when available so the
   * confirmation names the record (objectui#11695) without an extra fetch.
   */
  deleteRecord: (recordId: string, record?: Record<string, unknown>) => Promise<ActionResult>;
  /** Delete several records, confirmed once for the batch. */
  deleteRecords: (records: Record<string, unknown>[]) => Promise<ActionResult>;
  /** Navigate to a view */
  navigateToView: (viewId: string) => void;
  /** Navigate to a record detail */
  navigateToRecord: (recordId: string) => void;
  /** Whether an action is currently executing */
  loading: boolean;
  /** Last error message */
  error: string | null;
}

export function useObjectActions({
  objectName,
  objectLabel,
  objectDef,
  dataSource,
  onEdit,
  onRefresh,
  onConfirm,
  onToast,
}: ObjectActionConfig): ObjectActions {
  const navigate = useNavigate();
  const { appName } = useParams();
  const { t } = useObjectTranslation();
  const baseUrl = `/apps/${appName}`;

  const { execute, loading, error, runner } = useActionRunner({
    context: {
      objectName,
      objectLabel: objectLabel || objectName,
      baseUrl,
    },
    onConfirm,
    onToast,
  });

  // Register custom handlers
  useEffect(() => {
    // Handler: create
    runner.registerHandler('create', async () => {
      onEdit?.(null);
      return { success: true };
    });

    // Handler: delete — the shared record-delete core (objectui#10383), the
    // same one `plugin-view`'s grid Delete binds to. Its param shapes:
    //   { params: { recordId } }       — toolbar / programmatic deletes
    //   { params: { record } }         — ObjectGrid row dropdown
    //   { params: { records: [...] } } — bulk delete (multi-row)
    //   { recordId } (legacy)          — pre-params shape
    // It owns the toasts and returns without `error` (and `silent` on
    // success), so the runner's post-execution hook adds no second toast.
    runner.registerHandler('delete', (action: any) =>
      recordDelete.run(
        { objectName, label: objectLabel || objectName, dataSource, t, toast, onRefresh },
        action,
      ),
    );

    // Handler: navigate
    runner.registerHandler('navigate', async (action: any) => {
      const url = action.params?.url || action.url;
      if (url) {
        navigate(url.startsWith('/') ? url : `${baseUrl}/${url}`);
      }
      return { success: true };
    });

    // Handler: refresh
    runner.registerHandler('refresh', async () => {
      onRefresh?.();
      return { success: true, reload: true };
    });
  }, [runner, objectName, dataSource, onEdit, onRefresh, navigate, baseUrl, t, objectLabel]);

  const create = useCallback(() => {
    onEdit?.(null);
  }, [onEdit]);

  // objectui#11695 — a delete asks with the shared core's WHOLE copy: a title
  // that names the record (or counts the batch), the body, and a "Delete"
  // button painted destructive. The runner's own confirm step hands the
  // handler one argument — the `confirmText` body — so it can carry neither the
  // title nor the button; the question is therefore asked here, through the
  // same handler, and the delete then runs through the runner with no
  // `confirmText`, so nothing asks twice. A cancel returns what the runner's
  // cancel returned.
  const label = objectLabel || objectName;
  const confirmDelete = useCallback(
    async (copy: RecordDeleteConfirmCopy): Promise<boolean> =>
      (onConfirm ?? nativeConfirm)(copy.message, {
        title: copy.title,
        confirmText: copy.confirmText,
        destructive: true,
      }),
    [onConfirm],
  );

  const deleteRecord = useCallback(
    async (recordId: string, record?: Record<string, unknown>): Promise<ActionResult> => {
      // The copy comes from the shared record-delete core (objectui#10383).
      // With only an id in hand the title names the record by the resolver's
      // `Record #id` floor.
      const copy = recordDelete.confirmCopy(
        { objectName, t, label, objectDef },
        { record: record ?? { id: recordId } },
      );
      if (!(await confirmDelete(copy))) return { success: false, error: 'Action cancelled by user' };
      return execute({
        type: 'delete',
        params: record ? { recordId, record } : { recordId },
      });
    },
    [execute, t, objectName, label, objectDef, confirmDelete],
  );

  const deleteRecords = useCallback(
    async (records: Record<string, unknown>[]): Promise<ActionResult> => {
      const copy = recordDelete.confirmCopy(
        { objectName, t, label, objectDef },
        { count: records.length },
      );
      if (!(await confirmDelete(copy))) return { success: false, error: 'Action cancelled by user' };
      return execute({ type: 'delete', params: { records } });
    },
    [execute, t, objectName, label, objectDef, confirmDelete],
  );

  const navigateToView = useCallback(
    (viewId: string) => {
      navigate(`${baseUrl}/${objectName}/view/${viewId}`);
    },
    [navigate, baseUrl, objectName],
  );

  const navigateToRecord = useCallback(
    (recordId: string) => {
      navigate(`${baseUrl}/${objectName}/record/${encodeURIComponent(recordId)}`);
    },
    [navigate, baseUrl, objectName],
  );

  return {
    execute,
    create,
    deleteRecord,
    deleteRecords,
    navigateToView,
    navigateToRecord,
    loading,
    error,
  };
}

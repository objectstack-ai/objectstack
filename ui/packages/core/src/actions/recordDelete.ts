/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE record-delete core — the confirm question and the delete itself —
 * that every host's list Delete binds to (objectui#10383).
 *
 * ## Why this lives here, and why there is only one
 *
 * The console's object list deleted through `useObjectActions` (`app-shell`):
 * the confirm question, the single delete with its ADR-0094 detection, the bulk
 * delete and their toasts were written inline in that hook. The registered
 * `object-view` renderer (`plugin-view`) had no delete at all — its grid
 * handlers only refreshed — and the first repair COPIED those steps into a
 * second flow. The copy already diverged on consent: it asked every row the
 * plain "delete this record?" question, while the console asked a package-owned
 * permission set the reset question (that question went with the catalog
 * objects, ADR-0131). One operation with two
 * implementations drifts on exactly the part that matters, so the rule is: the
 * side with the governance keeps it, the other side re-binds to it, and there
 * is one copy. This module is that copy, and both hosts call it.
 *
 * `@object-ui/core` is the lowest package both hosts already depend on. The
 * host-specific pieces are INJECTED — the translator, the toast sink, the data
 * source and the refresh — so this package gains no i18n or toast dependency.
 * The host keeps its own confirm UI (`app-shell` hands the copy to the console's
 * confirm handler; `plugin-view` renders it in its own AlertDialog); the COPY —
 * title, body and confirm-button label — comes from
 * {@link recordDelete}.confirmCopy, whose body for one record is
 * {@link recordDelete}.confirmText.
 *
 * ## The confirmation names what it deletes (objectui#11695)
 *
 * A generic "Confirm Action" / "Continue" dialog never said WHICH record was
 * about to go, nor that the click is a delete. The title names the record by
 * the ONE ADR-0079 display-name resolver ({@link getRecordDisplayName}, the
 * resolver the record header and lookups use), and the object label — or, for
 * a batch, the count. The confirm button reads as the deletion it is; every
 * host paints it in the destructive button style.
 *
 * ## The result shape is the action runner's, on purpose
 *
 * `run` returns what a registered `delete` handler returns, because the console
 * registers it as exactly that. The toasts here are the AUTHORITATIVE feedback,
 * so every path returns WITHOUT an `error` key (and success returns `silent`) —
 * otherwise the runner's post-execution hook, which has its own toast handler,
 * would toast the same outcome a second time. The single exception is a
 * request with no record id at all, which toasts nothing here and returns the
 * `error` for the runner to report.
 *
 * Record ids are forwarded exactly as the caller supplied them; nothing here
 * converts them.
 */

import type { ActionResult } from './ActionRunner.js';
import { getRecordDisplayName } from '../utils/record-title.js';

type Row = Record<string, unknown>;

/** Translate a key — the host's `t`, injected so core takes no i18n dependency. */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Everything `run` needs from its host. `confirmText` needs only the first two. */
interface RecordDeleteDeps {
  objectName: string;
  t: Translate;
  /** The object's display label, used by the toasts. */
  label: string;
  dataSource: {
    delete(resource: string, id: string): Promise<unknown>;
  };
  /** The host's toast sink (sonner's `toast` in both hosts today). */
  toast: {
    success(message: string): unknown;
    error(message: string, data?: { description?: string }): unknown;
  };
  /** Re-read the list after a delete. */
  onRefresh?: () => void;
}

/**
 * The request, in the action runner's `delete` shape — the console registers
 * `run` as its `delete` handler, so the runner's action arrives here verbatim:
 * `params.records` (several), `params.recordId` + optional `params.record`
 * (one), and the legacy top-level `recordId`.
 */
interface RecordDeleteRequest {
  params?: { records?: unknown; recordId?: unknown; record?: Row | null };
  recordId?: unknown;
}

/**
 * The copy of a delete confirmation — everything a host's confirm dialog shows,
 * from {@link recordDelete}.confirmCopy (objectui#11695).
 */
export interface RecordDeleteConfirmCopy {
  /** The dialog title: names the record and its object, or the batch size. */
  title: string;
  /** The dialog body: the delete question, or the batch question. */
  message: string;
  /** The confirm button's label: a deletion verb, painted destructive by the host. */
  confirmText: string;
}

/**
 * What a delete confirmation is about: ONE record (its row — at least its
 * `id`, so a nameless row still reads by the resolver's `Record #id` floor) or
 * a batch (how many).
 */
export type RecordDeleteConfirmTarget = { record: Row | null | undefined } | { count: number };

/**
 * The record-delete core: `confirmText` is the question to ask before deleting
 * one record, `run` performs the delete (one record, or several settled
 * together) and reports it. See the module docblock for objectui#10383.
 */
export const recordDelete = Object.freeze({
  /**
   * The question to ask before deleting ONE record — the body of
   * {@link recordDelete}.confirmCopy.
   */
  confirmText(deps: Pick<RecordDeleteDeps, 't'>): string {
    return deps.t('objectActions.deleteConfirm');
  },

  /**
   * The whole delete confirmation — title, body and confirm-button label — for
   * ONE record or a batch (objectui#11695). Every host's delete dialog shows
   * this copy, so the list's row Delete, its bulk Delete and the record page's
   * Delete say the same thing.
   *
   * One record: the title names it — the object label plus the record's
   * display name from {@link getRecordDisplayName}, reading `objectDef`'s
   * declared name field when the host has the definition — and the body is
   * {@link recordDelete}.confirmText. A batch: the title counts it. The confirm
   * button is the delete verb in both, which the host paints destructive.
   */
  confirmCopy(
    deps: Pick<RecordDeleteDeps, 'objectName' | 't' | 'label'> & {
      /** The object definition, so the name follows its declared `nameField`. */
      objectDef?: unknown;
    },
    target: RecordDeleteConfirmTarget,
  ): RecordDeleteConfirmCopy {
    const { t, label } = deps;
    const confirmText = t('objectActions.deleteConfirmButton');
    if ('count' in target) {
      return {
        title: t('objectActions.bulkDeleteConfirmTitle', { count: target.count, label }),
        message: t('console.objectView.bulkDeleteConfirm', { count: target.count }),
        confirmText,
      };
    }
    return {
      title: t('objectActions.deleteConfirmTitle', {
        label,
        name: getRecordDisplayName(deps.objectDef, target.record),
      }),
      message: recordDelete.confirmText(deps),
      confirmText,
    };
  },

  /**
   * Delete, refresh and report. Several records (`params.records`, more than
   * one with an `id`) are deleted one call each and settled together, then the
   * list refreshes and ONE summary toast reports the batch. Otherwise one
   * record is deleted; on success the list refreshes and a success toast shows,
   * on failure an error
   * toast carries the error message and the list is left as it is.
   */
  async run(deps: RecordDeleteDeps, request: RecordDeleteRequest): Promise<ActionResult> {
    const { objectName, t, label, dataSource, toast, onRefresh } = deps;
    const params = request.params;
    const records = Array.isArray(params?.records)
      ? (params.records as Row[]).filter((r) => r?.id != null)
      : null;

    // Bulk path — delete every record in parallel and report a summary.
    if (records && records.length > 1) {
      const results = await Promise.allSettled(
        records.map((r) => dataSource.delete(objectName, r.id as string)),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results.length - failed;
      onRefresh?.();
      if (failed === 0) {
        toast.success(
          t('objectActions.bulkDeleteSuccess', {
            count: succeeded,
            label,
            defaultValue: `Deleted ${succeeded} ${label} records`,
          }),
        );
        // `silent`: the summary above is the feedback — without it the runner's
        // post-execution hook adds a second, generic success toast.
        return { success: true, reload: true, silent: true };
      }
      toast.error(
        t('objectActions.bulkDeletePartial', {
          succeeded,
          failed,
          defaultValue: `${succeeded} deleted, ${failed} failed`,
        }),
      );
      // The summary above is authoritative; returning WITHOUT `error` keeps the
      // runner from toasting the failure a second time.
      return { success: false };
    }

    const recordId =
      params?.recordId ?? params?.record?.id ?? records?.[0]?.id ?? request.recordId;
    if (!recordId) return { success: false, error: t('objectActions.noRecordId') };

    try {
      await dataSource.delete(objectName, recordId as string);
      onRefresh?.();
      toast.success(t('objectActions.deleteSuccess', { label }));
      return { success: true, reload: true, silent: true };
    } catch (err) {
      toast.error(t('objectActions.deleteFailed', { label }), {
        description: (err as Error).message,
      });
      // The toast above (label + error message) is the feedback; returning
      // WITHOUT `error` keeps the runner from toasting the raw message again.
      return { success: false };
    }
  },
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button } from '@object-ui/components';
import {
  Paperclip,
  Upload,
  Trash2,
  Download,
  Loader2,
  Lock,
  AlertTriangle,
  Ban,
  RefreshCw,
} from 'lucide-react';
import { createObjectStackUploadAdapter } from '@object-ui/providers';
import { createAuthenticatedFetch } from '@object-ui/auth';
import { useObjectTranslation, isPermissionError, classifyLoadError } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { resolveAffordance, type ConfirmationHandler } from '@object-ui/core';
import { ActionConfirmDialog, type ConfirmDialogState } from './ActionConfirmDialog.js';

/**
 * RecordAttachmentsPanel — generic record Attachments surface (objectstack-ai/objectstack#2727,
 * Salesforce "Notes & Attachments" parity).
 *
 * Rendered by RecordDetailView ONLY when the object declares
 * `enable: { files: true }` (opt-in; the server rejects sys_attachment
 * rows targeting any other object with 403 FILES_DISABLED, so this panel
 * and the enforcement seam always agree).
 *
 * Storage model: one `sys_file` row per uploaded blob (three-step
 * presigned upload via @object-ui/providers' ObjectStack adapter), one
 * `sys_attachment` join row linking it to `(parent_object, parent_id)`.
 * Downloads fetch a short-lived signed URL from `/storage/files/:fileId/url`
 * with the console's Bearer token (the endpoint requires an authenticated
 * session for attachments-scope files, objectstack-ai/objectstack#2970), then open it.
 */

interface AttachmentRow {
  id: string;
  file_id: string;
  file_name?: string | null;
  mime_type?: string | null;
  size?: number | null;
  created_at?: string | null;
  uploaded_by?: string | null;
}

export interface RecordAttachmentsPanelProps {
  objectName: string;
  recordId: string;
  /** ObjectUI DataSource (sys_attachment CRUD goes through the generic data path). */
  dataSource: any;
  /** Current user id, stamped on `uploaded_by`. */
  currentUserId?: string | null;
  className?: string;
}

/**
 * What the panel actually KNOWS about this record's `sys_attachment` list
 * (#4684, #4693) — the five-way vocabulary the sibling surfaces settled on.
 *
 *   - `loading`         — the read is in flight (or has not been issued yet).
 *                         The panel knows nothing and asserts nothing.
 *   - `loaded`          — the read ANSWERED. Only in this state is
 *                         `rows.length` a fact about the record, and only
 *                         here may the panel say "No attachments yet".
 *   - `denied`          — refused for AUTHORIZATION reasons (#4269 / PR
 *                         #4685): 403 / `PERMISSION_DENIED` / `FORBIDDEN` /
 *                         an RLS denial. The caller may not look; the
 *                         record's contents are unknown.
 *   - `api-unavailable` — refused because the OBJECT withholds the API
 *                         entirely (#4693): `OBJECT_API_DISABLED` (404,
 *                         `enable.apiEnabled: false`) or
 *                         `OBJECT_API_METHOD_NOT_ALLOWED` (405, the
 *                         operation is absent from `enable.apiMethods`).
 *                         Both are pure functions of the object's metadata —
 *                         no user, no session, no request body — so unlike
 *                         `denied` this is not something any permission
 *                         grant fixes, and unlike `unavailable` below no
 *                         retry changes the answer either.
 *   - `unavailable`     — the read FAILED for any other reason: a network
 *                         failure (server unreachable, DNS, aborted
 *                         request), a 5xx, or a 401 / `AUTH_REQUIRED` (an
 *                         expired session is authentication, not
 *                         authorization, so the `denied` predicate
 *                         deliberately does not claim it). Also unknown, and
 *                         — unlike `api-unavailable` — genuinely retryable.
 *
 * The split that matters is assert-vs-don't-assert. Before #4684 `denied` and
 * `unavailable` both collapsed into `rows = []`, so a panel that never got an
 * answer told the user "No attachments yet. Upload a file to get started." —
 * an affirmative claim about the record's contents, made from no evidence,
 * over a record that may hold thousands. The house rule this restores landed
 * twice already as a bug fix: `HomeActionCenter` (#4235) may only say "You're
 * all caught up" once the inbox has answered, and an unloadable app list
 * (#4300) is UNKNOWN rather than "no default app".
 *
 * `api-unavailable` was split out of `unavailable` because the same
 * assert-vs-don't-assert reasoning applies to the AFFORDANCE, not just the
 * copy: `unavailable` offers a Retry because an outage or an expired session is
 * exactly what a second attempt can fix, but `OBJECT_API_DISABLED` /
 * `OBJECT_API_METHOD_NOT_ALLOWED` are retry-invariant — every retry of every
 * persona re-fetches the identical refusal, so the button was the same wrong
 * advice as "check your connection", just spelled as a control. Classified
 * with `classifyLoadError` (`@object-ui/react`), the same "is this
 * retry-invariant" verdict `ListView`'s error panel already renders for list
 * views — `classifyLoadError` was lifted out of `ListView.tsx`'s module scope
 * for exactly this reuse. `denied` and `unavailable` keep their pre-#4693
 * meaning (`isPermissionError`, unchanged) — `api-unavailable` is the one new
 * fork, checked before that split.
 */
type AttachmentListStatus = 'loading' | 'loaded' | 'denied' | 'api-unavailable' | 'unavailable';

function formatSize(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const RecordAttachmentsPanel: React.FC<RecordAttachmentsPanelProps> = ({
  objectName,
  recordId,
  dataSource,
  currentUserId,
  className,
}) => {
  const { t } = useObjectTranslation();
  const [rows, setRows] = React.useState<AttachmentRow[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * See {@link AttachmentListStatus}. Kept separate from `rows.length === 0`
   * because the two say different things and only one of them is an assertion
   * the panel is entitled to make: "No attachments yet" claims the record
   * HOLDS nothing, while a refused or failed read says only that the panel
   * does not know.
   *
   * Opens at `loading`, not `loaded`: before the effect below has run, the
   * panel has issued no read at all, and a surface that has not read is not
   * entitled to the empty state either (#4684). The guard in `refresh()`
   * leaves it here on purpose — see the comment there.
   */
  const [status, setStatus] = React.useState<AttachmentListStatus>('loading');
  /**
   * objectui#10684 — which `refresh()` call is the CURRENT one. Every call
   * takes the next number, and only the newest may commit `rows` or move
   * `status` off `loading`: when the record changes while a read is in
   * flight, the previous record's answer can otherwise land after the current
   * one and replace its list, or settle first and end `loading` while the
   * current read is still out. Nothing renders from it.
   */
  const refreshSeqRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  /**
   * objectui#12047 — the two write affordances follow the caller's grant on
   * `sys_attachment`, read from the permissions the console already holds
   * (`usePermissions`; no request of its own). Since objectui#12082 they are
   * the `attachmentUpload` / `attachmentDelete` rows of the affordance-to-grant
   * map (`resolveAffordance` in `@object-ui/core`), the one table every console
   * CRUD affordance reads. Both rows carry no CRUD-affordance bit: an upload
   * and a delete go through the storage route, not `sys_attachment`'s generic
   * data door, so that door's operation set says nothing about them.
   *
   * Upload needs `create`. Without it the three-step presigned flow below
   * commits a `sys_file` and only the final `sys_attachment` insert is
   * refused: the user meets the error after the bytes are stored, and the file
   * stays committed with nothing attached to it.
   *
   * Delete needs `delete`, and being the uploader does not change that. The
   * server asks the object grant first (plugin-security's CRUD check wraps the
   * engine's `beforeDelete` hooks), and only a caller who passes it reaches
   * service-storage's uploader-or-parent-editor rule. So `uploaded_by` cannot
   * open a delete the grant withholds, and it cannot close one the grant
   * allows either: the parent-editor half of that rule is not visible here.
   * No row's `uploaded_by` enters this verdict for that reason.
   *
   * No flash while permissions load: the console's `MePermissionsProvider`
   * renders none of its children until it holds an answer, and a refetch keeps
   * answering from the answer it holds, so this panel's first render already
   * has its verdict. A failed load never reaches this panel (the provider
   * shows its error screen instead), and with no provider mounted `can`
   * answers `true`, leaving the server's refusal as the gate.
   *
   * The refusal mapping in `friendlyError` stays as the backstop: a grant can
   * change between render and click, and the parent-record gate judges the
   * record, which this verdict cannot see.
   */
  const perms = usePermissions();
  const canUpload = resolveAffordance('attachmentUpload', { objectName: 'sys_attachment', perms }).allowed;
  const canDelete = resolveAffordance('attachmentDelete', { objectName: 'sys_attachment', perms }).allowed;

  // Same base-URL convention as RecordDetailView's raw API fetches: the
  // Vite dev console proxies same-origin `/api` unless VITE_SERVER_URL
  // points elsewhere.
  const baseUrl = (import.meta as any).env?.VITE_SERVER_URL || '';
  // One authenticated fetch (Bearer token from localStorage) reused for the
  // upload adapter and the download-URL fetch — the storage routes require a
  // session and there is no cookie for `credentials: 'include'` to carry.
  const authFetch = React.useMemo(() => createAuthenticatedFetch(), []);
  const adapter = React.useMemo(
    () => createObjectStackUploadAdapter({ baseUrl, scope: 'attachments', fetchImpl: authFetch }),
    [baseUrl, authFetch],
  );

  /** Map the server's fail-closed 40x codes (objectstack-ai/objectstack#2755, objectstack-ai/objectstack#2970) to friendly copy. */
  const friendlyError = React.useCallback(
    (err: unknown): string => {
      const anyErr = err as { code?: string; message?: unknown } | null;
      const raw = String(anyErr?.message ?? err ?? '');
      const has = (code: string) => anyErr?.code === code || raw.includes(code);
      if (has('ATTACHMENT_DELETE_DENIED')) {
        return t('detail.attachmentDeleteDenied', {
          defaultValue: 'Only the uploader or someone who can edit this record may delete this attachment.',
        });
      }
      if (has('ATTACHMENT_PARENT_ACCESS')) {
        return t('detail.attachmentParentAccessDenied', {
          defaultValue: "You don't have access to attach files to this record.",
        });
      }
      if (has('ATTACHMENT_DOWNLOAD_DENIED')) {
        return t('detail.attachmentDownloadDenied', {
          defaultValue: "You don't have access to download this attachment.",
        });
      }
      if (has('AUTH_REQUIRED')) {
        return t('detail.attachmentAuthRequired', {
          defaultValue: 'Please sign in to download this attachment.',
        });
      }
      if (has('PERMISSION_DENIED')) {
        return t('detail.attachmentPermissionDenied', {
          defaultValue: "You don't have permission to do that.",
        });
      }
      return raw;
    },
    [t],
  );

  const refresh = React.useCallback(async () => {
    // No data source / no record yet: no read is ISSUED, so `status` stays at
    // whatever it was — `loading` on first mount. Deliberately not forced to
    // `loaded` (that would assert an empty record from zero evidence) and not
    // to `unavailable` (nothing failed; there is no error to report and a
    // Retry would have nothing to retry). Every dep here is in the callback's
    // dependency list, so if one of them arrives later this effect re-runs on
    // its own and the read happens then.
    //
    // The run number is taken BEFORE that return: a call that issues no read
    // still supersedes one in flight for inputs that no longer apply.
    const seq = ++refreshSeqRef.current;
    const isCurrent = () => refreshSeqRef.current === seq;
    if (!dataSource || !objectName || !recordId) return;
    setStatus('loading');
    try {
      const res: any = await dataSource.find('sys_attachment', {
        $filter: { parent_object: objectName, parent_id: recordId },
        $orderby: { created_at: 'desc' },
        $top: 100,
      });
      const items: AttachmentRow[] = Array.isArray(res) ? res : res?.data ?? [];
      // objectui#10684 — a superseded answer is dropped on arrival.
      if (!isCurrent()) return;
      setRows(items);
      // The read ANSWERED — only now is `rows.length === 0` a fact about the
      // record rather than an absence of information, and only now may the
      // empty state below speak.
      setStatus('loaded');
    } catch (err) {
      // objectui#10684 — and so is a superseded failure: it describes a read
      // for inputs that no longer apply, so it may not end `loading` either.
      if (!isCurrent()) return;
      setRows([]);
      // The read did NOT answer. Which of the three unknown states applies
      // turns on two questions, checked in order — is the object's API
      // withheld entirely, and if not, is this caller forbidden?
      //
      // `api-unavailable` (#4693) is checked FIRST, on the CODE alone (via
      // `classifyLoadError`, shared with `ListView`'s error panel):
      // `OBJECT_API_DISABLED` (404) / `OBJECT_API_METHOD_NOT_ALLOWED` (405).
      // Both are pure functions of the object's `enable` block — no user, no
      // session — so no persona and no retry changes the answer, and it must
      // run before the `denied` check below: a 404/405 carries no status this
      // predicate would confuse with a real permission refusal, but checking
      // order still matters for future codes that could overlap.
      //
      // `denied` (#4269 / PR #4685) uses the same house predicate the
      // kanban/calendar/form surfaces branch on: HTTP 403,
      // `PERMISSION_DENIED`/`FORBIDDEN`, or an RLS denial. It deliberately
      // does NOT claim a 401 — an expired session is authentication, not
      // authorization, and "you don't have access" is the wrong sentence for a
      // user who only needs to sign in again.
      //
      // `unavailable` (#4684) takes everything else that reaches this catch:
      // a network failure, a 5xx, a 401/`AUTH_REQUIRED`. Note what does NOT
      // arrive here — the ObjectStack adapter's `find()` degrades a bare 404
      // (collection absent on an older stack) to `{ data: [], total: 0 }`
      // (data-objectstack `is404Error`, objectui#4408), so the "table not yet
      // provisioned" case still resolves through the success path above and
      // still renders the empty state. It never depended on this catch
      // swallowing it.
      //
      // Nothing from the error is rendered in any of the three states — each
      // shows its i18n sentence and nothing else. objectui#2532's failure mode
      // (raw dump / status code / leaked row count) must stay absent, and
      // `setError` is deliberately NOT called here: a failed LIST is a state
      // of the panel, not an error banner about an action the user took.
      setStatus(
        classifyLoadError(err) === 'api-disabled'
          ? 'api-unavailable'
          : isPermissionError(err)
            ? 'denied'
            : 'unavailable',
      );
    }
  }, [dataSource, objectName, recordId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !dataSource) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          // 1) blob → sys_file via the canonical presigned three-step flow
          const uploaded = await adapter.upload(file);
          const fileId = (uploaded.meta as any)?.fileId as string | undefined;
          if (!fileId) throw new Error('Upload did not return a fileId');
          // 2) join row → sys_attachment (server enforces enable.files)
          await dataSource.create('sys_attachment', {
            parent_object: objectName,
            parent_id: recordId,
            file_id: fileId,
            file_name: uploaded.name ?? file.name,
            mime_type: uploaded.mimeType ?? file.type,
            size: uploaded.size ?? file.size,
            // Back-compat with pre-objectstack-ai/objectstack#2755 servers; a current server stamps
            // `uploaded_by` from the session and ignores this value.
            ...(currentUserId ? { uploaded_by: currentUserId } : {}),
          });
        }
        await refresh();
      } catch (err: any) {
        setError(friendlyError(err));
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [adapter, dataSource, objectName, recordId, currentUserId, refresh],
  );

  /**
   * objectui#12248 — a delete asks first, through the console's ordinary
   * destructive-action confirm: the same `ActionConfirmDialog` the record
   * page's own Delete opens (objectui#11001), mounted here with the same
   * promise-based state, and painted destructive the same way. Before this the
   * row's button deleted at once (`DELETE sys_attachment/…` answered 200 with
   * no question asked). A cancel settles `false` and nothing is sent.
   */
  const [confirmState, setConfirmState] = React.useState<ConfirmDialogState>({ open: false, message: '' });
  const confirmDelete = React.useCallback<ConfirmationHandler>(
    (message, options) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ open: true, message, options, resolve });
      }),
    [],
  );

  const handleDelete = React.useCallback(
    async (row: AttachmentRow) => {
      if (!dataSource) return;
      const confirmed = await confirmDelete(
        t('detail.deleteAttachmentConfirm', {
          defaultValue: 'Are you sure you want to delete the attachment "{{name}}"?',
          name: row.file_name || row.file_id,
        }),
        {
          title: t('detail.deleteAttachment', { defaultValue: 'Delete attachment' }),
          confirmText: t('objectActions.deleteConfirmButton', { defaultValue: 'Delete' }),
          destructive: true,
        },
      );
      if (!confirmed) return;
      setError(null);
      try {
        await dataSource.delete('sys_attachment', row.id);
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } catch (err: any) {
        // With the `delete` grant, the button renders for every row: the
        // server's record gate (uploader-or-parent-editor,
        // objectstack-ai/objectstack#2755) is not something the client can
        // pre-compute, so a denial surfaces here as friendly copy instead
        // (objectui#12047 removed the button only where the grant is absent).
        setError(friendlyError(err));
      }
    },
    [dataSource, friendlyError, confirmDelete, t],
  );

  const handleDownload = React.useCallback(
    async (row: AttachmentRow) => {
      setError(null);
      try {
        // The stable `/files/:fileId` endpoint now requires an authenticated
        // session for attachments-scope files (objectstack-ai/objectstack#2970) — an <a href> can't
        // carry the Bearer token. Fetch a short-lived signed URL with auth,
        // then open it (the signed URL itself needs no credentials).
        const res = await authFetch(
          `${baseUrl}/api/v1/storage/files/${encodeURIComponent(row.file_id)}/url`,
        );
        if (!res.ok) {
          let code: string | undefined;
          try {
            // Read BOTH error dialects, the same way the success branch below
            // reads both `url` shapes. The storage service moved its error
            // code from a sibling of `error` into the declared
            // `{ success: false, error: { code, message } }` envelope
            // (objectstack#3675); a console build is deployed independently of
            // the server it talks to, so it has to keep understanding the
            // older top-level `code` too. Without the nested branch the 401/403
            // downgrade silently to "Download failed (403)" and the friendly
            // copy below never fires.
            const body = (await res.json()) as { code?: string; error?: { code?: string } } | null;
            code = body?.error?.code ?? body?.code;
          } catch {
            /* non-JSON body */
          }
          throw Object.assign(new Error(code ?? `Download failed (${res.status})`), { code });
        }
        const body = await res.json();
        // Both URL dialects, for the same independent-deploy reason as the
        // error branch above: the route answered a bare `{ url }` until
        // objectstack#3689 moved it into the declared
        // `{ success: true, data: { url } }` envelope.
        const url: string | undefined = body?.url ?? body?.data?.url;
        if (!url) throw new Error('Download URL missing from response');
        const target = /^https?:/i.test(url) ? url : `${baseUrl}${url}`;
        window.open(target, '_blank', 'noopener,noreferrer');
      } catch (err: any) {
        setError(friendlyError(err));
      }
    },
    [authFetch, baseUrl, friendlyError],
  );

  return (
    <div className={cn('rounded-lg border bg-card', className)} data-testid="record-attachments-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span>{t('detail.attachments', { defaultValue: 'Attachments' })}</span>
          {rows.length > 0 && (
            <span className="text-xs text-muted-foreground">({rows.length})</span>
          )}
        </div>
        {/*
          No Upload affordance under a denied list (#4269). The button was
          previously unconditional — its only gate was `uploading` — so a
          member the server had just refused was still invited to upload into
          a record whose parent it cannot read, a click the `beforeInsert`
          gate answers with 403 ATTACHMENT_PARENT_ACCESS.

          `unavailable` withdraws it for the same reason one status over
          (#4684): offering an upload against a list the panel could not even
          reach is the same over-assertion as the empty state it replaces —
          the panel is claiming an attach will work when it has no evidence
          the server is reachable at all, and the upload's own three-step
          presigned flow would fail on the same outage. Retry first; the
          Upload returns with the answer.

          `api-unavailable` withdraws it too (#4693), for a stronger reason
          than either: the object's `enable` block refuses this operation for
          every caller, so an upload attempt here is not merely unverified —
          it is guaranteed to fail the same way the list read just did.

          Shown while `loading` and while `loaded` — and only to a caller
          holding the `create` grant on `sys_attachment` (objectui#12047; see
          `canUpload` above).
        */}
        {canUpload && status !== 'denied' && status !== 'api-unavailable' && status !== 'unavailable' && (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              {t('detail.uploadAttachment', { defaultValue: 'Upload' })}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-destructive border-b" role="alert">
          {error}
        </div>
      )}

      {/*
        The order of this chain IS the assertion discipline (#4235, #4300,
        #4269, #4684): every state that means "the panel does not know" is
        answered before `rows.length === 0` is allowed to mean "the record
        holds nothing". `rows` is emptied on every failure, so any unknown
        state reaching the empty branch would render the exact lie these
        cards exist to remove.

        `status === 'loading' && rows.length === 0` (not `status === 'loading'`
        alone) is unchanged from the pre-#4684 shape: a refresh over an
        already-populated list keeps showing that list instead of blanking it
        to a spinner.
      */}
      {status === 'loading' && rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('detail.loadingAttachments', { defaultValue: 'Loading attachments…' })}
        </div>
      ) : status === 'denied' ? (
        // Checked BEFORE the empty state, and rendering only the i18n
        // sentence: no status code, no server message, no row (#2532).
        <div
          className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2"
          data-testid="record-attachments-denied"
        >
          <Lock className="h-4 w-4 shrink-0" />
          {t('detail.attachmentsAccessDenied', {
            defaultValue: "You don't have access to these attachments.",
          })}
        </div>
      ) : status === 'api-unavailable' ? (
        // `OBJECT_API_DISABLED` / `OBJECT_API_METHOD_NOT_ALLOWED` (#4693): a
        // pure function of the object's `enable` block, not a permission and
        // not an outage — no persona and no retry changes the answer. Like
        // the other two failure states this renders ONLY the i18n sentence
        // (#2532), and — unlike `unavailable` below — deliberately offers NO
        // Retry: the button would re-fetch the identical refusal every time.
        <div
          className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2"
          data-testid="record-attachments-api-unavailable"
        >
          <Ban className="h-4 w-4 shrink-0" />
          {t('detail.attachmentsApiUnavailable', {
            defaultValue: 'The attachments list is not available on this object.',
          })}
        </div>
      ) : status === 'unavailable' ? (
        // The read never answered (#4684): network failure, 5xx, or an expired
        // session. Like the denied state above this renders ONLY the i18n
        // sentence — no status code, no server message, no row count (#2532) —
        // and, unlike it, offers a Retry: an outage and a lapsed session are
        // both things a second attempt can genuinely fix.
        //
        // The Retry cannot double-fetch. `refresh()` sets `status` to
        // `loading` synchronously and `rows` is already empty here, so the
        // branch above wins on the very next render and this button — with the
        // only handler that calls `refresh()` — unmounts for the duration of
        // the read.
        <div
          className="px-4 py-6 text-sm text-muted-foreground flex flex-col items-start gap-3"
          data-testid="record-attachments-unavailable"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('detail.attachmentsLoadFailed', {
              defaultValue: "We couldn't load the attachments for this record.",
            })}
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            {t('detail.retryLoadAttachments', { defaultValue: 'Retry' })}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        // Reached only with `status === 'loaded'`: every other status is
        // answered above. This is the one branch entitled to assert that the
        // record holds nothing, because it is the only one standing on a read
        // that came back — a genuine 200-with-zero-rows.
        <div className="px-4 py-6 text-sm text-muted-foreground">
          {t('detail.noAttachments', { defaultValue: 'No attachments yet. Upload a file to get started.' })}
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{row.file_name || row.file_id}</div>
                <div className="text-xs text-muted-foreground">
                  {[formatSize(row.size), row.mime_type || undefined]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              {/* objectui#12248: `data-fab-yield` on both row actions. They
                  sit at the panel's right edge, and when the panel is the
                  page's last content the last row lands in the bottom-right
                  corner at full scroll — under the console assistant's
                  button, which no further scroll can move it out from. The
                  marker makes that button step aside while they overlap. */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={t('detail.downloadAttachment', { defaultValue: 'Download' })}
                onClick={() => void handleDownload(row)}
                data-fab-yield=""
              >
                <Download className="h-4 w-4" />
              </Button>
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={t('detail.deleteAttachment', { defaultValue: 'Delete attachment' })}
                  onClick={() => void handleDelete(row)}
                  data-fab-yield=""
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ActionConfirmDialog
        state={confirmState}
        onOpenChange={(open) => {
          if (!open) setConfirmState((s) => ({ ...s, open: false }));
        }}
      />
    </div>
  );
};

export default RecordAttachmentsPanel;

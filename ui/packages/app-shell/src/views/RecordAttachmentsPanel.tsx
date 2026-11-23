/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  cn,
  Button,
  RelatedCountStore,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@object-ui/components';
import {
  Paperclip,
  Plus,
  Trash2,
  Download,
  Loader2,
  Lock,
  AlertTriangle,
  Ban,
  RefreshCw,
  MoreVertical,
  Pencil,
  File as FileIcon,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileArchive,
} from 'lucide-react';
import { createObjectStackUploadAdapter } from '@object-ui/data-objectstack';
import { createAuthenticatedFetch, useAuth } from '@object-ui/auth';
import { useDisplayLocale } from '@object-ui/i18n';
import { useObjectTranslation, isPermissionError, classifyLoadError } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { FilePreviewDialog, type FilePreviewItem } from '@object-ui/fields';
import { resolveAffordance, type ConfirmationHandler } from '@object-ui/core';
import {
  NATIVE_FILE_MAX_BYTES,
  getNativeHost,
  nativeFileFromBlob,
  nativeHostCan,
  nativeOpenFile,
  type NativeFile,
} from '@object-ui/mobile';
import { ActionConfirmDialog, type ConfirmDialogState } from './ActionConfirmDialog.js';
import { RECORD_PAGE_ATTACHMENT_ROWS, recordAttachmentsCountField } from './recordPagePayload.js';

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
 * presigned upload via @object-ui/data-objectstack's ObjectStack adapter), one
 * `sys_attachment` join row linking it to `(parent_object, parent_id)`. The
 * join row is written by the upload's own completion (`attachTo`), as the
 * signed-in user: the server's attach verb, never a `sys_attachment` create
 * through the generic data door, which a member who may attach files but not
 * read `sys_file` is refused (`reference_not_found` on `file_id`).
 * Downloads fetch a short-lived signed URL from `/storage/files/:fileId/url`
 * with the console's Bearer token (the endpoint requires an authenticated
 * session for attachments-scope files, objectstack-ai/objectstack#2970), then open it.
 * A row's NAME opens the file in the page (`FilePreviewDialog`, objectstack#36442),
 * which mints its link through that same door, so a reader the download refuses
 * is refused the same way; the download itself stays in the row's ⋮ menu.
 *
 * The list read expands `uploaded_by` (the record page payload's attachments
 * part does the same), so the uploader column names whoever uploaded a row
 * when the reader may read that user; a reader who may not gets the bare id
 * back and the column stays blank, never showing the id. A row's Rename sends
 * the new name to the attachment rename door, `PATCH /api/v1/attachments/:id`
 * (service-storage), which renames by the attachment delete rule.
 */

interface AttachmentRow {
  id: string;
  file_id: string;
  file_name?: string | null;
  mime_type?: string | null;
  size?: number | null;
  created_at?: string | null;
  /** The uploader's user id, or the user row where a read expanded it. */
  uploaded_by?: string | { id?: string; name?: string | null } | null;
}

export interface RecordAttachmentsPanelProps {
  objectName: string;
  recordId: string;
  /** ObjectUI DataSource (the list read and the delete go through the generic data path; the attach does not). */
  dataSource: any;
  /**
   * Current user id. The server stamps `uploaded_by` from the session; the panel no longer sends it.
   * It names the caller's own rows for Rename when no auth provider supplies the user.
   */
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

/** A file row's type mark, by its MIME type. */
function fileTypeIcon(mime?: string | null): React.ElementType {
  const type = (mime ?? '').toLowerCase();
  if (type.startsWith('image/')) return FileImage;
  if (type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') return FileSpreadsheet;
  if (type.includes('zip') || type.includes('compressed') || type.includes('tar')) return FileArchive;
  if (type.startsWith('text/') || type === 'application/pdf' || type.includes('word') || type.includes('document')) return FileText;
  return FileIcon;
}

/** Whether a drag carries files (a dragged text selection or link does not). */
function dragHasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Inside the ObjectStack mobile shell, when it announces `openFile`: fetch the
 * attachment's bytes from the signed URL this panel already fetched with the
 * Console's own session, and hand the BYTES to the shell, which previews or
 * opens them with the OS (objectstack-ai/mobile `docs/HYBRID-SHELL.md`,
 * "Files"; the shell never downloads a URL or reads the session). Answers
 * whether the shell took the file.
 *
 * `false` keeps the browser path (`window.open` on the signed URL), exactly as
 * outside the shell: no shell or an older one, a file over the bridge's
 * `NATIVE_FILE_MAX_BYTES` (judged on the row's size before any byte is
 * fetched, and on the fetched size), a fetch that fails (a cross-origin
 * storage URL without CORS), and the shell refusing (`bad_args`) or failing
 * the call. ⛔ The signed URL is a credential: only bytes cross the
 * bridge, never the URL.
 */
async function openInNativeShell(target: string, row: AttachmentRow): Promise<boolean> {
  if (!nativeHostCan(getNativeHost(), 'openFile')) return false;
  if (typeof row.size === 'number' && row.size > NATIVE_FILE_MAX_BYTES) return false;
  let file: NativeFile;
  try {
    const res = await fetch(target);
    if (!res.ok) return false;
    let blob = await res.blob();
    if (blob.size > NATIVE_FILE_MAX_BYTES) return false;
    if (!blob.type && row.mime_type) blob = new Blob([blob], { type: row.mime_type });
    file = await nativeFileFromBlob(blob, row.file_name || row.file_id);
  } catch {
    return false;
  }
  // Anything but `ok` (the shell refusing the file with `bad_args`, or failing
  // it) takes the browser path, so a tap is never answered worse than before.
  return (await nativeOpenFile(file)).status === 'ok';
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
  const [dragOver, setDragOver] = React.useState(false);
  const { user } = useAuth();
  const displayLocale = useDisplayLocale();

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
   * Upload needs `create`. Without it the attach at the end of the upload
   * below is refused after the bytes are stored (the server leaves the file
   * pending, and its retention reclaims it); hiding Upload spares the user
   * that round trip.
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
  /**
   * Rename follows the rename door's two limbs, behind the delete grant. The
   * door renames the caller's OWN upload with no edit grant (written on their
   * behalf, as the removal door removes), and writes anyone else's rename
   * through the engine as the caller, which needs the edit grant on
   * `sys_attachment`. So a row offers Rename to a reader who may delete and
   * either uploaded it or holds the edit grant; offering it elsewhere would
   * offer a door the server refuses. The edit-grant half is the map's
   * `attachmentRename` row; with no provider mounted it reads open, and the
   * server remains the gate.
   */
  const canEditAttachments = resolveAffordance('attachmentRename', { objectName: 'sys_attachment', perms }).allowed;
  const callerId = user?.id ?? currentUserId ?? null;
  const canRename = (row: AttachmentRow): boolean => {
    if (!canDelete) return false;
    if (canEditAttachments) return true;
    const by = row.uploaded_by;
    const uploaderId = by && typeof by === 'object' ? by.id : by;
    return !!callerId && uploaderId === callerId;
  };

  // Same base-URL convention as RecordDetailView's raw API fetches: the
  // Vite dev console proxies same-origin `/api` unless VITE_SERVER_URL
  // points elsewhere.
  const baseUrl = (import.meta as any).env?.VITE_SERVER_URL || '';
  // One authenticated fetch (Bearer token from localStorage) reused for the
  // upload adapter and the download-URL fetch — the storage routes require a
  // session and there is no cookie for `credentials: 'include'` to carry.
  const authFetch = React.useMemo(() => createAuthenticatedFetch(), []);
  // Every upload from this panel is attached to this record by the call that
  // completes it (`attachTo`): the server's attach verb, run as the user.
  const adapter = React.useMemo(
    () =>
      createObjectStackUploadAdapter({
        baseUrl,
        scope: 'attachments',
        fetchImpl: authFetch,
        ...(objectName && recordId ? { attachTo: { parentObject: objectName, parentId: recordId } } : {}),
      }),
    [baseUrl, authFetch, objectName, recordId],
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
      // objectstack#28470 — the record page payload carries this read's
      // answer on the record's open (`seedRecordPageReaders`, under the key
      // the Attachments tab badge counts): the first read takes it, once, and
      // every later one (an upload, a delete, Retry) is the panel's own.
      const seeded = RelatedCountStore.takeRows(
        'sys_attachment',
        recordAttachmentsCountField(objectName),
        recordId,
        undefined,
        RECORD_PAGE_ATTACHMENT_ROWS,
      );
      const res: any = seeded
        ? { data: (await seeded).rows }
        : await dataSource.find('sys_attachment', {
            $filter: { parent_object: objectName, parent_id: recordId },
            $orderby: { created_at: 'desc' },
            $top: RECORD_PAGE_ATTACHMENT_ROWS,
            $expand: ['uploaded_by'],
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
      if (!files || files.length === 0 || !dataSource || !objectName || !recordId) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          // blob → sys_file → sys_attachment: the presigned three-step flow,
          // whose completion attaches the file to this record as the user
          // (the server checks the create grant, edit access to the record,
          // `enable.files`, and that the file is the user's own upload).
          const uploaded = await adapter.upload(file);
          const attachmentId = (uploaded.meta as any)?.attachmentId as string | undefined;
          if (!attachmentId) throw new Error('The server completed the upload but did not attach it to this record');
        }
        await refresh();
      } catch (err: any) {
        setError(friendlyError(err));
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [adapter, dataSource, objectName, recordId, refresh],
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

  /**
   * Rename: offered beside Delete, to a reader who may delete and either
   * uploaded the row or holds the edit grant (`canRename`), because the server
   * renames by the attachment delete rule — the uploader, or an editor of the
   * record — and writes an editor's rename as the caller. The dialog closes on a stored name and
   * stays open on a refusal, which the panel's error line names.
   */
  const [renaming, setRenaming] = React.useState<AttachmentRow | null>(null);
  const handleRename = React.useCallback(
    async (row: AttachmentRow, fileName: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await authFetch(`${baseUrl}/api/v1/attachments/${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_name: fileName }),
        });
        let body: { data?: { file_name?: string }; error?: { code?: string; message?: string } } | null = null;
        try {
          body = await res.json();
        } catch {
          /* non-JSON body */
        }
        if (!res.ok) {
          const code = body?.error?.code;
          throw Object.assign(new Error(body?.error?.message ?? `Rename failed (${res.status})`), { code });
        }
        const stored = body?.data?.file_name;
        if (typeof stored !== 'string') throw new Error('The server renamed the attachment but did not answer its stored name');
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, file_name: stored } : r)));
        return true;
      } catch (err: any) {
        setError(
          err?.code === 'RECORD_NOT_ACCESSIBLE'
            ? t('detail.attachmentRenameDenied', {
                defaultValue: 'Only the uploader or someone who can edit this record may rename this attachment.',
              })
            : friendlyError(err),
        );
        return false;
      }
    },
    [authFetch, baseUrl, friendlyError, t],
  );

  /**
   * The signed link for a row: the one door both the download and the preview
   * read through. Throws the server's code on a refusal.
   */
  const signedUrlFor = React.useCallback(
    async (row: AttachmentRow): Promise<string> => {
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
      return /^https?:/i.test(url) ? url : `${baseUrl}${url}`;
    },
    [authFetch, baseUrl],
  );

  const handleDownload = React.useCallback(
    async (row: AttachmentRow) => {
      setError(null);
      try {
        const target = await signedUrlFor(row);
        if (await openInNativeShell(target, row)) return;
        window.open(target, '_blank', 'noopener,noreferrer');
      } catch (err: any) {
        setError(friendlyError(err));
      }
    },
    [signedUrlFor, friendlyError],
  );

  // The in-page preview (objectstack#36442): the row whose name was clicked,
  // and the rows as the dialog's set, so previous / next walk the list.
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);
  const previewFiles: FilePreviewItem[] = rows.map((row) => ({
    id: row.file_id,
    name: row.file_name || row.file_id,
    mimeType: row.mime_type ?? undefined,
    size: row.size ?? undefined,
  }));
  const previewSignedUrl = React.useCallback(
    async (file: FilePreviewItem): Promise<string> => {
      const row = rows.find((r) => r.file_id === file.id);
      if (!row) throw new Error(t('fields.filePreview.loadFailed', { defaultValue: 'The preview could not be loaded.' }));
      try {
        return await signedUrlFor(row);
      } catch (err) {
        // The download's own copy for the download's own refusal.
        throw Object.assign(new Error(friendlyError(err)), { cause: err });
      }
    },
    [rows, signedUrlFor, friendlyError, t],
  );

  // Upload is offered (the header's 「+ 上传」, the empty line's 「选择文件」 and
  // a drop anywhere on the panel) only to a caller holding the `create` grant
  // and only on a list that answered or is still loading — see the comment on
  // the header's button below.
  const uploadOffered =
    canUpload && status !== 'denied' && status !== 'api-unavailable' && status !== 'unavailable';
  const pickFiles = () => inputRef.current?.click();
  // Who uploaded a row: the name where the read expanded the user, the viewer's
  // own name for the viewer's own upload, and nothing otherwise.
  const uploaderOf = (row: AttachmentRow): string => {
    const by = row.uploaded_by;
    if (by && typeof by === 'object') return by.name ?? '';
    return by && user?.id === by ? user?.name ?? '' : '';
  };
  const whenOf = (row: AttachmentRow): string => {
    const date = row.created_at ? new Date(row.created_at) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(displayLocale, {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}),
    });
  };
  // A drop anywhere on the panel uploads, like 「+ 上传」.
  const dropHandlers = uploadOffered
    ? {
        onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        },
        onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        },
        onDrop: (e: React.DragEvent<HTMLDivElement>) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setDragOver(false);
          if (!uploading) void handleFiles(e.dataTransfer.files);
        },
      }
    : {};

  return (
    <div
      className={cn(
        '@container rounded-md transition-colors',
        dragOver && 'bg-primary/5 ring-2 ring-primary/40',
        className,
      )}
      data-testid="record-attachments-panel"
      data-attachments-drop={uploadOffered ? '' : undefined}
      {...dropHandlers}
    >
      <div className="flex h-9 items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span>{t('detail.attachments', { defaultValue: 'Attachments' })}</span>
          {rows.length > 0 && (
            <span className="text-xs text-muted-foreground">({rows.length})</span>
          )}
        </div>
        {uploadOffered && (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-11 sm:h-7 px-2 text-xs"
              disabled={uploading}
              onClick={pickFiles}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5 mr-1" />
              )}
              {t('detail.uploadAttachment', { defaultValue: 'Upload' })}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="py-1.5 text-xs text-destructive" role="alert">
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
        <div className="py-2 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('detail.loadingAttachments', { defaultValue: 'Loading attachments…' })}
        </div>
      ) : status === 'denied' ? (
        // Checked BEFORE the empty state, and rendering only the i18n
        // sentence: no status code, no server message, no row (#2532).
        <div
          className="py-2 text-sm text-muted-foreground flex items-center gap-2"
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
          className="py-2 text-sm text-muted-foreground flex items-center gap-2"
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
          className="py-2 text-sm text-muted-foreground flex flex-col items-start gap-2"
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
        // An upload-capable reader gets one dashed line to drop on or pick
        // from, never a large card; a reader who cannot upload, the sentence.
        <div
          className="flex min-h-10 flex-wrap items-center justify-center gap-x-1 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
          data-attachments-empty=""
        >
          {uploadOffered ? (
            <>
              <span>{t('detail.attachmentsDropHint', { defaultValue: 'Drop files here, or' })}</span>
              <button
                type="button"
                className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                onClick={pickFiles}
                disabled={uploading}
              >
                {t('detail.attachmentsChooseFile', { defaultValue: 'choose a file' })}
              </button>
            </>
          ) : (
            t('detail.noAttachments', { defaultValue: 'No attachments yet. Upload a file to get started.' })
          )}
        </div>
      ) : (
        <ul className="divide-y border-t">
          {rows.map((row, index) => {
            const TypeIcon = fileTypeIcon(row.mime_type);
            const name = row.file_name || row.file_id;
            const uploader = uploaderOf(row);
            return (
              // One 33 px row: type mark, name, size, uploader, date, ⋮. Size
              // and uploader step aside in a narrow container (a drawer).
              <li key={row.id} className="flex h-[33px] items-center gap-2 px-1 text-sm" data-attachment-row="">
                <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline focus-visible:underline focus-visible:outline-none"
                  title={name}
                  onClick={() => setPreviewIndex(index)}
                  data-attachment-preview=""
                >
                  {name}
                </button>
                <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums @md:inline">
                  {formatSize(row.size)}
                </span>
                <span className="hidden max-w-[8rem] shrink-0 truncate text-xs text-muted-foreground @lg:inline" title={uploader || undefined}>
                  {uploader}
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">{whenOf(row)}</span>
                {/* objectui#12248: `data-fab-yield` on the row's actions. It
                    sits at the panel's right edge, and when the panel is the
                    page's last content the last row lands in the bottom-right
                    corner at full scroll — under the console assistant's
                    button, which no further scroll can move it out from. The
                    marker makes that button step aside while they overlap. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 sm:h-7 sm:w-7 shrink-0 text-muted-foreground"
                      aria-label={t('detail.attachmentActions', { defaultValue: 'More for {{name}}', name })}
                      data-fab-yield=""
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void handleDownload(row)}>
                      <Download className="mr-2 h-4 w-4" />
                      {t('detail.downloadAttachment', { defaultValue: 'Download' })}
                    </DropdownMenuItem>
                    {canRename(row) && (
                      <DropdownMenuItem
                        onSelect={() => {
                          setError(null);
                          setRenaming(row);
                        }}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        {t('detail.renameAttachment', { defaultValue: 'Rename' })}
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => void handleDelete(row)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('detail.deleteAttachment', { defaultValue: 'Delete attachment' })}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
      <ActionConfirmDialog
        state={confirmState}
        onOpenChange={(open) => {
          if (!open) setConfirmState((s) => ({ ...s, open: false }));
        }}
      />
      {previewIndex !== null && previewIndex < rows.length && (
        <FilePreviewDialog
          files={previewFiles}
          index={previewIndex}
          open
          onOpenChange={(open) => !open && setPreviewIndex(null)}
          onIndexChange={setPreviewIndex}
          resolveUrl={previewSignedUrl}
          onDownload={(_file, index) => {
            const row = rows[index];
            if (row) void handleDownload(row);
          }}
        />
      )}
      <AttachmentRenameDialog
        row={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onSubmit={(name) => (renaming ? handleRename(renaming, name) : Promise.resolve(false))}
        error={error}
        t={t}
      />
    </div>
  );
};

/**
 * The name prompt of a row's Rename. It writes nothing: it hands the trimmed
 * name to `onSubmit` and closes only when that resolves `true`. An empty name,
 * or the name the row already has, cannot be submitted.
 */
function AttachmentRenameDialog({
  row,
  onOpenChange,
  onSubmit,
  error,
  t,
}: {
  row: AttachmentRow | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<boolean>;
  error: string | null;
  t: ReturnType<typeof useObjectTranslation>['t'];
}) {
  const inputId = React.useId();
  const current = row ? row.file_name || row.file_id : '';
  const [name, setName] = React.useState(current);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);

  // Each opening starts from the row's current name.
  React.useEffect(() => {
    if (row) setName(current);
  }, [row, current]);

  const trimmed = name.trim();
  const submittable = trimmed !== '' && trimmed !== current && !submitting;
  const submit = async () => {
    if (!submittable || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (await onSubmit(trimmed)) onOpenChange(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="attachment-rename-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('detail.renameAttachmentTitle', { defaultValue: 'Rename attachment' })}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-2 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor={inputId}>{t('detail.attachmentNameLabel', { defaultValue: 'File name' })}</Label>
          <Input
            id={inputId}
            autoFocus
            value={name}
            maxLength={255}
            onChange={(e) => setName(e.target.value)}
            data-testid="attachment-rename-input"
          />
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" disabled={!submittable} onClick={() => void submit()} data-testid="attachment-rename-submit">
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RecordAttachmentsPanel;

import React, { useRef, useState, useCallback } from 'react';
import { Button, EmptyValue } from '@object-ui/components';
import { useUpload } from '@object-ui/providers';
import { useObjectTranslation } from '@object-ui/i18n';
import { Upload, X, File as FileIcon, ImageIcon, Camera, Loader2, Lock } from 'lucide-react';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';
import { useUploadingSignal } from './useUploadingSignal.js';
import { useUploadingScopeHold } from './uploadingScope.js';
import { maxSizeError, type TranslateFn } from './file-size-guard.js';
import { uploadErrorMessage } from './upload-error-message.js';
import {
  fileValueForSubmit,
  readFileValues,
  uploadResultView,
  withRecentUploads,
  isImageValue,
  type FileValueView,
} from './file-value.js';
import { fileValueForResubmit } from './file-refused.js';
// The one view/download affordance every `file` surface renders
// (objectui#9161) — shared with `FileCellRenderer` rather than copied.
import { FileValueAffordance, useRestrictedFileText } from './file-affordance.js';

/**
 * Shared upload pipeline for the file widgets: validates size, uploads through
 * the configured UploadProvider adapter (with progress), and merges results
 * into the field value — append for `multiple`, replace otherwise. Extracted so
 * the full-size FileField and the compact grid-cell {@link FileCell} stay
 * behaviourally identical (same value shape, same error handling).
 *
 * Stores the **reference form** — the bare `sys_file` id the upload adapter
 * surfaced — and nothing else: an upload that surfaced no id is refused per
 * pick through `fileValueForSubmit` and reported in the error row, so ⛔ no
 * inline blob ever reaches `onChange` (objectui#7699; see `file-value`'s
 * "Submitting"). Because a bare id carries no name or URL, each completed
 * upload's display details are kept in `recent`, keyed by id, so the file
 * renders immediately instead of as a bare token until a read enriches it.
 */
function useFileUploads(opts: {
  files: any[];
  multiple: boolean;
  maxSize?: number;
  onChange: (value: any) => void;
  /**
   * Holds the enclosing uploading scope for the upload's own lifetime, which
   * can outlast this widget (objectui#10180) — see `useUploadingScopeHold`.
   * Passed by `FileField` only: `FileCell` reports into no scope today, and
   * whether a line-item cell should is not this pipeline's call to make.
   */
  holdScope?: () => () => void;
}) {
  const { files, multiple, maxSize, onChange, holdScope } = opts;
  const { upload } = useUpload();
  const { t } = useObjectTranslation();
  const [errors, setErrors] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [recent, setRecent] = useState<Record<string, FileValueView>>({});

  const processFiles = useCallback(async (selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return;
    const newErrors: string[] = [];

    // Shared with ImageField — see `file-size-guard`.
    const validFiles = selectedFiles.filter(file => {
      const rejection = maxSizeError(t as TranslateFn, file, maxSize);
      if (rejection) {
        newErrors.push(rejection);
        return false;
      }
      return true;
    });
    setErrors(newErrors);

    if (validFiles.length === 0) return;

    // Taken BEFORE the widget's own `uploading` flips and released only in the
    // `finally` below — after `onChange` has handed the value over — so the
    // scope never reads "done" while the value is still on its way, even when
    // this widget has been unmounted in between (a wizard step left mid-upload,
    // objectui#10180). `setUploading` is a no-op once unmounted; this is not.
    const releaseScope = holdScope?.();
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        validFiles.map(async (file) => {
          try {
            const result = await upload(file, {
              onProgress: (ratio) =>
                setUploadProgress((prev) => ({ ...prev, [file.name]: ratio })),
            });
            // Throws when the adapter surfaced no `sys_file` id, so the
            // refusal is reported per pick like a transport failure and the
            // pick is not added (objectui#7699).
            const value = fileValueForSubmit(result, file.name);
            return { result, originalName: file.name, value };
          } catch (err) {
            newErrors.push(uploadErrorMessage(t as TranslateFn, file.name, err));
            setErrors([...newErrors]);
            return null;
          }
        }),
      );
      const successful = uploaded.filter(Boolean) as Array<{
        result: any;
        originalName: string;
        value: string;
      }>;
      if (successful.length === 0) return;

      // Remember what each new id looks like so it can render before the next
      // read expands it back into `{ id, name, size, mimeType, url }`.
      const views: Record<string, FileValueView> = {};
      for (const { result, originalName } of successful) {
        const view = uploadResultView(result, originalName);
        if (view.id) views[view.id] = view;
      }
      if (Object.keys(views).length > 0) setRecent((prev) => ({ ...prev, ...views }));

      const nextValues = successful.map(({ value }) => value);
      if (multiple) {
        // The values already on the field go back as they came, except the
        // refused marker, which is reduced to its bare id (objectui#12339).
        onChange([...files.map(fileValueForResubmit), ...nextValues]);
      } else {
        onChange(nextValues[0]);
      }
    } finally {
      releaseScope?.();
      setUploading(false);
      setUploadProgress({});
    }
  }, [files, multiple, onChange, maxSize, upload, t, holdScope]);

  return { processFiles, errors, uploading, uploadProgress, recent };
}

/**
 * FileField - File upload widget with drag-and-drop support
 * Supports single and multiple file uploads with configurable accepted file types.
 * L2: File size validation, per-file progress indicators, error messages.
 */
export function FileField({ value, onChange, field, readonly, onUploadingChange, error, ...props }: FieldWidgetComponentProps<any>) {
  const { t } = useObjectTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileField = field as any;
  const multiple = fileField?.multiple || false;
  const accept = fileField?.accept ? fileField.accept.join(',') : undefined;
  const maxSize = fileField?.maxSize as number | undefined; // bytes
  /**
   * Camera capture mode for mobile devices.
   * - `'environment'` (back camera): photos of receipts, documents, products
   * - `'user'` (front camera): selfies, profile pictures
   * - `false`: disable the camera button entirely
   * @default 'environment' when accept includes image/* on a touch device
   */
  const captureMode = (fileField?.capture ?? null) as 'environment' | 'user' | false | null;
  const acceptsImages = !accept || accept.split(',').some((t: string) =>
    t.trim().startsWith('image/') || t.trim() === 'image/*' || t.trim().startsWith('.jp') || t.trim().startsWith('.png') || t.trim().startsWith('.gif') || t.trim().startsWith('.webp'),
  );
  // Auto-enable camera button on touch devices when image upload is permitted, unless explicitly disabled.
  const isTouchDevice = typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || /Mobi|Android/i.test(navigator.userAgent));
  const cameraEnabled = captureMode === false ? false : (captureMode ?? (acceptsImages && isTouchDevice ? 'environment' : null));
  const [isDragOver, setIsDragOver] = useState(false);

  const files = value ? (Array.isArray(value) ? value : [value]) : [];
  const holdScope = useUploadingScopeHold();
  const { processFiles, errors, uploading, uploadProgress, recent } = useFileUploads({
    files, multiple, maxSize, onChange, holdScope,
  });
  const fallbackName = t('fields.file.fileFallback', { defaultValue: 'File' });
  // Normalised for display: accepts a bare reference id, the expanded
  // `{ id, name, size, mimeType, url }`, or a legacy inline blob.
  const views = withRecentUploads(readFileValues(value, fallbackName), recent);
  useUploadingSignal(uploading, onUploadingChange);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (accept) {
      const acceptedTypes = accept.split(',').map((t: string) => t.trim().toLowerCase());
      const filtered = droppedFiles.filter(file => {
        const parts = file.name.split('.');
        const ext = parts.length > 1 ? '.' + parts.pop()?.toLowerCase() : '';
        return acceptedTypes.some((t: string) =>
          t === file.type || (ext && t === ext) || (t.endsWith('/*') && file.type.startsWith(t.replace('/*', '/')))
        );
      });
      processFiles(filtered);
    } else {
      processFiles(droppedFiles);
    }
  }, [accept, processFiles]);

  if (readonly) {
    // Readonly there is no dropzone: the field's whole rendered surface is the
    // list of file names, so THAT is what the host's group label names
    // (objectui#3990) and what its help text describes (objectui#4005) — the
    // dropzone that took the description while editable is exactly what this
    // branch does not render. The role is therefore `group` here and `button`
    // (the dropzone) while editable — the same widget, two different surfaces.
    // See `toHostGroupProps`; `EmptyValue`'s own `aria-label` ("No value") is
    // outranked by `aria-labelledby` per accname, and on the `generic` role that
    // placeholder span carries it was never exposed as a name anyway.
    const hostGroupProps = toHostGroupProps(props, 'instead-of-the-inputs');
    if (!value) return <EmptyValue {...hostGroupProps} />;

    return (
      <div {...hostGroupProps} className="flex flex-wrap gap-2">
        {/* THE DEFECT (objectui#9161): this list used to be bare `<span>`s, so a
            read-only field named its attachments and gave no way to open one.
            The URL was already in hand on every arm — `readFileValues` resolves
            the expanded value's own `url`, and derives the stable download
            endpoint for a bare `sys_file` id. ⛔ A value that resolves to none
            keeps the plain span it always had: no dead anchors (objectui#8490). */}
        {views.map((file, idx) => (
          <FileValueAffordance
            key={idx}
            view={file}
            className="text-sm max-w-xs"
            fallback={<span className="text-sm truncate max-w-xs">{file.name}</span>}
          />
        ))}
      </div>
    );
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(Array.from(e.target.files || []));
  };

  const handleRemove = (index: number) => {
    if (multiple) {
      const newFiles = files
        .filter((_: any, i: number) => i !== index)
        .map(fileValueForResubmit);
      onChange(newFiles.length > 0 ? newFiles : null);
    } else {
      onChange(null);
    }
  };

  const { name: _domName, ...dropzoneDomProps } = toDomProps(props);

  return (
    <div className={props.className}>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
      />
      {cameraEnabled && (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture={cameraEnabled}
          onChange={handleFileChange}
          className="hidden"
          aria-label={t('fields.file.cameraCapture', { defaultValue: 'Camera capture' })}
          data-testid="file-field-camera-input"
        />
      )}
      
      <div className="space-y-2">
        {/* Drag-and-drop zone — the widget's real focusable control (it is the
            keyboard path to the hidden file input), so the DOM pass-through
            and the validation state land here (objectui#3318). `name` is
            withheld: only DOM-legal on form controls, and on this div it is
            exactly the leak #3291 sweeps for.

            It also carries the host's label. This widget is declared
            `labelling: 'group'` (objectui#3961) NOT because it is composite — it
            has exactly one control — but because that one control is a
            `div[role="button"]`, which no `<label for>` can reach. So the form
            renderer names it by IDREF instead, and `aria-labelledby` arrives in
            the same whitelist spread (`toDomProps` forwards the whole `aria-`
            family). Deliberately no extra `role="group"` wrapper: there is no
            group here, and adding one would announce a container that holds a
            single button. */}
        <div
          {...dropzoneDomProps}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`
            flex flex-col items-center justify-center gap-2 p-6 
            border-2 border-dashed rounded-lg cursor-pointer
            transition-colors duration-200
            ${isDragOver 
              ? 'border-primary bg-primary/5 text-primary' 
              : 'border-muted-foreground/25 hover:border-primary/50 text-muted-foreground hover:text-foreground'}
          `}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          // AFTER the spread so this widget's own computation wins (#3222).
          aria-invalid={!!error}
        >
          <Upload className={`size-8 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          <div className="text-center">
            <p className="text-sm font-medium">
              {isDragOver
                ? t('fields.file.dropFilesHere', { defaultValue: 'Drop files here' })
                : t('fields.file.dragDropHere', { defaultValue: 'Drag & drop files here' })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {cameraEnabled
                ? t('fields.file.browseHintCamera', { defaultValue: 'or click to browse • use the camera button below' })
                : t('fields.file.browseHint', { defaultValue: 'or click to browse' })}
            </p>
          </div>
        </div>

        {cameraEnabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              cameraRef.current?.click();
            }}
            data-testid="file-field-camera-button"
          >
            <Camera className="size-4 mr-2" />
            {cameraEnabled === 'user'
              ? t('fields.file.takeSelfie', { defaultValue: 'Take selfie' })
              : t('fields.file.takePhoto', { defaultValue: 'Take photo' })}
          </Button>
        )}

        {/* Upload progress indicator */}
        {uploading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="file-field-uploading">
            <Loader2 className="size-3 animate-spin" />
            <span>
              {(() => {
                const keys = Object.keys(uploadProgress);
                if (keys.length === 0) return t('fields.file.uploading', { defaultValue: 'Uploading…' });
                const pct = Math.round(
                  (Object.values(uploadProgress).reduce((s, v) => s + v, 0) / keys.length) * 100,
                );
                return t('fields.file.uploadingPct', { defaultValue: `Uploading… (${pct}%)`, pct });
              })()}
            </span>
          </div>
        )}

        {/* Validation errors */}
        {errors.length > 0 && (
          <div className="space-y-0.5">
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-destructive">{err}</p>
            ))}
          </div>
        )}

        {/* File list */}
        {views.length > 0 && (
          <div className="space-y-1">
            {views.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded-md border"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {file.metadataRefused ? (
                    // A file the reader may not open: no thumbnail, its
                    // MIME type was never served (objectui#12339).
                    <Lock className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  ) : isImageValue(file) && file.url ? (
                    <img src={file.url} alt={file.name} className="size-8 object-cover rounded shrink-0" />
                  ) : isImageValue(file) ? (
                    <ImageIcon className="size-4 text-muted-foreground shrink-0" />
                  ) : (
                    <FileIcon className="size-4 text-muted-foreground shrink-0" />
                  )}
                  {/* The reporter's DOM reading of this row was `<button>` x 1
                      and `<a>` x 0 (objectui#9161): a file already uploaded
                      could be DELETED from here and not opened. The name
                      becomes the same shared affordance the read-only surfaces
                      draw — with `icon` suppressed, because this row already
                      draws its own thumbnail or file icon to the left. */}
                  <FileValueAffordance
                    view={file}
                    className="text-sm"
                    icon={false}
                    fallback={<span className="text-sm truncate">{file.name}</span>}
                  />
                  {file.size && (
                    <span className="text-xs text-muted-foreground">
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(idx);
                  }}
                  className="h-6 w-6 p-0"
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * FileCell — compact upload control for a line-item grid cell (objectui#2360).
 *
 * Same value shape and upload pipeline as {@link FileField}, sized for a 32px
 * grid row: existing files render as removable chips (image thumbnail / file
 * icon + name) and a small button opens the native file picker. No
 * drag-and-drop zone — a grid cell has no room for one; the per-row expand
 * form still offers the full-size FileField.
 */
export function FileCell({
  value,
  onChange,
  disabled,
  multiple,
  accept,
  maxSize,
  error,
  'aria-label': ariaLabel,
  'data-cell': dataCell,
}: {
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  multiple?: boolean;
  /** Comma-joined accept list for the native picker (e.g. `"image/*,.pdf"`). */
  accept?: string;
  /** Max file size in bytes (oversize picks are rejected with an inline error). */
  maxSize?: number;
  /**
   * The active validation message for this cell, named as
   * `@objectstack/spec/ui`'s `FieldWidgetPropsSchema` names it — the same
   * published slot `FieldWidgetComponentProps` declares and `LookupField` /
   * `FileField` above already consume (objectui#5431, completing #3318's
   * per-cell delivery). NOT the per-pick upload `errors` this component
   * computes itself — this is the HOST's verdict on the cell's value.
   *
   * **Producer**: `GridField`, for a required-but-empty `file` cell.
   * **Consumer**: drives `aria-invalid` on the picker button — the focusable
   * control assistive tech reads a control state from (objectui#5223; a mark
   * on the non-focusable wrapper is exactly what the registry sweep forbids).
   * The message TEXT stays with the cell's `title` in `GridField`; rendering
   * it here would double-display it.
   */
  error?: string;
  'aria-label'?: string;
  /** Focus-grid coordinate (see GridField keyboard navigation). */
  'data-cell'?: string;
}) {
  const { t } = useObjectTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const files = value ? (Array.isArray(value) ? value : [value]) : [];
  const { processFiles, errors, uploading, recent } = useFileUploads({
    files, multiple: !!multiple, maxSize, onChange,
  });
  const fallbackName = t('fields.file.fileFallback', { defaultValue: 'File' });
  const views = withRecentUploads(readFileValues(value, fallbackName), recent);
  const restricted = useRestrictedFileText();
  // A restricted file has no name of its own; the chip's tooltip and its
  // remove button name it by the restricted label (objectui#12339).
  const chipName = (file: FileValueView) => (file.metadataRefused ? restricted.label : file.name);

  const removeAt = (index: number) => {
    if (multiple) {
      const next = files
        .filter((_: any, i: number) => i !== index)
        .map(fileValueForResubmit);
      onChange(next.length > 0 ? next : null);
    } else {
      onChange(null);
    }
  };

  const showUpload = !disabled && !uploading && (multiple || files.length === 0);

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 px-1 py-0.5">
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          processFiles(Array.from(e.target.files || []));
          e.target.value = ''; // allow re-picking the same file
        }}
        className="hidden"
      />
      {views.map((file, idx) => (
        <span
          key={idx}
          className="inline-flex max-w-40 items-center gap-1 rounded border bg-muted/50 px-1 py-0.5 text-xs"
          title={file.metadataRefused ? restricted.hint : file.name}
          data-testid="file-cell-chip"
        >
          {file.metadataRefused ? (
            <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : isImageValue(file) && file.url ? (
            <img src={file.url} alt={file.name} className="size-5 shrink-0 rounded object-cover" />
          ) : (
            <FileIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          {/* THE DEFECT (objectui#9485): this chip stated a name and nothing
              else, so an attachment on a line-item grid row could not be
              opened — and under `disabled`, which is this control's READ-ONLY
              state, the delete button below is gone too, leaving the chip with
              no affordance at all. Same shared component the other two `file`
              surfaces draw (objectui#9161), with `icon` suppressed because the
              chip already drew its own thumbnail or file icon just above.
              ⛔ A value that resolves to no URL keeps the plain span it always
              had: no dead anchors (objectui#8490). */}
          <FileValueAffordance
            view={file}
            icon={false}
            fallback={<span className="truncate">{file.name}</span>}
          />
          {!disabled && (
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={t('fields.file.remove', { defaultValue: `Remove ${chipName(file)}`, name: chipName(file) })}
              onClick={() => removeAt(idx)}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {uploading && (
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          data-testid="file-cell-uploading"
        >
          <Loader2 className="size-3.5 animate-spin" />
        </span>
      )}
      {showUpload && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => inputRef.current?.click()}
          aria-label={ariaLabel}
          data-cell={dataCell}
          disabled={disabled}
          // The published `error` slot lands here, on the focusable control a
          // keyboard user edits — same computation as FileField's dropzone and
          // LookupField's trigger (#3222 / #5431).
          aria-invalid={!!error}
        >
          <Upload className="size-3.5" />
          {files.length === 0 && t('fields.file.upload', { defaultValue: 'Upload' })}
        </Button>
      )}
      {errors.length > 0 && (
        <span className="w-full truncate text-[11px] text-destructive" title={errors.join('; ')}>
          {errors[0]}
        </span>
      )}
    </div>
  );
}

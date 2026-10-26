import React from 'react';
import { Avatar, AvatarFallback, AvatarImage, Button } from '@object-ui/components';
import { useUpload } from '@object-ui/providers';
import { useObjectTranslation } from '@object-ui/i18n';
import { Upload, X, Loader2, Lock } from 'lucide-react';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useUploadingSignal } from './useUploadingSignal.js';
import { useUploadingScopeHold } from './uploadingScope.js';
import type { TranslateFn } from './file-size-guard.js';
// The error row for a failed OR incomplete upload — the same translated keys
// FileField and ImageField render for the same outcomes (objectui#7699).
import { uploadErrorMessage } from './upload-error-message.js';
import {
  fileValueForSubmit,
  readFileValues,
  uploadResultView,
  withRecentUploads,
  type FileValueView,
} from './file-value.js';
import { useRestrictedFileText } from './file-affordance.js';

/**
 * Avatar field widget - provides an avatar/profile picture uploader.
 *
 * `avatar` is a member of the file-reference family, so its stored value is
 * the bare `sys_file` id, exactly as for `file` and `image` (see
 * `file-value`'s "Submitting"). A pick uploads through the ambient
 * `UploadProvider` (`useUpload()`), and the id the adapter surfaced in
 * `meta.fileId` is what `onChange` receives, through `fileValueForSubmit` —
 * the one submit rule the file and image widgets use. A pick whose adapter
 * surfaced no id (the object-URL default `useUpload()` falls back to when no
 * provider is mounted, an S3/Azure-style adapter that mints no `sys_file`
 * row) is refused with the same translated "did not complete" row, and the
 * field is not changed. ⛔ The widget used to read the pick into a `data:` URL
 * and store that string, inlining the whole image into the record row as a
 * value the stored contract refuses (objectui#10785).
 *
 * Reading is `readFileValue`'s: a bare id renders from the storage endpoint,
 * and a legacy `data:` or http(s) URL already on a record still renders as
 * itself — ADR-0104's dual-read window is a read rule.
 */
export function AvatarField({ value, onChange, field, readonly, onUploadingChange, error, ...props }: FieldWidgetComponentProps<string>) {
  const [isHovered, setIsHovered] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { upload } = useUpload();
  const { t } = useObjectTranslation();
  const [uploading, setUploading] = React.useState(false);
  /** The last pick's failure, cleared on the next attempt. */
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  // The display view of a just-uploaded avatar, keyed by its new `sys_file`
  // id: the id the field now holds carries no URL of its own, so this keeps
  // the new picture visible until the next read expands the value.
  const [recent, setRecent] = React.useState<Record<string, FileValueView>>({});
  // The pick now travels over the network, so a save must wait for it — the
  // same signal and scope the file and image widgets raise (objectui#10180).
  useUploadingSignal(uploading, onUploadingChange);
  const holdScope = useUploadingScopeHold();

  const avatarField = field as any;
  const view = withRecentUploads(readFileValues(value, ''), recent)[0];
  // A picture the reader may not open (the refused marker) is never fetched:
  // no MIME type was served and the download door may refuse it, so the
  // avatar draws a lock in place of the initials instead (objectui#12339).
  const restrictedView = !!view?.metadataRefused;
  const src = restrictedView ? undefined : view?.url;
  const restricted = useRestrictedFileText();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset up front, as ImageField does, so a refused pick can be re-picked
    // under the same name.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    // Check file type
    if (!file.type.startsWith('image/')) {
      console.error('Please select an image file');
      return;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      console.error('File size must be less than 5MB');
      return;
    }

    setUploadError(null);
    // Released only after `onChange` has handed the value over — see
    // FileField's pipeline.
    const releaseScope = holdScope();
    setUploading(true);
    try {
      const result = await upload(file);
      // Throws when the adapter surfaced no `sys_file` id (objectui#7699), so
      // the catch below reports it and the field is not changed.
      const next = fileValueForSubmit(result, file.name);
      const view = uploadResultView(result, file.name);
      if (view.id) setRecent((prev) => ({ ...prev, [view.id as string]: view }));
      onChange(next);
    } catch (err) {
      setUploadError(uploadErrorMessage(t as TranslateFn, file.name, err));
    } finally {
      releaseScope();
      setUploading(false);
    }
  };

  const handleRemove = () => {
    onChange('');
  };

  // Extract initials for fallback
  const getInitials = (): string => {
    const name = avatarField?.defaultName || avatarField?.label || 'User';
    return name
      .split(' ')
      .map((word: string) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const fallback = restrictedView ? (
    <AvatarFallback title={restricted.hint} data-slot="file-restricted">
      <Lock className="size-5 text-muted-foreground" role="img" aria-label={restricted.label} />
    </AvatarFallback>
  ) : (
    <AvatarFallback>{getInitials()}</AvatarFallback>
  );

  if (readonly) {
    return (
      <Avatar className="w-16 h-16">
        {src && <AvatarImage src={src} alt={avatarField?.label} />}
        {fallback}
      </Avatar>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Avatar className="w-16 h-16">
          {src && <AvatarImage src={src} alt={avatarField?.label} />}
          {fallback}
        </Avatar>
        {!readonly && isHovered && value && (
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          // DOM pass-through onto the widget's real focusable control — the
          // upload button is the keyboard path to the hidden file input
          // (objectui#3318).
          {...toDomProps(props)}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={readonly || props.disabled || uploading}
          // AFTER the spread so this widget's own computation wins (#3222).
          aria-invalid={!!error}
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t('fields.image.uploading', { defaultValue: 'Uploading…' })}
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              {value ? 'Change' : 'Upload'} Avatar
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          PNG, JPG up to 5MB
        </p>
        {/* A failed or refused pick — same presentation as ImageField's row. */}
        {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
      </div>
    </div>
  );
}

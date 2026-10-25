import React, { useRef, useState, useCallback, lazy, Suspense } from 'react';
import { Button, EmptyValue } from '@object-ui/components';
import { useUpload } from '@object-ui/providers';
import { useObjectTranslation } from '@object-ui/i18n';
import { X, Image as ImageIcon, Crop as CropIcon, Loader2 } from 'lucide-react';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { ImageLightbox } from './ImageLightbox.js';
import { useUploadingSignal } from './useUploadingSignal.js';
import { useUploadingScopeHold } from './uploadingScope.js';
import { maxSizeError, type TranslateFn } from './file-size-guard.js';
// The error row for a failed OR incomplete upload — the same translated keys,
// arguments and fallbacks FileField renders for the same outcomes through the
// same `useUpload()` transport (objectui#10226, objectui#7699). Both upload
// paths in `ImageField` are invoked fire-and-forget (React ignores the promise
// an `onChange` handler returns; the cropper does not await `onConfirm`), so a
// failure not caught there is reported nowhere — it escapes as an unhandled
// rejection.
import { uploadErrorMessage } from './upload-error-message.js';
import {
  fileValueForSubmit,
  readFileValues,
  uploadResultView,
  withRecentUploads,
  type FileValueView,
} from './file-value.js';
import { fileValueForResubmit } from './file-refused.js';
// The restricted state a file the reader may not open draws (objectui#12339).
import { RestrictedFileAffordance } from './file-affordance.js';

// Lazy-load the cropper so the dialog (canvas + crop logic) is not in the initial
// ImageField bundle. Consumers that never crop pay zero cost.
const ImageCropperDialog = lazy(() =>
  import('./ImageCropperDialog.js').then((m) => ({ default: m.ImageCropperDialog })),
);

/**
 * ImageField - Image upload widget with preview thumbnails
 * Supports single and multiple image uploads with drag-and-drop and preview display
 */
export function ImageField({ value, onChange, field, readonly, onUploadingChange, error, ...props }: FieldWidgetComponentProps<any>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageField = field as any;
  const multiple = imageField?.multiple || false;
  const accept = imageField?.accept ? imageField.accept.join(',') : 'image/*';
  /**
   * Max upload size in bytes. Delivered by `paramToField` for an action param
   * and by the field config for a record field; enforced before any upload
   * starts, exactly as FileField does (objectui#4141).
   */
  const maxSize = imageField?.maxSize as number | undefined;
  /**
   * Set `field.crop = false` to opt out of inline cropping. Defaults to enabled.
   */
  const cropEnabled = imageField?.crop !== false;
  const [cropTarget, setCropTarget] = useState<{ index: number; src: string; name: string } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { upload } = useUpload();
  const { t } = useObjectTranslation();
  const [uploading, setUploading] = useState(false);
  /**
   * Per-pick failures shown under the button, cleared on the next attempt:
   * client-side rejections (oversize picks) and failed uploads.
   */
  const [errors, setErrors] = useState<string[]>([]);
  // Display details of just-uploaded images, keyed by their new `sys_file` id.
  // Submitting the reference form means the field value no longer carries the
  // URL a thumbnail needs; these keep the preview visible until the next read
  // returns the expanded form. See `file-value`.
  const [recent, setRecent] = useState<Record<string, FileValueView>>({});
  useUploadingSignal(uploading, onUploadingChange);
  // The upload's own lifetime, which can outlast this widget — both upload
  // paths below take it (objectui#10180). See `useUploadingScopeHold`.
  const holdScope = useUploadingScopeHold();

  // Derived value + memoized handlers must run before the readonly early return
  // so hook order stays stable across renders.
  const images = value ? (Array.isArray(value) ? value : [value]) : [];
  // An EMPTY fallback name, as the image cell's `displayableImagesOf` passes:
  // a value that carries no name of its own (a bare id, a `data:` URI) stays
  // nameless, so every reader below falls through to its own fallback — the
  // translated `fields.image.imageAlt` for the alt, the enlarge label and the
  // lightbox, and `image-${index}.png` for the cropper's output file name.
  // The literal `'Image'` passed here used to name every such image
  // `Image` on every locale, leaving the translated alt unreachable
  // (objectui#10637).
  const views = withRecentUploads(readFileValues(value, ''), recent);

  const remember = useCallback((result: any, originalName: string) => {
    const view = uploadResultView(result, originalName);
    if (view.id) setRecent((prev) => ({ ...prev, [view.id as string]: view }));
  }, []);

  const handleCropConfirm = useCallback(
    async (blob: Blob, name: string) => {
      if (!cropTarget) return;
      // The size that matters here is the CROP's, not the source image's: the
      // cropper re-encodes to PNG, so cropping an in-limit JPEG can produce a
      // blob over the limit. Checked before `setUploading` so a rejected crop
      // never flashes the spinner, and the dialog closes so the message lands
      // in the field's error row rather than behind the open dialog.
      const rejection = maxSizeError(t as TranslateFn, { name, size: blob.size }, maxSize);
      if (rejection) {
        setErrors([rejection]);
        setCropTarget(null);
        return;
      }
      setErrors([]);
      const releaseScope = holdScope();
      setUploading(true);
      try {
        const result = await upload(blob);
        // Throws when the adapter surfaced no `sys_file` id (objectui#7699),
        // so the catch below reports it and the crop is not written; the
        // preview is remembered only once there is an id to key it by.
        const next = fileValueForSubmit(result, name);
        remember(result, name);
        if (multiple) {
          const updated = images.map(fileValueForResubmit);
          updated[cropTarget.index] = next;
          onChange(updated);
        } else {
          onChange(next);
        }
      } catch (err) {
        // The original image stays in place; the dialog closes in `finally`,
        // so the message lands in the field's error row, not behind it.
        setErrors([uploadErrorMessage(t as TranslateFn, name, err)]);
      } finally {
        releaseScope();
        setUploading(false);
        setCropTarget(null);
      }
    },
    [cropTarget, images, multiple, onChange, upload, remember, maxSize, t, holdScope],
  );

  const openCropper = useCallback(
    (index: number) => {
      const img = views[index];
      if (!img?.url || img.metadataRefused) return;
      setCropTarget({ index, src: img.url, name: img.name || `image-${index}.png` });
    },
    [views],
  );

  // A file the reader may not open (`metadataRefused`) is never drawn as a
  // thumbnail — no MIME type was served, and its URL is the download door,
  // which may refuse — so it is left out of the lightbox and drawn as the
  // restricted state in its own place (objectui#12339).
  const lightboxImages = views
    .filter((v) => v.url && !v.metadataRefused)
    .map((v) => ({ url: v.url as string, name: v.name }));
  const hasRestricted = views.some((v) => v.metadataRefused);

  if (readonly) {
    if (!value || (lightboxImages.length === 0 && !hasRestricted)) return <EmptyValue />;

    let lightboxPos = -1;
    return (
      <>
        <div className="flex flex-wrap gap-2">
          {views.map((view, viewIdx) => {
            if (view.metadataRefused) {
              return (
                <RestrictedFileAffordance
                  key={viewIdx}
                  view={view}
                  compact
                  className="size-20 justify-center rounded-md border border-border bg-muted"
                />
              );
            }
            if (!view.url) return null;
            const idx = ++lightboxPos;
            const img = lightboxImages[idx];
            return (
              <button
                key={viewIdx}
                type="button"
                onClick={() => setLightboxIndex(idx)}
                className="group relative overflow-hidden rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={t('fields.image.enlarge', { name: img.name || t('fields.image.imageAlt', { index: idx + 1 }) })}
              >
                <img
                  src={img.url}
                  alt={img.name || t('fields.image.imageAlt', { index: idx + 1 })}
                  className="size-20 object-cover transition-transform duration-150 group-hover:scale-105"
                />
                <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
              </button>
            );
          })}
        </div>
        {lightboxIndex !== null && (
          <ImageLightbox
            images={lightboxImages}
            index={lightboxIndex}
            open
            onOpenChange={(o) => !o && setLightboxIndex(null)}
            onIndexChange={setLightboxIndex}
          />
        )}
      </>
    );
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    // Reset the input up front rather than in `finally`: a pick rejected below
    // returns before the upload runs, and leaving the old value in place would
    // stop the user re-picking the same name after shrinking the image.
    // `selectedFiles` already holds the File objects, so clearing is safe.
    if (inputRef.current) inputRef.current.value = '';
    if (selectedFiles.length === 0) return;

    // Enforce the declared limit before anything touches the network. Partial
    // acceptance matches FileField: the in-limit picks of a multi-select still
    // upload, and only the oversize ones are reported.
    const rejections: string[] = [];
    const validFiles = selectedFiles.filter((file) => {
      const rejection = maxSizeError(t as TranslateFn, file, maxSize);
      if (rejection) {
        rejections.push(rejection);
        return false;
      }
      return true;
    });
    setErrors(rejections);
    if (validFiles.length === 0) return;
    const failures: string[] = [];

    // Released only after `onChange` has handed the value over, and whether or
    // not this widget is still mounted by then — see FileField's pipeline.
    const releaseScope = holdScope();
    setUploading(true);
    try {
      // Each pick is caught on its own, as FileField does: a failed pick is
      // reported and not added, and the picks that did upload still land.
      const uploaded = await Promise.all(
        validFiles.map(async (file) => {
          try {
            const result = await upload(file);
            // Throws when the adapter surfaced no `sys_file` id (objectui#7699):
            // reported below like a transport failure, and the pick is not
            // added. The preview is remembered only once there is an id.
            const next = fileValueForSubmit(result, file.name);
            remember(result, file.name);
            return next;
          } catch (err) {
            failures.push(uploadErrorMessage(t as TranslateFn, file.name, err));
            return null;
          }
        }),
      );
      if (failures.length > 0) setErrors([...rejections, ...failures]);
      const imageIds = uploaded.filter((v) => v !== null);
      if (imageIds.length === 0) return;

      if (multiple) {
        // The refused marker goes back as its bare id (objectui#12339).
        onChange([...images.map(fileValueForResubmit), ...imageIds]);
      } else {
        onChange(imageIds[0]);
      }
    } finally {
      releaseScope();
      setUploading(false);
    }
  };

  const handleRemove = (index: number) => {
    if (multiple) {
      const newImages = images
        .filter((_: any, i: number) => i !== index)
        .map(fileValueForResubmit);
      onChange(newImages.length > 0 ? newImages : null);
    } else {
      onChange(null);
    }
  };

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
      
      <div className="space-y-2">
        {views.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {views.map((img, idx) => (
              <div key={idx} className="relative group">
                {img.metadataRefused ? (
                  <RestrictedFileAffordance
                    view={img}
                    compact
                    className="size-20 justify-center rounded-md border border-gray-200 bg-muted"
                  />
                ) : (
                  <img
                    src={img.url || ''}
                    alt={img.name || t('fields.image.imageAlt', { index: idx + 1 })}
                    className="size-20 rounded-md object-cover border border-gray-200"
                  />
                )}
                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {cropEnabled && !img.metadataRefused && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openCropper(idx)}
                      className="h-6 w-6 p-0"
                      aria-label={t('fields.image.crop', { index: idx + 1 })}
                      data-testid={`image-field-crop-${idx}`}
                    >
                      <CropIcon className="size-3" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRemove(idx)}
                    className="h-6 w-6 p-0"
                    aria-label={t('fields.image.remove', { index: idx + 1 })}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        <Button
          // DOM pass-through onto the widget's real focusable control — the
          // upload button is the keyboard path to the hidden file input
          // (objectui#3318).
          {...toDomProps(props)}
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="w-full"
          disabled={uploading}
          data-testid="image-field-upload-button"
          // AFTER the spread so this widget's own computation wins (#3222).
          aria-invalid={!!error}
        >
          {uploading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <ImageIcon className="size-4 mr-2" />
          )}
          {uploading
            ? t('fields.image.uploading')
            : images.length > 0
              ? t('fields.image.addMore')
              : t('fields.image.upload')}
        </Button>

        {/* Oversize picks (objectui#4141) and failed uploads (objectui#10226).
            Same presentation as FileField's error row. */}
        {errors.length > 0 && (
          <div className="space-y-0.5">
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-destructive">{err}</p>
            ))}
          </div>
        )}
      </div>

      {cropEnabled && cropTarget && (
        <Suspense fallback={null}>
          <ImageCropperDialog
            open
            onOpenChange={(o) => !o && setCropTarget(null)}
            src={cropTarget.src}
            outputName={cropTarget.name}
            onConfirm={handleCropConfirm}
          />
        </Suspense>
      )}
    </div>
  );
}

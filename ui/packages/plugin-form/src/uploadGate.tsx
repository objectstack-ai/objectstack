import React from 'react';
import { createSafeTranslation } from '@object-ui/i18n';
import { useUploadingScope, UploadingScopeProvider } from '@object-ui/fields';

/**
 * The record form's upload-in-flight gate (objectui#10166).
 *
 * ## The defect
 *
 * A record form could be submitted while a `file` / `image` widget's upload was
 * still in flight. The value of such a field only becomes the fileId once the
 * presigned upload settles, so the record was written WITHOUT the attachment —
 * and the form reported success. The user picked the file, saw it listed and
 * pressed Save; nothing failed, and the attachment was simply not there.
 *
 * ## What a fix has to be
 *
 * Blocking the submit is the data-integrity half and it is not the whole
 * repair: a Save that is merely inert leaves the user pressing a dead control
 * with no explanation. So this module ships three things together and the hosts
 * use all three:
 *
 *   1. `uploading` — the gate. The host refuses the submit while it is true, so
 *      a keyboard submit and a click on a still-enabled button are both covered.
 *   2. `busyLabel` — the Save button's label while an upload is in flight, the
 *      same answer `ActionParamDialog` gives its Confirm button.
 *   3. `reason` — the sentence that says WHY, rendered by
 *      {@link UploadInFlightNotice} beside the action row and reused as the
 *      refusal message when a submit is actually attempted.
 *
 * ## Where the signal comes from
 *
 * Not from a prop. A record form hands a `fields` array to the `form` node
 * renderer and never touches a widget, and its upload controls can sit inside a
 * section, a tab or a line-items subform — there is no point in that chain
 * where a host can attach `onUploadingChange`. `useUploadingScope` from
 * `@object-ui/fields` is the aggregation for exactly that shape: the host mounts
 * a provider around its form body and every `useUploadingSignal` below it
 * reports in.
 */
const useUploadGateTranslation = createSafeTranslation(
  {
    // Must stay byte-identical to the `en` pack values — `pnpm check:i18n-keys`
    // compares this table against them.
    'form.uploadInFlight': 'Wait for the upload to finish before saving.',
    'fields.file.uploading': 'Uploading…',
  },
  'form.uploadInFlight',
);

export interface UploadGate {
  /** True while at least one upload inside this form is still in flight. */
  uploading: boolean;
  /** Mount around the form body so its upload widgets report in. */
  scope: ReturnType<typeof useUploadingScope>;
  /** The Save button's label while `uploading`. */
  busyLabel: string;
  /** Why Save is unavailable — shown, and used as the refusal message. */
  reason: string;
}

/**
 * Own the gate for one record form. The host renders its form body inside
 * {@link UploadGateProvider} with the returned `scope`.
 */
export function useUploadGate(): UploadGate {
  const scope = useUploadingScope();
  const { t } = useUploadGateTranslation();
  return {
    uploading: scope.anyUploading,
    scope,
    busyLabel: t('fields.file.uploading'),
    reason: t('form.uploadInFlight'),
  };
}

/** Re-exported under this package's own name so hosts import one module. */
export function UploadGateProvider({
  gate,
  children,
}: {
  gate: UploadGate;
  children: React.ReactNode;
}): React.ReactElement {
  return <UploadingScopeProvider scope={gate.scope}>{children}</UploadingScopeProvider>;
}

/**
 * The visible reason. Rendered beside the action row, not as a toast: the
 * explanation has to be readable at the moment the user looks at the control
 * that will not respond, and a toast is gone by then.
 *
 * `role="status"` (polite) rather than `alert`: nothing has gone wrong, an
 * upload is simply still running, and an assertive live region would interrupt
 * a screen-reader user mid-sentence every time a file is picked.
 */
export function UploadInFlightNotice({ gate }: { gate: UploadGate }): React.ReactElement | null {
  if (!gate.uploading) return null;
  return (
    <p role="status" className="text-sm text-muted-foreground" data-testid="upload-in-flight-notice">
      {gate.reason}
    </p>
  );
}

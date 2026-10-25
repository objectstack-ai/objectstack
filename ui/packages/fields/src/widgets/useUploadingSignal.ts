import { useEffect, useRef } from 'react';
import { useUploadingScopeReport } from './uploadingScope.js';

/**
 * Notify a parent whenever an upload widget's in-progress state flips. Used by
 * hosts that must block a submit until the presigned upload resolves — e.g.
 * `ActionParamDialog` disables Confirm so a `file`/`image` param can't be
 * submitted mid-upload (the value only becomes the fileId once the upload
 * settles). Fires with the latest callback and only when `uploading` actually
 * changes, so an inline arrow prop doesn't thrash the parent every render.
 *
 * It ALSO reports into the ambient `UploadingScope` when one is mounted above
 * the widget (objectui#10166). The prop suits a host that renders one named
 * control; a record form hands its fields to the `form` node renderer and never
 * touches the widget, so it has no place to attach a callback — the scope is how
 * that host learns an upload is in flight. Both sinks are driven from this one
 * call so they cannot disagree, and a host that mounts no provider is
 * unaffected: `useUploadingScopeReport` is inert without one.
 */
export function useUploadingSignal(
  uploading: boolean,
  onUploadingChange?: (uploading: boolean) => void,
): void {
  const ref = useRef(onUploadingChange);
  ref.current = onUploadingChange;
  useEffect(() => {
    ref.current?.(uploading);
  }, [uploading]);
  useUploadingScopeReport(uploading);
}

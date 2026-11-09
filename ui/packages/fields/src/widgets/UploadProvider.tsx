/**
 * UploadProvider — pluggable file upload context for the file, image and
 * avatar widgets of this package.
 *
 * Why: the widgets need to push picked bytes to a store and replace the
 * temporary blob URL with a canonical one; `URL.createObjectURL(file)` alone
 * lives only as long as the browser tab and persists nothing.
 *
 * Design:
 * - `UploadProvider` exposes an `upload(file, opts)` function via context.
 * - Apps inject an `UploadAdapter` (the contract `@object-ui/types` declares):
 *   `createObjectStackUploadAdapter` from `@object-ui/data-objectstack`, or any
 *   object with a `name` and an `upload(file, opts)` method.
 * - The default adapter (`createObjectUrlAdapter`) mints a tab-local `blob:`
 *   URL and no `sys_file` id; it keeps the widgets from crashing when no
 *   provider is mounted, and they refuse every pick through it (objectui#7699).
 * - Upload progress and cancellation are part of the contract: an adapter
 *   receives `onProgress` and an abort `signal` in `UploadOptions`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { UploadAdapter, UploadOptions, UploadResult } from '@object-ui/types';

interface UploadContextValue {
  upload: (file: File | Blob, opts?: UploadOptions) => Promise<UploadResult>;
  adapter: UploadAdapter;
}

const UploadContext = createContext<UploadContextValue | null>(null);

/**
 * Default adapter — wraps the file in an object URL. It persists nothing and
 * returns no `meta.fileId`, so the file and image widgets refuse its result
 * (`UploadIncompleteError`); it is a no-crash default, not an upload
 * destination, so it is not exported.
 */
function createObjectUrlAdapter(): UploadAdapter {
  return {
    name: 'object-url',
    async upload(file) {
      const f = file as File;
      const name = ('name' in f && f.name) || 'upload';
      return {
        url: URL.createObjectURL(file),
        name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
      };
    },
  };
}

export interface UploadProviderProps {
  adapter?: UploadAdapter;
  children: ReactNode;
}

export const UploadProvider: React.FC<UploadProviderProps> = ({ adapter, children }) => {
  const adapterRef = useRef<UploadAdapter>(adapter ?? createObjectUrlAdapter());
  useEffect(() => {
    if (adapter) adapterRef.current = adapter;
  }, [adapter]);

  const upload = useCallback(
    (file: File | Blob, opts?: UploadOptions) => adapterRef.current.upload(file, opts),
    [],
  );

  const value = useMemo<UploadContextValue>(
    () => ({ upload, adapter: adapterRef.current }),
    [upload],
  );
  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
};

/**
 * Hook returning the configured upload function. Falls back to a fresh
 * object-URL adapter so widgets never crash when used outside a provider.
 */
export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  // Always call useMemo to honour the rules of hooks; cheap when ctx is set.
  const fallback = useMemo<UploadContextValue>(() => {
    const a = createObjectUrlAdapter();
    return { upload: (f: File | Blob, o?: UploadOptions) => a.upload(f, o), adapter: a };
  }, []);
  return ctx ?? fallback;
}

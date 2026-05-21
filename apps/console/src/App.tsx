/**
 * ObjectStack Console — fork-ready runtime console template.
 *
 * Auth UI lives in the Account SPA at `/_account/*`. This file owns the
 * console routing tree only — sign-in / sign-up / forgot-password URLs are
 * shimmed to hard-redirect to Account, and the AuthGuard fallback bounces
 * unauthenticated visitors there too (preserving `?redirect=...`).
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, AuthGuard } from '@object-ui/auth';
import { Toaster } from 'sonner';
import { UploadProvider, type UploadAdapter } from '@object-ui/providers';
import {
  ConsoleShell,
  ConnectedShell,
  RequireOrganization,
  SystemRedirect,
  LoadingFallback,
  DefaultHomeLayout,
  DefaultHomePage,
  DefaultOrganizationsLayout,
  DefaultOrganizationsPage,
  DefaultAppContent,
} from '@object-ui/app-shell';
import { AccountLoginRedirect } from './components/AccountLoginRedirect';
import { CloudAwareRootRedirect } from './components/CloudAwareRootRedirect';
import {
  gotoAccountLogin,
  gotoAccountRegister,
  gotoAccountForgotPassword,
} from './lib/auth-redirect';
import { useEffect, useMemo } from 'react';

const AUTH_URL = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;
const STORAGE_BASE_URL = import.meta.env.VITE_SERVER_URL || '';
const STORAGE_PATH = '/api/v1/storage';
const BASENAME = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

/**
 * Inline ObjectStack presigned-upload adapter.
 *
 * Mirrors `@object-ui/providers/createObjectStackUploadAdapter` (introduced
 * post-4.8.0). Kept local so this console can ship against the published
 * 4.8.x runtime without bumping every workspace.
 */
function createStorageUploadAdapter(): UploadAdapter {
  const base = STORAGE_BASE_URL.replace(/\/$/, '');
  const apiUrl = (segment: string) =>
    /^https?:/i.test(segment) ? segment : `${base}${segment}`;
  return {
    name: 'objectstack-presigned',
    async upload(file: Blob, options: { signal?: AbortSignal } = {}) {
      const f = file as File;
      const name = ('name' in f && f.name) || 'upload';
      const mimeType = file.type || 'application/octet-stream';
      const presignRes = await fetch(apiUrl(`${STORAGE_PATH}/upload/presigned`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({ filename: name, mimeType, size: file.size }),
      });
      if (!presignRes.ok) {
        throw new Error(
          `Presigned upload failed (${presignRes.status}): ${await presignRes.text().catch(() => '')}`,
        );
      }
      const presignBody = await presignRes.json();
      const descriptor = presignBody?.data ?? presignBody;
      const { uploadUrl, fileId, headers: putHeaders } = descriptor as {
        uploadUrl: string;
        fileId: string;
        headers?: Record<string, string>;
      };
      if (!uploadUrl || !fileId) {
        throw new Error('Presigned upload response missing uploadUrl/fileId');
      }
      const putRes = await fetch(apiUrl(uploadUrl), {
        method: 'PUT',
        signal: options.signal,
        headers: { 'Content-Type': mimeType, ...(putHeaders ?? {}) },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(
          `Raw PUT failed (${putRes.status}): ${await putRes.text().catch(() => '')}`,
        );
      }
      const completeRes = await fetch(apiUrl(`${STORAGE_PATH}/upload/complete`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({ fileId }),
      });
      if (!completeRes.ok) {
        throw new Error(
          `Upload completion failed (${completeRes.status}): ${await completeRes.text().catch(() => '')}`,
        );
      }
      const stableUrl = apiUrl(`${STORAGE_PATH}/files/${encodeURIComponent(fileId)}`);
      return {
        url: stableUrl,
        name,
        size: file.size,
        mimeType,
        meta: { fileId },
      };
    },
  };
}

/**
 * ProtectedRoute — replaces app-shell's AuthenticatedRoute. Same composition
 * (AuthGuard + ConnectedShell + optional RequireOrganization) but with an
 * external-redirect fallback instead of `<Navigate to="/login" />`.
 */
function ProtectedRoute({
  children,
  requireOrganization = true,
}: {
  children: ReactNode;
  requireOrganization?: boolean;
}) {
  return (
    <AuthGuard fallback={<AccountLoginRedirect />} loadingFallback={<LoadingFallback />}>
      <ConnectedShell>
        {requireOrganization ? <RequireOrganization>{children}</RequireOrganization> : children}
      </ConnectedShell>
    </AuthGuard>
  );
}

/** Redirect-only route shim: `/login` → Account, preserving any `?redirect=`. */
function LoginRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    gotoAccountLogin(params.get('redirect') ?? undefined);
  }, []);
  return <LoadingFallback />;
}

function RegisterRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    gotoAccountRegister(params.get('redirect') ?? undefined);
  }, []);
  return <LoadingFallback />;
}

function ForgotPasswordRedirect() {
  useEffect(() => {
    gotoAccountForgotPassword();
  }, []);
  return <LoadingFallback />;
}

export function App() {
  const uploadAdapter = useMemo(() => createStorageUploadAdapter(), []);
  return (
    <AuthProvider authUrl={AUTH_URL}>
      <UploadProvider adapter={uploadAdapter}>
        <Toaster position="bottom-right" />
      <BrowserRouter basename={BASENAME}>
        <ConsoleShell>
          <Routes>
            <Route path="/login" element={<LoginRedirect />} />
            <Route path="/register" element={<RegisterRedirect />} />
            <Route path="/forgot-password" element={<ForgotPasswordRedirect />} />
            <Route path="/home" element={
              <ProtectedRoute>
                <DefaultHomeLayout><DefaultHomePage /></DefaultHomeLayout>
              </ProtectedRoute>
            } />
            <Route path="/organizations" element={
              <ProtectedRoute requireOrganization={false}>
                <DefaultOrganizationsLayout><DefaultOrganizationsPage /></DefaultOrganizationsLayout>
              </ProtectedRoute>
            } />
            <Route path="/system/*" element={<SystemRedirect />} />
            <Route path="/apps/:appName/*" element={
              <ProtectedRoute>
                <DefaultAppContent />
              </ProtectedRoute>
            } />
            <Route path="/" element={<ConnectedShell><CloudAwareRootRedirect /></ConnectedShell>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConsoleShell>
      </BrowserRouter>
      </UploadProvider>
    </AuthProvider>
  );
}

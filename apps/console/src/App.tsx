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
import {
  ConsoleShell,
  ConnectedShell,
  RequireOrganization,
  RootRedirect,
  SystemRedirect,
  LoadingFallback,
  DefaultHomeLayout,
  DefaultHomePage,
  DefaultOrganizationsLayout,
  DefaultOrganizationsPage,
  DefaultAppContent,
} from '@object-ui/app-shell';
import { AccountLoginRedirect } from './components/AccountLoginRedirect';
import {
  gotoAccountLogin,
  gotoAccountRegister,
  gotoAccountForgotPassword,
} from './lib/auth-redirect';
import { useEffect } from 'react';

const AUTH_URL = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;
const BASENAME = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

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
  return (
    <AuthProvider authUrl={AUTH_URL}>
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
            <Route path="/" element={<ConnectedShell><RootRedirect /></ConnectedShell>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConsoleShell>
      </BrowserRouter>
    </AuthProvider>
  );
}

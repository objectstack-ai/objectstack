/**
 * Minimal third-party console template.
 *
 * This file owns the routing tree — fork and edit it. The building blocks
 * imported from @object-ui/app-shell (ConsoleShell, AuthenticatedRoute,
 * Default* pages) encapsulate the provider stack and auth guard
 * so you only write JSX.
 *
 * Common customisations:
 *   - add routes: drop a <Route path="/billing" ... /> inside <Routes>
 *   - swap auth: replace <DefaultLoginPage /> with your own component
 *   - skip orgs: <AuthenticatedRoute requireOrganization={false}>
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@object-ui/auth';
import { Toaster } from 'sonner';
import {
  ConsoleShell,
  AuthenticatedRoute,
  SystemRedirect,
  DefaultLoginPage,
  DefaultRegisterPage,
  DefaultForgotPasswordPage,
  DefaultHomeLayout,
  DefaultHomePage,
  DefaultOrganizationsLayout,
  DefaultOrganizationsPage,
  DefaultAppContent,
} from '@object-ui/app-shell';

const AUTH_URL = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;

/** Wraps `DefaultHomeLayout` so the FAB picks up the signed-in user id. */
function HomeRoute() {
  const { user } = useAuth();
  return (
    <DefaultHomeLayout userId={user?.id}>
      <DefaultHomePage />
    </DefaultHomeLayout>
  );
}

export function App() {
  return (
    <AuthProvider authUrl={AUTH_URL}>
      <Toaster position="bottom-right" />
      <BrowserRouter>
        <ConsoleShell>
          <Routes>
            <Route path="/login" element={<DefaultLoginPage />} />
            <Route path="/register" element={<DefaultRegisterPage />} />
            <Route path="/forgot-password" element={<DefaultForgotPasswordPage />} />
            <Route path="/home" element={
              <AuthenticatedRoute>
                <HomeRoute />
              </AuthenticatedRoute>
            } />
            <Route path="/organizations" element={
              <AuthenticatedRoute requireOrganization={false}>
                <DefaultOrganizationsLayout><DefaultOrganizationsPage /></DefaultOrganizationsLayout>
              </AuthenticatedRoute>
            } />
            <Route path="/system/*" element={<SystemRedirect />} />
            <Route path="/apps/:appName/*" element={
              <AuthenticatedRoute>
                <DefaultAppContent />
              </AuthenticatedRoute>
            } />
            {/* This starter lands on the launcher, and routes `/` there
              * itself: objectui#10042 removed the published `/` element, so
              * `/` has exactly one resolver in this repo and it is the
              * console's own. Still guarded (not a bare `ConnectedShell`) so an
              * unauthenticated visitor goes to /login instead of firing a round
              * of doomed 401 `/meta/*` reads first — objectui#4042. */}
            <Route path="/" element={
              <AuthenticatedRoute requireOrganization={false}>
                <Navigate to="/home" replace />
              </AuthenticatedRoute>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConsoleShell>
      </BrowserRouter>
    </AuthProvider>
  );
}

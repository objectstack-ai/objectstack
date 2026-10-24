/**
 * SetupPage — first-run owner-bootstrap surface.
 *
 * Ported from `framework/apps/account/src/routes/setup.tsx`. Renders only
 * when the server reports `hasOwner: false`. Creates the first owner
 * account + names the auto-provisioned personal organization.
 *
 * `useAuth()` doesn't expose bootstrap-status, so we call the REST
 * endpoint directly. Org rename uses `useAuth().updateOrganization()`.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@object-ui/components';
import { withConsoleBase } from '../../utils/consoleBase';
import { browserTimeZone } from '../settings/workspaceTimezonePromptLogic';

const AUTH_BASE = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;

/**
 * Both exits below are FULL-PAGE navigations, and they have to stay that way —
 * `withConsoleBase` fixes where they land, not what kind of navigation they are
 * (objectui#4181).
 *
 * A router `navigate('/')` would keep the SPA alive, and the console's shell is
 * not built to survive an anonymous → owner transition in place:
 * `ConsoleShell.ConnectedShellInner` mounts `MetadataProvider` once auth merely
 * RESOLVES (it deliberately does not gate on `isAuthenticated`, objectui#4042)
 * and keys it on `language` alone. So on a first-run deployment the metadata
 * tree is already mounted, populated by reads that ran with no session, and
 * nothing in its effect deps changes when `signUp()` creates one. The landing
 * resolution the exit hands off to (`RootLandingRedirect.resolveLandingPath`)
 * reads that app list — which would still be the empty anonymous-era one, so a
 * router navigation drops the new owner into an appless console.
 *
 * The permission grant makes it worse: the bootstrap runs off a permission-grant
 * middleware that "may land moments after signUp() resolves" (see handleSubmit),
 * so even a re-fetch raced at exit time is not reliably the owner's world.
 *
 * Tearing the document down is what guarantees the console rebuilds with the
 * session cookie present. It is also what the two sibling auth surfaces already
 * do for the same reason — `LoginPage` and `RegisterPage` both exit through
 * `window.location.assign(withConsoleBase(…))`.
 */
const POST_BOOTSTRAP_EXIT = '/';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function SetupPage() {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const {
    user,
    signUp,
    refreshOrganizations,
    updateOrganization,
    createOrganization,
    switchOrganization,
  } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);

  // Probe bootstrap-status on mount. If an owner already exists, bounce
  // to /login — this page must never be reachable in a normal deployment.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${AUTH_BASE}/bootstrap-status`, {
          credentials: 'include',
        });
        const data: { hasOwner?: boolean } = res.ok
          ? await res.json().catch(() => ({}))
          : {};
        if (!cancelled) setBootstrapped(data.hasOwner === true);
      } catch {
        if (!cancelled) setBootstrapped(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (bootstrapped === true && !user) {
      navigate('/login', { replace: true });
    }
  }, [bootstrapped, user, navigate]);

  useEffect(() => {
    // Already-signed-in visitors bounce home — but NOT mid-submission: signUp
    // flips `user` while handleSubmit is still renaming the bootstrap org, and
    // navigating here killed that in-flight rename (the org silently kept the
    // "Default Organization" name). handleSubmit owns the redirect on success.
    if (user && !submitting) {
      window.location.assign(withConsoleBase(POST_BOOTSTRAP_EXIT));
    }
  }, [user, submitting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signUp(name, email, password);

      // The server bootstraps the owner's organization (plugin-auth's
      // default-org bootstrap in single-org mode; org-scoping's in
      // multi-org) — don't create a second org, RENAME the bootstrap one
      // to the user's chosen name. Two subtleties:
      //   - the bootstrap runs off a permission-grant middleware and may
      //     land moments after signUp() resolves → poll briefly;
      //   - the `organizations` state from useAuth() is a STALE CLOSURE
      //     here (refresh just updated it, but this render can't see it) —
      //     use the list refreshOrganizations() returns. Reading the state
      //     was the bug that made this path silently fall through to
      //     createOrganization(), which single-org mode FORBIDs.
      const trimmedName = orgName.trim();
      if (trimmedName) {
        try {
          let personal: { id?: string } | undefined;
          for (let attempt = 0; attempt < 4 && !personal?.id; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
            const orgs = await refreshOrganizations();
            personal = orgs?.[0];
          }
          // CJK/emoji-only names slugify to '' — an empty slug fails the org
          // update server-side and the whole rename used to be silently
          // swallowed. The rename is about the DISPLAY name: keep the
          // existing slug when there's nothing latin to derive, and mint a
          // stable fallback only when creating from scratch.
          const slug = slugify(trimmedName);
          let activeOrgId: string | undefined;
          if (personal?.id) {
            await updateOrganization(personal.id, {
              name: trimmedName,
              ...(slug ? { slug } : {}),
            });
            activeOrgId = personal.id;
          } else {
            // objectui#11908: a workspace created here takes the creator's
            // browser zone, so its first administrator is not asked for one.
            // No zone, no key: the server keeps its default.
            const timezone = browserTimeZone();
            const created = await createOrganization({
              name: trimmedName,
              slug: slug || `org-${Date.now().toString(36)}`,
              ...(timezone ? { timezone } : {}),
            });
            activeOrgId = created?.id;
          }
          if (activeOrgId) {
            await switchOrganization(activeOrgId).catch(() => undefined);
          }
        } catch (err) {
          // Non-fatal — user can rename / create from settings later.
          console.warn('[setup] organization rename/create failed', err);
        }
      }

      window.location.assign(withConsoleBase(POST_BOOTSTRAP_EXIT));
    } catch (err) {
      toast.error(
        t('auth.setup.failed', { defaultValue: 'Setup failed' }),
        { description: (err as Error).message },
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (bootstrapped === null) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center bg-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted-foreground/20 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle>
              {t('auth.setup.welcomeTitle', { defaultValue: 'Welcome to ObjectStack' })}
            </CardTitle>
            <CardDescription>
              {t('auth.setup.description', {
                defaultValue:
                  'Create the first owner account to finish setting up this deployment.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">
                  {t('auth.setup.yourName', { defaultValue: 'Your name' })}
                </Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="orgName">
                  {t('auth.setup.orgName', { defaultValue: 'Organization name' })}
                </Label>
                <Input
                  id="orgName"
                  required
                  placeholder={t('auth.setup.orgNamePlaceholder', {
                    defaultValue: 'Acme Inc.',
                  })}
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">
                  {t('auth.setup.emailLabel', { defaultValue: 'Email' })}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('auth.setup.emailPlaceholder', { defaultValue: 'name@example.com' })}
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">
                  {t('auth.setup.passwordLabel', { defaultValue: 'Password' })}
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder={t('auth.setup.passwordHint', {
                    defaultValue: 'Minimum 8 characters',
                  })}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="mt-2 w-full" disabled={submitting}>
                {submitting
                  ? t('auth.setup.submitting', { defaultValue: 'Setting up…' })
                  : t('auth.setup.submit', { defaultValue: 'Create owner account' })}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default SetupPage;

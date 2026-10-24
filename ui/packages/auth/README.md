# @object-ui/auth

Authentication system for Object UI — AuthProvider, guards, login/register forms, and token management.

## Features

- 🔐 **AuthProvider Context** - Wrap your app with authentication state and methods
- 🛡️ **AuthGuard** - Protect routes and components from unauthenticated access
- 📝 **Pre-built Forms** - LoginForm, RegisterForm, and ForgotPasswordForm ready to use
- 👤 **UserMenu** - Display authenticated user info with sign-out support
- 🔑 **Auth Client Factory** - `createAuthClient` powered by official [better-auth](https://better-auth.com) client
- 🌐 **Authenticated Fetch** - `createAuthenticatedFetch` for automatic token injection
- 👀 **Preview Mode** - Auto-login with simulated identity for marketplace demos and app showcases
- 🎯 **Type-Safe** - Full TypeScript support with exported types

## Installation

```bash
npm install @object-ui/auth
```

**Peer Dependencies:**
- `react` ^18.0.0 || ^19.0.0

## Quick Start

```tsx
import type { ReactNode } from 'react';
import { AuthProvider, AuthGuard, createAuthClient, useAuth } from '@object-ui/auth';

// Your app supplies the sign-in page shown to unauthenticated visitors.
declare const LoginPage: () => ReactNode;

const authUrl = 'https://api.example.com/auth';
const authClient = createAuthClient({ baseURL: authUrl });

function App() {
  return (
    <AuthProvider authUrl={authUrl} client={authClient}>
      <AuthGuard fallback={<LoginPage />}>
        <Dashboard />
      </AuthGuard>
    </AuthProvider>
  );
}

function Dashboard() {
  const { user, signOut } = useAuth();
  return (
    <div>
      <p>Welcome, {user?.name}</p>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
}
```

## API

### AuthProvider

Wraps your application with authentication context. `authUrl` is **required**;
`client` is optional, and when you pass one it is used instead of the client
`AuthProvider` would otherwise build from `authUrl`:

```tsx
import type { ReactNode } from 'react';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';

declare const authClient: AuthClient;
declare const App: () => ReactNode;

<AuthProvider authUrl="/api/v1/auth" client={authClient}>
  <App />
</AuthProvider>;
```

### useAuth

Hook for accessing auth state and methods:

```tsx
import { useAuth } from '@object-ui/auth';

const {
  user,
  session,
  signIn,
  signOut,
  signUp,
  isAuthenticated,
  isLoading,
  isPreviewMode,
  previewMode,
} = useAuth();
```

| Property | Type | Description |
| --- | --- | --- |
| `user` | `AuthUser \| null` | Current authenticated user |
| `session` | `AuthClientSession \| null` | Current session information |
| `isAuthenticated` | `boolean` | Whether the user is authenticated |
| `isLoading` | `boolean` | Whether auth state is loading |
| `isPreviewMode` | `boolean` | Whether the app is running in preview mode |
| `previewMode` | `PreviewModeOptions \| null` | Preview mode configuration (only set when `isPreviewMode` is true) |
| `signIn` | `(email, password) => Promise` | Sign in with credentials |
| `signOut` | `() => Promise` | Sign out the current user |
| `signUp` | `(name, email, password) => Promise` | Register a new user |

### AuthGuard

Protects children from unauthenticated access:

```tsx
import type { ReactNode } from 'react';
import { AuthGuard, LoginForm } from '@object-ui/auth';

declare const ProtectedContent: () => ReactNode;

<AuthGuard fallback={<LoginForm />}>
  <ProtectedContent />
</AuthGuard>;
```

### LoginForm / RegisterForm / ForgotPasswordForm

Pre-built authentication form components:

```tsx
import { ForgotPasswordForm, LoginForm, RegisterForm } from '@object-ui/auth';

declare const navigate: (to: string) => void;

<LoginForm onSuccess={() => navigate('/dashboard')} />;
<RegisterForm onSuccess={() => navigate('/welcome')} />;
<ForgotPasswordForm onSuccess={() => navigate('/check-email')} />;
```

`labels` is how the forms take translated text, and it reaches the social
provider buttons the server's `/auth/config` turns on: `socialButton`
is a template whose `{provider}` is replaced with the provider's display name
(defaults "Continue with {provider}" on `LoginForm`, "Sign up with {provider}"
on `RegisterForm`), and `orText` is the divider under the buttons (default
"or continue with email").

The divider introduces the email form, so `LoginForm` draws it only while that
form is shown: under SSO-only mode (`features.ssoEnforced`) the buttons stand
alone until "Use a password instead" reveals the form. A host rendering
`SocialSignInButtons` itself omits the divider with `hideDivider` (default
`false`). While the auth config is still loading, `LoginForm`'s header shows
its title and no description, because the description may describe a password
form the server does not offer.

When the server requires email verification, a registration ends in the user's
inbox, and the verification link is the only way back. `verificationCallbackURL`
says where that link lands, e.g. the invitation the user signed up from. It is
sent as better-auth's sign-up `callbackURL` (the same value as the fourth
argument of `useAuth().signUp`). The server accepts only a root-relative path
or an absolute URL on a trusted origin, and refuses a document-relative `./…`
with `INVALID_CALLBACK_URL`, which fails the sign-up. Resolve an SPA route
against its mount first. Omitted, the server default (`/`) applies.

```tsx
import { RegisterForm } from '@object-ui/auth';

declare const navigate: (to: string) => void;

<RegisterForm
  verificationCallbackURL="/_console/accept-invitation/inv_123"
  onVerificationRequired={(email) => navigate(`/verify-email-prompt?email=${encodeURIComponent(email)}`)}
/>;
```

### UserMenu

Displays current user info with avatar and sign-out:

```tsx
import { UserMenu } from '@object-ui/auth';

<UserMenu />;
```

### createAuthenticatedFetch

Creates a fetch wrapper that injects the stored Bearer token (plus
`X-Tenant-ID` and `Accept-Language`) into API requests:

```tsx
import { createAuthenticatedFetch } from '@object-ui/auth';

const authedFetch = createAuthenticatedFetch();

// For fetches whose target URL may come from metadata (an API-call
// action's target), restrict credential injection to the current page's
// origin so the platform token never leaks to third-party hosts:
const sameOriginFetch = createAuthenticatedFetch({ sameOriginOnly: true });
```

### getSessionOwnerChangeCount / subscribeSessionOwnerChange

When the session resolves to a different user than the one this browser last
held, `AuthProvider` drops the previous user's client state (objectui#5664).
That clears storage only. State already derived from that storage and held in
memory, such as the UI language the boot resolved, has to be re-derived by
whoever owns it. These two exports tell that owner a change happened in this
page-load (objectui#10193). The count lets an owner that mounts after the purge
still see it:

```tsx
import { useSyncExternalStore } from 'react';
import { getSessionOwnerChangeCount, subscribeSessionOwnerChange } from '@object-ui/auth';

const ownerChanges = useSyncExternalStore(
  subscribeSessionOwnerChange,
  getSessionOwnerChangeCount,
  getSessionOwnerChangeCount,
);
```

The count lives in memory for one page-load and is never persisted.
`@object-ui/app-shell`'s `useSignedInUserLocale` is the in-repo consumer.

## The `X-Tenant-ID` edge contract

`createAuthenticatedFetch` stamps `X-Tenant-ID` on the requests it wraps. This section is
that header's contract: what it means, who stamps it, who reads it, what a reader may
assume, and the one window in which it is not sent at all.

It is written down because **a grep cannot answer any of those questions from this
repository.** The header's only non-CORS consumer lives in the **cloud** repository, so a
search confined to this repo and the framework (`objectstack`) finds zero readers and
reads as *"nothing consumes this stamp"*. That reading is what
[objectui#5279](https://github.com/objectstack-ai/objectui/issues/5279) was filed on, and
it is false. Do not act on it.

### What it means

A **routing hint** for the hosting edge — *this request belongs to tenant `<id>`*:

```http
X-Tenant-ID: <better-auth activeOrganizationId>
```

The value is the active **organization** id, the same id the session carries as
`session.activeOrganizationId`. The header is **not** an identity claim, **not** an
authorization input, and **not** what scopes rows.

### Who stamps it

| | |
| --- | --- |
| Stamped by | `createAuthenticatedFetch` ([`src/createAuthenticatedFetch.ts`](src/createAuthenticatedFetch.ts)) |
| Value read from | `ActiveOrganizationStorage` ([`src/ActiveOrganizationStorage.ts`](src/ActiveOrganizationStorage.ts)) — `localStorage`, key `auth-active-organization-id:u:$userId` (per-user since objectui#5664; the bare key is the retired pre-#5664 spelling) |
| Condition | that storage holds a non-empty value |
| *Not* conditioned on | the URL being an `/api/` call. `Authorization` and `Accept-Language` are; this is not |
| Suppressed by | `createAuthenticatedFetch({ sameOriginOnly: true })` for cross-origin URLs — it returns before any header work |
| Precedence | overwrites an `X-Tenant-ID` the caller passed in `init.headers` |

`ActiveOrganizationStorage` has exactly one writer, [`AuthProvider`](src/AuthProvider.tsx):

| Event | Effect |
| --- | --- |
| `refreshOrganizations` — after `getSession` &rarr; `listOrganizations` &rarr; `getActiveOrganization` resolves (including the ADR-0081 single-membership repair) | set |
| `switchOrganization` — the org switcher | set, or clear when the server returns no org |
| `deleteOrganization` / `leaveOrganization`, when the active org is the one going away | clear |
| sign-out | clear |

### Who reads it

**The cloud edge — yes.** The non-test readers are recorded on objectui#5279:
`packages/service-tenant/src/tenant-context.ts` (header resolution) and
`packages/tenant-router/src/spec/turso-multi-tenant.zod.ts`, both in the `cloud`
repository. That repository is not readable from this one, so those paths are cited as the
recorded reading rather than re-derived here.

**Its configuration contract, though, IS readable from here**, because this package
depends on `@objectstack/spec`. `TenantRoutingConfigSchema` (`@objectstack/spec/cloud`) is
what configures a tenant resolver; parsing an empty config on the version this package
resolves today (17.1.0) yields:

```text
enabled:               false
identificationSources: ["subdomain", "header", "jwt_claim"]
tenantHeaderName:      "X-Tenant-ID"
jwtOrganizationClaim:  "organizationId"
```

Two consequences matter to a client author:

- **The header name is configurable.** `X-Tenant-ID` is its default, not a constant.
- **The header is one of six identification sources** (`subdomain`, `custom_domain`,
  `header`, `jwt_claim`, `session`, `default`), and in the default precedence it ranks
  **second, behind `subdomain`**. On a subdomain-routed deployment it is not the thing
  that picks the tenant, and a deployment may leave it out of `identificationSources`
  entirely.

**The framework (`objectstack`) — no.** `resolveAuthzContext`
(`packages/core/src/security/resolve-authz-context.ts`) derives `tenantId` from the
API-key principal or from `session.activeOrganizationId`, and from no header;
`packages/verify/src/harness.org-context.test.ts` pins it — *"`session.activeOrganizationId`
is the ONE field `resolveAuthzContext` reads into `tenantId`"*. Environment and kernel
routing read the hostname and `X-Environment-Id`. The framework's only other mentions are
the CORS preflight allow-list (`DEFAULT_CORS_ALLOW_HEADERS`, whose comment describes
`X-Tenant-ID` / `X-Environment-Id` as what routes "a request to its environment") and
`plugin-sharing`, which records that trusting `x-tenant-id` as identity **was a
vulnerability**: its secure default stopped reading identity from headers because doing so
let a client forge attribution and enumerate or revoke other users' links.

### What a reader may assume

A reader **may**:

- use it to select the tenant database or environment to route to, subject to its own
  `identificationSources` precedence;
- treat it as a hint that may be absent, stale, or contradicted by the session.

A reader **may not**:

- treat it as authenticated identity, or as an authorization decision. It is
  client-controlled — any caller can send any value, and `plugin-sharing` is the recorded
  precedent for what happens to a server that trusts it;
- assume the row scoping it sees downstream came from this header. It did not: the
  framework scopes from the session;
- assume the header is present. See below.

### The unstamped-first-request gap

The stamp reads storage that `AuthProvider` fills only **after** `getSession` &rarr;
`listOrganizations` &rarr; `getActiveOrganization` resolves. Every request that leaves
before that chain completes carries **no** `X-Tenant-ID` at all.

The window opens in five situations:

1. a browser that has never signed in, or whose site data was cleared, including a private
   window;
2. the page load in which the user signs in — from the sign-in response until the
   organization chain resolves;
3. after sign-out, which clears the storage, until a new organization resolves;
4. outside a browser (SSR, tests, a worker), where `localStorage` is unavailable and the
   storage falls back to a per-process in-memory value that starts empty on every cold
   start;
5. a browser where `localStorage` exists but **rejects writes** (Safari private browsing,
   quota exhaustion). There the window never closes — the in-memory fallback is written
   but never read back, because `get()` only falls back when reading itself *throws*, and
   a rejected write leaves reads working and returning `null`. Reported on objectui#5279
   as a separate defect; it is not fixed here.

Case 1 is not theoretical in this codebase: `app-shell`'s `MetadataProvider` issues its
eager `app` metadata fetch inside exactly this window, which is why its first-boot cache
scope needed its own reasoning
([`packages/app-shell/src/providers/MetadataProvider.tsx`](../app-shell/src/providers/MetadataProvider.tsx),
pinned by `MetadataProvider.firstBootOrgScope.test.tsx`).

**What a reader observes in the window:** the header is **absent**, never
present-and-empty. A resolver must fall through to its next configured identification
source — `subdomain` already outranks it by default, with `jwt_claim`, `session` and
`defaultTenantId` behind it — rather than fail closed on the absence. It must also not
cache a routing decision taken inside the window as *the* tenant for the session: the very
next request will normally carry the header.

**Why the gap does not corrupt data scoping.** A response computed inside the window is
still computed for the right tenant, because the framework takes `tenantId` from the
session rather than from the header. The gap is a *routing-input* gap, not a scoping gap.
This is the same reasoning objectui#5243 relied on when it relabelled a metadata cache
entry that had been written in the window.

**Closing the gap is a separate decision, not an omission.** The cloud readers observe the
current behaviour, so changing when the header first appears changes what they see. If it
should be closed, it needs its own card.

## Server Feature Flags (`GET /auth/config`)

`createAuthClient().getConfig()` fetches the server's public auth configuration. The
`features` map on it tells the login surface which capabilities the deployment actually
has, so the UI never renders an entry point whose endpoint is not mounted — `features.sso`
gates the "Sign in with SSO" button, `features.phoneNumberOtp` gates the
verification-code mode, `features.deviceAuthorization` gates the device-approval page,
and so on.

### `features.audiencePosture` — read it beside `emailPassword.disableSignUp`

`features.audiencePosture` reports which audience posture is in force: `invite_only` (the
default when the deployment declares none), `email_domain` or `open`. It is a value, not a
flag, and the server does **not** force `emailPassword.disableSignUp` from it: under
`invite_only` the sign-up route still admits a pending invitee, and a fresh deployment's
first owner. So `disableSignUp: false` on its own does not mean a stranger may register.

A surface that offers a generic sign-up reads both keys. `disableSignUp: true` hides
sign-up outright. Otherwise offer it when the posture is `open` or `email_domain`, or when
the visitor came from an invitation; under `invite_only` say that registration is by
invitation instead of rendering a form the server will refuse. A server that sends no
`audiencePosture` predates the key, and `disableSignUp` alone decides there. The
console's login and register pages are that reader (objectui#11691).

### `features.cloudManaged` — a cloud-managed environment

`features.cloudManaged` is `true` when the cloud's control plane runs the
environment (the objectstack-ai/objectstack#25083 ruling). People then arrive
from the hosting organization through its identity provider, and the server
refuses the doors that add people inside the environment: inviting a member,
importing users, and setting an initial password without platform-admin
standing. Absent or `false` means not managed, and nothing changes.

The console reads it in four places (objectui#13330): Setup → Users shows one
line saying where people are invited and marks a user who holds no permission
set beyond the baseline; the identity import entry on that list is not offered;
the organization members page shows a note instead of Invite member; and the
recovery-password reminder does not show. The `invite_user`, `create_user` and
`set_user_password` actions are hidden by their own served `visible`
predicates, not by console code.

### Reserved flags — advertised by the server, consumed by nothing

Two members of that map are **declared but deliberately not consumed** by this package:

| Flag | Status | What enabling it does in the UI today |
| --- | --- | --- |
| `features.passkeys` | **Reserved** | Nothing. There is no passkey sign-in or registration UI for it to gate. |
| `features.magicLink` | **Reserved** | Nothing. There is neither a magic-link request step nor a route that consumes the emailed token. |

They are typed so the `/auth/config` payload round-trips without loss, not because
anything reads them. **Turning either flag on server-side adds no entry point to the login
page.** If you are enabling one because you expect a button to appear, it will not — and
that is the whole reason this section exists.

Building the two flows is tracked as a separate, unscheduled feature card,
[objectui#4179](https://github.com/objectstack-ai/objectui/issues/4179). Documenting them
as reserved rather than building them now follows the maintainer's ruling on
[objectui#2514](https://github.com/objectstack-ai/objectui/issues/2514): mark them
reserved today, build the UI when the login surface gets roadmap time, at which point it
renders driven by these same flags. When that lands, this section retires with it.

`features.twoFactor` is **not** in this category, despite also not being read by
`LoginForm`. Two-factor authentication is implemented here (`enableTwoFactor` /
`verifyTwoFactor` on the auth client) and its challenge is driven by server-side
remediation rather than by the flag, so the login form ignoring the flag is the design,
not a gap.

## Preview Mode

Preview mode allows visitors (e.g. marketplace customers) to explore the platform without registering or logging in. The `AuthProvider` auto-authenticates with a simulated user identity and bypasses login/registration screens.

This capability is host-supplied and has no `@objectstack/spec` anchor. It aligned with `PreviewModeConfig` from `@objectstack/spec/kernel` until that symbol was retired upstream (objectstack#11846), which removed it together with the `RuntimeMode` value `'preview'`; the spec this package resolves no longer exports it. The `previewMode` prop below is unaffected — it is the host's to supply, and always was.

### Usage

```tsx
import type { ReactNode } from 'react';
import { AuthProvider, PreviewBanner } from '@object-ui/auth';

declare const Dashboard: () => ReactNode;

function App() {
  return (
    <AuthProvider
      authUrl="/api/v1/auth"
      previewMode={{
        simulatedRole: 'admin',
        simulatedUserName: 'Demo Admin',
        readOnly: false,
        bannerMessage: 'You are exploring a demo — data will be reset periodically.',
      }}
    >
      <PreviewBanner />
      <Dashboard />
    </AuthProvider>
  );
}
```

### PreviewModeOptions

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `autoLogin` | `boolean` | `true` | Auto-login as simulated user, skipping login/registration pages |
| `simulatedRole` | `'admin' \| 'user' \| 'viewer'` | `'admin'` | Permission role for the simulated preview user |
| `simulatedUserName` | `string` | `'Preview User'` | Display name for the simulated preview user |
| `readOnly` | `boolean` | `false` | Restrict the preview session to read-only operations |
| `expiresInSeconds` | `number` | `0` | Preview session duration in seconds (0 = no expiration) |
| `bannerMessage` | `string` | — | Banner message displayed in the UI during preview mode |

### PreviewBanner

A component that renders a status banner when preview mode is active. Shows `bannerMessage` from the preview config, or a default message.

```tsx
import { PreviewBanner } from '@object-ui/auth';

// Only renders when isPreviewMode is true
<PreviewBanner />
```

### Detecting Preview Mode

Use the `useAuth` hook to check if the app is in preview mode:

```tsx
import { useAuth } from '@object-ui/auth';

function MyComponent() {
  const { isPreviewMode, previewMode } = useAuth();

  if (isPreviewMode && previewMode?.readOnly) {
    // Disable write operations
  }

  return <div>...</div>;
}
```

> **⚠️ Security:** Preview mode should **never** be used in production environments.

## Links

- 📦 [npm package](https://www.npmjs.com/package/@object-ui/auth)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).

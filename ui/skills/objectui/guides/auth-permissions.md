# ObjectUI Auth & Permissions

Authentication and authorization for an ObjectUI app. The auth system is built on two independent but composable packages: `@object-ui/auth` and `@object-ui/permissions`.

## Architecture

```
┌────────────────────────────────┐
│  AuthProvider                  │  ← Authentication state
│  ├── PermissionProvider        │  ← RBAC evaluation
│  │   └── App Content           │
│  │       └── AuthGuard         │  ← Route protection
│  │           └── Pages         │
```

Each provider is optional. Use only what you need.

## Authentication (`@object-ui/auth`)

### AuthProvider setup

```typescript
import { AuthProvider, createAuthClient } from '@object-ui/auth';

const authClient = createAuthClient({ baseURL: '/api/v1/auth' });

function App() {
  return (
    <AuthProvider authUrl="/api/v1/auth" client={authClient}>
      <AppContent />
    </AuthProvider>
  );
}
```

### useAuth hook

Guard `user` on its own, not through `isAuthenticated`: in guest mode (`enabled: false`) and in preview mode, `AuthProvider` hardcodes `isAuthenticated` to `true` while `user` stays `null`, so a signed-in-looking context can still carry no user. The shipped `UserMenu` guards both members the same way.

```typescript
import { useAuth } from '@object-ui/auth';

function UserBadge() {
  const { user, isAuthenticated, isLoading, error, signOut } = useAuth();

  if (isLoading) return <Spinner />;
  if (!isAuthenticated || !user) return <LoginButton />;

  return (
    <div>
      <span>Hello {user.name}</span>
      <Button onClick={signOut}>Log out</Button>
    </div>
  );
}
```

### AuthUser type

<!-- os:check -->
```typescript
import type { AuthUser } from '@object-ui/auth';

// Imported, not re-declared. The old fence here kept a private copy of this
// type; the copy could not drift loudly, so it went on teaching a member the
// package had already retired. An import cannot do that: a member that goes
// away upstream stops compiling here on the day it goes.
function isTenantAdmin(user: AuthUser): boolean {
  return user.tenantId !== undefined && (user.positions ?? []).includes('admin');
}
```

`AuthUser` extends the spec's `IAuthService` principal — `id`, `email`, `name`,
plus the `positions` / `tenantId` an authorization decision reads — and adds the
display-only fields better-auth returns to the client: `image`, `role`,
`emailVerified`. The index signature (`[key: string]: unknown`) is deliberate:
better-auth projects an app's own user columns onto this object, and no local
type can enumerate them.

⛔ **There is no `roles` member.** The hand-copied `roles?: string[]` mirror was
RETIRED (maintainer ruling 2026-08-22) once its last reader —
`AuthGuard`'s `requiredRoles` check — moved to `positions`. Framework ADR-0090
D3 renamed `roles` → `positions` with no deprecation window, and the protocol-17
session face emits no `roles` key at all. Reading `user.roles` now resolves
through the index signature as `unknown` rather than as `string[]`. ⛔ Do not
re-declare it, and do not re-emit it as a compatibility shadow of `positions`.

### AuthGuard (route protection)

```typescript
import { AuthGuard } from '@object-ui/auth';

function ProtectedRoutes() {
  return (
    <AuthGuard fallback={<LoginPage />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </AuthGuard>
  );
}
```

### Pre-built UI components

```typescript
import { LoginForm, RegisterForm, ForgotPasswordForm, UserMenu } from '@object-ui/auth';

// LoginForm includes email/password fields, social login buttons, forgot password link
<LoginForm onSuccess={() => navigate('/dashboard')} />

// UserMenu shows user avatar, name, role with dropdown for profile/settings/logout
<UserMenu />
```

### Authenticated data fetching

Connect auth tokens to the DataSource layer:

```typescript
import { createAuthenticatedFetch, createAuthClient } from '@object-ui/auth';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

const authClient = createAuthClient({ baseURL: '/api/v1/auth' });
const authenticatedFetch = createAuthenticatedFetch();

const dataSource = new ObjectStackAdapter({
  baseUrl: '/api/v1',
  fetch: authenticatedFetch,  // Bearer token injected on every request
});
```

## Permissions (`@object-ui/permissions`)

### PermissionProvider setup

<!-- os:check -->
```typescript
import { PermissionProvider } from '@object-ui/permissions';
import { useAuth } from '@object-ui/auth';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
declare function AppContent(): null; // stands in for your own app tree

// A role definition carries identity and inheritance only. Its grants live in
// `ObjectPermissionConfig.roles` below, keyed by object — that is the single
// wired home for "what may this role do".
const roles: RoleDefinition[] = [
  { name: 'admin', label: 'Administrator' },
  { name: 'viewer', label: 'Viewer', inherits: ['base'] },  // Role inheritance
];

const permissions: ObjectPermissionConfig[] = [
  {
    object: 'contacts',
    publicAccess: ['read'],  // Public actions (no auth needed)
    // `roles` is required, and it is the level that decides *who* a rule
    // applies to. Field and row rules nest under the role name; they carry
    // no `roles` member of their own.
    roles: {
      admin: {
        actions: ['create', 'read', 'update', 'delete', 'export'],
      },
      viewer: {
        actions: ['read'],
        // Only admin sees salary: the restriction is declared on the role
        // it restricts, and admin simply has no entry for the field.
        fieldPermissions: [{ field: 'salary', read: false, mask: '****' }],
      },
      owner: {
        actions: ['read', 'update', 'delete'],
        // `filter` is a string, and it is handed back to you verbatim.
        rowPermissions: [
          { filter: 'ownerId = ${user.id}', actions: ['update', 'delete'] },
        ],
      },
    },
  },
  {
    object: 'orders',
    roles: {
      admin: { actions: ['create', 'read', 'update', 'delete'] },
      viewer: { actions: ['read'] },
    },
  },
];

function App() {
  const { user } = useAuth();
  return (
    <PermissionProvider
      roles={roles}
      permissions={permissions}
      userRoles={user?.positions || ['viewer']}
      user={user ?? undefined}
    >
      <AppContent />
    </PermissionProvider>
  );
}
```

The keys under `roles` are matched against the `userRoles` you pass to the
provider (after inheritance is expanded through the `roles` array), so a grant
key such as `owner` above works whether or not it also has a `RoleDefinition`
entry — the definitions array is read only to expand `inherits`.

### Row filters are returned verbatim — nothing interpolates them

`RowLevelPermission.filter` is a **string**, not a filter object, and
`@object-ui/permissions` performs no interpolation on it anywhere. `check()`
returns it as `rowFilter` and `getRowFilter()` returns it unchanged; the
package has no substitution step at all.

So a placeholder like `${user.id}` is **not** resolved for you. It arrives at
your code exactly as written, and it is the caller's job either to substitute
it — using whatever user scope that caller has — or to forward the string to a
backend that understands the placeholder itself. This is also not a
`SchemaRenderer` expression, so the expression scope described later in this
guide does not govern it; the two look alike and are unrelated.

### usePermissions hook

<!-- os:check -->
```tsx
import { usePermissions } from '@object-ui/permissions';
import { Button } from '@object-ui/components';

function ContactActions({ contact }: { contact: { salary?: number } }) {
  const { can, checkField, getFieldPermissions, getRowFilter } = usePermissions();

  // Gate on `can`, which answers a boolean. `check` answers `{ allowed, … }`, and
  // an object is truthy, so gated on it both buttons render for a denied user
  // too; its `record` argument reads no field of the record, so none is passed.
  // `: boolean` is what makes a `check(...)` here fail to compile.
  const canEdit: boolean = can('contacts', 'update');
  const canDelete: boolean = can('contacts', 'delete');
  const canSeeSalary = checkField('contacts', 'salary', 'read');

  return (
    <div>
      {canEdit && <Button>Edit</Button>}
      {canDelete && <Button variant="destructive">Delete</Button>}
      {canSeeSalary && <span>Salary: {contact.salary}</span>}
    </div>
  );
}
```

### Permission evaluation pipeline

When `check(object, action, record?)` is called:

1. Check `publicAccess` — if action is public, allow immediately
2. Resolve effective roles (with inheritance chain)
3. Check role-based action permissions
4. If record provided + row permissions exist: evaluate row-level filter
5. Return `{ allowed, fieldRestrictions?, rowFilter?, reason? }`

### PermissionGuard component

```typescript
import { PermissionGuard } from '@object-ui/permissions';

function AdminPanel() {
  return (
    <PermissionGuard object="contacts" action="delete" fallback="custom" fallbackContent={<AccessDenied />}>
      <BulkDeleteButton />
    </PermissionGuard>
  );
}
```

### Schema-level visibility with expressions

Combine permissions with expression-based visibility. The names an expression can
read are the ones the **host published**: `PredicateScopeProvider` is that
channel, and every key of the `scope` you hand it becomes a root — so the gate
below works on a page whose host published `userRole`, and on no other.

<!-- os:check -->
```json
{
  "type": "button",
  "label": "Delete Selected",
  "hidden": "${userRole !== 'admin'}"
}
```

For more complex permission checks, publish the derived permission flags on that
same scope. Publish `can(...)`, which answers a **boolean** — `check(...)` answers
a `{ allowed, … }` result object, and an object is truthy, so a flag derived from
it makes `${!flag}` permanently `false` and shows the button to everyone:

<!-- os:check -->
```tsx
import { usePermissions } from '@object-ui/permissions'
import { PredicateScopeProvider, SchemaRenderer } from '@object-ui/react'
import type { SchemaRendererProps } from '@object-ui/react'

declare const schema: SchemaRendererProps['schema']

function ContactsPage() {
  const permissions = usePermissions()
  const scope = {
    canEditContacts: permissions.can('contacts', 'update'),
    canDeleteContacts: permissions.can('contacts', 'delete'),
  }

  return (
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={schema} />
    </PredicateScopeProvider>
  )
}
```

Then in schema — read each flag by the name you published it under:
<!-- os:check -->
```json
{
  "type": "button",
  "label": "Delete",
  "hidden": "${!canDeleteContacts}"
}
```

⛔ `SchemaRendererProvider`'s `dataSource` is **not** where those names come from.
It carries the host's `DataSource` **adapter** — the object data renderers call
`find()` on. The renderer used to publish that adapter under the expression root
`data`; an adapter answers no `data.*` path an author would write, so that root
was silently constant for every conformant host, and it has been removed
(maintainer ruling 2026-09-13). Inject the adapter for CRUD, publish a scope for
expressions — two channels, on purpose.

### Expression scope: which roots resolve

`SchemaRenderer` evaluates every schema expression against the scope the host
published, plus the roots this tier answers itself:

| Root | Comes from | Example |
|---|---|---|
| every key of `scope` | the host's `PredicateScopeProvider` | `${canDeleteContacts}` |
| `user` / `current_user` | the same channel — app-shell's `ExpressionProvider` already feeds it | `${user.id}` |
| `features` | the same channel, from `ExpressionProvider` | `${features.multiOrgEnabled}` |
| `record` | the row a record surface is bound to, when there is one — ADR-0089 D3 makes `record` the runtime-layer row root | `${record.status}` |
| `page` | `PageSchema.variables`, inside a Page | `${page.selectedId}` |

The ambient roots exist only while a host scope is mounted — `ExpressionProvider`
supplies them (it also aliases the signed-in user as `ctx.user` and `os.user`).
With no host scope mounted, `record` and `page` are all you get. `data` is a root
only when **you** publish one under that name, like any other key of `scope`.

**A name nothing published does not fail loudly — and the two layers that read
`${…}` fail differently.** Measured on `@object-ui/core`'s built evaluator
over `hidden: "${!canDeleteContacts}"`:

| what the scope holds | `hidden` verdict | button on screen |
|---|---|---|
| `canDeleteContacts: true`, published as a root | `false` | shown |
| nothing published under that name | **fails soft to `true`** | hidden for *every* user |

So a gate whose flag never reached the scope hides the button for everyone,
including the users who do hold the permission. Because the result no longer
depends on the flag, flipping the user's permission to test it produces no change
at all, and the most natural way to debug it gives no signal — a
`… is not defined` console line is the only one, and the node-gate diagnostic
warns. Spelled `visible` the same miss flips the other way and the node is shown
to everyone. A text key does not fail soft at all: `content` hands back the
characters you typed, so a missing root renders the literal `${…}` on screen. The
same applies to `disabled` and any other expression-valued key.

## Multi-tenancy

There is no client-side tenancy layer. Tenant scoping is server-enforced
from the session, not from a header: `createAuthenticatedFetch`
(`@object-ui/auth`) does stamp the active organization as `X-Tenant-ID` on
requests, but that header is an edge routing hint, not identity — see
`packages/auth/README.md`, "The `X-Tenant-ID` edge contract", for what it may
and may not be trusted for. Per-tenant branding is a `ThemeSchema` concern
(see the theming guide), not an auth concern.

## Provider composition pattern

Here's the typical nesting order for a full-featured app:

```typescript
<BrowserRouter>
  <AuthProvider authUrl="/api/v1/auth" client={authClient}>
    <PermissionProvider roles={roles} permissions={perms} userRoles={userRoles}>
      <SchemaRendererProvider dataSource={authenticatedDataSource}>
        <AuthGuard fallback={<LoginPage />}>
          <AppShell>
            <Routes>...</Routes>
          </AppShell>
        </AuthGuard>
      </SchemaRendererProvider>
    </PermissionProvider>
  </AuthProvider>
</BrowserRouter>
```

## Common mistakes

- Nesting PermissionProvider outside AuthProvider — userRoles can't be resolved from auth state.
- Using `hidden` expressions for security — they only hide UI elements. Always enforce permissions server-side.
- Forgetting `createAuthenticatedFetch` — API calls go without Bearer token, getting 401 errors.
- Hardcoding role checks in JSX instead of using PermissionGuard or usePermissions.
- Not providing fallback UI for AuthGuard/PermissionGuard — users see blank screens.

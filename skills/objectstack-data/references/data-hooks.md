# Data Lifecycle Hooks — Reference

Reference companion to `objectstack-data/SKILL.md`. Comprehensive guide to
the 8 data lifecycle events, registration modes (inline `handler` **and**
sandboxed `body`), the `HookContext` API, and common patterns (validation,
defaults, audit logging, workflows).


# Writing Hooks — ObjectStack Data Lifecycle

Expert instructions for third-party developers to write data lifecycle hooks in ObjectStack.
Hooks are the primary extension point for adding custom business logic, validation rules,
side effects, and data transformations to CRUD operations.

---

## When to Use This Skill

- You need to **add custom validation** beyond declarative rules.
- You want to **enrich data** (set defaults, calculate fields, normalize values).
- You need to trigger **side effects** (send emails, update external systems, publish events).
- You want to **enforce business rules** that span multiple fields or objects.
- You need to **transform data** before or after database operations.
- You want to **integrate with external APIs** during data operations.
- You need to **implement audit trails** or compliance requirements.

---

## Core Concepts

### What Are Hooks?

Hooks are **event handlers** that execute during the ObjectQL data access lifecycle.
They intercept operations at specific points (before/after) and can:

- **Read** the operation context (user, session, input data)
- **Modify** input parameters or operation results
- **Validate** data and throw errors to abort operations
- **Trigger** side effects (notifications, integrations, logging)

### Hook Lifecycle Events

ObjectStack provides **8 lifecycle events** organized by operation type:

| Event | When It Fires | Use Cases |
|:------|:--------------|:----------|
| **Read Operations** | | |
| `beforeFind` | Before any read — `find` **and** `findOne` | Filter queries by user context, log access |
| `afterFind` | After any read — `find` **and** `findOne` | Transform results, enrich data |
| **Write Operations** | | |
| `beforeInsert` | Before creating a record | Set defaults, validate, normalize |
| `afterInsert` | After creating a record | Send notifications, create related records |
| `beforeUpdate` | Before updating a record (single **or** bulk `multi:true`) | Validate changes, check permissions |
| `afterUpdate` | After updating a record (single **or** bulk) | Trigger workflows, sync external systems |
| `beforeDelete` | Before deleting a record (single **or** bulk `multi:true`) | Check dependencies, prevent deletion |
| `afterDelete` | After deleting a record (single **or** bulk) | Clean up related data, notify users |

> **Why only 8?** The read events fire for `findOne` as well as `find` (the event
> attaches to record materialization, not the engine method), so one subscription
> covers every read shape — there is no `beforeFindOne`/`afterFindOne`. Likewise the
> write events fire on bulk `multi:true` operations (the row-scoping predicate is in
> `ctx.input.ast`), so there is no `*Many` event. And there is no `beforeCount`/
> `beforeAggregate`: read authorization and row filtering belong to **RLS / permission
> rules**, and field masking to **field-level metadata** — declarative mechanisms that
> apply everywhere, rather than a hook every author must remember to re-attach.

### Before vs After Hooks

| Aspect | `before*` Hooks | `after*` Hooks |
|:-------|:----------------|:---------------|
| **Purpose** | Validation, enrichment, transformation | Side effects, notifications, logging |
| **Can modify** | `ctx.input` (mutable) | `ctx.result` (mutable) |
| **Can abort** | Yes (throw error → rollback) | No (operation already committed) |
| **Transaction** | Within transaction | After transaction (unless async: false) |
| **Error handling** | Aborts operation by default | Logged by default (configurable) |

---

## Hook Definition Schema

Every hook must conform to the `HookSchema`:

```typescript
import { Hook, HookContext } from '@objectstack/spec/data';

const myHook: Hook = {
  // Required: Unique identifier (snake_case)
  name: 'my_validation_hook',

  // Required: Target object(s)
  object: 'account',  // string | string[] | '*'

  // Required: Events to subscribe to
  events: ['beforeInsert', 'beforeUpdate'],

  // Required: Handler function (inline or string reference)
  handler: async (ctx: HookContext) => {
    // Your logic here
  },

  // Optional: Execution priority (lower runs first)
  priority: 100,  // System: 0-99, App: 100-999, User: 1000+

  // Optional: Run in background (after* events only)
  async: false,

  // Optional: Conditional execution
  condition: "status = 'active' AND amount > 1000",

  // Optional: Human-readable description
  description: 'Validates account data before save',

  // Optional: Error handling strategy
  onError: 'abort',  // 'abort' | 'log'

  // Optional: Execution timeout (ms)
  timeout: 5000,

  // Optional: Retry policy
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 1000,
  },
};
```

### Key Properties Explained

#### `object` — Target Scope

```typescript
// Single object
object: 'account'

// Multiple objects
object: ['account', 'contact', 'lead']

// All objects (use sparingly — performance impact)
object: '*'
```

#### `events` — Lifecycle Events

```typescript
// Single event
events: ['beforeInsert']

// Multiple events (common pattern)
events: ['beforeInsert', 'beforeUpdate']

// After events for side effects
events: ['afterInsert', 'afterUpdate', 'afterDelete']
```

#### `handler` — Implementation

Handlers can be:

1. **Inline functions** (recommended for simple hooks):
   ```typescript
   handler: async (ctx: HookContext) => {
     if (!ctx.input.email) {
       throw new Error('Email is required');
     }
   }
   ```

2. **String references** (for registered handlers):
   ```typescript
   handler: 'my_plugin.validateAccount'
   ```

#### `priority` — Execution Order

Lower numbers execute first:

```typescript
// System hooks (framework internals)
priority: 50

// Application hooks (your app logic)
priority: 100  // default

// User customizations
priority: 1000
```

#### `async` — Background Execution

Only applicable for `after*` events:

```typescript
// Blocking (default) — runs within transaction
async: false

// Fire-and-forget — runs in background
async: true
```

**When to use async: true:**
- Sending emails/notifications
- Calling slow external APIs
- Logging to external systems
- Non-critical side effects

**When to use async: false:**
- Creating related records
- Updating dependent data
- Critical consistency requirements

#### `condition` — Declarative Filtering

Skip handler execution if condition is false:

```typescript
// Only run for high-value accounts
condition: "annual_revenue > 1000000"

// Only run for specific statuses
condition: "status IN ('pending', 'in_review')"

// Complex conditions
condition: "type = 'enterprise' AND region = 'APAC' AND is_active = true"
```

#### `onError` — Error Handling

```typescript
// Abort operation on error (default for before* hooks)
onError: 'abort'

// Log error and continue (default for after* hooks)
onError: 'log'
```

---

## Sandboxed Hook Bodies (`body`) — What the Sandbox `ctx` Can Call

A hook can carry its logic in one of two shapes. Everything above this point
showed the inline **`handler`** function; the section below documents the
**`body`** form — the one a metadata-only runtime actually executes, and the one
that was previously undocumented (you had to reverse-engineer
`@objectstack/runtime` to use it).

### `body` (sandboxed) vs `handler` (inline) — pick one

| | **`body`** — sandboxed script | **`handler`** — inline function |
|:--|:--|:--|
| Shape | `body: { language, source, capabilities }` (pure metadata) | `handler: async (ctx) => { … }` |
| Runs in | An isolated **QuickJS VM** (edge-safe, capability-gated) | The host process (**full Node**) |
| Ships as | Plain JSON inside the build artifact — travels everywhere | Lowered at build to a string ref + a sibling `.mjs` runtime module |
| Status | **Preferred for new code** | **Deprecated** (`HookSchema`: *"prefer `body`"*) |
| Both present? | Runtime uses **`body`** and ignores `handler` | — |

Because a `body` is pure metadata, it is what AI-authored hooks, Studio-authored
hooks, and any `objectstack build` artifact carry. The rest of this section is
the contract for that sandbox.

### The `body` shape

```jsonc
body: {
  language: 'js',                 // 'js' = L2 sandboxed script | 'expression' = L1 pure formula
  source: "/* function body */",  // the FUNCTION BODY only — not a module
  capabilities: ['api.read', 'api.write', 'log'],  // default: []
  timeoutMs: 250,                 // optional, ≤ 30000 (hook default 250ms, action 5000ms)
  memoryMb: 32,                   // optional, ≤ 256 (best-effort under QuickJS)
}
```

- `source` is the **function body**, which the runtime wraps as
  `(async (ctx) => { <source> })(ctx)`. Write **statements** against `ctx`;
  `await` is allowed.
- In a `before*` hook, change the write by assigning `ctx.input.x = …` **or**
  `return { x: … }` (a returned object is shallow-merged onto `ctx.input`). In an
  `after*` hook the body is for side effects (cross-object writes, logging).
- `language: 'expression'` is a pure CEL formula for a computed value or
  predicate — no IO, no `ctx.api`.

### What lives on the sandbox `ctx`

The sandbox is handed a **JSON snapshot** of these (built by
`buildSandboxContext`), not live engine objects:

| `ctx.*` | Shape | Notes |
|:--|:--|:--|
| `ctx.input` | object | The write payload (mutable). On update, only the **changed** fields plus `id`. |
| `ctx.previous` | object \| `undefined` | Pre-write record on update/delete. **`undefined` on insert** → use `!ctx.previous` to detect *create*. |
| `ctx.result` | object \| `undefined` | `after*` only. ⚠️ **partial** on afterUpdate — see gotcha 1. |
| `ctx.user` | object \| `undefined` | `{ id, name, email, organizationId }`. `undefined` for system / unauthenticated writes. |
| `ctx.session` | object \| `undefined` | `{ userId, organizationId, roles, … }`. |
| `ctx.event` | string | e.g. `'afterUpdate'` — dispatch on it when one hook subscribes to several events. |
| `ctx.object` | string | The target object name. |
| `ctx.api` | object | Cross-object CRUD. Gated by `api.read` / `api.write` — see below. |
| `ctx.log` | `{ info, warn, error }` | Gated by `log`. Call **`ctx.log.info(msg, data?)`** — `ctx.log` is an **object, not** callable as `ctx.log(msg)`. Emission is **best-effort** (see Troubleshooting). |
| `ctx.crypto` | `{ randomUUID }` | Gated by `crypto.uuid`. |

(Action bodies additionally receive `ctx.recordId` and `ctx.record`, and their
wrap is `(async (input, ctx) => { … })(input, ctx)` — the action params arrive as
the first arg.)

Because the VM only holds a snapshot, mutating `ctx.previous` / `ctx.result` is
local and thrown away; the only way to change the persisted write is
`ctx.input.x = …` or `return { … }`.

### `ctx.api.object(name)` — the cross-object repo

`ctx.api.object('<object>')` returns a repository bound to the current
org / user / transaction. Methods:

| Method | Capability | Call |
|:--|:--|:--|
| `find(opts)` | `api.read` | `find({ where: { … }, fields, sort, limit })` → array |
| `findOne(opts)` | `api.read` | `findOne({ where: { id } })` → record \| `null` |
| `count(opts)` | `api.read` | `count({ where: { … } })` → number |
| `insert(data)` | `api.write` | `insert({ … })` |
| `update(data, opts?)` | `api.write` | **`update({ id, ...fields })`** — put the id **inside** `data` |
| `upsert(data, opts?)` | `api.write` | `upsert({ … })` |
| `delete(opts)` | `api.write` | `delete({ where: { id } })` |

**Query shape — the key is `where`.** It takes an object with `$`-operators, the
same DSL as the [objectstack-query](../../objectstack-query/SKILL.md) skill:

```js
await ctx.api.object('candidate').findOne({ where: { id: ctx.result.id } });
await ctx.api.object('candidate').find({ where: { stage: 'hired' } });
await ctx.api.object('invoice').count({ where: { amount: { $gte: 1000 } } });
await ctx.api.object('task').find({ where: { $and: [{ done: false }, { owner: uid }] } });
```

> `filter:` is tolerated as an **object-valued** alias (normalised to `where`),
> but prefer `where`. Do **not** pass an array-of-triples such as
> `[['id', '=', x]]` — that is not a supported value shape and silently matches
> nothing.

**Update by id.** `update` reads the primary key out of `data`, so the
single-record form is `update({ id, ...fieldsToChange })` — e.g.
`update({ id: pos, status: 'filled' })`.

### Capabilities — the complete list

A body may only touch a `ctx` API it declared in `capabilities`. Calling an
undeclared one **throws inside the VM** — `capability '<token>' not granted to
hook '<name>' …` — which surfaces as a hook error (see Troubleshooting). The full
set of legal tokens (`HookBodyCapability`) is exactly six:

| Token | Unlocks |
|:--|:--|
| `api.read` | `ctx.api.object(n).find` / `findOne` / `count` / `aggregate` |
| `api.write` | `ctx.api.object(n).insert` / `update` / `delete` / `upsert` |
| `api.transaction` | `ctx.api.transaction(async () => { … })` — runs the callback's `ctx.api` ops in **one driver transaction** (commit on return, rollback on throw). Pair it with `api.write`. |
| `crypto.uuid` | `ctx.crypto.randomUUID()` |
| `crypto.hash` | *declared token* for `ctx.crypto.hash(algo, data)` — the current WASM runner wires only `randomUUID`, so don't rely on `hash` yet |
| `log` | `ctx.log.info` / `warn` / `error(msg, data?)` |

There is **no `http.fetch` capability** by design — outbound calls go through
Connector recipes so they stay auditable and replayable.

### Sandbox restrictions

The body runs in an isolated QuickJS VM, **not** Node:

- **Available:** standard JS built-ins — `Date`, `Math`, `JSON`, `Object`,
  `Array`, `String`, `Number`, `RegExp`, `Map`, `Set`, `Promise`, `parseInt`,
  `encodeURIComponent`, … — plus `ctx.*` and `await`.
- **Not available** (verified absent from the QuickJS heap): `console` (use
  `ctx.log`), `fetch` (use Connectors), `setTimeout` / `setInterval`, `URL`,
  `TextEncoder` / `TextDecoder`, `structuredClone`, `atob` / `btoa`, `require`,
  Node modules, the filesystem.
- **Rejected by `objectstack build`:** `import` / `require` / dynamic `import()`,
  `process`, `globalThis`, `eval`, `new Function`, and any **free identifier** —
  a name bound at module scope, e.g. a `const slugify = …` helper sitting next to
  the hook. A `body` must be **self-contained**: inline the helper, or keep that
  hook as a bundled `handler`.

### ⚠️ Gotcha 1 — `ctx.result` is a *partial* record on afterUpdate

On `afterUpdate`, both `ctx.result` and `ctx.input` carry only the fields this
PATCH touched, plus `id`. A field you did **not** write — a lookup FK, a status
you want to branch on — is **absent**, not stale. To read the whole record,
re-query it:

```js
// afterUpdate on `candidate`
const full = await ctx.api.object('candidate').findOne({ where: { id: ctx.result.id } });
// full.position_id is present even though this PATCH only set `stage`.
```

(A declarative `condition` on an un-written field hits the same wall — guard it
with the missing-key-safe `has(record.x)` macro.)

### ⚠️ Gotcha 2 — cross-object writes obey the *target's* sharing model

A hook's `ctx.api.object('other').update(…)` goes through the engine's normal
write path, so it is gated by **`other`'s** permission / sharing rules — not by
whoever is elevated. If the acting user cannot edit the target (e.g. it is
`public_read`), the write throws:

```
FORBIDDEN: insufficient privileges to update <object> <id>
```

**An admin is not automatically exempt** — the gate is `canEdit`, driven by the
sharing model, not a global admin bypass. If a hook must write a target, give the
acting principal edit access to it (sharing rule / permission set), or drive the
write from a system-context automation.

### Copy-paste example — afterUpdate + cross-object update + re-query + capabilities

When a `candidate` is marked `hired`, look up its `position` (a lookup FK that
is **not** in the partial patch) and flip that position to `filled`:

<!-- os:check -->
```typescript
import type { Hook } from '@objectstack/spec/data';

const fillPositionOnHire: Hook = {
  name: 'fill_position_on_hire',
  object: 'candidate',
  events: ['afterUpdate'],
  body: {
    language: 'js',
    source: `
      // afterUpdate → ctx.result is the PARTIAL patch. Gate on the field this
      // write actually set, then re-query for the lookup FK it does NOT carry.
      if (!ctx.result || ctx.result.stage !== 'hired') return;
      const rec = await ctx.api.object('candidate').findOne({ where: { id: ctx.result.id } });
      if (!rec || !rec.position_id) return;
      // Cross-object write — needs the acting user to be able to edit 'position'.
      await ctx.api.object('position').update({ id: rec.position_id, status: 'filled' });
      ctx.log.info('position filled', { position: rec.position_id });
    `,
    capabilities: ['api.read', 'api.write', 'log'],
  },
  onError: 'log',
};

export default fillPositionOnHire;
```

Register it like any hook — add it to `defineStack({ hooks: [fillPositionOnHire] })`
(the `AppPlugin` binds `body` hooks onto the engine automatically).

### Troubleshooting (`[BodyRunner]` log lines)

- **`[BodyRunner] invalid hook.body shape`** *(warn)* — `body` failed
  `HookBodySchema`; the hook is skipped. Check `language` / `source` /
  `capabilities`.
- **`[BodyRunner] sandboxed hook threw`** *(error)* — the body raised. The
  wrapped message names the hook; the usual causes are a missing capability, a
  `FORBIDDEN` cross-object write (gotcha 2), or a `ReferenceError` from a free
  identifier or an unavailable global (e.g. `console`).
- **`ctx.log.*` produced no output** — two independent causes: (1) without the
  `log` capability the call **throws** (surfaces as a hook error); (2) **with** the
  capability it emits only when the runtime wired a logger into the hook context —
  otherwise it is a **silent no-op**. Treat `ctx.log` as best-effort diagnostics,
  not a reliable side-channel or proof a hook ran; to observe an effect, assert on
  the data it writes. (And call `ctx.log.info(msg)` — `ctx.log` is an object, not
  a function, so `ctx.log(msg)` is not callable.)

---

## Hook Context API

> **Sandbox vs in-process.** The `ctx` documented below is the **in-process
> `handler`** context (full Node). A metadata-native **`body`** sees a
> capability-gated *subset* of it inside an isolated VM — see
> [Sandboxed Hook Bodies](#sandboxed-hook-bodies-body--what-the-sandbox-ctx-can-call)
> for exactly what is and isn't available there, including the `where` query
> shape and the `update({ id, … })` pattern.

The `HookContext` passed to your handler provides:

### Context Properties

```typescript
interface HookContext {
  // Immutable identifiers
  id?: string;           // Unique execution ID for tracing
  object: string;        // Target object name (e.g., 'account')
  event: HookEventType;  // Current event (e.g., 'beforeInsert')

  // Mutable data
  input: Record<string, unknown>;    // Operation parameters (MUTABLE)
  result?: unknown;                  // Operation result (MUTABLE, after* only)
  previous?: Record<string, unknown>; // Previous state (update/delete)

  // Execution context
  session?: {
    userId?: string;
    organizationId?: string; // Active org — the single blessed name. Matches the
                             // `organization_id` column + `current_user.organizationId` (RLS).
                             // The former `tenantId` alias was removed in #3290.
    roles?: string[];
    accessToken?: string;
  };

  transaction?: unknown;  // Database transaction handle

  // Engine access
  ql: IDataEngine;       // ObjectQL engine instance
  api?: ScopedContext;   // Cross-object CRUD API

  // User info shortcut (undefined for system / unauthenticated writes)
  user?: {
    id?: string;
    name?: string;
    email?: string;
    organizationId?: string; // Same value as session.organizationId
  };
}
```

### Reading the current organization

The value a hook usually wants when it needs "the current org to filter/scope
by" is the caller's **active organization** — the same value that lives in the
`organization_id` column, in `current_user.organizationId` inside RLS/sharing
predicates, and in seed rows. Read it as **`organizationId`**:

```typescript
// ✅ Blessed — matches columns, RLS `current_user`, and seed data
const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
```

> The former `ctx.session.tenantId` alias was removed in v16 (#3290) — read the
> org under `organizationId`. (The generic driver-layer `execCtx.tenantId` /
> `DriverOptions.tenantId` isolation knob is a separate axis and is unaffected.)

`ctx.user` is the ergonomic shortcut for an authenticated caller; it is
`undefined` for system / unauthenticated writes, so read `ctx.session?.organizationId`
when a hook must work regardless of whether a user resolved.

> **Two isolation axes — don't conflate them.** `organization_id` is
> **org row-scoping**: many organizations share one database and every row
> carries its owning org (`current_user.organizationId` filters reads/writes;
> multi-org needs cloud + `@objectstack/organizations`). That is different from
> **environment / database-per-tenant** isolation (`service-tenant`,
> `driver-turso`), where "tenant" means an entire environment/database and the
> generic driver-layer `tenantId` knob can carry that environment id. The
> object-metadata `tenancy.*` knob configures the *mechanism* (isolation on/off
> + which column); the *value* you read and write is your `organization_id`
> column. Community edition never populates an org, so `organizationId` is
> `undefined` there.

### `input` — Operation Parameters

The structure of `ctx.input` varies by event:

**Insert operations:**
```typescript
// beforeInsert, afterInsert
{
  // All field values being inserted
  name: 'Acme Corp',
  industry: 'Technology',
  annual_revenue: 5000000,
  ...
}
```

**Update operations:**
```typescript
// beforeUpdate, afterUpdate
{
  id: '123',  // Record ID being updated
  // Only fields being changed
  status: 'active',
  updated_at: '2026-04-13T10:00:00Z',
}
```

**Delete operations:**
```typescript
// beforeDelete, afterDelete
{
  id: '123',  // Record ID being deleted
}
```

**Query operations:**
```typescript
// beforeFind, afterFind
{
  query: {
    filter: { status: 'active' },
    sort: [{ field: 'created_at', order: 'desc' }],
    limit: 50,
    offset: 0,
  },
  options: { includeCount: true },
}
```

### `result` — Operation Result

Available in `after*` hooks:

```typescript
// afterInsert
result: { id: '123', name: 'Acme Corp', ... }

// afterUpdate
result: { id: '123', status: 'active', ... }

// afterDelete
result: { success: true, id: '123' }

// afterFind
result: {
  records: [{ id: '1', ... }, { id: '2', ... }],
  total: 150,
}
```

### `previous` — Previous State

Available in update/delete hooks:

```typescript
// beforeUpdate, afterUpdate
ctx.previous: {
  id: '123',
  status: 'pending',  // Old value
  updated_at: '2026-04-01T00:00:00Z',
}

// beforeDelete, afterDelete
ctx.previous: {
  id: '123',
  name: 'Old Account',
  // ... full record state
}
```

### Cross-Object API

Access other objects within the same transaction. `ctx.api.object(name)` is the
same repository in both forms; the canonical query key is **`where`** (see
[Sandboxed Hook Bodies](#sandboxed-hook-bodies-body--what-the-sandbox-ctx-can-call)
for the full method + capability contract). In a sandboxed `body` these calls
additionally require the `api.read` / `api.write` capabilities.

```typescript
handler: async (ctx: HookContext) => {
  // Get API for another object
  const users = ctx.api?.object('user');

  // Query users — `where` is canonical (`filter` is a tolerated object alias)
  const admin = await users.findOne({
    where: { role: 'admin' }
  });

  // Create related record
  await ctx.api?.object('audit_log').insert({
    action: 'account_created',
    user_id: ctx.session?.userId,
    record_id: ctx.input.id,
  });
}
```

---

## Common Patterns

### 1. Setting Default Values

```typescript
const setAccountDefaults: Hook = {
  name: 'account_defaults',
  object: 'account',
  events: ['beforeInsert'],
  handler: async (ctx) => {
    // Set default industry
    if (!ctx.input.industry) {
      ctx.input.industry = 'Other';
    }

    // Set created timestamp
    ctx.input.created_at = new Date().toISOString();

    // Set owner to current user
    if (!ctx.input.owner_id && ctx.session?.userId) {
      ctx.input.owner_id = ctx.session.userId;
    }
  },
};
```

### 2. Data Validation

```typescript
const validateAccount: Hook = {
  name: 'account_validation',
  object: 'account',
  events: ['beforeInsert', 'beforeUpdate'],
  handler: async (ctx) => {
    // Validate email format
    if (ctx.input.email && !ctx.input.email.includes('@')) {
      throw new Error('Invalid email format');
    }

    // Validate website URL
    if (ctx.input.website && !ctx.input.website.startsWith('http')) {
      throw new Error('Website must start with http or https');
    }

    // Check annual revenue
    if (ctx.input.annual_revenue && ctx.input.annual_revenue < 0) {
      throw new Error('Annual revenue cannot be negative');
    }
  },
};
```

### 3. Preventing Deletion

```typescript
const protectStrategicAccounts: Hook = {
  name: 'protect_strategic_accounts',
  object: 'account',
  events: ['beforeDelete'],
  handler: async (ctx) => {
    // ctx.previous contains the record being deleted
    if (ctx.previous?.type === 'Strategic') {
      throw new Error('Cannot delete Strategic accounts');
    }

    // Check for active opportunities
    const oppCount = await ctx.api?.object('opportunity').count({
      filter: {
        account_id: ctx.input.id,
        stage: { $in: ['Prospecting', 'Negotiation'] }
      }
    });

    if (oppCount && oppCount > 0) {
      throw new Error(`Cannot delete account with ${oppCount} active opportunities`);
    }
  },
};
```

### 4. Data Enrichment

```typescript
const enrichLeadScore: Hook = {
  name: 'lead_scoring',
  object: 'lead',
  events: ['beforeInsert', 'beforeUpdate'],
  handler: async (ctx) => {
    let score = 0;

    // Email domain scoring
    if (ctx.input.email?.endsWith('@enterprise.com')) {
      score += 50;
    }

    // Phone number bonus
    if (ctx.input.phone) {
      score += 20;
    }

    // Company size scoring
    if (ctx.input.company_size === 'Enterprise') {
      score += 30;
    }

    // Industry scoring
    if (ctx.input.industry === 'Technology') {
      score += 25;
    }

    ctx.input.score = score;
  },
};
```

### 5. Triggering Workflows

```typescript
const notifyOnStatusChange: Hook = {
  name: 'notify_status_change',
  object: 'opportunity',
  events: ['afterUpdate'],
  async: true,  // Fire-and-forget
  handler: async (ctx) => {
    // Detect status change
    const oldStatus = ctx.previous?.stage;
    const newStatus = ctx.input.stage;

    if (oldStatus !== newStatus) {
      // Send notification (async, doesn't block transaction)
      console.log(`Opportunity ${ctx.input.id} moved from ${oldStatus} to ${newStatus}`);

      // Could trigger email, Slack notification, etc.
      // await sendEmail({
      //   to: ctx.user?.email,
      //   subject: `Opportunity stage changed to ${newStatus}`,
      //   body: `...`
      // });
    }
  },
};
```

### 6. Creating Related Records

```typescript
const createAuditTrail: Hook = {
  name: 'audit_trail',
  object: ['account', 'contact', 'opportunity'],
  events: ['afterInsert', 'afterUpdate', 'afterDelete'],
  async: false,  // Must run in transaction
  handler: async (ctx) => {
    const action = ctx.event.replace('after', '').toLowerCase();

    await ctx.api?.object('audit_log').insert({
      object_type: ctx.object,
      record_id: String(ctx.input.id || ''),
      action,
      user_id: ctx.session?.userId,
      timestamp: new Date().toISOString(),
      changes: ctx.event === 'afterUpdate' ? {
        before: ctx.previous,
        after: ctx.result,
      } : undefined,
    });
  },
};
```

### 7. External API Integration

```typescript
const syncToExternalCRM: Hook = {
  name: 'sync_external_crm',
  object: 'account',
  events: ['afterInsert', 'afterUpdate'],
  async: true,  // Don't block the main transaction
  timeout: 10000,  // 10 second timeout
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 2000,
  },
  handler: async (ctx) => {
    try {
      // Call external API
      // await fetch('https://external-crm.com/api/accounts', {
      //   method: 'POST',
      //   headers: { 'Authorization': 'Bearer ...' },
      //   body: JSON.stringify(ctx.result),
      // });

      console.log(`Synced account ${ctx.input.id} to external CRM`);
    } catch (error) {
      // Error is logged but doesn't abort the operation
      console.error('Failed to sync to external CRM', error);
    }
  },
};
```

### 8. Multi-Object Logic

```typescript
const cascadeAccountUpdate: Hook = {
  name: 'cascade_account_updates',
  object: 'account',
  events: ['afterUpdate'],
  handler: async (ctx) => {
    // If account industry changed, update all contacts
    if (ctx.input.industry && ctx.previous?.industry !== ctx.input.industry) {
      await ctx.api?.object('contact').updateMany({
        filter: { account_id: ctx.input.id },
        data: { account_industry: ctx.input.industry },
      });
    }
  },
};
```

### 9. Conditional Execution

```typescript
const highValueAccountAlert: Hook = {
  name: 'high_value_alert',
  object: 'account',
  events: ['afterInsert'],
  // Only run for high-value accounts
  condition: "annual_revenue > 10000000",
  async: true,
  handler: async (ctx) => {
    console.log(`🚨 High-value account created: ${ctx.result.name}`);
    // Send alert to sales leadership
  },
};
```

### 10. Data Masking (Read Operations)

> For **static** field masking (a field is always hidden/masked for a role),
> prefer declarative **field-level metadata** (secret/masked fields) — it applies
> on every read path automatically. Use an `afterFind` hook only for masking that
> depends on runtime logic the field metadata can't express. A single `afterFind`
> subscription covers both `find` and `findOne`.

```typescript
const maskSensitiveData: Hook = {
  name: 'mask_pii',
  object: ['contact', 'lead'],
  events: ['afterFind'],   // fires for findOne too — no separate afterFindOne
  handler: async (ctx) => {
    // Check user role
    const isAdmin = ctx.session?.roles?.includes('admin');

    if (!isAdmin) {
      // Mask sensitive fields
      const maskField = (record: any) => {
        if (record.ssn) {
          record.ssn = '***-**-' + record.ssn.slice(-4);
        }
        if (record.credit_card) {
          record.credit_card = '**** **** **** ' + record.credit_card.slice(-4);
        }
      };

      if (Array.isArray(ctx.result?.records)) {
        ctx.result.records.forEach(maskField);
      } else if (ctx.result) {
        maskField(ctx.result);
      }
    }
  },
};
```

---

## Registration Methods

### Method 1: Declarative (Stack Definition) — RECOMMENDED

**Best for:** Application-level hooks defined as metadata. The `AppPlugin`
auto-binds these onto the ObjectQL engine at startup — **no `register*Hook`
boilerplate is required**, and all declarative fields (`condition`,
`async`, `retryPolicy`, `timeout`, `onError`, `priority`) are honoured by
the runtime.

```typescript
// objectstack.config.ts
import { defineStack } from '@objectstack/spec';
import taskHook from './objects/task.hook';

export default defineStack({
  manifest: { /* ... */ },
  objects: [/* ... */],
  hooks: [taskHook],  // ← AppPlugin auto-binds; no manual registration needed
});
```

For string-named handlers, declare them under `functions` so the binder
can resolve them:

```typescript
export default defineStack({
  hooks: [
    { name: 'h', object: 'account', events: ['beforeInsert'], handler: 'normalize' },
  ],
  functions: {
    normalize: async (ctx) => { /* ... */ },
  },
});
```

### Method 2: Programmatic (Runtime) — escape hatch

**Best for:** Plugins that need to register hooks dynamically based on
runtime state. Prefer Method 1 unless you actually need imperative
control.

```typescript
// In your plugin's onEnable()
export const onEnable = async (ctx: { ql: ObjectQL }) => {
  ctx.ql.registerHook('beforeInsert', async (hookCtx) => {
    // Handler logic
  }, {
    object: 'account',
    priority: 100,
    packageId: 'my-plugin', // enables clean unregister later
  });
};
```

> Note: hooks registered this way **do not** get the declarative
> `condition` / `retry` / `timeout` / `onError` / `async` semantics —
> those only apply when binding through `defineStack({ hooks })` or
> calling `ql.bindHooks([...])` directly.

### Method 3: Hook Files (Convention)

**Best for:** Organized codebases, per-object hooks.

```typescript
// src/objects/account.hook.ts
import { Hook, HookContext } from '@objectstack/spec/data';

const accountHook: Hook = {
  name: 'account_logic',
  object: 'account',
  events: ['beforeInsert', 'beforeUpdate'],
  handler: async (ctx: HookContext) => {
    // Validation logic
  },
};

export default accountHook;

// Then import and register in objectstack.config.ts
```

---

## Best Practices

### ✅ DO

1. **Use specific events** — Don't subscribe to all events if you only need one.
2. **Keep handlers focused** — One hook = one responsibility.
3. **Use `condition` for filtering** — Avoid unnecessary handler execution.
4. **Set appropriate priorities** — Ensure correct execution order.
5. **Use `async: true` for side effects** — Don't block transactions for non-critical operations.
6. **Validate early** — Use `before*` hooks for validation.
7. **Handle errors gracefully** — Provide meaningful error messages.
8. **Use `ctx.api` for cross-object operations** — Maintains transaction consistency.
9. **Document your hooks** — Use `description` and comments.
10. **Test thoroughly** — Unit test hooks in isolation.

### ❌ DON'T

1. **Don't mutate immutable properties** — `ctx.object`, `ctx.event`, `ctx.id` are read-only.
2. **Don't perform expensive operations in `before*` hooks** — Use `after*` + `async: true` instead.
3. **Don't create infinite loops** — Be careful when hooks modify data that triggers other hooks.
4. **Don't ignore `ctx.previous`** — Essential for detecting changes.
5. **Don't use `object: '*'` unless necessary** — Performance impact.
6. **Don't block on external APIs** — Use `async: true` and proper timeouts.
7. **Don't assume `ctx.session` exists** — System operations may have no user context.
8. **Don't throw in `after*` hooks unless critical** — Use `onError: 'log'` for non-critical errors.
9. **Don't duplicate validation** — Use declarative validation rules when possible.
10. **Don't forget transaction boundaries** — `async: true` runs outside transaction.

---

## Error Handling

### Throwing Errors (Abort Operation)

```typescript
handler: async (ctx) => {
  if (!ctx.input.email) {
    // Aborts operation, rolls back transaction
    throw new Error('Email is required');
  }
}
```

### Logging Errors (Continue)

```typescript
{
  onError: 'log',  // Log error, don't abort
  handler: async (ctx) => {
    try {
      await sendEmail(ctx.input.email);
    } catch (error) {
      // Error is logged, operation continues
      console.error('Failed to send email', error);
    }
  }
}
```

### Custom Error Messages

```typescript
handler: async (ctx) => {
  if (ctx.input.annual_revenue < 0) {
    throw new Error('Annual revenue cannot be negative');
  }

  if (ctx.input.annual_revenue > 1000000000) {
    throw new Error('Annual revenue exceeds maximum allowed value (1B)');
  }
}
```

---

## Testing Hooks

### Unit Testing

```typescript
import { describe, it, expect } from 'vitest';
import { HookContext } from '@objectstack/spec/data';
import accountHook from './account.hook';

describe('accountHook', () => {
  it('sets default industry', async () => {
    const ctx: Partial<HookContext> = {
      object: 'account',
      event: 'beforeInsert',
      input: { name: 'Acme Corp' },
    };

    await accountHook.handler(ctx as HookContext);

    expect(ctx.input.industry).toBe('Other');
  });

  it('validates website URL', async () => {
    const ctx: Partial<HookContext> = {
      object: 'account',
      event: 'beforeInsert',
      input: { website: 'invalid-url' },
    };

    await expect(
      accountHook.handler(ctx as HookContext)
    ).rejects.toThrow('Website must start with http');
  });
});
```

### Integration Testing

```typescript
import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { DriverPlugin } from '@objectstack/runtime';
import { InMemoryDriver } from '@objectstack/driver-memory';

describe('Hook Integration', () => {
  it('executes hook on insert', async () => {
    const kernel = new LiteKernel();
    kernel.use(new ObjectQLPlugin());
    kernel.use(new DriverPlugin(new InMemoryDriver()));

    // Register hook
    const ql = kernel.getService('objectql');
    ql.registerHook('beforeInsert', async (ctx) => {
      ctx.input.created_at = '2026-04-13T10:00:00Z';
    }, { object: 'account' });

    // Test insert
    const result = await ql.object('account').insert({
      name: 'Test Account',
    });

    expect(result.created_at).toBe('2026-04-13T10:00:00Z');

    await kernel.shutdown();
  });
});
```

---

## Performance Considerations

### Hook Execution Overhead

```
Single Record Insert:
┌─────────────────┬──────────────┐
│ Hook Count      │ Overhead     │
├─────────────────┼──────────────┤
│ 0 hooks         │ ~1ms         │
│ 5 hooks         │ ~5ms         │
│ 20 hooks        │ ~20ms        │
└─────────────────┴──────────────┘
```

### Optimization Tips

1. **Use `condition` to filter** — Avoid executing handlers unnecessarily.
2. **Use `async: true` for non-critical side effects** — Don't block transactions.
3. **Batch operations in `after*` hooks** — Reduce database round-trips.
4. **Cache expensive lookups** — Use kernel cache service.
5. **Use specific `object` targets** — Avoid `object: '*'`.

### Anti-Patterns

```typescript
// ❌ BAD: Expensive synchronous operation
{
  events: ['beforeInsert'],
  async: false,
  handler: async (ctx) => {
    await slowExternalAPI(ctx.input);  // Blocks transaction
  }
}

// ✅ GOOD: Async background operation
{
  events: ['afterInsert'],
  async: true,  // Fire-and-forget
  handler: async (ctx) => {
    await slowExternalAPI(ctx.result);
  }
}
```

---

## Advanced Topics

### Dynamic Hook Registration

```typescript
// Register hooks based on configuration
export const onEnable = async (ctx: { ql: ObjectQL }) => {
  const config = await loadConfig();

  config.objects.forEach(objectName => {
    ctx.ql.registerHook('beforeInsert', async (hookCtx) => {
      // Dynamic logic
    }, { object: objectName });
  });
};
```

### Hook Composition

```typescript
// Compose multiple validators
const validators = [
  validateEmail,
  validatePhone,
  validateWebsite,
];

const composedHook: Hook = {
  name: 'validation_suite',
  object: 'account',
  events: ['beforeInsert', 'beforeUpdate'],
  handler: async (ctx) => {
    for (const validator of validators) {
      await validator(ctx);
    }
  },
};
```

### Conditional Hook Execution

```typescript
const conditionalHook: Hook = {
  name: 'enterprise_only',
  object: 'account',
  events: ['afterInsert'],
  handler: async (ctx) => {
    // Check runtime condition
    if (process.env.FEATURE_FLAG_ENTERPRISE !== 'true') {
      return;  // Skip execution
    }

    // Enterprise-specific logic
  },
};
```

---

## Troubleshooting

### Common Issues

**Issue:** Hook not executing

**Solutions:**
1. Check `object` matches target object name
2. Verify `events` includes the expected event
3. Check `condition` doesn't filter out all records
4. Ensure hook is registered before operations

**Issue:** Transaction rollback on `after*` hook error

**Solution:** Set `onError: 'log'` or `async: true`

**Issue:** Infinite loop (hook triggers itself)

**Solution:** Use conditional checks, track execution state

**Issue:** `ctx.api` is undefined

**Solution:** Ensure ObjectQL engine is initialized with API support

**Issue:** Performance degradation

**Solutions:**
1. Use `async: true` for non-critical operations
2. Add `condition` to filter executions
3. Reduce number of global (`object: '*'`) hooks

---

## References

- [`@objectstack/spec/src/data/hook.zod.ts`](../../../node_modules/@objectstack/spec/src/data/hook.zod.ts) — Hook schema definition, HookContext interface
- [Examples: app-todo](../../examples/app-todo/src/objects/task.hook.ts) — Simple task hook
- [Project hooks pattern](../SKILL.md#lifecycle-hooks) — Hook integration in the data skill

---

## Summary

Hooks are the **primary extension mechanism** in ObjectStack. They enable you to:

- ✅ Add custom validation and business rules
- ✅ Enrich data with calculated fields
- ✅ Trigger side effects and integrations
- ✅ Enforce security and compliance
- ✅ Implement audit trails
- ✅ Transform data in/out

**Golden Rules:**

1. Use `before*` for validation, `after*` for side effects
2. Set `async: true` for non-critical background work
3. Use `ctx.api` for cross-object operations
4. Handle errors gracefully with meaningful messages
5. Test hooks in isolation and integration

For more advanced patterns, see the **objectstack-automation** skill for Flows and Workflows.

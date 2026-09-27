# Part 3 — Operations: CLI, Testing, Deployment

Every project gets the same `os` command surface — `npm install` does not need
to be re-run when commands are added.

## Daily-loop commands

| Command | What it does |
|:--------|:-------------|
| `os init` | Scaffold a new project (alternative to `npx create-objectstack`) |
| `os dev` | Start the dev server with hot metadata reload. `--seed-admin` (default **on** for plain `os dev`) seeds a loginable dev admin **in-process via the runtime** (env vars `OS_SEED_ADMIN*`) on an **empty** DB only — idempotent, never overwrites an existing account (default `admin@objectos.ai` / `admin123`; override with `--admin-email` / `--admin-password`; disable with `--no-seed-admin`). `--fresh` = ephemeral clean OS_HOME/DB, implies `--seed-admin`. The seeded admin is promoted to **platform admin**, so Setup/Studio work on first login. |
| `os dev --ui` | Also mount the bundled Console portal at `/_console/` (there is no separate `os studio` command) |
| `os validate` | Validate `objectstack.config.ts` — Zod protocol schema, CEL/predicate validation (`record.<field>` existence), and widget-binding integrity. Same gates as `os build`, no artifact emitted. See [Verify your work](#verify-your-work). |
| `os lint` | Style/convention lint on metadata files |
| `os info` | Print a metadata summary of the config (objects, apps, and other collections; `--json`) |
| `os doctor` | Diagnose common setup issues |

## Build & runtime

| Command | What it does |
|:--------|:-------------|
| `os build` | Compile TS metadata, bundle, and produce `dist/` |
| `os compile` | Compile to portable JSON artifact (for runtime hydration) |
| `os serve` | Serve a compiled stack in production mode |
| `os start` | Quick-start a server: auto-compiles `objectstack.config.ts` when no artifact is present, and falls back to an empty kernel with the Console + marketplace when there is no config at all. It does **not** validate env or apply migrations — run `os validate` / `os migrate apply` yourself |
| `os generate <kind>` | Scaffold an object / view / flow / agent from a template |

## Verify your work

ObjectStack metadata mistakes fail **silently at runtime**, not at edit time:
a bare field ref in a predicate (`done` instead of `record.done`) evaluates to
`null` and silently hides an action/validation on every record; a
dangling dashboard widget binding renders an empty chart (ADR-0021). Both are
caught at author time by one command:

```bash
os validate     # Zod schema + CEL predicates + widget bindings — no artifact
# or
os build        # the same three gates, plus emits dist/objectstack.json
```

`os validate` and `os build` run the **same** structural + semantic gates:

1. **Zod protocol schema** — the stack conforms to `@objectstack/spec`.
2. **CEL / predicate validation (ADR-0032)** — every `visible` / `disabled` /
   `requiredWhen` / validation rule / flow condition / sharing rule is parsed
   for CEL syntax *and* checked that each `record.<field>` reference exists on
   the target object. A bare `field` (missing `record.`) fails here.
3. **Widget-binding integrity (ADR-0021)** — every dashboard widget's
   `dataset` / `dimensions` / `values` resolves to a declared dataset/field.

Both exit non-zero with a located, corrective message; `os build` additionally
emits the artifact. Use `os validate` as the fast inner-loop check after editing
metadata and `os build` when you need `dist/`. In a scaffolded project these are
`npm run validate` / `npm run build`.

**Rule of thumb: never report a metadata change as done until `os validate`
passes.** (`os lint` is a *separate* style/convention pass — naming, labels,
namespace prefixes — and does not replace `os validate`.)

## Ports & networking

Port resolution is the same for `os dev` and `os start` (both spawn `os serve`):

```
--port <n>  ›  $OS_PORT  ›  $PORT  ›  3000   (default)
```

**Conflict behaviour is mode-dependent — this is deliberate:**

| Mode | If the resolved port is busy |
|:-----|:-----------------------------|
| **Dev** (`os dev`, or `NODE_ENV=development`) | Auto-hops to the next free port (up to +100) so several example apps run side-by-side. The startup banner shows the *actual* bound port. |
| **Production** (`os start`) | **Fails loudly and exits 1.** It never silently drifts — a shifted port breaks reverse-proxy upstreams, better-auth callback URLs, and CORS trusted-origins as opaque 403/502s. |

**Production guidance:**

- **Pin the port explicitly** — `PORT=8080 os start` (or `--port 8080`). Don't
  rely on the `3000` default; it collides easily on shared hosts.
- **Keep these in sync when you change the port** (mismatch ⇒ better-auth
  `Invalid origin` 403 / CORS failures):
  - reverse-proxy upstream (`nginx`/`caddy`)
  - `OS_AUTH_URL` / better-auth `baseURL` + `callbackURL`
  - `OS_TRUSTED_ORIGINS` (CORS allow-list)
  - the app's `hostname`
- **Recommended topology:** terminate TLS on a reverse proxy (`:443`) and let
  the app listen on an internal high port (e.g. `8080`) fixed via `PORT`.

## Data & migrations

| Command | What it does |
|:--------|:-------------|
| `os data create` / `get` / `query` / `update` / `delete` | Record-level CRUD against a running server (there is no `os data seed` / `export` / `import` — seed data in the `data:` collection loads automatically at boot) |
| `os diff` | Compare two ObjectStack config files and detect breaking changes |
| `os meta register` / `os meta resync` | Register (create/update) metadata on a target server / re-sync it (there is no `os meta apply`) |
| `os migrate plan` / `os migrate apply` | Dry-run / apply physical-DB drift reconciliation from metadata (forward-only — no batch rollback; `os rollback` was removed) |

## Environments & deploy

| Command | What it does |
|:--------|:-------------|
| `os login` / `logout` / `whoami` | Auth against the ObjectStack cloud control plane |
| `os environments list` / `create` / `switch` | Manage cloud environments (prod/staging/dev) |
| `os register` | Register the local stack as a deployable target |
| `os cloud login` / `logout` / `whoami` | Cloud auth subcommands (these three only — there are no `os cloud logs/metrics/status`) |
| `os package publish [dist/objectstack.json] [--env … --install --visibility org]` | Upload the compiled artifact as a versioned package to the cloud catalog (ADR-0008 P3) |
| `os package install <manifest-id │ ./dist/objectstack.json> [--version │ --runtime http://localhost:3000]` | Install a package into a **running** runtime via its install-local endpoint. Catalog mode (by manifest id) or air-gapped local-artifact mode. Auths with the **target runtime's** session (`--email/--password` or `OS_RUNTIME_EMAIL`/`OS_RUNTIME_PASSWORD`), not the cloud login |

> **Cloud connection & marketplace (`@objectstack/cloud-connection`, ADR-0008/0009).**
> The open runtime-side cloud client. Its plugins —
> `CloudConnectionPlugin`/`createCloudConnectionPlugin`, `MarketplaceProxyPlugin`,
> `MarketplaceInstallLocalPlugin`, `RuntimeConfigPlugin` — expose the install-local
> endpoint that `os package install` targets, ship the **Installed Apps** page and
> marketplace Setup nav as plugin metadata, and maintain `LocalManifestSource`
> (a local desired-state ledger) plus runtime-identity bind v2 (environment-less
> self-hosted binding).

## Shipping a plugin

Authoring stops at `kernel.use(plugin)`; these three make it distributable.
`manifest.type: 'plugin'` is what marks the package as one.

| Command | What it does |
|:--|:--|
| `os plugin build [--out dist/x.osplugin]` | Bundle from `objectstack.plugin.json` into a reproducible ustar+gzip `ID-VERSION.osplugin` with per-file `sha256-` integrity |
| `os plugin sign` | Sign the built artifact |
| `os plugin publish` | Upload it to the catalog |

## Testing pattern

Use `LiteKernel` for unit / integration tests — it skips the cloud bits and
plugin discovery, so tests run in milliseconds. Assemble the same plugins the
CLI would auto-register (`use()` is synchronous and chainable):

```typescript
import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { InMemoryDriver } from '@objectstack/driver-memory';
import stack from '../objectstack.config';

describe('stack boot', () => {
  it('registers the task object', async () => {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    kernel
      .use(new ObjectQLPlugin())
      .use(new DriverPlugin(new InMemoryDriver()))
      .use(new AppPlugin(stack));
    await kernel.bootstrap();

    const ql = kernel.getService<any>('objectql');
    // query / mutate through the engine — see objectstack-query for the API
    expect(ql).toBeDefined();

    await kernel.shutdown();
  });
});
```

- **Seed in tests:** declare fixtures in the stack's `data:` collection —
  they load at boot. See **objectstack-data** for env-scoped fixtures
  (`env: ['test']`).
- **Reset between tests:** create a fresh `LiteKernel` per test — with the
  in-memory driver a full bootstrap is cheap, and there is no `reset()`.
- **HTTP-level tests:** mount `createHonoApp({ kernel })` from
  `@objectstack/hono` and drive it with `app.request(...)` / `fetch`.

## Deployment targets

| Target | Driver | HTTP layer | Notes |
|:-------|:-------|:-----------|:------|
| Node.js server | `driver-sql` (`pg` / `mysql` / `better-sqlite3`) | `plugin-hono-server` / `@objectstack/hono` | Default — works anywhere Node runs |
| Edge (Cloudflare Workers, Vercel Edge) | `driver-turso` (**cloud / EE only**) | `@objectstack/hono` | Cold-start friendly; LiteKernel only |
| Serverless (Lambda, Vercel functions) | `driver-sql` (`pg` with pooler) / `driver-mongodb` | `@objectstack/hono` | Mind cold-start: prefer LiteKernel |
| Browser / WebContainer | `driver-sqlite-wasm` | none (in-process) | Playground, demos |
| Docker / Kubernetes | any | any | Use `os start` as the entrypoint; pin `PORT` and `EXPOSE` it (see [Ports & networking](#ports--networking)) |

## Health & observability

- **Health endpoints:** the HTTP dispatcher exposes `GET /health` and
  `GET /ready` under the API prefix.
- **Logs:** plugins log via `ctx.logger`. Logger config is a **kernel
  construction** option, not a `defineStack` key:
  `new ObjectKernel({ logger: { level: 'info', format: 'json' } })`.
- **Metrics:** use the kernel's built-ins — `kernel.getPluginMetrics()`
  (per-plugin startup durations) and `await kernel.checkAllPluginsHealth()`.
  There is no `metrics` service and no `@objectstack/plugin-prometheus`.

## Common ops pitfalls

| Symptom | Likely cause |
|:--------|:-------------|
| `os dev` hangs at "Loading metadata…" | Circular import in `objectstack.config.ts` — run `os validate` |
| `os start` exits with "Port N is already in use" | Intended: production never auto-shifts ports. Free the port or set `PORT=<n>` — see [Ports & networking](#ports--networking) |
| better-auth `Invalid origin` 403 after a port/host change | Port or hostname out of sync with `OS_AUTH_URL` / `OS_TRUSTED_ORIGINS` — see [Ports & networking](#ports--networking) |
| Migrations apply locally but not in cloud | `env` scoping on the dataset excludes the target environment |
| Adapter 404s on auto-generated routes | `enable.apiEnabled: false` on the object, or missing `os build` |
| LiteKernel test passes, ObjectKernel boot fails | Test missed a plugin the CLI auto-registers — compare your test's `use()` list against the `os dev` boot log |
| Hot reload misses new objects | Barrel `src/objects/index.ts` not re-exporting — check the file |
| Login works but **Setup / Studio missing** | The logged-in user isn't a platform admin. Setup/Studio are gated by `setup.access` / `studio.access` on `admin_full_access`, auto-granted only to the first registered **human** (`bootstrapPlatformAdmin`). The `usr_system` seed identity is skipped, so it can't steal the grant. Either sign up first (`--seed-admin`/`--fresh` does this) or check `sys_user_permission_set` for a cross-tenant (`organization_id = NULL`) `admin_full_access` link on your user. Don't edit nav code first. |
| A permission set is declared but grants nobody anything | Declaring a set is not assigning it — see "Assigning a permission set to a user" in **objectstack-data**. |

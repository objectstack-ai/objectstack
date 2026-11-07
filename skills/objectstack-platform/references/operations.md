# Part 3 — Operations: CLI, Testing, Deployment

## Daily-loop commands

| Command | What it does |
|:--------|:-------------|
| `os init` | Scaffold a new project (alternative to `npx create-objectstack`) |
| `os dev` | Start the dev server with hot metadata reload. `--seed-admin` (default **on** for plain `os dev`) seeds a loginable dev admin **in-process via the runtime** (env vars `OS_SEED_ADMIN*`) on an **empty** DB only — idempotent, never overwrites an existing account (default `admin@objectos.ai` / `admin123`; override with `--admin-email` / `--admin-password`; disable with `--no-seed-admin`). `--fresh` = ephemeral clean OS_HOME/DB, implies `--seed-admin`. |
| `os dev --ui` | Also mount the bundled Console portal at `/_console/` (there is no separate `os studio` command) |
| `os validate` | Validate `objectstack.config.ts` — see [Verify your work](#verify-your-work) |
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

1. **Zod protocol schema** — the stack conforms to `@objectstack/spec`.
2. **CEL / predicate validation (ADR-0032)** — every `visible` / `disabled` /
   `requiredWhen` / validation rule / flow condition / sharing rule is parsed
   for CEL syntax *and* checked that each `record.<field>` reference exists on
   the target object. A bare `field` (missing `record.`) fails here.
3. **Widget-binding integrity (ADR-0021)** — every dashboard widget's
   `dataset` / `dimensions` / `values` resolves to a declared dataset/field.

Both exit non-zero with a located, corrective message.

**Rule of thumb: never report a metadata change as done until `os validate`
passes.** (`os lint` is a *separate* style/convention pass and does not
replace `os validate`.)

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
| `os meta register` | Register (create/update) metadata on a target server (there is no `os meta apply`) |
| `os migrate plan` / `os migrate apply` | Preview / reconcile DB drift from metadata; `apply` loosens only, `--allow-destructive` for drops/tightenings (forward-only; `os rollback` was removed) |

## Environments & deploy

| Command | What it does |
|:--------|:-------------|
| `os login` / `logout` / `whoami` | Auth against the ObjectStack cloud control plane |
| `os environments list` / `create` / `switch` | Manage cloud environments (prod/staging/dev) |
| `os register` | Register the local stack as a deployable target |
| `os cloud login` / `logout` / `whoami` | Cloud auth subcommands (these three only — there are no `os cloud logs/metrics/status`) |
| `os deploy` (or `npm run deploy`, or `d` in `os dev`) | See an edit on your org's ObjectOS Cloud environment: build, publish `<manifest.version>-dev.<timestamp>`, install, wait until served. Environment: `--env <id>`, else the one `os environments switch` recorded (kept across `os cloud login`), else your organization's only one. `--no-wait`; `--wait-timeout <seconds>` (600) |
| `os package publish [dist/objectstack.json] [--env … --install --visibility org]` | Upload the compiled artifact as a versioned package to the cloud catalog (ADR-0008 P3). Listing file, README, review and every screen the customer's administrator meets: [Marketplace handbook](https://objectstack.ai/docs/deployment/marketplace-handbook) |
| `os package install <manifest-id │ ./dist/objectstack.json> [--version │ -u/--url http://localhost:3000]` | Install a package into a **running** runtime. Catalog mode (by manifest id) or air-gapped local-artifact mode. Auths as a **target runtime** user (`-t/--token` or `--email/--password`; env `OS_RUNTIME_TOKEN` or `OS_RUNTIME_EMAIL`/`OS_RUNTIME_PASSWORD`), not the cloud login |

**`os deploy` exit 1:** a refusal before any write publishes nothing: log in (`os cloud login`), pick an environment (`--env`; none: create one in the ObjectOS Cloud console), or fix the local build or `manifest.version`. `could not build …: <reason>`: the environment's build failed, it keeps serving the previous one; fix and deploy again. `Timed out after …`: the install is recorded and a failing build reads as pending for minutes; deploy again with a longer `--wait-timeout`, or see the build in the ObjectOS Cloud console.

> **Cloud connection & marketplace (`@objectstack/cloud-connection`, ADR-0008/0009):**
> the open runtime-side cloud client; its `MarketplaceInstallLocalPlugin` serves the
> install-local endpoint `os package install` targets.

## Mobile push

`requires: ['push']` reads the top-level `push` key (`PushServiceConfigSchema`).
Served today: `transport: 'direct'` only, one block per vendor, at least one:

```ts
push: { transport: 'direct',
  apns: { teamId, keyId, topic: 'com.acme.app', environment: 'production', credentialRef: 'APNS_P8_KEY' },
  fcm: { projectId, credentialRef: 'FCM_SA_JSON' } },
```

`credentialRef` names each secret (the `.p8` key, the service-account JSON; an
env-var name in the open tier), never holds it: `privateKey`, `serviceAccount` or
a PEM/JSON value is refused. The relay transport (also what `{}` or no key reads
as) is refused at boot until its sender ships.

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
`new ObjectQLPlugin()`, `new DriverPlugin(new InMemoryDriver())` and
`new AppPlugin(stack)` (`AppPlugin`: `@objectstack/runtime`; `stack`: the
config's default export). The vitest shape: [Testing Plugins](./plugin-development.md#testing-plugins);
the other imports: [Using Plugins](./plugin-development.md#using-plugins).

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
| Docker / Kubernetes | any | any | Use `os start` as the entrypoint; pin `PORT` and `EXPOSE` it (see [Ports & networking](#ports--networking)). The official image (`ghcr.io/objectstack-ai/objectstack`): its required variables (pitfalls below) set at runtime, never baked in; an explicit `OS_DATABASE_URL=file:/path/on/a/mounted/volume/app.db` passes, so SQLite on a volume still works |

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
| Migrations apply locally but not in cloud | `env` scoping on the dataset excludes the target environment |
| Adapter 404s on auto-generated routes | `enable.apiEnabled: false` on the object, or missing `os build` |
| LiteKernel test passes, ObjectKernel boot fails | Test missed a plugin the CLI auto-registers — compare your test's `use()` list against the `os dev` boot log |
| Hot reload misses new objects | Barrel `src/objects/index.ts` not re-exporting — check the file |
| Login works but **Setup / Studio missing** | The logged-in user isn't a platform admin. Setup/Studio are gated by `setup.access` / `studio.access` on `admin_full_access`, auto-granted only to the first registered **human** (`bootstrapPlatformAdmin`). The `usr_system` seed identity is skipped, so it can't steal the grant. Either sign up first (`--seed-admin`/`--fresh` does this) or check `sys_user_permission_set` for a cross-tenant (`organization_id = NULL`) `admin_full_access` link on your user. Don't edit nav code first. |
| A permission set is declared but grants nobody anything | Declaring a set is not assigning it — see "Assigning a permission set to a user" in **objectstack-data**. |
| The official image exits at start naming `OS_DATABASE_URL` / `OS_AUTH_SECRET` / `OS_SECRET_KEY` | The image presets `OS_DEPLOYMENT_DURABILITY_CHECK_ENABLED=true`: with any of the three unset, `os start` exits 1 before it writes a database file or a secret. Set the named ones on the run command. Upgrading a container that ran on the image's defaults? **Keep its generated values**, read from the old container's `/home/node/.objectstack` (`docker exec <container> cat <file>`, or its volume): `OS_AUTH_SECRET` is the contents of `auth-secret`, `OS_SECRET_KEY` the contents of `dev-crypto-key`, and the data is `data/objectstack.db` (`OS_DATABASE_URL=file:…` on the kept volume, or migrate it). Fresh values leave every saved credential unreadable and sign everyone out. |

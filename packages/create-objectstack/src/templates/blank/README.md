# Blank Starter

An ObjectStack environment that starts with companies, the people at them,
and the platform's tasks and notes in one menu — yours to change.

## Getting started

```bash
pnpm install
pnpm dev
```

After editing any metadata (an object, view, flow, …), run `pnpm validate` —
see [Verify your changes](#verify-your-changes) below. It is the one command
this project's `AGENTS.md` calls unskippable: it catches mistakes that
otherwise fail silently at runtime.

The REST API is served at `http://localhost:3000/api/v1`. Data endpoints
require a session — the dev server seeds a login-ready admin
(`admin@objectos.ai` / `admin123`) on an empty database:

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/v1/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@objectos.ai","password":"admin123"}'

curl -b cookies.txt "http://localhost:3000/api/v1/data/<your_object>"
```

## What this project starts with

The same companies and contacts as the platform's Starter app, as source you
own:

- `src/objects/company.object.ts` — **Company**: a company the organization
  works with (a customer, a prospect, a partner, a supplier), with its type,
  industry, phone, website and address. Its record page lists its contacts.
- `src/objects/contact.object.ts` — **Contact**: a person at one of those
  companies, with a job title, an influence, an email and a phone. A contact
  is not a user and never signs in.
- `src/views/company.view.ts`, `src/views/contact.view.ts` — a grid of every
  record and a board (companies by type, contacts by influence).
- `src/apps/main.app.ts` — the menu: Companies, Contacts, Tasks and Notes.

**Tasks and Notes are the platform's own objects** (`sys_task`, `sys_note`),
which every environment carries. This project declares no copy of them: the
menu points at them, so they stay when your app changes or goes, and a task or
a note never changes who may see the record it is about.

Change any of it freely: rename a field, add one, or replace both objects with
your own. To remove companies and contacts entirely:

1. Delete `src/objects/company.object.ts` and `src/objects/contact.object.ts`
   and their export lines in `src/objects/index.ts`.
2. Delete `src/views/company.view.ts` and `src/views/contact.view.ts` and
   their export lines in `src/views/index.ts`, and the Companies and Contacts
   entries in `src/apps/main.app.ts` (put your own objects there instead —
   see [The Console](#the-console) below).
3. Point `starter.test.ts` at your own objects (rename the file to match). It
   imports `Company` and `Contact`, so it stops compiling until you do.
4. Run `pnpm validate` and `pnpm test`.

## The Console

`pnpm dev` also serves the admin Console at `http://localhost:3000/_console/`,
and prints the link on boot. Open it and you will see this project's app,
**Main**, beside the platform's own apps (Setup, Account), with Companies,
Contacts, Tasks and Notes in its menu.

**An object appears in Console navigation only when an app lists it.**
`src/apps/main.app.ts` lists companies and contacts, and
`src/views/company.view.ts` and `src/views/contact.view.ts` draw their lists. A package whose manifest type is `app` holds at most one app,
so `main.app.ts` is the one: to show another object, add a navigation entry for
it to that app's `navigation` (a `group` entry with children nests them) rather
than a second app, and give it a list view. `objectstack generate view OBJECT`
writes the view and its export line together; the Console renders both after
the next `pnpm dev` rebuild. The
`objectstack-ui` skill covers the shape; describing the app you want to your
coding agent is the intended path.

## Your app is an MCP server

Every ObjectStack app is itself a
[Model Context Protocol](https://modelcontextprotocol.io) server — **on by
default**, no plugin to install. `pnpm dev` prints the endpoint and a
ready-to-paste connect command on boot; point a coding agent (Claude Code,
Cursor, any MCP client) at it and it can read your schema, query data, and run
your exposed actions — all under the caller's own permissions and RLS:

```bash
claude mcp add --transport http my-app http://localhost:3000/api/v1/mcp
```

Set `OS_MCP_SERVER_ENABLED=false` to turn it off. This is the *serve* side — the
reverse of the `mcp` connector below (which lets your app *call* other MCP
servers). See [Connect an MCP Client](https://objectstack.ai/docs/ai/connect-mcp)
for OAuth, API keys, and which objects/actions become tools.

## Layout

- `objectstack.config.ts` — environment manifest (objects, API, plugins), and
  the wiring for every directory below
- `src/objects/` — object definitions (one file per object): companies and
  contacts, described [above](#what-this-project-starts-with)
- `src/apps/` — the app, `main.app.ts`, described in
  [The Console](#the-console); `src/views/` — the companies' and contacts'
  list views
- `src/actions/`, `src/flows/`, `src/dashboards/`, `src/skills/`,
  `src/picklists/`, `src/security/` (permission sets), `src/datasets/`
  (analytics datasets) — empty to start. Each directory's `index.ts`
  exports what it holds and `objectstack.config.ts` hands those exports to the
  stack, so `objectstack generate flow NAME` (or `view`, `action`, …) adds a
  file and one export line, and the item is loaded, and counted by
  `pnpm validate`, with no edit to the config
- `starter.test.ts` — the starter test `pnpm test` runs, configured by
  `vitest.config.ts`

## Connectors (add a provider when you need one)

A **generic connector executor** lets you call an external system from a flow
as pure metadata — no host code:

| Provider | Package | Use for |
|:---|:---|:---|
| `rest` | `@objectstack/connector-rest` | Any JSON/HTTP REST API |
| `openapi` | `@objectstack/connector-openapi` | An API described by an OpenAPI document |
| `mcp` | `@objectstack/connector-mcp` | A Model Context Protocol server |

The starter lists none of them in `plugins:`. A plugin is code, and an app
with code in `plugins:` installs only as a managed package — never as an
editable copy (`manifest.installModes: ['unmanaged']`, how a marketplace trial
template is installed), because a copy is made of metadata alone. So add a
provider when the app first needs one: install its package
(`pnpm add @objectstack/connector-rest`), list its executor in `plugins:`
(`new ConnectorRestPlugin()`), and add a `connectors:` entry that names its
`provider`. The `automation` capability materializes that entry into a live,
dispatchable connector at boot — see
[Automation → Connectors](https://objectstack.ai/docs/automation/connectors)
for how that materialization works; a flow's `connector_action` node then
calls it. A brand connector (e.g. Slack) is added the same way, with its own
package and `new ConnectorSlackPlugin()`.

> **Security — declarative MCP over stdio.** An `mcp` connector whose transport
> spawns a local process (`stdio`) is denied by default, because the command
> comes from metadata. Opt in per host with
> `new ConnectorMcpPlugin({ declarativeStdio: ['node'] })`; `http` transports
> need no opt-in.

See [Automation → Flows](https://objectstack.ai/docs/automation/flows) for
the full connector and `connector_action` guide.

## Verify your changes

After editing any metadata, run:

```bash
pnpm validate     # schema + CEL predicates + widget bindings (no artifact)
pnpm lint         # authoring rules validate does not run — e.g. a handler that
                  # stopped lowering to a metadata-only body
pnpm typecheck    # TypeScript types against @objectstack/spec
pnpm test         # your app's own tests, against the real engine
```

`pnpm validate` runs the same gates as `pnpm build` and catches mistakes that
otherwise fail *silently at runtime* — e.g. a bare `done` (instead of
`record.done`) in an action predicate that would hide the action on every
record. See `AGENTS.md` for the full convention.

`pnpm test` checks what the app *does*. `starter.test.ts` boots this app's
stack in-process with `bootStack` from `@objectstack/verify` (in-memory
database, no server) and asserts business facts through its handle: a company
without a name is refused, a contact belongs to a company, and the menu lists
Companies, Contacts, Tasks and Notes. Write your own the same way: `stack.hooks.run` makes a real
write through validation, permissions and hooks, and the same handle runs flows
and actions, seeds fixtures and reads rows as a given user.

## Deploy

The project ships container-ready — the `Dockerfile` builds your metadata into
an artifact and runs it on the official ObjectStack runtime image
(`ghcr.io/objectstack-ai/objectstack`):

```bash
# Image only
docker build -t my-app .

# Or the full app + Postgres stack
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
OS_AUTH_SECRET=$(openssl rand -hex 32)
OS_SECRET_KEY=$(openssl rand -hex 32)
EOF
docker compose up -d
curl -fsS http://localhost:8080/api/v1/health
```

Bare Node, Kubernetes, reverse-proxy wiring, and the required secrets are
covered in [Self-Hosted Deployment](https://objectstack.ai/docs/deployment/self-hosting).

### A Studio change is not in the image

The image carries what `src/` builds into, and nothing else. A change you save
in Studio, in the Console `pnpm dev` serves, is stored in that environment's
database (locally, `.objectstack/data/`) as an item of the package
`<this app's package id>.custom`. It is never written to `src/`, so
`pnpm build`, the `Dockerfile` and `docker compose` leave it behind.

- To make it part of the app, make the same change in `src/`: that is what is
  validated, reviewed and deployed. Ask your coding agent to do it in code, not
  in Studio.
- To keep it as a customization, take it out as a package while `pnpm dev`
  runs: `npx os login --url http://localhost:3000` once, then
  `npx os package export --url http://localhost:3000`, writes every package the database holds that
  `src/` does not register, the `.custom` package among them, to
  `objectstack-export/NN-ID/objectstack.json`. Commit that directory, and once
  the deployment is up install each file into it in the numbered order with
  `npx os package install objectstack-export/NN-ID/objectstack.json --url URL`.

`pnpm build` prints a notice when your local dev database holds such a change.

## Next steps

- Open the Console (`pnpm dev`, then `http://localhost:3000/_console/`) and
  add a company and a contact; reshape them in `src/objects/` to fit your
  business — see [What this project starts with](#what-this-project-starts-with).
- Add an object: see the `objectstack-data` skill.
- Add a view or app: see `objectstack-ui`.
- Add a flow or automation: see `objectstack-automation`.
- Add an AI agent: see `objectstack-ai`.

Skills live in `.claude/skills/` and are committed with this project, once.
They come from the `@objectstack/skills` dev dependency, at the version of
`@objectstack/spec`, are installed one agent runtime at a time (see
`AGENTS.md`), and also show up in the in-IDE assistant catalog. Re-install them
from `node_modules` after upgrading the `@objectstack/*` packages:

```bash
npx skills@1.7.2 experimental_sync --agent claude-code --copy -y
```

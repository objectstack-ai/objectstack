# Blank Starter

Minimal ObjectStack environment — a clean slate for building.

## Getting started

```bash
pnpm install
pnpm dev
```

The REST API is served at `http://localhost:3000/api/v1`. Data endpoints
require a session — the dev server seeds a login-ready admin
(`admin@objectos.ai` / `admin123`) on an empty database:

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/v1/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@objectos.ai","password":"admin123"}'

curl -b cookies.txt "http://localhost:3000/api/v1/data/<your_object>"
```

## Layout

- `objectstack.config.ts` — environment manifest (objects, API, plugins)
- `src/objects/` — object definitions (one file per object)

## Connectors (default providers)

`objectstack.config.ts` wires the three **generic connector executors**, so you
can call an external system from a flow as pure metadata — no host code:

| Provider | Package | Use for |
|:---|:---|:---|
| `rest` | `@objectstack/connector-rest` | Any JSON/HTTP REST API |
| `openapi` | `@objectstack/connector-openapi` | An API described by an OpenAPI document |
| `mcp` | `@objectstack/connector-mcp` | A Model Context Protocol server |

Add a `connectors:` entry that names one of these `provider`s and the
`automation` capability materializes it into a live, dispatchable connector at
boot (ADR-0097); a flow's `connector_action` node then calls it. To add a brand
connector (e.g. Slack), install its package and add `new ConnectorSlackPlugin()`
to `plugins:`; to drop a provider, remove its plugin.

> **Security — declarative MCP over stdio.** An `mcp` connector whose transport
> spawns a local process (`stdio`) is denied by default, because the command
> comes from metadata. Opt in per host with
> `new ConnectorMcpPlugin({ declarativeStdio: ['node'] })`; `http` transports
> need no opt-in.

See [Automation → Flows](https://docs.objectstack.ai/docs/automation/flows) for
the full connector and `connector_action` guide.

## Verify your changes

After editing any metadata, run:

```bash
pnpm validate     # schema + CEL predicates + widget bindings (no artifact)
pnpm typecheck    # TypeScript types against @objectstack/spec
```

`pnpm validate` runs the same gates as `pnpm build` and catches mistakes that
otherwise fail *silently at runtime* — e.g. a bare `done` (instead of
`record.done`) in an action predicate that would hide the action on every
record. See `AGENTS.md` for the full convention.

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
covered in [Self-Hosted Deployment](https://docs.objectstack.ai/docs/deployment/self-hosting).

## Next steps

- Add an object: see the `objectstack-data` skill.
- Add a view or app: see `objectstack-ui`.
- Add a flow or automation: see `objectstack-automation`.
- Add an AI agent: see `objectstack-ai`.

Skills live in `skills/` in the ObjectStack framework repo and in the in-IDE
assistant catalog.

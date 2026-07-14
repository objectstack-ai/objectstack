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

## Next steps

- Add an object: see the `objectstack-data` skill.
- Add a view or app: see `objectstack-ui`.
- Add a flow or automation: see `objectstack-automation`.
- Add an AI agent: see `objectstack-ai`.

Skills live in `skills/` in the ObjectStack framework repo and in the in-IDE
assistant catalog.

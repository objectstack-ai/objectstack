# Docker Reference for Standalone ObjectStack Apps

Reference container packaging for a project scaffolded with
`npm create objectstack@latest`. These files are **meant to be copied into
your app**, not built from this directory — the example apps in this repo use
`workspace:*` dependencies and are not standalone-buildable.

```bash
npm create objectstack@latest my-app
cd my-app
cp <framework>/examples/docker/{Dockerfile,docker-compose.yml,.dockerignore} .

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

How it works, what the required variables mean, reverse-proxy wiring, and the
multi-node caveats are documented in
[Self-Hosted Deployment](https://docs.objectstack.ai/docs/deployment/self-hosting).

Two properties worth knowing:

- The runtime image contains only Node, `@objectstack/cli`, and your compiled
  `objectstack.json` — the build stage's TypeScript toolchain never ships.
- `OS_SECRET_KEY` must be provided at runtime. On a container's ephemeral
  filesystem the auto-minted dev key is lost on restart, which makes
  previously-encrypted secrets undecryptable.

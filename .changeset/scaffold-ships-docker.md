---
"create-objectstack": minor
---

Scaffolded projects are now container-ready out of the box: the `blank` template ships a `Dockerfile` (two-stage build onto the official `ghcr.io/objectstack-ai/objectstack` runtime image), a `docker-compose.yml` (app + Postgres single-host stack), and a `.dockerignore`, plus a Deploy section in the project README. `docker build -t my-app .` works immediately after `npm create objectstack`.

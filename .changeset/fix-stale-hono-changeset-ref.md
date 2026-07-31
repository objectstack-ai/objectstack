---
---

Repo-plumbing only: the pending changeset `adapter-hono-auth-wildcard-yields` referenced the Hono adapter by its old `@objectstack/adapter-hono` name, which `changeset version` rejects because the workspace package is named `@objectstack/hono`. Renamed the entry; a full sweep of every other pending changeset (and `pre.json`) against the workspace found nothing else stale. Releases nothing by itself.

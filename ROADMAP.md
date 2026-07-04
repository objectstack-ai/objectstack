# ObjectStack Roadmap

> **Last updated:** 2026-06-06
> **Source of truth:** [content/docs/concepts/north-star.mdx](content/docs/concepts/north-star.mdx) for product direction, ADRs for architectural decisions, and code for shipped behavior.

This roadmap tracks the current framework repository. Historical Cloud/ObjectOS
milestone plans that referred to `apps/cloud`, `apps/objectos`,
`@objectstack/service-tenant`, `sys_project`, or `/api/v1/cloud/projects/*`
have been retired. Cloud control-plane distribution work now lives outside this
repo; this repo owns the framework runtime, protocol schemas, CLI, examples,
docs, adapters, services, plugins, and the bundled console integration.

---

## Current Architecture

- **Runtime:** `@objectstack/runtime` boots standalone/local hosts and exposes
  Cloud-aware seams such as environment registry, runtime config, marketplace
  proxy, and environment artifact loading.
- **Environment identity:** current docs and runtime paths use
  `environment`, not `project`: `OS_ENVIRONMENT_ID`,
  `X-Environment-Id`, `/api/v1/environments/:environmentId`, and
  `environment_id`.
- **Console UI:** framework serves the published ObjectUI console bundle from
  `packages/console`; active UI source development happens in sibling repo
  `../objectui`.
- **Cloud publishing:** CLI publish/rollback target
  `/api/v1/cloud/environments/:environment/...` endpoints when pointed at an
  ObjectStack Cloud control plane.
- **Generated references:** `content/docs/references/` is generated from Zod
  descriptions. Update `packages/spec/src/**/*.zod.ts`, then regenerate.

---

## Near-Term Priorities

| Priority | Work | Why |
|:---|:---|:---|
| P0 | Keep public docs aligned with the environment rename. | Prevent users from copying stale `project` route/header/env examples. |
| P0 | Keep CLI/docs/examples aligned with actual scripts: `pnpm dev`, `pnpm dev:crm`, `os dev`, `os start`, `os serve`, `os publish`. | Avoid broken onboarding. |
| P0 | Remove references to deleted app/service packages from current docs. | `apps/cloud`, `apps/objectos`, `apps/studio`, and `service-tenant` no longer exist in this repo. |
| ~~P1~~ done | ~~Document Flow-first automation and workflow state-machine semantics.~~ Flow automation is documented in [guides/metadata/flow](content/docs/automation/flows.mdx) (triggers, nodes, structured control flow, durable pause/resume, parallel + batch approval, run observability) and the ADR-0019/0031/0039 series; state-machine semantics in [guides/metadata/workflow](content/docs/automation/workflows.mdx) + [validation](content/docs/data-modeling/validation.mdx). | Old Workflow Rule docs implied a retired Salesforce-style rule engine. |
| P1 | Document explicit AI action opt-in via action metadata. | AI tool exposure is no longer automatic for every action. |
| P1 | Document implemented formula, summary, autonumber, notifications, and master-detail behavior. | Recent runtime work is under-documented and older status pages still mark it missing. |
| P2 | Regenerate reference docs after Zod description updates. | Keeps generated schema pages consistent without hand-editing them. |

---

## Documentation Rules

- Do not hand-edit `content/docs/references/`.
- When adding guide pages, update the nearest `meta.json`.
- Use `environment` for runtime/deployment identity.
- Use `project` only for npm/monorepo/project-folder meaning, or when quoting
  historical ADR text.
- Link to sibling UI work as `../objectui` or the ObjectUI repo, not
  `apps/studio`.

---

## Verification

For doc-only updates, prefer targeted checks:

```bash
pnpm --filter @objectstack/docs build
pnpm --filter @objectstack/spec gen:docs
rg "X-Project-Id|OS_PROJECT_ID|/api/v1/projects|sys_project|apps/studio|service-tenant" README.md content/docs docs/design docs/handoff packages/spec/src
```

Run the full `pnpm test` suite when documentation changes accompany runtime or
schema behavior changes.

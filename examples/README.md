# ObjectStack Examples Catalog

> In-repo examples, organized by what you want to learn. Each one compiles,
> boots, and is exercised by CI (`pnpm --filter <pkg> verify` / `test`).

## The examples

| Example | Level | What it is |
|---------|-------|------------|
| [App Todo](./app-todo/) | 🟢 Beginner | A complete but small task-management app — the fastest way to learn the by-type conventions (objects, actions, dashboards, reports, flows, i18n). |
| [App CRM](./app-crm/) | 🟡 Intermediate | A deliberately minimal CRM that smoke-tests the metadata application loading pipeline (Account/Contact/Lead/Opportunity + cube, mapping, connector, extension, portal). Not a feature showcase. |
| [App Showcase](./app-showcase/) | 🟣 Reference | The **kitchen-sink conformance fixture** — `src/` mirrors the six protocol domains; every metadata kind in the registry is demonstrated or explicitly waived, every field/view/chart/report/action variant appears at least once, and the coverage test enforces it. Start at its Capability Map landing page. |
| [Embed ObjectQL](./embed-objectql/) | 🟢 Focused | Using the ObjectQL data engine as a plain library — no kernel, no plugins (ADR-0076). |
| [HotCRM](https://github.com/objectstack-ai/hotcrm) | 🔴 Production reference | Full enterprise CRM in its own repository (10+ objects, sharing rules, approval flows, multi-driver E2E). |

**Note:** in-repo examples are intentionally lean; production-grade reference
apps (HotCRM, …) live in dedicated repositories under the
[objectstack-ai org](https://github.com/objectstack-ai).

## Which example demonstrates what?

The authoritative, CI-enforced answer is the showcase's coverage manifest:
[`app-showcase/src/coverage.ts`](./app-showcase/src/coverage.ts). It maps
**every metadata kind** in `DEFAULT_METADATA_TYPE_REGISTRY` to the files that
demonstrate it — or to an explicit waiver with a reason and tracking issue
(e.g. AI agent/tool/skill are waived per ADR-0063, not faked). The test suite
fails whenever the platform gains a capability no example demonstrates.

For a guided walkthrough, boot the showcase and follow its per-domain tour:

```bash
cd examples/app-showcase
pnpm dev            # → http://localhost:3000 — landing = Capability Map
pnpm verify         # validate + typecheck + coverage tests
```

## Getting started

```bash
# From the repo root
pnpm install
pnpm run setup                  # first-time: install + build spec

# Beginner path
cd examples/app-todo && pnpm typecheck

# Reference path
cd examples/app-showcase && pnpm verify && pnpm dev
```

### Learning path

1. **App Todo** — structure, conventions, `objectstack.config.ts`.
2. **App Showcase** — click through the Capability Map; read the Guided Tour
   docs (one per protocol domain); grep the file the coverage manifest points
   at whenever you wonder "how do I author X?".
3. **App CRM / HotCRM** — realistic relational modeling and enterprise
   patterns.

## Example standards

- ✅ **Type-safe** — passes `typecheck`; Zod-first, types inferred.
- ✅ **Named right** — `camelCase` config keys, `snake_case` machine names.
- ✅ **Verified** — `pnpm --filter <pkg> verify` must pass after any metadata
  edit (metadata errors fail silently at runtime; see [AGENTS.md](./AGENTS.md)).
- ✅ **Honest** — never demo a capability the runtime doesn't deliver
  (Prime Directive #10); waive it with an issue instead.

### File structure

Small examples use the flat by-type convention (`src/objects/`,
`src/actions/`, …— see app-todo). The showcase, being domain-complete, groups
the same per-type directories under the six protocol domains
(`src/data/`, `src/ui/`, `src/automation/`, `src/system/`, `src/security/`) —
see its README for the full tree and the two pinned exceptions
(`src/coverage.ts`, flat `src/docs/`).

## Contributing examples

1. Follow the standards above and fill a real gap.
2. Add a README with purpose, quick start, and what it demonstrates.
3. If you demonstrate a previously-waived capability, flip its entry in the
   showcase coverage manifest.
4. Submit a PR — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Additional resources

- **[Main Documentation](../content/docs/)** — complete protocol reference
- **[examples/AGENTS.md](./AGENTS.md)** — agent rules for editing examples

## License

All examples are licensed under Apache 2.0. See [LICENSE](../LICENSE).

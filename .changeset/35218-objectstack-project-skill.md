---
'@objectstack/skills': patch
'create-objectstack': patch
---

feat(skills): a process skill for running a metadata-app project; scaffolded projects run their tests in CI

Clause-②: no
Metadata-protocol: none

The skills catalog gains `objectstack-project`. The domain skills teach how to write each kind of metadata; this one teaches how a change moves through an app project: whether it belongs in the app or the platform, what to write at each stage, what the app tests itself (with `bootStack` from `@objectstack/verify`) and what `os validate`, `os lint` and `os verify` already check, how a platform defect is handled without a workaround, how a change is described for customers, and how to bump `@objectstack/*` and carry customer data across an upgrade with a backfill. Steps that matter only to an app shipped to customers are marked, and the light path is the default.

A project that already syncs its skills gets the new one on its next `npx skills@1.7.2 experimental_sync --agent <runtime> --copy -y` after bumping `@objectstack/skills`.

`npm create objectstack` projects now:

- run `pnpm test` in `.github/workflows/ci.yml`, after `validate`, `lint` and `typecheck`, so the sample test (and every test you add) runs on each push;
- point `AGENTS.md` at `objectstack-project` in place of its hand-written skill table, which listed nine of the catalog's skills;
- carry a three-line `.github/pull_request_template.md`: what a user can do now, how it was checked, which docs changed.

Existing projects are not changed. To take the CI step, add `- run: pnpm test` after `- run: pnpm typecheck` in your `ci.yml`.

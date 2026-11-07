---
'@objectstack/scenarios': minor
---

feat(scenarios): `@objectstack/scenarios` is published, with an `objectstack-scenarios` command line: `npx @objectstack/scenarios run` runs the open scenario cards with no checkout of the platform

Clause-②: yes
Metadata-protocol: none

The package was private. It is now released with the `@objectstack/*` packages, at their version, and it carries:

- **A `bin`, `objectstack-scenarios`.** `objectstack-scenarios run [flags]` is the scenario runner (`run-scenarios` in this repository) with the same flags, defaults and refusals: it drives your own local Claude Code login and refuses to start when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set or the CLI is logged in with an API key. `help` and `version` are the other two commands. The bin runs the built JavaScript in `dist/`.
- **The open card library as package data** (`dist/library/`): the cards of `docs/qa/scenarios/` and the capability areas they are checked against, copied at build time. `run` reads them unless `--cards DIR` names another directory, which is loaded as the overlay. Run records go to `./scenario-runs` unless `--out` says otherwise.
- **The library entries it already had**: the card schema and loader (`@objectstack/scenarios`), the scorer (`./score`, `./score/full`), the runner (`./runner`) and the gallery exporter (`./export`).

It is not an `objectstack` (`os`) subcommand, and nothing in `@objectstack/cli` changes.

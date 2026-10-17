---
'create-objectstack': patch
---

Clause-②: no

When the dependency install fails (a network error, a registry outage, an engine mismatch, an npm crash), the
scaffolder's closing "Next steps" now lists `npm install` (or `pnpm install`, whichever package manager the run
detected) before `npm run dev` and `npm run validate`, the same as it does under `--skip-install`. Before, a
failed install printed the same list as a successful one, so the next command it named ran against an empty
`node_modules`. A successful install still prints no install step. No flag, exit code, prompt or scaffolded file
changes.

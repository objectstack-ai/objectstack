---
"create-objectstack": patch
---

fix(create-objectstack): stop reporting a failed pnpm probe as a deliberate npm choice (#11616)

`detectPackageManager()` was `try { execSync('pnpm --version') } catch { return
'npm' }`, so every failure mode collapsed into one answer. `npm install` in the
scaffolder's output meant either *this machine has no pnpm* or *the probe
threw*, and nothing — no log line, no message — could tell the two apart.

That second case is reachable on an ordinary developer machine, not just in
theory: `pnpm --version` resolves through Corepack and therefore depends on the
directory it runs in. Measured on one machine, one binary, two directories —
`10.31.0` inside a repo that pins `packageManager`, `10.33.0` outside it, where
Corepack has to resolve, and may have to fetch, a version nothing pinned. A
user who has pnpm installed but is on a slow or offline network was silently
told to run npm.

The probe now reports why as well as what:

- `probe: 'ok'` — pnpm answered, so pnpm is used (unchanged, silent).
- `probe: 'absent'` — no pnpm on PATH at all, so npm is a real choice
  (unchanged, silent).
- `probe: 'failed'` — pnpm **is** on PATH and the probe still threw. npm is
  used exactly as before, and the run now says so, naming the underlying
  failure: `pnpm is installed but \`pnpm --version\` failed (<reason>); using
  npm as a fallback.`

**Which package manager a run uses is unchanged in all three cases** — it is
still pnpm if and only if the probe succeeded. The PATH lookup that separates
`absent` from `failed` runs only after the decision is already made and feeds
the message alone, so a miss there can change a warning's wording and never the
tool's behaviour. The only output that moves is one warning in a case that was
previously silent and wrong.

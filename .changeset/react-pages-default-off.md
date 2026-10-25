---
'@objectstack/cli': patch
'@objectstack/spec': patch
---

feat: `kind:'react'` pages are off unless the deployment turns them on

Clause-②: no
Metadata-protocol: none

**BREAKING**: the `kind:'react'` page tier, which runs page source in the Console, now defaults to **off** (ADR-0081, amended). A deployment that serves react pages turns the tier on with `OS_PAGE_REACT_ENABLED=true`, in the environment or the project's `.env` file. With it off, each react page shows a notice naming that switch instead of running, and the Console document's content-security-policy no longer allows `'unsafe-eval'`. `kind:'html'` pages are unaffected.

### Migration: FROM → TO

```bash
# FROM — react pages ran unless the deployment set OS_PAGE_REACT=off
# TO — they run only when the deployment opts in
OS_PAGE_REACT_ENABLED=true
```

The earlier name is still read while the new one is unset: `OS_PAGE_REACT=on` turns the tier on and `OS_PAGE_REACT=off` keeps it off, each with a one-time deprecation warning. `true`, `1`, `on`, `yes` and `enabled` turn it on; unset, `false`, `0`, `off`, `no` and `disabled` leave it off; any other value leaves it off and is reported once in the server log.

The server now writes the Console's capability global in both directions, so a Console build with either default follows the server's setting. `examples/app-showcase` opts in through its `.env`, so its three react pages keep running. The `PageSchema.kind` description in `@objectstack/spec` now states the new default.

Operators who collect content-security-policy reports may see one `script-src` eval refusal per Console load while the tier is off: the Console's schema library probes for `eval` once at boot and falls back without it. Nothing on the page is affected, and the probe is removed on the objectui side.

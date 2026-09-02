---
"@objectstack/cloud-connection": minor
---

feat(cloud-connection): `/api/v1/runtime/config` can carry the control plane's upgrade / billing entry as an absolute `upgradeUrl` (#14514)

**Additive, optional, default-absent.** No existing key moves; a runtime that
declares nothing serves the same payload as before.

The tenant Console offers an "upgrade" exit when the AI quota guardrail refuses
a turn. It used to compose the target from `cloudUrl` plus a guessed console
mount, app slug and page route — three facts owned by whoever deploys the
control plane — and missed all three, landing on the control plane's API 404.
The control plane's own two call sites did not even agree on the spelling.
Maintainer ruling 2026-09-02 (cloud#1850, option A): the payload carries the
absolute URL; the host that owns the page declares it; the Console renders a
link only when the key is present (objectui already consumes it that way).

`RuntimeConfigPlugin` gains one option, `upgradeUrl`, on the exported
`RuntimeConfigPluginConfig`, and the served payload gains one optional top-level
key of the same name beside `cloudUrl`:

- **declared** → served verbatim (no trailing-slash trimming, no
  re-serialisation);
- **undeclared** (or empty / whitespace-only) → the key is NOT THERE — asserted
  on key presence, not on `undefined`;
- **not absolute** (`/settings/billing`, a bare host, a non-`http(s)` scheme) →
  refused and named in the boot log, no key served. The Console opens this URL
  from the tenant origin, so a relative path would resolve against the wrong
  host and recreate the defect this key removes.

Host option only — no env var. The value belongs to the distribution whose
control plane serves the page; the cloud subclass fills it (cloud#1850's other
half, after the pin bump).

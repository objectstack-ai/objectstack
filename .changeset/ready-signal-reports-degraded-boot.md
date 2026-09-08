---
"@objectstack/core": patch
"@objectstack/cli": patch
---

The `Server is ready` line now reports the degraded boot it is standing on, instead of printing a green `✓` over it.

`✓ Server is ready` and the kernel's `System started with degraded capabilities. Missing core services: …` were two statements about one boot, produced by two packages — the banner in `@objectstack/cli`, the conclusion in `@objectstack/core` — with **no data path between them**. So the ready signal did not depend on the thing that broke, and therefore could not report it. Measured twice within a day, from unrelated causes: an objectui CI boot where the auth plugin failed and not one `sys_*` table existed, and this repo's own weekly registry canary on the published `npx create-objectstack@latest` on-ramp, where the tick printed directly **above** four boot warnings. In the second case the ready line carried no weight in the job's verdict at all — it was present, green, wrong, and believed by nobody.

- **The data path.** `ObjectKernel.validateSystemRequirements()` now publishes the list it had already computed — the same array behind its own warning — on the kernel's service registry, which is the seam boot facts already cross to reach the banner (`serve` reads `auth` and `seed-summary` off it the same way). No member and no type is added to `@objectstack/core`'s public surface, and nothing re-derives which services count as `core`: that judgement stays in `ServiceRequirementDef` alone.
- **The line.** On a degraded boot the banner prints `⚠ Server is ready — DEGRADED: missing core services: <names>`, naming exactly what the kernel found missing. On a healthy boot the ready block is byte-for-byte unchanged, so an ordinary boot's output does not move.
- **Readiness is NOT made strict.** Nothing about what boots, binds, or exits changes. A machine deliberately running without auth still starts, still prints ready, and still exits 0 — the line just says what state it is ready in.

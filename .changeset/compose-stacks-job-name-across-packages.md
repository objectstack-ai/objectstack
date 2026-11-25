---
'@objectstack/spec': minor
---

fix(spec)!: composition refuses one job name enabled in two packages of the composed artifact, where the boot would schedule none of them

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no skill teaches declaring one job name in two packages of a composition; the refusal names every enabled job of the name and prescribes the fix

<!-- adr-0087: registered compose-stacks-job-name-across-packages-refused -->

**BREAKING** accept-set narrowing, shipped as `minor`.

- **Refused now, at composition (`STACK_CROSS_REFERENCE_INVALID`, 422), once the result carries `packages[]`.** One job name enabled in two package bodies, or in a package body and the residual (a top-level job no body declares: under `composeStacks(stacks, { manifest: 'preserve' })` an input with no `manifest`; under `'first'`, `'last'` or an index any top-level job beside an input that is itself a multi-package artifact). The boot's job binder schedules every job of an artifact by its bare name, whichever package declares it, and refuses a name two enabled jobs share, so none of them was scheduled (`NOT SCHEDULED` at `error`); the install-local door already refused such a package. The finding names every enabled job of the name: `Job 'crm_nightly' is declared enabled twice across the packages of one composed artifact: 'com.example.sales' (stack #0) jobs[0] and 'com.example.billing' (stack #1) jobs[0]. …`, a residual job marked `(the top level, outside every package body)`.
- **Read as the binder reads it.** Enabled jobs only, by name; the residual is counted beyond the package bodies' flattened copies, never by content. Two residual jobs of one name stay the one-package finding (`Job 'NAME' is declared twice in \`jobs\``), as before.
- **Unchanged.** A disabled twin composes (a disabled job is scheduled by nothing). A body job's own flattened copy is not a second job. Distinct job names compose. A flat composition (no `packages[]`) is one package and keeps its own finding.
- **Installed artifacts.** An artifact built before this keeps loading; the binder still refuses the name at boot, naming every holder.

FROM → TO: two packages composed into one artifact each declaring an enabled job `crm_nightly` → rename one of the two jobs, or disable one (`enabled: false`).

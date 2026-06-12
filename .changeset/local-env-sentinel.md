---
"@objectstack/cloud-connection": patch
---

`resolveEnvironmentId` no longer presents the CLI's local-dev sentinel ids (`env_local` / `proj_local`) to the control plane as cloud environment ids — they identify the local kernel only. A single-environment runtime started via `objectstack dev` now reads as cleanly unbound and binds environment-less (ADR runtime-identity-binding), instead of 404-ing the bind against a non-existent cloud environment.

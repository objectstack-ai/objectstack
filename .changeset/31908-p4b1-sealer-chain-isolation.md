---
'@objectstack/plugin-audit': patch
'@objectstack/cli': patch
---

fix(plugin-audit, cli): the audit sealer skips only the chain a chain-local fault belongs to; `os serve` hands its crypto provider to an AuditPlugin the app composed with none

Clause-②: yes (widening)
Metadata-protocol: none

**The sealer (ADR-0154 D3, S4).** A fault that belongs to one chain of a sealed object — a row a canonical rule refuses, or a malformed checkpoint of that chain (its head among them) — now skips that chain for the rest of the pass instead of stopping the whole object. Every other chain is still sealed. Each chain now resumes from its own oldest unsealed window, as `window` checkpoints, so a skipped chain catches up once its fault is fixed. No checkpoint's `sealed_through` passes a window a skipped chain leaves unsealed. The sealer reports each skipped chain once at `error`, naming the object, the chain, the fault and the window it is unsealed from, and again each hour while it lasts. A lock lapse, a signer, crypto-provider or storage fault still stops the object's pass, as before. `os audit verify` reads the skipped chain's rows in a window another chain sealed as `late` and unsealed, and fails.

**An app-supplied AuditPlugin (ADR-0154 D2, D6).** An app that puts its own `AuditPlugin` in its stack `plugins` (to turn on `readAudit`, for example) supersedes the one `os serve` composes, and so lost the host's crypto provider: its sealer sealed nothing and said so at `error`. `os serve` now hands it the host's provider when the app composed it with no `cryptoProvider`, and keeps its sealer off on an `OS_MIGRATE_AND_EXIT=1` boot, as for the instance it composes itself. A provider the app composed is never replaced, an app's `armSealer: false` stays off, and a plugin that only carries the AuditPlugin name is never handed anything. The new `AuditPlugin.adoptHostCryptoProvider(provider, { armSealer })` is the method a host calls to do this.

---
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-reports": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-pinyin-search": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/plugin-audit": patch
---

fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
roots. 35 lookup sites that had been erased to `any` now carry the slot's
contract, so the compiler checks what each plugin actually calls on the service
it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

**Two real defects, both of the shape this sweep exists to find.** Approvals'
actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
read the HTTP server under `http-server` *only* — the deprecated alias. The
ledger records `http.server` as canonical and as the only name present on every
provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
that path both lookups threw, the surrounding `catch` swallowed it, and the
routes silently never mounted — approval e-mail action links 404'd and the
share-link surface was absent, with nothing in the log to say so. Both reads are
now canonical-first with the alias as fallback, each name in its own `try`
because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
never reaches `b` — the same correction #4393 made in metadata and
cloud-connection).

Typing choices follow the batch method: pure data-plane consumers take the
narrow contract (`IDataEngine` in reports), consumers that bind hook or
middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
sharing and pinyin-search), and slots with no contract get a **named** local
surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
`SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
still makes the compiler name every call site; `any` says nothing.

No behaviour change beyond the two alias reads. No contract changes.

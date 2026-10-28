---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

fix(spec): the `newTabUrl` path refusal is registered as an ADR-0087 D3 semantic entry, and the action form labels the field "New-tab path"

Clause-②: no
Metadata-protocol: none

<!-- adr-0087: registered ui-action-new-tab-url-path-refused -->

Supersedes, in the same release, the ADR-0087 disposition of the `newTabUrl` narrowing note (`fix(spec)!: an action's newTabUrl is a path on this backend and must start with /`), which declared `not-required (no-migration-prescription)` while carrying a remedy. That narrowing is now registered: D3 semantic entry `ui-action-new-tab-url-path-refused` (protocol 18) names the surface (an `action` whose `newTabUrl` does not start with `/`), the two remedies (write the backend path, or drop `opensInNewTab` / `newTabUrl` and declare a `type: 'url'` action with `target: 'https://…'` and `openIn: 'new-tab'`), and why neither is applied mechanically: an external URL names no path on this backend, and the url-action rewrite changes the action's type, drops its handler and replaces an auth-enforcing endpoint with a page the browser opens directly. So `os migrate meta` and the upgrade guide carry it as a structured TODO, and a stored row holding such a value behaves exactly as that note says (loads unchanged and registered, counted `invalid` with a `[metadata_spec_invalid]` boot line, served with `_diagnostics`, next save refused until rewritten). No accept set changes here.

The action form's `newTabUrl` field label now says path in every locale: "New-tab path" (en), "新标签页路径" (zh-CN), "新しいタブのパス" (ja-JP), "Ruta de pestaña nueva" (es-ES).

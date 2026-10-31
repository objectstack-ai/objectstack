---
'@objectstack/plugin-security': patch
'@objectstack/platform-objects': patch
---

feat(plugin-security): Setup → People & Organization opens the Position Holders and Permission Set Assignment pages

Clause-②: no
Metadata-protocol: none

The Setup app's People & Organization group gains two entries, contributed by `@objectstack/plugin-security` beside its Positions / Capabilities / Permission Sets entries:

- **Position Holders** (`nav_position_holders`) — `type: 'component'`, `componentRef: 'security:position-holders'`.
- **Permission Set Assignment** (`nav_permission_set_assignment`) — `type: 'component'`, `componentRef: 'security:permission-set-assignment'`.

The console registers the two pages under those refs; until then an entry opens the console's not-found page. The entries carry no gate of their own, exactly like the catalog entries: the Setup app's `setup.access` and the ungated group anchor decide who sees them, and they disappear wherever the plugin is not installed.

`@objectstack/platform-objects`' Setup bundles carry both labels in `en`, `zh-CN`, `ja-JP` and `es-ES`, with each translation's source digest recorded.

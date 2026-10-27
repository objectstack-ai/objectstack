---
'@objectstack/spec': minor
---

spec(ui): a navigation group that says nothing opens — `GroupNavItem.expanded` defaults to `true`

Clause-②: yes
Metadata-protocol: semantic

- **Before.** `GroupNavItemSchema.expanded` defaulted to `false`. An app parsed through `defineStack` or `defineApp` (and so every compiled `objectstack.json`) carried a written `expanded: false` on every group whose author said nothing. The console honours a written `false` as an explicit close, so those groups started collapsed. An app registered without a parse (the platform's Setup and Account apps) arrived without the key, and the console opened its groups. The protocol and the console disagreed about what a silent group means.
- **Now.** The default is `true`. A group that says nothing parses to `expanded: true` and opens on first view, the same answer the console already gave a group without the key. A group holding the current route still opens whatever it declares.
- **To keep a group closed**, write `expanded: false`. Setup's Advanced group and Account's Developer group already do, and they still collapse. Every authored `expanded` parses exactly as before, and a non-boolean is still refused.
- **Compiled artifacts.** A document that serialised an earlier parse (an `os compile` artifact) carries the old written `false`, and its groups stay closed. Recompile it, or delete the key.
- **Upgrade path.** The ADR-0087 D3 semantic entry `ui-nav-group-expanded-default-open` carries the change to `os migrate meta` and the upgrade guide. The default change is declared in the build's default-change ledger. No key is added or removed.

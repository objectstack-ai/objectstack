---
'@objectstack/cloud-connection': patch
'@objectstack/cli': patch
---

feat: `OS_CONSOLE_MAP_STYLE_URL` names a deployment's default map style, served on runtime-config and allowed by the Console's content-security-policy

Clause-②: no
Metadata-protocol: none

A map view that names no `mapStyle` falls back to a built-in style on a public demo host, so a deployment without public internet, or one whose policy forbids a third-party tile host, shows a grey map. An operator can now name the deployment's own style document once:

```sh
OS_CONSOLE_MAP_STYLE_URL=https://tiles.example.com/styles/basic/style.json
```

That one value does two things, both read at boot:

- `GET /api/v1/runtime/config` serves it verbatim as the top-level `mapStyleUrl`, the deployment's default map style. Unset, the key is absent and every other key is unchanged.
- The Console document's `connect-src` gains the URL's origin. The default demo host stays allowed beside it.

The value must be an absolute `https:` URL on a host name, with no user name, password or whitespace. Anything else stops the server at boot with a message naming the variable, the same way a malformed `OS_CONSOLE_CSP_CONNECT_SRC` entry does. The runtime-config door is anonymous, so the URL is public once set.

It is an operator setting only: there is no Setup setting and no metadata key for it, so only the person who runs the deployment can widen the Console's content-security-policy. A style whose tiles, sprites or glyphs live on other hosts still needs those hosts in `OS_CONSOLE_CSP_CONNECT_SRC`.

`@objectstack/cloud-connection` also exports `CONSOLE_MAP_STYLE_URL_ENV`, `readConsoleMapStyleUrl` and `consoleMapStyleOrigin`, the one reader both sides use. The Console's map renderer reads `mapStyleUrl` in a separate change.

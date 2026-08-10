---
"@objectstack/cloud-connection": minor
"@objectstack/cli": patch
---

feat(cloud-connection,cli): the install-local POST reports where it cached the manifest, and `os package install` quotes it (#6721)

The two endpoints of `MarketplaceInstallLocalPlugin` disagreed about one fact.
`GET /api/v1/marketplace/install-local` — the console's Installed Apps list —
served `storageDir: this.storageDir`, the ledger directory as resolved by
`LocalManifestSource` (`config.storageDir` when the host set one, the
`.objectstack/installed-packages` default when it did not). The `POST` that
performs the install did not, so its `data` block described everything about
the install except **where the install went**.

That gap was load-bearing for the one consumer of that response. `os package
install` runs on a different machine from the runtime it installs into: it
speaks HTTP and never touches the target's disk. With no directory in the
response it could only describe the cache location by literal, and the literal
it printed was the plugin's *default* — wrong for every host that configures
`storageDir`, and wrong today rather than eventually. No consumer-side fix
existed: a locally-resolved constant names the wrong machine, and importing it
from `@objectstack/cloud-connection` would make a pure-HTTP command fail at
module load wherever that package is absent. The producer is the contract, so
the fix is there.

**`@objectstack/cloud-connection` (additive, no migration).** The install POST
response's `data` now carries `storageDir`, read from the same
`this.storageDir` field the GET listing already returns — one field, two
endpoints, so they cannot drift apart again. No existing key changed, and
nothing needs to read the new one.

**`@objectstack/cli`.** The post-install hint now quotes the directory the
runtime reported:

```
  The manifest is cached on the runtime host and re-registers on every
  boot (survives restarts):
    /srv/objectstack/state/ledger-packages
```

Against a runtime older than this release — one whose response has no
`storageDir` — the CLI prints **no** directory sentence at all. It does not
fall back to the old literal: a consumer stating a value the producer declined
to state is the defect Prime Directive #12 forbids, and saying less is correct
where guessing is not. Everything else the command prints is unchanged.

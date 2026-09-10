---
'@objectstack/cli': patch
---

`os package publish` no longer publishes under a manifest id the author did not write. A `manifest.id` the artifact declares is now used or refused — never silently swapped for a derived one.

Before this, `deriveManifestId` adopted `manifest.id` only when it parsed as `PackageSchema.manifestId`, and any other declared value fell through to `local.<manifest.name slug>`. Nothing said so: the substituted id appeared in the ordinary progress line, byte-identical to the run where the artifact declared no id at all.

```
manifest.id = 'crm'      before: → Registering package 'local.acme-crm'...   (exit 0)
manifest.name = 'Acme CRM'
                          after: ✗ Invalid manifest-id 'crm'. …             (exit 1)
```

`sys_package.manifest_id` is **immutable once set** — "renaming a package requires creating a new package" — so the value chosen there is a permanent, globally unique identifier. Choosing it silently, against the author's own declaration, is the one field that must not be rewritten without a word.

- **A declared `manifest.id` reaches the existing preflight gate.** If it is not a manifest id the control plane accepts, the publish refuses before any network call, quoting the schema's own issue and description and naming where the id came from. No second rule is introduced in the CLI: the judgement is still `PackageSchema.manifestId`, which is the same schema node `CreatePackageRequestSchema.manifestId` declares for the `manifest_id` this command POSTs.
- **Honouring the declared value instead was not available.** The values that used to fall through are, by construction, exactly the ones that schema rejects, so forwarding one would only move the same refusal to the server, later and with a worse message.
- **Absent, blank and non-string `manifest.id` are unchanged** — none of those is a declaration, and each still derives from `manifest.name`, then the artifact filename.

What to do if a publish that worked now refuses: the message names the three ways out. Fix `manifest.id` in `objectstack.config.ts` to a reverse-domain id and rebuild; remove the key to keep publishing under the derived `local.…` id (the value the previous release was already using); or pass `--manifest-id`. Every id the control plane accepts publishes with unchanged bytes.

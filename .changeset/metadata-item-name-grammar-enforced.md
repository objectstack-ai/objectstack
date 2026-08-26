---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

feat(spec,metadata-protocol): declare the metadata item-name grammar and refuse it loudly at the publish door (#12194, #12176 stage 1)

**BREAKING** accept-set narrowing at the metadata write door, shipped as
`minor` under the repo's launch-window convention for breaking changes.

Metadata item names — the `name` half of the `type`/`name` pair that keys
`sys_metadata` and the `/api/v1/meta` URL space — were entirely unconstrained:
the empty string, `//`, `'Views/All Leads'` and slash-compound spellings
(`views/all_leads`) were all accepted and stored, and a slash in the name
bypassed the unrecognised-metadata-type refusal entirely (`type=fieldz
name='a/b'` was accepted and stored while `type=fieldz name='a'` was 400).
Maintainer ruling 2026-08-25 (#12176): item names must not contain `/`.

The grammar is now **declared in spec** (`MetadataItemNameSchema` /
`METADATA_ITEM_NAME_PATTERN`, `@objectstack/spec/shared`): lowercase
snake_case segments, optionally dot-qualified — the family
`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` — sourced from the existing
`ViewItemNameSchema` dotted declaration (same segment source, one grammar; the
view-item identity keeps requiring its dot). And it is **enforced at the
publish door** (`saveMetaItem` and `publishMetaItem` in
`@objectstack/metadata-protocol`): an off-grammar name is refused
`400 INVALID_REQUEST` with the grammar and the dotted prescription in the
message, and nothing is persisted. The slash bypass of
`refuseUnmintableMetaType` closes as a consequence.

**What an author writes instead.** A flat snake_case name (`crm_lead`) and a
dotted qualified name (`crm_lead.pipeline`) both work exactly as before. A
name that spelled a sub-resource with a slash (`views/all_leads`) is
re-authored with a dot qualifier (`crm_lead.pipeline` — the qualified identity
whose prefix recovers the owner) or flattened with an underscore
(`views_all_leads`); containment is expressed by structure, never by a
separator inside the identity string. A translation item conventionally named
after its locale is named in snake_case (`zh_cn`) with the BCP-47 spelling in
its required `locale` field (`"zh-CN"`), which has been the item's real
identity key all along.

Reads and `deleteMetaItem` deliberately stay open, so any pre-grammar residue
row remains listable and clearable. The in-repo stored corpus was measured at
**zero** slash-bearing item names (#12176 census, re-asserted at land time);
out-of-repo stored slash rows, if any exist, are reported by their deployment's
migrate run rather than rewritten silently.

<!-- adr-0087: registered metadata-item-name-grammar-enforced -->

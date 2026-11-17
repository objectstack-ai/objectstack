---
'@objectstack/spec': minor
---

feat(spec): the `list_datasets` output declares `candidates`, the members offered for a clarifying question when a term matched nothing (ADR-0149 D3)

Clause-②: yes (widening — an optional output field on a published schema)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-ask/SKILL.md (zero-match row reads candidates once #34763 lands)

`ListDatasetsOutputSchema` (`@objectstack/spec/ai`) gains one optional member, `candidates`, with its entry schema `DatasetTermCandidateSchema` (type `DatasetTermCandidate`) and the per-term cap `LIST_DATASETS_MAX_CANDIDATES_PER_TERM` (5). Nothing is removed or renamed, and an answer without the key parses as it did.

- **What it is.** For a term the caller sent that matched no member of any listed dataset, the members the platform offers as possible readings. Each entry is a pointer `{ term, dataset, member }` to a member listed in the same answer: `dataset` is a `datasets[].name`, `member` is `measures.<name>` or `dimensions.<name>`. Only members the caller may read are offered. The label, dataset label and description a clarifying question lists are read from that `datasets` entry.
- **What it is not.** A candidate is not a match. `matches`, and what counts as a match (equality after normalization, ADR-0149 D3 rule 1), are unchanged, and an entry carries no `matchedOn`. The platform selects none of them. The list carries no score, and its order is the listing order: terms as sent, datasets as listed, a dataset's measures before its dimensions, at most five per term.
- **When it is present.** Only when `terms` were sent and a term that matched nothing has a candidate. No candidates is the key's absence: an empty list does not parse. A term with a match has none.
- **Who fills it.** This change declares the shape only, and the tool's `outputSchema` (`getDatasetToolJsonSchemas().list_datasets.outputSchema`) lists the member from it. Filling the list is the `list_datasets` executor's change in `@objectstack/service-analytics`, which ships under its own entry; an answer carries `candidates` only from a release that has both.

ADR-0149 D3 gains an add-only amendment note recording the ruling: a term with no match and with candidates is asked about in rule 3's form and none is acted on; with no candidate, rule 4's fallback is unchanged.

Level: `minor` for `@objectstack/spec`, the level `Metadata-protocol: added` takes. The `authorable-surface/ai.json` baseline records the new keys: `ai/ListDatasetsOutput:candidates` and the three `ai/DatasetTermCandidate` members.

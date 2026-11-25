---
'@objectstack/spec': patch
'@objectstack/service-knowledge': patch
'@objectstack/knowledge-memory': patch
---

feat(service-knowledge): a knowledge search can be held to chosen records, or to the records under one parent, and the adapter filters before it ranks

Clause-②: yes
Metadata-protocol: none

A knowledge search can now look only inside chosen records, for example only inside one policy, and every one of the `topK` hits comes from inside that scope. A scope only narrows what is searched; each hit is still re-read as the caller, as before.

New, both optional, in `@objectstack/spec` (types only, no metadata key):

- `KnowledgeSearchOptions.scope?: Array<{ object: string; ids: string[] }>`. An entry naming the object a source indexes holds that source to those records. An entry naming another object reaches a source that lists, in its `metadataFields`, a `lookup` or `master_detail` field pointing at that object, and holds it to the documents whose stored value of that field is one of the ids. Entries are a union. A source no entry reaches is not searched, and a `file` / `http` source answers nothing under a scope. `scope: []`, or an entry with no ids, answers no hits; it never means "no scope". At most 10 entries, each with at most 500 ids, every `object` and id a non-empty string, no other key on an entry; past those bounds `search` refuses before any adapter is called, with an error carrying `code: 'VALIDATION_ERROR'` and `status: 400` and naming the bound.
- `AdapterSearchOptions.scope?: AdapterScopeTerm[]`, and the exported type `AdapterScopeTerm` (`{ kind: 'record', ids }` or `{ kind: 'metadata', field, ids }`). The knowledge service builds it per source from `KnowledgeSearchOptions.scope`; an adapter that reads it ranks only the documents some term holds for, filtering before it ranks, comparing values as strings (a list value matches when any element does).

`KnowledgeService` checks every hit after the adapter answers and drops a hit no term holds for, including a hit that does not carry the value, so an adapter returns the document's `metadata` on its hits. An adapter that ignores the member keeps working: its scoped searches may answer fewer than `topK`, and the service logs that once per adapter at `warn`. A source that lists two or more lookups to the scoped object is not reached by that entry, logged once at `warn` naming the fields. A `user` field is not a parent link, and a parent two hops away is not reached. How many hits the scope removed is logged, never returned.

`@objectstack/knowledge-memory` applies `scope` before ranking. `runKnowledgeAdapterContract` (from `@objectstack/service-knowledge/testing`) now requires `implements.scope`. It adds scope cases for the adapter alone, for each term kind, and cases through a real `KnowledgeService`, including one over the adapter with the member stripped.

What to do: an adapter package reads `scope` in its search, returns each document's `metadata` on its hits, and passes `implements.scope` to the contract suite. A source that should be searchable inside one parent record lists the lookup to that parent in `metadataFields`; documents indexed before the lookup was listed are in no parent scope until a complete reindex writes them again.

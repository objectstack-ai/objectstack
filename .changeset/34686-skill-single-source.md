---
'@objectstack/mcp': patch
---

fix(mcp): the data loop on `GET /mcp/skill` is the published `objectstack-ask` skill's text

Clause-②: no
Metadata-protocol: none

The page an open server serves at `GET /mcp/skill` taught the governed-metric procedure in its own hand-written words, and those words had drifted from the published `objectstack-ask` skill. The page now carries the skill's own steps, generated from `skills/objectstack-ask/SKILL.md` into the package, under a new section **Answering a business question**. A test fails when the two differ.

What a connected client now reads on that page, where it reads differently from before:

- Each word for a thing measured is decided on its own: two words with one measure each are two metrics, computed both, not a question for the user. One word that matches several measures is still a question.
- A word with no match that is a loose form of several listed measures (a bare "revenue" beside Won Revenue, Annual Revenue and Planned Revenue) is a question too, with nothing computed yet. One near form selects nothing.
- `membersWithheld: true` is reported as members (measures or groupings) the user may not read, and the metric asked for may be among them.
- The fallback to object queries reads the object's fields first, uses `aggregate_records` rather than adding pages up, opens with a line saying the answer is not from a governed metric, and names a listed dataset on that object when there is one.
- The answer is written in the user's language, with labels rather than machine names, and states its filter and time window.

The two dataset tool entries in the page's tool list now give only each tool's signature and what its answer carries. The section renders where it did before and nowhere else: only when the host carries the dataset tools and the grant has `data:read` (or names no scopes). Pages for other hosts and grants are byte-identical to before.

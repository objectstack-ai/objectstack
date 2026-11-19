---
'@objectstack/scenarios': patch
---

feat(scenarios): door mode's rules arm has a built-in corpus, `--door-rules builtin`, the hosted build door's authoring rules ported as data

Clause-②: no
Metadata-protocol: none

`--door-rules builtin` (or `OS_SCENARIOS_DOOR_RULES=builtin`) gives the door-mode client the authoring rules the hosted product's MCP build door hands its own client: 54 rules and the two corpora's preambles, rendered verbatim at that door's tier (only its tracker citations struck, as this repository's runtime strings carry none) and ported as one data module (`src/runner/door-rules-corpus.ts`, which names the source files and the revision). It carries five named sets for `--door-rules-omit`: `metadata-authoring` and `solution-design` (each corpus), `inline` and `ondemand` (what the hosted door gives up front, and what it serves only when asked by id), and `names-build-door-tools` (the rules that name a tool of the hosted build door). One rule describing the hosted runtime's timer lifecycle is left out. The corpus is judged by the same reader and the same refusals as a rules file, and the record states it as `builtin` with the sha256 of its JSON. `--door-rules FILE` still gives a rules file the maintainer supplies instead; with no `--door-rules`, the arm has no rules, as before.

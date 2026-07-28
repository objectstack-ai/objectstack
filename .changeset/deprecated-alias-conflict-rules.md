---
"@objectstack/spec": minor
---

feat(spec): the deprecated-alias warning now covers all three fold-and-drop aliases (#3743 follow-up)

#3838 introduced `lintDeprecatedAliases` — the pre-parse pass that reports an
alias the parse is about to consume — with one rule, for `action.execute`. The
issue that asked for it predicted the pass would earn its keep beyond that rule,
and it does: `execute` was never special. The spec has exactly **three**
transforms that fold an alias into its canonical key and then drop it from the
parsed output, and all three share the same failure mode — declare both slots
with different values and one of them is discarded with no signal, invisible to
every downstream check because the parse already erased it.

Two more rules, same shape, same advisory severity, same two surfaces
(`defineStack` at authoring time; `os build` / `os validate` for stacks that skip
strict `defineStack`):

- **`field-requiredwhen-conditionalrequired-conflict`** — `FieldSchema` folds
  `conditionalRequired` into `requiredWhen` (#3754). The discarded predicate
  never gates the field. Covers fields on objects *and* on object extensions.
  Compares the predicate **text**, so a bare string and the
  `{ dialect, source }` envelope it lowers into are recognised as the same
  predicate and stay quiet.
- **`agent-knowledge-sources-topics-conflict`** — `AIKnowledgeSchema` folds
  `knowledge.topics` into `knowledge.sources` (#1891). The discarded list names
  RAG sources the agent never recruits from. Compares by **set**, so the same
  sources in a different order stay quiet.

Neither fails the build; both name the two values and give the one-line fix.

Also corrects `content/docs/ai/agents.mdx`, which documented `knowledge` as
`{ topics, indexes }` and used `topics` in all three examples — teaching the
deprecated alias as if it were the canonical key, and disagreeing with
`skills/objectstack-ai/SKILL.md`, which already had it right. The examples now
use `sources`.

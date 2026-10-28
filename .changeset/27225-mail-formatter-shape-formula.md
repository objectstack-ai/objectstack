---
'@objectstack/formula': minor
---

feat(formula)!: the mail hole grammar refuses text after a hole's `|` that is not a formatter name, and reads every formatter part exactly as the in-app dialect does

Clause-②: no (narrowing) — `parseMailHole` answered `null` for a path followed by `|` whose formatter part failed its own pattern (`{{ due | date-long }}`, `{{ x | two words }}`, `{{ x | }}`), so `judgeMailHoleGrammar` never judged the hole. It now parses the hole and carries a refusal under the new rule `formatter-shape`, which `judgeHoleFormatter` judges for both dialects. One mail spelling is accepted that was refused before: a double-quoted `currency` argument (`currency:"EUR"`) kept its quotes, so `currency-code-literal` refused it, and it now reads `EUR`, publishes and renders, as in-app. The narrowing is the BREAKING arm and decides the level. The formatter parts the in-app dialect accepts and the mail pattern did not (`currency :EUR`, `default:it's`) were accepted unjudged before and are accepted now. `TemplateHoleGrammarRule` gains the member `'formatter-shape'`; the package index exports nothing new.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export is removed: a hole whose formatter part never formatted anything (the renderer printed the hole as written) is now refused where the template is judged. A conversion cannot know which formatter the author meant, and the refusal names the hole and states the shape, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing in the shared hole grammar.

- **One tokenizer.** `splitHoleFormatter` (`template-engine.ts`) splits a formatter part at its first `:`, trims both sides and removes one enclosing quote mark at each end of the argument. The in-app `parseHole` and the mail `parseMailHole` both read it, so the two dialects accept exactly the same formatter parts. The mail grammar's own pattern is gone.
- **Before.** `parseMailHole(' due | date-long ')` answered `null`: the text was not a hole to any reader, and the mail renderer printed `{{ due | date-long }}` to the recipient. `{{ amount | currency :EUR }}` and `{{ note | default:it's }}` were printed as written too, though the in-app dialect formats them. Every double-quoted argument kept its quotes: `default:"n/a"` supplied `"n/a"`, `date:"long"` and `number:"2"` reached their formatter as `"long"` and `"2"` (so `date` fell back to its short style and `number` to no fixed digits), `truncate:"80"` was not a number, `default:""` supplied `""`, and `currency:"EUR"` was refused by `currency-code-literal`.
- **Now.** A name that is not one word is refused by `formatter-shape`, whose sentence names the hole, states the shape (`{{ path | formatter[:arg] }}`, one word optionally followed by `:` and its argument) and lists `TEMPLATE_FORMATTERS`. A chained hole is still refused by `one-formatter` first, and a one-word unknown name by `known-formatter`. `currency :EUR` is `currency` with `EUR`, `default:it's` supplies `it's`, and one enclosing quote mark is removed at each end of every argument, as in-app: `default:"n/a"` supplies `n/a`, `date:"long"` is `long`, `number:"2"` is `2`, `truncate:"80"` is `80`, `default:""` supplies nothing, and `currency:"EUR"` formats in EUR. Brace text whose part before any `|` is not a path (`{{ not a path }}`, `{{ | upper }}`) is still not a hole.
- **In-app.** No accept set moves: its compile already refused these holes, and keeps its own sentence.
- **Who sees it.** A mail template whose hole writes a formatter that is not one word. No template shipped in this repository does.
- **Supersedes, in the same release.** The `known-formatter` entry of this release says text after the `|` that is not a single word "still names no formatter and is left as written". That is no longer so: it is refused, as above.

**The remedy.** Write the formatter as one of the names the refusal lists, optionally followed by `:` and its argument (`{{ due | date:long }}`), or format the value in the caller that supplies the data and pass the finished text as its own variable.

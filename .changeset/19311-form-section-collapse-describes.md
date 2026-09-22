---
"@objectstack/spec": patch
---

`FormSection.collapsible` / `FormSection.collapsed` — both keys now carry a `.describe()`, so the published reference page no longer prints two empty Description cells for two authorable booleans (#19311).

They were the only keys in `FormSectionSchema` with no contract text at all, sitting between neighbours that have it, and the dependency between them was published nowhere. **Both** are described rather than only `collapsed`: the sibling silence is what made the gap ambiguous in the first place, and describing one of a pair recreates it one key over.

Measured against the built package, `FormSectionSchema.safeParse` on one section:

| authored on the section | `collapsible` after parse | `collapsed` after parse |
| :--- | :--- | :--- |
| neither | `false` | `false` |
| `collapsible: true` | `true` | `false` |
| `collapsed: true` | `false` | `true` |
| `collapsed: true` + `collapsible: false` | `false` | `true` |
| both `true` | `true` | `true` |
| both `false` | `false` | `false` |

- **Parse does NOT normalize the pair, in either direction.** `{ collapsed: true }` parses to `{ collapsible: false, collapsed: true }` verbatim, and `safeParseAsync` agrees. So the implication `collapsed` ⇒ `collapsible` — ruled 2026-09-18, letter A — is a **renderer** rule applied from the declaration, and the describes say exactly that rather than implying a fold the schema does not perform. A consumer reading the parsed `collapsible` is reading what the author typed, never whether a disclosure control renders.
- **This is the opposite of the `ObjectFieldGroup` pair**, where a parse-time mapping really does fold the old booleans onto the ADR-0085 `collapse` enum. The two surfaces share key names and share nothing else; the describes say so.
- **Text only.** No key is added, removed or re-typed, no accept set moves and no refinement changes: `check:authorable-surface` and `check:api-surface` are both green with no delta, and the wizard-step and `group` co-declaration refusals parse identically before and after (only `true` is refused in either place; `false` is accepted in both).

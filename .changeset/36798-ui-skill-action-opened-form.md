---
'@objectstack/skills': patch
---

docs(skills): the UI skill says a default or create form an action opens by name still loads and is not reported

Clause-②: no
Metadata-protocol: none

objectstack-ui `rules/list-views.md` "Form Views" said `os validate` warns `form-view-internal-not-loaded` on every container `form`, `formViews.default` and `formViews.create`. The rule leaves out one that a `type: 'form'` action's literal `target` names, because the Console still loads that form where the action opens it. The passage now says so, and that such a form loads as a named form. The list of what an internal form no longer steers (sections, tabs, steps, `subforms`, `defaults`, `modalSize`) is dropped to pay for the new words: the file stays at its token ceiling and its line count is unchanged.

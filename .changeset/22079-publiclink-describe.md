---
'@objectstack/spec': patch
---

The `sharing.publicLink` describe says the value is a slug and names where it is served

Clause-②: no

`FormView.sharing.publicLink` described itself as a "Generated public share URL". It is
neither: the author chooses it, nothing generates it, and the server reads it as a slug, where
`/forms/x`, `forms/x` and `x` name one slug, `x` (`publicFormSlug`). The describe now says so,
and names where an anonymous visitor reaches the form while `enabled` and `allowAnonymous` are
both true: the REST form door `GET /api/v1/forms/:slug` (on the default API base), and, on a
host that serves the console, the console page `/_console/f/:slug`, with `/forms/:slug`
redirected there and its query string carried. The generated `ui/sharing` and `ui/view`
reference pages carry the new text. Describe text only: the accepted values, keys, types and
exports do not change.

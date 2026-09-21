---
'@objectstack/platform-objects': patch
'@objectstack/plugin-email': patch
'@objectstack/service-messaging': patch
---

docs(email): the shipped carriers said "best-matching locale"; the resolver matches `(name, locale)` exactly (#18499)

Clause-②: no — no accept set moves and no published payload key changes; the
corrected prose ships as JSDoc in each package's `dist/*.d.ts` (and, for
`@objectstack/service-messaging`, inside the bundled `dist/index.js`), which is
why this is a changeset rather than `skip-changeset`.

`packages/plugins/plugin-email/src/template-loader.ts` already enumerates
"the EmailService picks the best-matching locale" as a FALSE declaration, and
three shipped carriers still stated it. Measured against the code at this
branch's base rather than against the card's transcription:

- `createSysEmailTemplateLoader.load` — `locale` given ⇒ exact `{ name, locale }`
  match ordered by `id`, or `null`; `locale` absent ⇒ `{ name, locale: 'en-US' }`
  first, and only if that misses `{ name }` ordered by `locale` ascending;
- `EmailService.resolveAndRenderTemplate` — `wanted = input.locale?.trim() ||
  'en-US'`, then exactly one retry at the literal `'en-US'` when the call NAMED a
  locale, then `TEMPLATE_NOT_FOUND`; the unpinned rung is reachable only for a
  call that named no locale.

No language-subtag folding anywhere on that path, and nothing that could be
called a "best match". Corrected:

- `sys_email_template`'s object doc (`@objectstack/platform-objects`) now states
  the exact match, the single `en-US` rung and the no-locale last resort;
- `sys_notification_template.locale`'s sibling-declaration comment
  (`@objectstack/service-messaging`) said "both resolve a template by
  best-matching locale", which was false in a second way: the two resolvers do
  not agree. `NotificationTemplateStore.load` walks `(topic, channel, locale)`
  through a candidate list — the named tag, its primary subtag, then
  `DEFAULT_LOCALE` (`'en'`) — so it DOES fold a subtag, where
  `sys_email_template` does not. Only the shared 16-char BCP-47 bound is shared;
  the resolution is not, and the comment now says so;
- `template-loader.ts`'s own "What was wrong" block quoted two sentences it can
  no longer quote — one was already stale at this base (the
  `EmailTemplateDefinitionSchema.locale` text it reproduces has zero occurrences
  in `packages/spec` today) and the other is corrected above. Both bullets are
  now cited rather than quoted, so a later rewording cannot strand them again.

No resolution behaviour changes: every edit in this changeset is prose.

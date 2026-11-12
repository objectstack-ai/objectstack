---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

feat(spec, lint): user-facing refusal and advisory text is declared to be in the request's locale, and the security-posture advisories carry a user sentence in every platform locale

Clause-②: yes
Metadata-protocol: added

The two error envelopes' `userMessage` (`ApiErrorSchema`, `EnhancedApiErrorSchema`) now state their language: the producer composes the text in the request's locale (the locale the request names, else the workspace default, else `en`, each read against the platform locale table), and consumers render it as received. The field's meaning is unchanged: producer-marked user-facing text, verbatim, present only when the producer opted in.

`RuntimeAuthoringIssueSchema`, the one finding shape of the save and publish doors' `advisories[]` and the 422's `issues[]`, gains an optional `userMessage` under the same rule: the finding's sentence for the person who saved the metadata, beside the unchanged `rule` id. `message` and `hint` stay the developer-facing English. A response without it parses exactly as before, and a client that parses the response now keeps the key instead of stripping it.

`@objectstack/lint`: an authoring finding may carry `userTextParams` (the object, field and permission-set names its user sentence interpolates), and `findingUserMessage(finding, [requestLocale, workspaceDefault])` (on the root entry and on `@objectstack/lint/runtime`) renders that sentence from the producer's own catalog, falling back to the workspace default and then to `en`. The seven advisory rules of the security-posture linter (`security-private-no-readscope`, `security-master-detail-ungranted`, `security-book-audience-unknown-set`, `security-superuser-field-mask-inert`, `security-controlled-by-parent-master-reference-hidden`, `security-update-policy-no-check`, `security-controlled-by-parent-owner-policy-without-opt-in`) carry their names and have a sentence in all eleven platform locales, in `validate-security-posture.user-text.ts` beside the rule. Their rule ids, messages and hints are unchanged. Because the finding objects now carry `userTextParams`, `os validate --json` and `os build --json` show that key on those seven findings in `warnings`. The save door does not put `userMessage` on its responses yet; the server change that does is separate work.

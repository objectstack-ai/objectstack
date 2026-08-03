---
'@objectstack/spec': major
'@objectstack/example-todo': patch
---

feat(spec)!: retire the six remaining `authorWarn` dead keys — book/group `translations`, `job.id`, `translation.validationMessages`, `app.homePageId`, `app.areas[].order` (#4667)

The #4488 liveness audit marked as `authorWarn` the keys whose *declaration*
actively misleads — not merely unread, but shaped so an author reasonably
concludes they configure something. #4509 and #4583 cleared the rest; these six
are what remained, and each shipped with its own reason for reading alive.

**The retirement kit:**

| FROM | TO | Fix |
|---|---|---|
| `book.translations` | *(removed)* | Delete the key. Localize the **docs** — `doc.translations` is live on every doc render path. |
| `book.groups[].translations` | *(removed)* | Same. Tombstoned, since `BookGroupSchema` is not `.strict()`. |
| `job.id` | *(removed)* | Delete the key. `name` is the job's identity everywhere. |
| `translation.validationMessages` | *(removed)* | Delete the key. Author the message on the rule: `object.validations[].message`. |
| `app.homePageId` | *(removed)* | Delete the key. Reorder `navigation`; set `isDefault` for the root landing. |
| `app.areas[].order` | *(removed)* | Delete the key. Reorder the `areas` array itself. |

Run `os migrate meta --from 16` to rewrite existing sources automatically.

**Each read alive for a different reason, and the prescriptions say which:**

- **book `translations`** — *proximity*. `doc.translations`, two files over, same
  name and shape, works on every read path. The book-level map was parsed,
  stored and round-tripped, and rendered in the authoring locale to every
  reader: the tree endpoint and the portal emit `label` / `description`
  verbatim.
- **`job.id`** — *its own description*. "Defaults to `name` when omitted"
  advertises an identity override that does not exist. `name` is the scheduling
  key, the `sys_job` row key, and the `JobExecution.jobId` stamp — so two jobs
  differing only in `id` were one job declared twice.
- **`translation.validationMessages`** — *the platform's own signposts, twice*.
  The schema example showed a concrete override, and #3778's legacy-key
  migration table steered retired `errors:` authors straight into it. **That
  guidance entry is rewritten here**: retiring one dead key by pointing at
  another is the defect, not the fix.
- **`app.homePageId`** — *a second source for one fact*. Not unread: objectui's
  console consumed it in `resolveLandingRoute()` and it was the only thing
  deciding where an app opened. (This entry first shipped saying otherwise;
  corrected in #4709, which upheld the removal.) What condemns the key is its
  shape — an ID cross-reference into `navigation` with no referential integrity,
  falling back to the first item *silently* when the id dangled. If "land
  somewhere other than first" is ever wanted again it belongs on the navigation
  item itself, not on a pointer that can miss.
- **`app.areas[].order`** — *the sibling that works*. Nav-item `order` really is
  sorted; area-level order never was, and both renderers iterate the array as
  authored.

**Routes differ, deliberately.** `book.groups[].translations` and
`app.homePageId` are **tombstoned** (`retiredKey`: `never` at compile time, a
prescription at parse time) — the group schema is a plain `z.object`, where a
bare delete would have zod silently strip the key, trading one silent no-op for
another. The other four are strict deletions carrying `guidance`. Retired alias
spellings (`i18n`, `home`, `homepage`, `landingpage`, `sort`) route to the same
prescriptions rather than renaming onto keys that are gone.

Registered as three ADR-0087 D2 conversions (`book-translations-removed`,
`job-id-removed`, `translation-validation-messages-removed`) plus an extension
of `app-dead-authoring-keys-removed`, all wired into the protocol-17 D3 chain.

**Also corrected, both found by the gates rather than by grep:** the published
`objectstack-i18n` skill taught `validationMessages` in a copy-paste example
(an AI reproduces that verbatim), and `examples/app-todo` authored the group in
three locales — where the `en` entries merely duplicated the rule's own text and
the zh-CN / ja-JP translations had never once been rendered.

After this, the only `authorWarn` keys left in the ledger are the two fail-open
area gates tracked in #4651, which need a decision rather than a patch.

# @objectstack/skills

## 18.0.0-next.3

### Patch Changes

- 46ca793: docs(skills): the `objectstack-ui` pages rule says what a page type, template and region name run (#23610)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/pages.md` taught `home` as the app's landing page, `utility` as a floating utility panel, templates `two-column` / `single-column` and regions `left_sidebar` / `right_sidebar`, and `kind: 'jsx'` as a live alias of `html` — none of which the console draws or the spec accepts. The rule now states the declared contract: `home` is the widest region page and not a landing (an app opens on its first navigation item; `isDefault` on it is refused), `utility` is a narrow inline region page with no floating or docked shell slot, `template` is one of `default`, `header-sidebar-main`, `three-column` or `dashboard` with the regions each one places (`sidebar` left, `aside` right; `full-width` retired), a region the template does not place or a second region for a filled slot is refused at its `name`, and `kind: 'jsx'` is refused with the prescription `html`. Skill text only; nothing an author writes changes.
- b711056: docs(skills): the `objectstack-ui` navigation rule states the derived record surface per flow — viewing routes to a page, creating or editing opens a modal bounded on desktop and full-screen on mobile, a light record uses a drawer (#23753)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/navigation.md`'s Surface bullet said a field-heavy object opens create/edit/detail as a full page and that mobile always pages. The platform's derivation (`deriveRecordFlowSurface` in `@objectstack/spec`) routes only the `view` flow to a page; the create, edit and child task flows never route — a field-heavy record, or any record on mobile, opens them in a modal that is bounded on desktop and full-screen on mobile, and a light record on desktop opens every flow in a drawer. The bullet now states that mapping and names the override only where the spec declares it: `navigation.mode` on the list view (`navigation` is not an object key). Text only; nothing an author writes changes.
- 2fdfb5d: docs(skills): the `objectstack-data` datasources rule states that `default` is host-reserved — the host connects it from `OS_DATABASE_URL`, and a stack that declares a datasource named `default` is refused (#23768)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/datasources.md`'s opening paragraph read "Most apps need only the `default` datasource; declare more to read/write a separate or external database." "Declare more" implied that `default` is declared too, and a stack whose `datasources` collection carries an entry named `default` is refused at `defineStack`, `os validate`, publish and boot: the host declares and connects `default` itself. The sentence is replaced by the rule the spec and runtime hold: `default` is host-reserved, the host connects it from `OS_DATABASE_URL`, a stack that declares a datasource named `default` is refused, and a datasource is declared under its own name only to read/write a separate or external database. The added words are paid for inside the same file by deleting two restatements of the field reference: "`external` settings are required when `schemaMode !== 'managed'`" (the schema refuses the omission itself) and "Set `autoConnect: true` to force a live connection" (the auto-connect list two lines above already names it). No behaviour changes; nothing an author writes changes.
- 49700e4: docs(skills): the `objectstack-api` skill stops teaching an app to mount routes on `http.server` — an app declares `apis:`, computes in a flow, and registers code as a stack function or a connector (#23787)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md`'s decision table sent an endpoint that needs code to an imperative `http.server` mount on `kernel:ready`, and its "Code routes" section taught that mount. Ruling C′ item 2 on #23128 retired the mount as an app-author surface: the `http.server` service is the platform plugins' own door-building primitive. The table now points code at a `type: 'flow'` endpoint whose `script` node runs a stack function (`defineStack({ functions })`) or whose `connector_action` node calls a declared connector, names the inbound `type: 'api'` flow hook for a webhook signed with ObjectStack's own `x-objectstack-signature`, and states the three cases that have no app surface today (a third-party callback verified by its own signature over the raw body, a streaming response, a protocol the platform does not speak) instead of inventing one. The "Code routes" section is deleted, and eval 3 expects that answer. Skill text only; nothing an author writes changes.

## 18.0.0-next.2

### Patch Changes

- 11d4c5a: docs(skills): the `objectstack-data` lint-rule reference drops `security-external-wider-than-internal`, retired with `externalSharingModel` (#23268)
  
  Clause-②: no
  
  The row named a rule `@objectstack/lint` 18 no longer has, and nothing an author writes changes.
- 5477020: docs(skills): the `objectstack-data` security rule states a grant's uniqueness as the declared `unique: 'organization'` index holds it, in place of the retired `permission_set_id` column (#23615)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/security.md`'s grant paragraph closed with "`permission_set_id` is a legacy column: do not write it." The grant object `sys_user_permission_set` no longer declares that column, so a write naming it is refused `400 INVALID_FIELD` as an undeclared field, and the sentence taught an AI author a key the declared shape does not have. The sentence is replaced by the rule the declared shape holds: one grant per user, set and organization, enforced by the join object's `unique: 'organization'` index on (`user_id`, `permission_set`, `organization_id`). The by-name reference — `permission_set` takes the set's `name` — and its refusals are unchanged. No behaviour changes; nothing an author writes changes.

## 18.0.0-next.1

### Patch Changes

- 44cadd3: fix(skills): the automation skill teaches flow value slots as a CEL envelope or a literal and text slots as `{{ }}` holes; the single-brace `{…}` dialect leaves the catalog text
  
  Clause-②: no
  
  The `objectstack-automation` skill no longer lists `{$User.<path>}`, `{NOW()}` / `{TODAY() ± N}` or any other single-brace `{…}` token as a spelling a flow value slot still reads, and the remedies it gives no longer pass through a refused spelling. What the skill now teaches is what the platform accepts:
  
  - A value slot — `assignments.*`, `fields.*`, a `subflow` / `map` `input.*`, a `script` `inputs.*`, a `loop` / `map` `collection`, a notify node's `recipients` / `templateData.*` / `sourceId`, an `http` node's `body`, each CRUD `filter` operand — takes a CEL value envelope `{ dialect: 'cel', source: '…' }` or a literal. A `{…}` token there is refused at `objectstack validate` (`expression-invalid`), `registerFlow` and the executor, naming its CEL spelling.
  - A text slot — notify `title` / `message` / `actionUrl`, screen `title` / `description`, end `message`, `http` `url` and `headers` — renders `{{ }}` holes.
  - The run user is `current_user.id`, guarded as `current_user != null ? current_user.id : null` in a flow that can run without a user; the date macros are `isoDate(today())`, `isoDate(daysFromNow(N))` / `isoDate(daysAgo(N))`, `isoDatetime(now())` and `isoDatetime(addDays(now(), N))`.
  - A CRUD `filter` operand that is a whole-string query placeholder (`{current_user_id}`, `{today}`) passes through to the query engine untouched; an operand that evaluates to `null` refuses the node.
  - A notify `recipients` value is one id, a list, or an envelope that evaluates to one, a list or `null` — a comma-separated string is one recipient.
  
  The `objectstack-query` skill's filters rule names the value-slot judge (`expression-invalid`) in place of the retired lint rule `flow-filter-token-unknown`, and the automation eval set's two expected outputs that spelled a retired token move with the text.
- 197fbe2: docs(skills): both READMEs the package ships install the catalog from `@objectstack/skills` at the installed `@objectstack/spec`'s version, and name the GitHub path only as the `next` channel (#22668)
  
  Clause-②: no
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) are the two READMEs this package ships. Both now give the same two-step install the docs give: `npm install --save-dev "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, then `npx skills experimental_sync --agent claude-code -y` — the catalog's version is then the installed spec's.
  
  Before: the npm page taught a bare `npm install --save-dev @objectstack/skills`, which on a project depending on `@objectstack/spec` 17.x installs `18.0.0-next.0`, the next major's catalog (the registry's `latest`); its example named `@objectstack/skills@17.7.0`, a version that was never published; and it did not say that the sync skips every skill a `skills add` installed, which is every project `create-objectstack` scaffolded through `18.0.0-next.0`. The catalog's front page still taught `npx skills add objectstack-ai/objectstack/skills …` as the install command for existing projects.
  
  Both pages now state which versions exist (published from `18.0.0-next.0` on; no 17.x, so step 1 answers `ETARGET` there), the update story (bump `@objectstack/skills` with the other `@objectstack/*` packages, then re-run the sync), and the GitHub path once, as the `next` channel: the unreleased `main`, for trying the next version's skills, not for a released project. Nothing under `dist/skills/*/` changes.
- 713f231: docs(skills): the upgrade skill's preflight re-installs the catalog from `@objectstack/skills` when a 17.x project moves to 18, and both READMEs give the scaffolder's pinned `--copy` sync (#23276)
  
  Clause-②: no
  
  `objectstack-upgrade`'s §0 Preflight gains one step for the skills themselves. A 17.x project's skills were installed with `skills add` from the repository's `main`; their `skills-lock.json` entries read `sourceType: github`, and `experimental_sync` skips them (it prints `Skipped … installed with skills add` and exits 0), so a project that only bumps its packages keeps its 17.x-era skill text. The step removes the eleven `objectstack-*` skills the catalog carried during 17.x (a name not installed is skipped; `--all` when they are the project's only skills), installs `@objectstack/skills` at the installed `@objectstack/spec`'s version, and copies it with `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` — the command `create-objectstack` runs. The step is paid under the token ratchet by deleting text the same file restates elsewhere; the ceiling is unchanged.
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) replace the unpinned linked sync (`npx skills experimental_sync --agent claude-code -y`) with that pinned `--copy` spelling and say why: without `--copy` the sync writes links into `node_modules`, which a clone of a project that commits its skills does not have.
- 68e64dd: fix(skills): the automation skill's two reference files write a CRUD `filter` operand as a CEL value envelope or the `{today}` query placeholder; the single-brace `{…}` filter spelling leaves them
  
  Clause-②: no
  
  `skills/objectstack-automation/references/examples-flows.md` and `references/state-machines-and-approvals.md` no longer teach `'{TODAY()}'`, `'{TODAY() + N}'` or `'{record.id}'` at an `update_record` filter operand — spellings the platform refuses (`expression-invalid`) at `objectstack validate`, `registerFlow` and the executor, so an author who copied the example got a refused node. The examples now write what the platform accepts: the query placeholder `'{today}'` for today's date, a CEL value envelope `{ dialect: 'cel', source: 'isoDate(daysFromNow(N))' }` for a one-day window at a date offset, and `{ dialect: 'cel', source: 'record.id' }` for the triggering record's id. The prose names the CEL value envelope where it named a template token (and no longer says a CEL envelope is compared as a literal at a filter operand), and the time-word cheat sheet names the CEL envelope and the `{{ }}` text hole where it named the retired `{…}` template.

## 18.0.0-next.0

### Minor Changes

- 165587e: New published package `@objectstack/skills`: the ObjectStack skills catalog (`skills/**` of the repository), shipped in the changeset `fixed` group so it always carries the version of the `@objectstack/*` packages it teaches. Its build copies the catalog into `dist/skills/<skill>/…` byte for byte (the layout the skills CLI's `experimental_sync` reads from `node_modules`), and `files` lists only that tree. The repository's `skills/**` stays the one source of truth and the documented `next` channel; nothing a consumer writes changes.
  
  `@objectstack/spec`: `llms.txt`'s package-ecosystem count reads 69 with `@objectstack/skills` joining the scope.

### Patch Changes

- e4a770d: docs(skills): the `objectstack-ai` skill names the `agent` type's environment-overlay switch by its protocol-18 spelling, `allowEnvironmentOverlay:false` (#22340 S3)
  
  Clause-②: no
  
  `skills/objectstack-ai/SKILL.md`'s "Platform agents — reference only" section said the `agent` type is closed with `allowOrgOverride:false`. That key was renamed to `allowEnvironmentOverlay` in protocol 18 (ADR-0131 D6 retired the per-organization overlay axis, so the key names the one scope it governs; the old key stays on the registry entry schema only as a tombstone that refuses at parse with the new name in its prescription), so the published line now reads `allowEnvironmentOverlay:false`. The value, the `allowRuntimeCreate:false` beside it and the ADR-0063 §2 citation are unchanged; nothing an author writes changes. The same rename is recorded in `AGENTS.md` rule 7 and as header amendment notes on ADR-0005 and ADR-0010, none of which publishes.
- 179f7bf: fix(skills): the `objectstack-data` field-types rule names all five formula `returnType` members, `'currency'` included, and the `currencyConfig` a currency formula carries (#22743)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/field-types.md` taught a formula's `returnType` as the four-member set `'number' | 'text' | 'boolean' | 'date'`, and its formula example said `(no 'currency')`. `@objectstack/spec`'s `FieldSchema.returnType` is the five-member enum `'number' | 'text' | 'boolean' | 'date' | 'currency'`, and a formula whose `returnType` is `'currency'` carries its currency in its own `currencyConfig` — `CurrencyConfigSchema`, the same shape a `currency` field declares; absent, the mode is `dynamic`, the tenant default currency. The `formula` table row and the formula example now both state the five-member set and name `currencyConfig` as the carrier. The example's `CEL — record. prefixes required` comment, which restated the table cell above it, is removed to pay the skill's token ratchet. Nothing is said about how a currency formula renders.
- eed637c: docs(automation): every text that teaches a sender of an inbound `api` hook teaches the timestamped `x-objectstack-signature` form only — `t=<unix seconds>,v1=<hex>`, the HMAC-SHA256 of `<t>.<raw body>` under the flow's secret, refused when `t` is more than 300 seconds from the server clock
  
  Clause-②: no
  
  The inbound hook door has accepted the timestamped form since `signHttpBodyAt` landed in `@objectstack/core`, and it is the only form that stops a captured post from verifying forever; the published teaching still showed the body-only `sha256=<hex>` form. The guidance converges first; the door's refusal of the body-only form is a later change of its own.
  
  - **`@objectstack/skills`.** The `objectstack-automation` skill's Inbound webhook section teaches `t=<unix seconds>,v1=<hex>`: `v1` is the HMAC-SHA256 of `<t>.<raw body>` under the start node's `secret`, and the door refuses a `t` more than 300 seconds from its clock. The body-only form is no longer shown.
  - **`@objectstack/lint`.** The hint of `flow-api-trigger-secret-missing` and its `os explain` entry describe the same form. The rule's id, severity, verdict sentence and judgement are unchanged.
  - The showcase example's comment and the platform checklist's intake recipe sign the same way.
  
  **Nothing to migrate for an author.** A sender that already signs with `signHttpBodyAt` is unchanged. **The outbound contract stays as published:** the messaging outbox and the flow `http` node keep signing body-only (`signHttpBody`) for third-party receivers, and the inbound door's accept set is not changed by this release.
- e9e10fd: docs(skills): the `objectstack-data` indexing rule's partial-index example teaches the rule with an application-shaped index instead of restating the platform's overlay uniqueness key (#23039)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/indexing.md`'s "Access methods and partial indexes" section illustrated a partial index with the platform's own overlay-uniqueness DDL and said that was what `ensureOverlayIndex` runs. The quoted key had four parts; the platform's runtime key has carried a fifth, `bundle_member`, since protocol 18, so the sentence stated something the platform no longer runs. The example is re-cut to an application-shaped partial index — one *active* subscription per account, the coarse `{ fields: ['account_id'] }` declared in metadata and the unique partial form built in a migration — so the rule is taught without restating a platform key that changes on its own schedule. The rule itself is unchanged: declare the coarse index (or none) in metadata, build the partial form as raw SQL in a runtime migration, fall back to a plain index on a dialect that rejects the predicate. Nothing an author writes changes.

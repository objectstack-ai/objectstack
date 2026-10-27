# @objectstack/skills

## 18.2.0

### Minor Changes

- 493a6c4: feat(spec,metadata-protocol): a seed dataset column can be written only when its row is created (`columns.FIELD.applyOn: 'create'`)
  
  Clause-②: yes
  Metadata-protocol: added
  
  A seed is replayed on every dev-server boot and every package re-publish, and an `upsert` replay re-asserts every column a record declares on the row it matched. That reverts the columns an app's own jobs write after the first seed (a status a payment job advances, a flag a renewal job sets), so a re-run undid the jobs' work with nothing in the log.
  
  A seed dataset now takes a per-column write policy, keyed by field name:
  
  ```ts
  defineSeed(Instalment, {
    externalId: 'code',
    columns: {
      status:      { applyOn: 'create' },
      is_expiring: { applyOn: 'create' },
    },
    records: [{ code: 'INS-001', amount: 1200, status: 'pending', is_expiring: false }],
  });
  ```
  
  - **`applyOn: 'create'`** writes the column when the seed creates the row and leaves it out of every write to a row the seed matched by its `externalId`: an `upsert` replay over an existing row, and every row of an `update` dataset. The matched row keeps the value it holds, while the `always` columns are refreshed. A row whose only differences are create-only columns is not written at all. A create-only reference column on a matched row is not resolved and not deferred to pass 2, so nothing later in the load writes it back. A column of the `externalId` is the key the row was matched by and stays in its update. `insert`, `ignore` and `replace` never update a matched row, so nothing changes on those modes.
  - **`applyOn: 'always'`** (the default, and every column without a `columns` entry) is the behaviour before this change.
  - The values, the default and the meaning are those of the import door's `FieldMappingEntry.applyOn`. Both doors now read one enum, exported as `ColumnApplyOnSchema` from `@objectstack/spec/data`. `SeedColumnSchema` (with `SeedColumn` / `SeedColumnParsed`) is the per-column shape.
  - A `columns` key must name a column the object has: a declared field, or a system column the platform injects on it such as `owner_id`. `defineSeed` refuses one that does not when it runs (and at compile time for an object literal), naming the key with a near miss. The seed loader logs an `error` naming the column, once per dataset, whenever it loads a seed that names one, since a stored seed never passes through `defineSeed`. The rows still load.
  - `SeedSchema` refuses an unknown key on a column (`unrecognized_keys`), and a dataset-level `applyOn` is pointed at `columns`.
  
  `@objectstack/skills` only regenerates its schema reference indexes, which now list `SeedColumnSchema` and `ColumnApplyOnSchema`.

### Patch Changes

- f3d0eab: docs(skills): the objectstack-automation capability table says a declared webhook or auto-launched flow is refused without its `requires` pair, not silently undelivered
  
  Clause-②: no
  Metadata-protocol: none
  
  The 〈Prerequisite — declare the capabilities your nodes need〉 table in `objectstack-automation/SKILL.md` said that without `webhooks` in `requires` "nothing [is] delivered outbound", and that without `triggers` "flows register, never fire". Neither is what `defineStack` does: a declared webhook while `requires` omits `webhooks`, `realtime` or both is refused with `STACK_WEBHOOK_CAPABILITY_REQUIRED` (422), and an auto-launched flow while `requires` omits `triggers`, `automation` or both is refused with `STACK_TRIGGER_CAPABILITY_REQUIRED` (422) — at `os validate`, `os build`, `os dev` and `os serve` alike. The two rows now name the pair each surface owes and the refusal code; the lead-in says the refusal is at load time and that neither token implies the other. The `requires: [...]` example block under the table is folded into the lead-in to keep the skill within its token ceiling.
- 061cc94: docs(skills): the objectstack-platform bootstrap example pins every `@objectstack/*` dependency to one exact version
  
  Clause-②: no
  
  The 〈Complete Working Example〉 `package.json` in `objectstack-platform/references/bootstrap.md` gave `^17.0.0` for its five `@objectstack/*` packages, a major behind and a caret range the v18 docs advise against. It now gives `18.1.0` for each, the exact form `create-objectstack` writes, with all of them on one version.
- 992a7e1: docs(skills): the objectstack-platform stack-config example declares `engines: { protocol: '^18' }`, the major the 18.x boot handshake accepts
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-platform/SKILL.md` taught `engines: { protocol: '^17' }` in its `defineStack` manifest example while `PROTOCOL_VERSION` is `18.0.0`, so a config copied from the skill was refused at boot (`OS_PROTOCOL_INCOMPATIBLE`). The example, the eval that pins it (`evals/config-plugins-ops.json`, prompt and expected output together) and the `objectstack-upgrade` sentence describing what the scaffold writes now all say `'^18'`, matching `create-objectstack` and every example app. The `'^17'` → `--from 17` worked example in `objectstack-upgrade` is unchanged.
- d0eac35: docs(skills): the automation skill's inbound-hook table names `config.secretRef`, the form a package ships instead of a literal secret
  
  Clause-②: no
  
  Metadata-protocol: none
  
  The `objectstack-automation` skill's start-node table said an `api` flow needs a non-blank literal `secret`, or the flow is refused at registration. An `api` flow's start node may now name its secret instead, with `secretRef: 'NAME'`: the deployment fills that name (an environment variable in the open tier, never `OS_*`), and the engine reads it at every post, answering `503` while the name is unfilled. The row now says either one is required, and that a package ships `secretRef` and never commits a literal. The signature line names the `x-objectstack-signature` header the row used to carry.
- 8f35ffc: docs(skills): object-level `composite` / `repeater` are untyped JSON — a typed list is a child object
  
  Clause-②: no
  Metadata-protocol: none
  
  The `objectstack-data` field-types table said a `composite` carries "declared sub-fields". An object field has no member that declares them: `fields`, `subFields` and `columns` are refused on the field. The two rows now say the types are untyped JSON and that a list needing typed columns is a child object with a `master_detail` field (`inlineEdit: 'grid'` edits it inline on the parent's form).
  
  What to do: nothing. No key, value or behaviour changes.
- d65cbb6: docs(skills, spec): state that every published package declares exactly one anchor-safe `isDefault: true` permission set
  
  Clause-②: no
  Metadata-protocol: none
  
  `objectstack-data/rules/security.md` said what `isDefault: true` means (the `everyone` baseline, ADR-0090 D5) but not that a published package must declare one. Its `isDefault` bullet now states the requirement as a check an author can run: exactly one such set, anchor-safe, meaning `describeAnchorForbiddenBits(set, 'everyone')` from `@objectstack/spec/security` returns `null`; otherwise lint rule `security-anchor-high-privilege` and the binding refuse it. It also says what happens without one (invited members get nothing until an admin assigns a set to each) and that no gate counts the sets. The Marketplace Protocol header in `marketplace.zod.ts`, which the generated marketplace reference page renders, gains a matching "What a published package declares" section. No lint rule or schema changes. To stay within the skill file's token ceiling, three source-path asides, a section reference and one sentence are trimmed in the same file.
- a8f2afa: docs(skills): the `objectui` skill joins the published catalog, so `@objectstack/skills` ships the `@object-ui/*` authoring skill beside the `objectstack-*` ones
  
  Clause-②: no
  Metadata-protocol: none
  
  - **What ships.** `skills/objectui/` (its `SKILL.md`, 11 guides, 3 rules, 11 evals and a README) moves in from the objectui repository's own `skills/` tree. A project that syncs `@objectstack/skills` now gets an `objectui` skill in its agent directory, and `npx skills add objectstack-ai/objectstack/skills` lists it on the `next` channel.
  - **Stamped like the others.** Its `compatibility:` line now reads `Requires @objectstack/spec 18.x`, and `metadata.version` carries the workspace version, as on every catalog skill.
  - **Content changes on the way in.** The guides use the platform's vocabulary: expression examples gate on `data.status` or a user position, not on a `role` field, and the expressions guide gates a combined condition with `visibleWhen` instead of the deprecated `visibleOn`. The `@object-ui/permissions` example keeps its real `roles` keys, and the plugin guide's color input passes `value ?? ''` instead of a hard-coded black fallback.
- 2409c9c: chore(packages): ship a LICENSE in the 14 published packages that had none
  
  Clause-②: no
  Metadata-protocol: none
  
  npm packs a package's own `LICENSE` whatever its `files` says, and nothing in the release tooling copies the repository's root `LICENSE` into a package, so these 14 published tarballs carried no licence text at all while declaring `"license": "Apache-2.0"`. Each now carries a byte-for-byte copy of the root `LICENSE`, the same file the other 59 published packages already ship. With this, every one of the 73 published packages outside `ui/` ships a LICENSE and a README.
- 8061f33: chore(packages): publishing metadata — per-format types in `exports`, declared `sideEffects`, and a README for the 18 published packages without one
  
  Clause-②: no
  Metadata-protocol: none
  
  Measured on a fresh `origin/main` build of all 73 published packages outside `ui/`, each staged as `npm pack` would ship it, with publint 0.3.25 and @arethetypeswrong/cli 0.18.5. Before: 73 of 73 packages carried at least one publint message and 48 carried an attw problem. After: 3 packages carry a publint message and 16 carry an attw problem, each remaining class needing a change this one deliberately does not make — an export-map shape change, or a dual-build fix in `@objectstack/core`.
  
  - **Types per module format.** On 38 manifests one `types` entry served both formats, so a TypeScript consumer importing the ESM build was handed the CJS declarations — every one of attw's 38 `FalseCJS`. Each `{types, import, require}` entry becomes `{import: {types, default}, require: {types, default}}` pointing at the declaration file the same tsup run already emits for that format. No subpath is added or removed, and no JavaScript target moves. `@objectstack/core` keeps its single `types` entry: its `.d.ts` and `.d.cts` declare the same classes with private members, so serving them per format gives a consumer that reaches `core` through both resolution modes two incompatible `ObjectKernel` types, which is `@objectstack/plugin-dev`'s declaration build (it awaits `import('@objectstack/objectql')` inside a CommonJS build). Its `FalseESM` therefore stays, measured and unfixed here.
  - **`sideEffects` on the 72 manifests that declared none**, read per package rather than set in bulk: `@objectstack/service-cluster-redis` registers its `redis` cluster driver at module load and `create-objectstack`'s bin reaches its program through a bare import, so both declare their entry files side-effectful; everything else is `false`.
  - **`publishConfig: { access: 'public' }`** on the 17 that had none, the value the other 56 already declare.
  - **`type`** on the 39 that shipped `.js` without declaring a format — every `.js` under their `dist/` was read first and is CommonJS, which is what the absent field already meant — **`engines.node >= 22.0.0`** on the 22 that had no `engines`, and **`repository.url`** as the full `git+https://` git URL on 71.
  - **A README for 18 published packages that had none**: one paragraph, the first import a reader writes, and a link to the package's docs page. They are the pages npm renders, and for these 18 npm rendered nothing.

## 18.1.0

### Patch Changes

- c0cde8b: docs(skills): the npm page and the catalog's front page give the install line for the project's own package manager
  
  Clause-②: no
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) printed `npm install --save-dev "@objectstack/skills@$(node -p …)"` as the only install line. In a pnpm-installed project that line exits `1` with `npm error Cannot read properties of null (reading 'edgesOut')` and writes nothing, and `create-objectstack` installs with pnpm when it is available, so a scaffolded project is commonly a pnpm project.
  
  - **Both pages** now print `pnpm add -D "@objectstack/skills@$(node -p "require('@objectstack/spec/package.json').version")"`, with the npm and yarn spellings on a comment line beside it, and the rule: add the package with the manager that installed the project. The `objectstack-upgrade` skill's re-install step, which an agent follows for this exact move, prints the same line.
  - **The npm page** names pnpm's `ERR_PNPM_NO_MATCHING_VERSION` beside npm's `ETARGET` for a project on `@objectstack/spec` 17.x, and runs `npx skills list` before `npx skills remove --all`, which removes every installed skill without asking.
- 7f5b19d: docs(spec, skills): the `titleFormat` description and the objectstack-data skill no longer steer a composite record title that must be queried into a formula field
  
  Clause-②: no
  Metadata-protocol: none
  
  The `titleFormat` description (and its generated copies on the object, metadata and migration reference pages) and the `objectstack-data` skill's `nameField` and `titleFormat` rows told an author to migrate a composite record title to a `formula` field with `returnType: 'text'` designated as `nameField`. A formula value is computed on read and stored nowhere, so a sort by it is refused, search never reaches it, and an import cannot match a lookup cell against it. Both now say what the record-title lint and ADR-0079 D3 already say: a composite title that import, sort or search must match is a stored computed field, a non-`formula` field that declares an `expression`, which the engine computes and stores on every write, designated as `nameField`; a text formula designated as `nameField` stays legal for a title shown for display only.
  
  The same skill's "Computed column" bullet (`rules/relationships.md`) said a stored field's `expression` is a client compute hint and the sent value is stored verbatim. The engine computes the expression from the row the write stores and stores the result, so a client-sent value never stands; the bullet now says so.
  
  No key, type, default or accepted value changes; only the text an author reads changes.
- cb38a8c: docs(skills): the objectstack-data skill's `current_user` placeholder table names a declared membership key
  
  Clause-②: no
  
  The security rules' table of the `current_user.*` placeholders the RLS compiler resolves listed only the kernel's keys. It now has a row for `current_user.KEY`, the set an object's `membershipKeys.KEY` declares (for `IN`), so an author reading the catalog alone learns that a declared key resolves.
- 0949fe5: docs(skills): objectstack-data's security rules name the risk of renaming or removing a shipped access item in a later package version
  
  Clause-②: no
  Metadata-protocol: none
  
  `skills/objectstack-data/rules/security.md` gains a closing section, "Renaming or removing a shipped access item". Administrators act on a package's permission sets, positions, sharing rules and capabilities by name: they switch them off, clone them, and name the package's objects, fields and capabilities in their own sets. The section says what a rename, a removal or an added field deny does to those choices on upgrade, asks authors to keep shipped names stable and, when such a change is genuinely needed, to say in the release notes what changed and what an administrator should re-check. It is guidance only: no gate and no behaviour change.
  
  The file stays under its token ceiling. The new text is paid for by deleting restatements elsewhere in the same file: the stack-key bullet that repeated the code sample's comment, the assignment payload that repeated the row's columns, a code comment that repeated the sentence above it, the `viewAllRecords` corollary sentence, and the callout's repeats of the Layer 0 bullets and of a citation made two paragraphs earlier. No rule changes meaning.

## 18.0.0

### Minor Changes

- 165587e: New published package `@objectstack/skills`: the ObjectStack skills catalog (`skills/**` of the repository), shipped in the changeset `fixed` group so it always carries the version of the `@objectstack/*` packages it teaches. Its build copies the catalog into `dist/skills/<skill>/…` byte for byte (the layout the skills CLI's `experimental_sync` reads from `node_modules`), and `files` lists only that tree. The repository's `skills/**` stays the one source of truth and the documented `next` channel; nothing a consumer writes changes.
  
  `@objectstack/spec`: `llms.txt`'s package-ecosystem count reads 69 with `@objectstack/skills` joining the scope.

### Patch Changes

- f4755a6: docs(skills): `objectstack-data` says which hook doors provide `ctx.title` — a `body` has it, a deprecated `handler` gets it at runtime without `HookContext` declaring it, and `ql.registerHook` and a bare `ObjectQL` `bindHooks` do not provide it (#24289)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` listed `ctx.title(field?)` in the sandbox `ctx` table with no qualifier, so it read as a member of every hook context. It is not: a sandboxed `body` has it (the recommended form); an inline or named `handler`, which is deprecated, is handed it at runtime when the runtime binds the stack's hooks, but `HookContext` does not declare it, so a handler annotated with that type fails to compile; a hook registered with `ql.registerHook(...)`, or bound through `ObjectQL.bindHooks` with no runtime, gets no `ctx.title` at all. The row now says so. Text only; nothing an author writes changes, and no hook context changes.
- e4a770d: docs(skills): the `objectstack-ai` skill names the `agent` type's environment-overlay switch by its protocol-18 spelling, `allowEnvironmentOverlay:false` (#22340 S3)
  
  Clause-②: no
  
  `skills/objectstack-ai/SKILL.md`'s "Platform agents — reference only" section said the `agent` type is closed with `allowOrgOverride:false`. That key was renamed to `allowEnvironmentOverlay` in protocol 18 (ADR-0131 D6 retired the per-organization overlay axis, so the key names the one scope it governs; the old key stays on the registry entry schema only as a tombstone that refuses at parse with the new name in its prescription), so the published line now reads `allowEnvironmentOverlay:false`. The value, the `allowRuntimeCreate:false` beside it and the ADR-0063 §2 citation are unchanged; nothing an author writes changes. The same rename is recorded in `AGENTS.md` rule 7 and as header amendment notes on ADR-0005 and ADR-0010, none of which publishes.
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
- 11d4c5a: docs(skills): the `objectstack-data` lint-rule reference drops `security-external-wider-than-internal`, retired with `externalSharingModel` (#23268)
  
  Clause-②: no
  
  The row named a rule `@objectstack/lint` 18 no longer has, and nothing an author writes changes.
- 713f231: docs(skills): the upgrade skill's preflight re-installs the catalog from `@objectstack/skills` when a 17.x project moves to 18, and both READMEs give the scaffolder's pinned `--copy` sync (#23276)
  
  Clause-②: no
  
  `objectstack-upgrade`'s §0 Preflight gains one step for the skills themselves. A 17.x project's skills were installed with `skills add` from the repository's `main`; their `skills-lock.json` entries read `sourceType: github`, and `experimental_sync` skips them (it prints `Skipped … installed with skills add` and exits 0), so a project that only bumps its packages keeps its 17.x-era skill text. The step removes the eleven `objectstack-*` skills the catalog carried during 17.x (a name not installed is skipped; `--all` when they are the project's only skills), installs `@objectstack/skills` at the installed `@objectstack/spec`'s version, and copies it with `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` — the command `create-objectstack` runs. The step is paid under the token ratchet by deleting text the same file restates elsewhere; the ceiling is unchanged.
  
  `README.md` (the npm page) and `dist/skills/README.md` (the catalog's front page, copied from the repository's `skills/README.md`) replace the unpinned linked sync (`npx skills experimental_sync --agent claude-code -y`) with that pinned `--copy` spelling and say why: without `--copy` the sync writes links into `node_modules`, which a clone of a project that commits its skills does not have.
- 68e64dd: fix(skills): the automation skill's two reference files write a CRUD `filter` operand as a CEL value envelope or the `{today}` query placeholder; the single-brace `{…}` filter spelling leaves them
  
  Clause-②: no
  
  `skills/objectstack-automation/references/examples-flows.md` and `references/state-machines-and-approvals.md` no longer teach `'{TODAY()}'`, `'{TODAY() + N}'` or `'{record.id}'` at an `update_record` filter operand — spellings the platform refuses (`expression-invalid`) at `objectstack validate`, `registerFlow` and the executor, so an author who copied the example got a refused node. The examples now write what the platform accepts: the query placeholder `'{today}'` for today's date, a CEL value envelope `{ dialect: 'cel', source: 'isoDate(daysFromNow(N))' }` for a one-day window at a date offset, and `{ dialect: 'cel', source: 'record.id' }` for the triggering record's id. The prose names the CEL value envelope where it named a template token (and no longer says a CEL envelope is compared as a literal at a filter operand), and the time-word cheat sheet names the CEL envelope and the `{{ }}` text hole where it named the retired `{…}` template.
- 46ca793: docs(skills): the `objectstack-ui` pages rule says what a page type, template and region name run (#23610)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/pages.md` taught `home` as the app's landing page, `utility` as a floating utility panel, templates `two-column` / `single-column` and regions `left_sidebar` / `right_sidebar`, and `kind: 'jsx'` as a live alias of `html` — none of which the console draws or the spec accepts. The rule now states the declared contract: `home` is the widest region page and not a landing (an app opens on its first navigation item; `isDefault` on it is refused), `utility` is a narrow inline region page with no floating or docked shell slot, `template` is one of `default`, `header-sidebar-main`, `three-column` or `dashboard` with the regions each one places (`sidebar` left, `aside` right; `full-width` retired), a region the template does not place or a second region for a filled slot is refused at its `name`, and `kind: 'jsx'` is refused with the prescription `html`. Skill text only; nothing an author writes changes.
- 5477020: docs(skills): the `objectstack-data` security rule states a grant's uniqueness as the declared `unique: 'organization'` index holds it, in place of the retired `permission_set_id` column (#23615)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/security.md`'s grant paragraph closed with "`permission_set_id` is a legacy column: do not write it." The grant object `sys_user_permission_set` no longer declares that column, so a write naming it is refused `400 INVALID_FIELD` as an undeclared field, and the sentence taught an AI author a key the declared shape does not have. The sentence is replaced by the rule the declared shape holds: one grant per user, set and organization, enforced by the join object's `unique: 'organization'` index on (`user_id`, `permission_set`, `organization_id`). The by-name reference — `permission_set` takes the set's `name` — and its refusals are unchanged. No behaviour changes; nothing an author writes changes.
- b711056: docs(skills): the `objectstack-ui` navigation rule states the derived record surface per flow — viewing routes to a page, creating or editing opens a modal bounded on desktop and full-screen on mobile, a light record uses a drawer (#23753)
  
  Clause-②: no
  
  `skills/objectstack-ui/rules/navigation.md`'s Surface bullet said a field-heavy object opens create/edit/detail as a full page and that mobile always pages. The platform's derivation (`deriveRecordFlowSurface` in `@objectstack/spec`) routes only the `view` flow to a page; the create, edit and child task flows never route — a field-heavy record, or any record on mobile, opens them in a modal that is bounded on desktop and full-screen on mobile, and a light record on desktop opens every flow in a drawer. The bullet now states that mapping and names the override only where the spec declares it: `navigation.mode` on the list view (`navigation` is not an object key). Text only; nothing an author writes changes.
- 2fdfb5d: docs(skills): the `objectstack-data` datasources rule states that `default` is host-reserved — the host connects it from `OS_DATABASE_URL`, and a stack that declares a datasource named `default` is refused (#23768)
  
  Clause-②: no
  
  `skills/objectstack-data/rules/datasources.md`'s opening paragraph read "Most apps need only the `default` datasource; declare more to read/write a separate or external database." "Declare more" implied that `default` is declared too, and a stack whose `datasources` collection carries an entry named `default` is refused at `defineStack`, `os validate`, publish and boot: the host declares and connects `default` itself. The sentence is replaced by the rule the spec and runtime hold: `default` is host-reserved, the host connects it from `OS_DATABASE_URL`, a stack that declares a datasource named `default` is refused, and a datasource is declared under its own name only to read/write a separate or external database. The added words are paid for inside the same file by deleting two restatements of the field reference: "`external` settings are required when `schemaMode !== 'managed'`" (the schema refuses the omission itself) and "Set `autoConnect: true` to force a live connection" (the auto-connect list two lines above already names it). No behaviour changes; nothing an author writes changes.
- 49700e4: docs(skills): the `objectstack-api` skill stops teaching an app to mount routes on `http.server` — an app declares `apis:`, computes in a flow, and registers code as a stack function or a connector (#23787)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md`'s decision table sent an endpoint that needs code to an imperative `http.server` mount on `kernel:ready`, and its "Code routes" section taught that mount. Ruling C′ item 2 on #23128 retired the mount as an app-author surface: the `http.server` service is the platform plugins' own door-building primitive. The table now points code at a `type: 'flow'` endpoint whose `script` node runs a stack function (`defineStack({ functions })`) or whose `connector_action` node calls a declared connector, names the inbound `type: 'api'` flow hook for a webhook signed with ObjectStack's own `x-objectstack-signature`, and states the three cases that have no app surface today (a third-party callback verified by its own signature over the raw body, a streaming response, a protocol the platform does not speak) instead of inventing one. The "Code routes" section is deleted, and eval 3 expects that answer. Skill text only; nothing an author writes changes.
- f1c0b57: docs(skills): `objectstack-data` and `objectstack-formula` state that `previous` is `null` on insert — `previous == null` judges an insert, a column read off it there faults, and only a write to an existing row whose prior state is not in hand leaves it unbound (#23983)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` and `skills/objectstack-formula/SKILL.md` said `previous` is unbound on insert events and told authors to write insert-event conditions over `record` alone. Since `@objectstack/objectql` binds `previous` to `null` on insert in validation rules and declarative hook conditions (the binding a flow's start condition already had), that text was false: `previous == null || …` judges an insert and `previous != null && …` skips one; only a column read off `previous` on insert (`previous.status`) still has no value and still fails the write, and only a write to an existing row whose prior state is not in hand leaves `previous` unbound, failing closed. The bullet, the scope-table row, the abort note and the legacy-translation note now state that binding and the `null` guard; the `record`-alone advice stays correct and is no longer presented as the rule. Text only; nothing an author writes changes, and a hook's `ctx.previous` is unchanged.
- 53ef752: docs(skills): `objectstack-api` states that a public form's submit is authorized by the form's own `publicFormGrant`, and that the `guest_portal` name on the submit context admits nothing and needs no permission set (#24239)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md` described the anonymous form endpoints as running under a synthetic `{ permissions: ['guest_portal'], anonymous: true }` execution context and named nothing else, so an author reading it inferred that a `guest_portal` permission set authorizes the submit and declared one, or concluded that the form falls open without one. Neither is true: the submit is authorized by the form's own declaration (ADR-0056 Option A) — the route hands the engine a `publicFormGrant` scoped to the form's target object, which admits the create and the read-back of the row it made and nothing else, decided before any permission set resolves. The `guest_portal` name on the context admits nothing; where a deployment registers a set under it, that set only feeds the grant's result masker. The passage now says so, matching `content/docs/ui/public-data-collection.mdx` and the `registerFormEndpoints` docstring in `@objectstack/rest`. Text only; nothing an author writes changes, and the form routes' behaviour is unchanged.

## 18.0.0-next.5

No changes in this release.

## 18.0.0-next.4

### Patch Changes

- f1c0b57: docs(skills): `objectstack-data` and `objectstack-formula` state that `previous` is `null` on insert — `previous == null` judges an insert, a column read off it there faults, and only a write to an existing row whose prior state is not in hand leaves it unbound (#23983)
  
  Clause-②: no
  
  `skills/objectstack-data/references/data-hooks.md` and `skills/objectstack-formula/SKILL.md` said `previous` is unbound on insert events and told authors to write insert-event conditions over `record` alone. Since `@objectstack/objectql` binds `previous` to `null` on insert in validation rules and declarative hook conditions (the binding a flow's start condition already had), that text was false: `previous == null || …` judges an insert and `previous != null && …` skips one; only a column read off `previous` on insert (`previous.status`) still has no value and still fails the write, and only a write to an existing row whose prior state is not in hand leaves `previous` unbound, failing closed. The bullet, the scope-table row, the abort note and the legacy-translation note now state that binding and the `null` guard; the `record`-alone advice stays correct and is no longer presented as the rule. Text only; nothing an author writes changes, and a hook's `ctx.previous` is unchanged.
- 53ef752: docs(skills): `objectstack-api` states that a public form's submit is authorized by the form's own `publicFormGrant`, and that the `guest_portal` name on the submit context admits nothing and needs no permission set (#24239)
  
  Clause-②: no
  
  `skills/objectstack-api/SKILL.md` described the anonymous form endpoints as running under a synthetic `{ permissions: ['guest_portal'], anonymous: true }` execution context and named nothing else, so an author reading it inferred that a `guest_portal` permission set authorizes the submit and declared one, or concluded that the form falls open without one. Neither is true: the submit is authorized by the form's own declaration (ADR-0056 Option A) — the route hands the engine a `publicFormGrant` scoped to the form's target object, which admits the create and the read-back of the row it made and nothing else, decided before any permission set resolves. The `guest_portal` name on the context admits nothing; where a deployment registers a set under it, that set only feeds the grant's result masker. The passage now says so, matching `content/docs/ui/public-data-collection.mdx` and the `registerFormEndpoints` docstring in `@objectstack/rest`. Text only; nothing an author writes changes, and the form routes' behaviour is unchanged.

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

---
'@objectstack/lint': minor
'@objectstack/runtime': minor
'@objectstack/spec': minor
---

fix(lint)!: a body whose regular-expression pattern the runtime's QuickJS also refuses is refused, not only warned about

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-data/references/data-hooks.md (its "Refused when it does not compile" bullet says every regex pattern the checking engine refuses is a warning; now only a duplicate named capture group or a modifier group is)

<!-- adr-0087: registered body-regexp-pattern-refused -->

**BREAKING** only for a body that never ran. `action-body-does-not-compile`, `hook-body-does-not-compile` and `job-body-does-not-compile` compile an L2 body inside the wrapper the runtime runs it in, with the host's JavaScript engine, and reported every failure V8 words as `Invalid regular expression: /PATTERN/FLAGS: REASON` at `warning`, because the host's V8 and the runtime's QuickJS differ on some patterns. Measured over the same wrapper text (Node 22.23.5's V8 12.4, Unicode 17.0 tables, against quickjs-emscripten 0.32.0), they differ on two constructs, a duplicate named capture group in different alternatives (`/(?<a>x)|(?<a>y)/`, V8 `Duplicate capture group name`) and a modifier group (`/(?i:a)/`, V8 `Invalid group`), and on three Unicode property names, `IDS_Unary_Operator` (`IDSU`), `Modifier_Combining_Mark` (`MCM`) and the script `Katakana_Or_Hiragana` (`Hrkt`, under `sc=`, `Script=`, `scx=` or `Script_Extensions=`), V8 `Invalid property name`: every name in QuickJS's own tables was compiled in every key form, under `u` and `v`, bare and in a class, and these twelve spellings were every disagreement. Node 22 refuses them and QuickJS runs them. Every other pattern reason probed is refused by QuickJS too, among them an unterminated group (`/(/`), nothing to repeat (`a**`), a class range out of order (`/[b-a]/`), and under `u` a back-reference to a group the pattern does not name, a Unicode property name neither engine knows (`/\p{Nope}/u`) and an incomplete quantifier (`/a{/u`). Such a body passed `os validate`, `os build`, `os lint` and the runtime publish door, and every run of it failed.

What moves (FROM → TO):

- The three rules (`validateActionBodyCompiles`, `validateHookAndJobBodyCompiles`, `@objectstack/lint`) on a regular-expression pattern failure that is not one of those measured gaps: FROM `warning` TO `error` at `os validate`, `os build`, `os lint` and the runtime publish door (`action`, `object` and `hook` writes, `422 INVALID_METADATA`), with a hint that names the fix. The measured gaps stay a `warning`; a property name is judged by the host's Unicode tables, and on a host whose tables are older than Unicode 17.0 every property name it refuses is a `warning`; a later Node whose V8 accepts a gap reports nothing for it.
- `BodyCompileShape` (`@objectstack/lint`) gains `regexp-dialect-gap`, the one `warning` arm; `regexp-pattern` is now an `error`.
- The unterminated-literal hint names a line terminator inside the literal as a cause (a `\n` written with one backslash in a quoted or JSON-carried `body.source`).
- A hook lowered from an inline `handler` whose body does not compile gets a hint that names the handler instead of `body.source`.
- The runtime's QuickJS runner (`@objectstack/runtime`): a hook or job body that does not compile is reported FROM the generic `hook 'NAME' threw: SyntaxError: …` (the sentence a body that ran and threw gets) TO `hook 'NAME' does not compile: SyntaxError: …` (and `job 'NAME' …`), the way an action body's is. The caller's answer is unchanged: the `/data` door still answers the sanitised `500 INTERNAL_ERROR`.
- `os explain` for the three rules and the ADR-0087 entries `action-body-does-not-compile-refused`, `action-body-regexp-literal-token-refused` and `hook-job-body-does-not-compile-refused` now say which pattern failures warn.

The fix: close every group, give each quantifier something to repeat or escape it, write a class range low to high, reference only a group the pattern names, and use a Unicode property that exists.

No conversion is made (ADR-0087 D3, entry `body-regexp-pattern-refused`): which pattern the author meant is a judgement. Measured first-party exposure: zero.

#!/usr/bin/env node
/**
 * Every key a component asks `t()` for must EXIST in the `en` locale pack — and
 * where the call site also writes an inline `defaultValue`, that dead string
 * must say the same thing the pack does (objectui#3810) — and the interpolation
 * arguments the call site passes must be exactly the holes the `en` value has
 * to receive them (objectui#3845) — and the OTHER spelling of a fallback,
 * `t(key) || 'English'`, must not exist at all (objectui#4117) — and whatever
 * text that inline default carries must spell its placeholders the one way the
 * provider-less fallback can resolve them (objectui#4905) — and the SAME
 * promise written one indirection away, in a `createSafeTranslation` defaults
 * table, must say the same thing the pack does too (objectui#7567).
 *
 * Run:  node scripts/check-i18n-call-site-keys.mjs   (also `pnpm check:i18n-keys`)
 * Exit: 0 = every in-scope call-site key resolves (or is baselined), no inline
 *           default contradicts its `en` value, no `createSafeTranslation`
 *           defaults row contradicts it either, no call site's option names
 *           disagree with its `en` value's holes, and no call site carries a
 *           literal sibling fallback, 1 = otherwise
 *
 * ## The gap this closes (objectui#3530)
 *
 * `packages/i18n/src/__tests__/all-locales-key-parity.test.ts` asserts that every
 * pack defines every `en` key and no pack defines a key `en` lacks — a **pack vs
 * pack** invariant. It is blind by construction to the other direction: a key a
 * component *references* that NO pack defines. Ten packs identically missing a
 * key is full parity, and full parity is green.
 *
 * Nothing else caught it either, because `fallbackLng: 'en'` plus an inline
 * `t(key, { defaultValue: 'English text' })` renders correct English at the one
 * call site while the key stays untranslatable in all ten languages. The
 * dev-only missing-key warner (`i18n.ts`) is the only runtime signal and CI
 * never sees a browser console. objectui#3517 was one instance —
 * `form.createTargetOrg`, missing from all ten packs, covered by an inline
 * default for months, found only by #3469's by-hand per-key sweep. This gate is
 * the class, not the instance: the first full run over `main` found
 * 258 more.
 *
 * ## Division of labour with the other two i18n gates
 *
 * All three read the same ten packs, and each is blind to what the next owns:
 *
 *   - THIS gate: call site -> `en`. Does the key a component asks for exist, and
 *     does the call site's own inline `defaultValue` agree with the `en` value?
 *     Both directions of one question — what this call site will render.
 *   - `packages/i18n/src/__tests__/all-locales-key-parity.test.ts`: pack vs pack
 *     KEY SETS, plus placeholder shape. Never reads a value.
 *   - `scripts/check-i18n-en-drift.mjs` (objectui#3650): `en` vs the other nine
 *     packs, as an event — when an `en` string CHANGES, the nine translations
 *     must change in the same PR (or be waived). Neither pack gate can see a
 *     value go stale: objectui#3582 and objectui#3625 were eight packs serving a
 *     retired sentence at full key parity, the second one in idiomatic native
 *     script that every value-shaped heuristic also reads as healthy.
 *
 * The `default-value-drift` class below is the fourth blind spot in that
 * partition, and it was blind to all three by construction (objectui#3810):
 * this gate asked only whether the key existed, parity reads no values at all,
 * and en-drift fires on CHANGE — and in every one of the 43 sites the `en` value
 * had not moved for months. The call site was the thing that disagreed.
 *
 * `interpolation-parity` is the fifth, and it is blind to all four
 * (objectui#3845). Parity DOES compare placeholder shape — but pack against
 * pack: the nine translations must hold the same `{{holes}}` as `en`. Ten packs
 * agreeing on `Update` while the call site passes `version` is full placeholder
 * parity, because no pack gate ever reads the argument list. And a `defaultValue`
 * that agrees byte for byte with `en` says nothing about the arguments either:
 * `home.welcome` passed `product` to `Welcome to {{product}}`, the `en` value was
 * later rewritten to `Build your business system with AI`, and #3810's rule is
 * satisfied the moment the call site copies that new sentence — with the now
 * inert `product` still sitting beside it.
 *
 * ## What is IN scope, and why the answer is not "every `t(`"
 *
 * A naive grep for `t('...')` scores 3485 call sites in this repo and would be
 * wrong about roughly a third of them, because `t` is not one function:
 *
 *   - 2370 calls reach i18next and therefore the locale packs. Those are the
 *     subject of this gate.
 *   - 1074 calls go to `packages/app-shell/src/views/metadata-admin/i18n.ts`, a
 *     module-local `engine.*` label table that is NOT an i18next pack and never
 *     will be (read its header). Checking its keys against `en` produces 89
 *     permanent false reds — measured, by removing the exclusion.
 *   - 41 calls are a local `t` that is not a translator at all — a `useCallback`
 *     result, a `Date` difference, a `||` chain, a `.t()` method on some other
 *     object.
 *
 * So the unit of classification is the **binding**, not the spelling. For each
 * `t(...)`/`tt(...)` call this file resolves which declaration of `t` is in
 * scope at that position (nearest enclosing scope wins, then the latest
 * declaration before the use), and classifies it:
 *
 *   PACK   — bound from a call to a translate hook: `const { t } = useXxx…()`,
 *            `const tt = useSafeTranslate()`. The hook-name convention is
 *            `use*Translation` / `use*Translate` / `use*T` and it is a real
 *            repo-wide convention: all 26 such hooks are either
 *            `createSafeTranslation(...)` factories or thin wrappers over
 *            `useObjectTranslation`. **Checked.**
 *   LOCAL  — bound from an `import` of a module in EXCLUDED_TRANSLATORS below,
 *            or forwarded inside that module's declared scope. **Skipped**, by
 *            declaration, with a reason. An import from any *other* module is a
 *            hard error, so a second local table cannot appear silently.
 *   OTHER  — anything else (`const t = someValue`). **Skipped**, counted.
 *
 * A `t` received as a parameter or a prop inherits its file's provenance: a
 * helper that takes `t: TranslateFn` is checked in a file whose own `t` comes
 * from a hook, and skipped inside the metadata-admin tree. That hop is the one
 * place a type checker would be exact and this parser is a heuristic, so it is
 * worth knowing what it buys: deleting `forwardedScope` puts 89 call sites
 * (78 distinct `engine.*`/`perm.cel.*`/`perm.rls.*` keys) back on the report,
 * every one of them a component that was handed the metadata-admin table's `t`
 * by its parent, and not one of them a real finding.
 *
 * `dead-sibling-fallback` is the sixth, and it was blind to all five — including
 * the two that read values — for one syntactic reason (objectui#4117): every
 * rule above reads the call's ARGUMENTS, and this fallback is not an argument.
 * `t('marketplace.detail.moreOptions') || 'More options'` carries no options
 * object at all, so class 3 sees no `defaultValue` to compare and class 4 sees
 * an empty (and correct) argument set. The dead English sits one operator to the
 * right of everything this file used to look at. `node.parent` is what closes
 * it, and the rule is the class rather than the instance: the first full run
 * found 24 such sites in four files, every one of them on a key `en` defines.
 *
 * ## Eight failure classes
 *
 * (The heading said "Five" while the list below held seven — a stale count
 * corrected here rather than left to grow by one more.)
 *
 * 1. `missing-key` — a literal key with no leaf in `en`. i18next plural suffixes
 *    (`_one`, `_other`, …) count as defining the base key, and a key passed with
 *    `returnObjects: true` may name a subtree rather than a leaf.
 * 2. `missing-prefix` — a template key (`` t(`marketplace.category.${c}`) ``)
 *    whose static head matches NO `en` key at all. Then every possible expansion
 *    is missing, whatever the substitution evaluates to. This is the only claim
 *    about a dynamic key that is true without knowing the value.
 * 3. `default-value-drift` (objectui#3810) — the key EXISTS and the call site
 *    still carries a literal `t(key, { defaultValue: 'other English' })` whose
 *    text differs from the `en` value. i18next uses `defaultValue` only on a
 *    miss, so with the key present the pack always wins and that string is
 *    structurally dead code — dead code that states, at the call site, a
 *    different sentence from the one users read. Two costs, both measured on
 *    `main`: the reader (and the AI writing the next edit) is misled —
 *    `ForgotPasswordPage` claimed `If an account exists, a reset link has been
 *    sent.` while the pack asserts `We've sent a password reset link to
 *    {{email}}.`, a materially different privacy claim — and on the day the key
 *    is renamed or dropped, rendering silently falls back to that other
 *    sentence, in a diff where nobody expected copy to change.
 *
 *    Classes 1 and 3 are disjoint by construction: drift is judged only when the
 *    key resolves to an `en` leaf this file could read as a string, so a call
 *    site is never reported twice, and each report reads on its own. Deliberately
 *    NOT judged (counted instead): a computed default (`defaultValue: label`), a
 *    call whose key is dynamic or denotes several literals, a `returnObjects`
 *    subtree, and the plural families — `t('detail.showEmptyRelated')` resolves
 *    through `_one`/`_other`, and there is no single form to compare against.
 *
 *    The rule is HARD from day one — no baseline section, unlike classes 1-2.
 *    That is a measurement, not an aspiration: the first full run found 43 sites
 *    in 19 files, all of them aligned in the same PR (objectui#3810), so there
 *    is no debt for a ratchet to hold. A `defaultValue` written on a key that is
 *    NOT yet in `en` stays legal — that transition period runs for months
 *    (objectui#3546) and is class 1's business, not this one's.
 *
 * 4. `interpolation-parity` (objectui#3845) — the key EXISTS, and the set of
 *    interpolation option names the call site passes is not the set of `{{hole}}`
 *    names the `en` value has. Both directions fail, because the declaration and
 *    the thing that consumes it are the same statement read from two ends:
 *
 *      - **inert** — an argument passed with no hole to receive it. i18next
 *        drops it silently, so the author's intent evaporates with no runtime
 *        signal at all: `marketplace.action.updateTo` passed `version` to a value
 *        reading `Update`, while its sister key three hundred lines down renders
 *        `Update → v{{version}}` from the same variable. Nothing is broken today,
 *        which is exactly why nothing ever noticed.
 *      - **unfilled** — a hole with no argument to fill it. i18next leaves the
 *        braces in the output, so the user reads a literal `{{name}}`. This
 *        direction measured 0 on `main` when the rule landed; keeping it judged
 *        is the difference between "0 by luck" and "0 by guarantee".
 *
 *    Deliberately NOT judged (counted instead), and each abstention is a
 *    decision:
 *
 *      - The same key preconditions as class 3 — a dynamic or several-literal
 *        key, a `returnObjects` subtree, an `en` leaf that is not a readable
 *        static string. Plural families fall out here too: `t(k, { count })`
 *        resolves through `_one`/`_other` and there is no single value whose
 *        holes could be the answer, so the families are never judged.
 *      - An options object whose NAME SET cannot be read: a spread, a computed
 *        name, a getter — or a `replace:` redirect, which is where i18next takes
 *        the interpolation data from when it is present, making the top-level
 *        names not interpolation at all. Today the repo has none of these; the
 *        abstention is what stops the first one becoming a false red.
 *      - RESERVED names are removed from the call site's own option names ONLY
 *        when judging **inert**, and kept for **unfilled** (objectui#4206).
 *        `count` is the reason both directions need a different answer: it is
 *        an i18next control option AND the value of a `{{count}}` hole, so
 *        dropping it before judging `inert` keeps a passed `count` from
 *        reading as an inert argument, while KEEPING it for `unfilled` lets
 *        the rule tell "passed `count`" apart from "passed nothing" and still
 *        catch a real `{{count}}` miss (objectui#4157) — dropping it from both
 *        directions, as the rule did before #4206, made `unfilled`
 *        structurally unable to ever contain `count`, whether filled or not.
 *
 *    Nested `t()` inside the options object is not a special case here and must
 *    not become one: the arguments of an inner call are not properties of the
 *    outer object literal, so an AST reading the outer literal's own properties
 *    never sees them. It is called out because the census that found this class
 *    was done with a regex first, and the regex read the inner `index:` of
 *    `packages/fields/src/widgets/ImageField.tsx` as an argument of the outer
 *    `fields.image.enlarge` call — one false positive out of two hits. The
 *    self-test pins the AST's behaviour on exactly that shape.
 *
 *    Also HARD from day one, and for the same reason: the first full run found
 *    2 inert sites and 0 unfilled ones, both fixed in objectui#3845's PR by
 *    DELETING the dead argument. Adding the hole to the `en` value instead is a
 *    product decision about what the string should say — it changes what users
 *    read and obliges the nine other packs through objectui#3650 — so the gate
 *    accepts either resolution and neither is its to make.
 *
 * 5. `dead-sibling-fallback` (objectui#4117) — the key EXISTS and the call site
 *    still writes a literal fallback as the call's SIBLING rather than as an
 *    argument: `t('detail.moreOptions') || 'More options'`, or the same with
 *    `??`. Unlike class 3 this rule does not ask what the fallback SAYS. It is
 *    existence-is-red, and the fix is DELETION, because there is no reading of
 *    this spelling under which the right operand can render:
 *
 *      - With a provider, i18next serves the pack value — the same reason class
 *        3's `defaultValue` is dead.
 *      - With NO provider, this spelling is strictly worse than `defaultValue`
 *        rather than equivalent to it. react-i18next's not-ready `t` returns the
 *        KEY, and `createSafeTranslation`'s fallback returns `defaults[key] ||
 *        key` — both truthy — so `||` skips the right operand and the user reads
 *        a raw `console.objectView.delete`. `defaultValue` at least renders
 *        English there. Same family as objectui#3865; this is its `||` half.
 *
 *    So the two spellings are not two ways to write one thing: one is dead and
 *    misleading, the other is dead and misleading AND cannot degrade gracefully.
 *    The ruling on this card keeps ONE blessed fallback spelling — `defaultValue`,
 *    governed by class 3 — instead of two competing ones, which is also why this
 *    rule does not simply extend class 3's byte-equality test to the sibling
 *    position: aligning these strings would bless the spelling.
 *
 *    Deliberately NOT judged (counted instead), and each abstention is a
 *    decision the class above would get wrong:
 *
 *      - The same key preconditions as classes 3 and 4 — a dynamic or
 *        several-literal key, a `returnObjects` subtree, an `en` leaf that is
 *        not a readable static string (the plural families land here).
 *      - An `en` value that is the EMPTY STRING. Then `t()` really can return a
 *        falsy value and `||` really can reach its right operand, so the premise
 *        of the whole class fails. `en` has no such leaf today; the abstention is
 *        what stops the first one becoming a wrong red.
 *      - A NON-LITERAL right operand (`t(key) || label`). What renders is then a
 *        runtime value, not a second copy of the sentence, and judging it would
 *        mean claiming something about a variable this parser cannot read —
 *        exactly how class 3 treats a computed `defaultValue`.
 *      - An OPTIONAL call, `t?.(key) ?? 'English'`. This one is not a parser
 *        limitation but a live path: where `t` is an optional prop, the call
 *        evaluates to `undefined` whenever the prop is absent and the fallback
 *        is what renders. Both of `packages/app-shell/src/layout/
 *        ContextSelectors.tsx`'s sites are this shape, and its own
 *        `ContextSelectors.persist.test.tsx` renders the hook with no `t` — so
 *        deleting those two would have replaced a rendered placeholder with
 *        `undefined`. The card that filed this class listed them among the 24;
 *        measuring the call shape is what took them back out.
 *
 *    Only the LEFT operand position is judged. `someLabel || t('common.actions')`
 *    is the healthy, opposite shape — a runtime value with a translated fallback
 *    — and `main` has 94 of them against these 24. A rule that read "appears in a
 *    `||`" rather than "is the left operand of one" would condemn all 94.
 *
 *    HARD from day one, like classes 3 and 4: the first full run found 24 sites,
 *    22 of them judged and deleted in objectui#4117's own PR, so there is no debt
 *    for a ratchet to hold. And a fallback written on a key `en` does NOT define
 *    stays legal — that is class 1's business, not this one's.
 *
 * 6. `missing-member` (objectui#4964) — the template family's HEAD resolves, so
 *    class 2 is satisfied, and a specific MEMBER of the vocabulary the call site
 *    iterates has no leaf in `en`. This is the sixth blind spot and it was blind
 *    to all five, plus to both other i18n gates, by construction: class 2 says in
 *    its own words that the prefix is "the only claim about a dynamic key that is
 *    true without knowing the value", parity compares ten packs that are missing
 *    it identically (full parity, green), and en-drift fires on a value CHANGING,
 *    which a key that was never added never does. `filterBuilder.operators` was
 *    the measured instance: six of its twenty-two operators were missing from all
 *    ten packs while the head resolved sixteen members deep, and users read
 *    `filterBuilder.operators.isNull` in the operator dropdown (fixed in
 *    objectui#4962, which pinned that ONE family; this class is the generalisation).
 *
 *    Knowing the members is a DECISION, not a measurement, so it is declared
 *    rather than inferred — see DYNAMIC_KEY_FAMILIES below for the registry, the
 *    six vocabulary shapes it can read, and the four reasons a family may declare
 *    that it has no static member set. Three ratchet rules keep the registry
 *    honest in both directions (`undeclared-dynamic-family`,
 *    `stale-dynamic-family`) and stop it going vacuous
 *    (`empty-vocabulary`/`unreadable-vocabulary` — a vocabulary that resolves to
 *    nothing reads exactly like one that passes).
 *
 *    Baselined like classes 1 and 2, in `missingMembers`, and for the same
 *    reason: the first full run found real debt (2 members over 25 families and
 *    112 checked member keys), and a missing translation is a gap to surface, not
 *    something to invent pack entries for.
 *
 * 7. `unresolvable-default-spelling` (objectui#4905) — an inline `defaultValue`
 *    spells a placeholder in one of the four dialects i18next accepts and
 *    `createSafeTranslation`'s `fallbackT` does not (`{{ name }}`,
 *    `{{count, number}}`, `{{- name}}`, `$t(key)`). WITH a provider the pack
 *    value wins and nothing is visible; WITHOUT one the braces reach the user.
 *
 *    This is objectui#3512's rule, and the reason it is HERE rather than there
 *    is the whole of objectui#4905. That card gated the three copy TABLE
 *    surfaces and left inline defaults out in writing, because a `defaultValue`
 *    is a call-site OPTION rather than a table: finding one means resolving
 *    which `t` is in scope at that position and reading the call's arguments —
 *    the classifier this file already is, and a second independently-rotting
 *    copy of it anywhere else. The residue #3512 recorded was 3 "not
 *    comparable" plus 62 computed inline defaults with no transitive pin.
 *
 *    Closing that residue at the SOURCE — rewriting a computed default as the
 *    `en` value so class 3 pins it — turns out to reach only 5 of the 66 sites
 *    measured on this tree, and the reason is worth stating because it is the
 *    opposite of what the card assumed. THREE things can render an inline
 *    default, and only two of them interpolate it:
 *
 *      1. i18next, with a provider. It interpolates — but the pack value wins,
 *         so the default never renders at all. Moot.
 *      2. `createSafeTranslation`'s `fallbackT`. It interpolates, with the exact
 *         literal needle this class is named for. SAFE to rewrite.
 *      3. react-i18next's not-ready `t`, which is what a bare
 *         `useObjectTranslation()` yields when no i18next instance is
 *         initialised. Measured in `react-i18next/dist/es/useTranslation.js`:
 *         `notReadyT` returns `options.defaultValue` VERBATIM — it does not
 *         interpolate at all.
 *
 *    So at a `useObjectTranslation` call site, a default written as
 *    `` `Signed in as ${user.email}` `` is not an unpinned near-miss to be
 *    tidied into `'Signed in as {{email}}'` — the template literal is the only
 *    one of the two that renders correctly there, and "fixing" it would put
 *    literal braces in front of a user on exactly the provider-less host this
 *    whole family of cards is about. `objectBulkActionDispatch.test.tsx` fails
 *    on precisely that substitution, which is how it was found.
 *
 *    Hence only 5 rewrites: four whose default carries no hole (nothing to
 *    interpolate, so all three renderers agree) and one behind a
 *    `createSafeTranslation` hook. The rest stay computed, and this class is
 *    what covers them.
 *
 *    Judged over EVERY inline default, not just the residue. A pinned default is
 *    byte-equal to an `en` value #3512 already holds to this rule, so those
 *    verdicts are green twice over — which is the point: it makes the judged
 *    count a live control (hundreds, guarded), instead of a rule whose whole
 *    subject is three strings that could silently become zero. HARD from day
 *    one, like classes 3-5: the first full run found 0 violations, so there is
 *    no debt for a ratchet to hold, and 0 stops being luck.
 *
 * 8. `factory-default-drift` (objectui#7567) — the same promise as class 3, one
 *    indirection away, and it was blind to all seven for exactly that reason.
 *    Class 3 reads the call's ARGUMENTS, so it sees `t(key, { defaultValue })`
 *    and nothing else; a `createSafeTranslation(DEFAULT_TRANSLATIONS, …)` row
 *    carries the identical string with no argument anywhere near the call site.
 *    Before this class the gate classified those hooks as pack-backed, checked
 *    every key they were asked for, and never once read the table they fall back
 *    to.
 *
 *    THE DIRECTION IS NOT A CHOICE HERE, and stating it is half the class. Read
 *    `packages/i18n/src/useSafeTranslation.ts`: `fallbackT` resolves
 *    `defaults[key] || defaultValue || key`, and its own comment calls the table
 *    "the pack value's stand-in here … it takes the pack's position in i18next's
 *    own order". So a row that differs from `en` is not a second opinion, it is
 *    the SAME control labelled one way on a provider-less host and another in
 *    the console — objectui#7454's measured instance, where a calendar lane read
 *    `all-day` standalone and `All Day` in the app, plus a ternary kept
 *    structurally unreachable by nothing. The pack wins, for the same reason it
 *    wins in class 3: it is what essentially all traffic renders and what the
 *    nine other packs were translated from.
 *
 *    Not a new rule so much as a generalisation of one that already existed for
 *    three tables: `packages/app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx`
 *    (objectui#4401) compares `DETAIL_`/`LIST_`/`DESIGNER_DEFAULT_TRANSLATIONS`
 *    against the pack key by key. That test found the divergence it was written
 *    for; what it could not do is cover the other 29 tables, because each one
 *    would have to be added by hand. This class takes the population from the
 *    SOURCE instead — every `createSafeTranslation(...)` /
 *    `createSafeTranslationHook(...)` invocation, whatever its table is called —
 *    so a 33rd factory is covered on the day it is written, with nothing to
 *    register.
 *
 *    HARD from day one, and here the measurement is the whole story. The census
 *    objectui#7567 SHIPPED ON — 32 factory sites, 32 distinct tables, 846 rows,
 *    841 of them comparable against `en`, 0 drifted — is a reading of the tree
 *    that card landed against, and it is dated on purpose: today's numbers are
 *    the ones the run prints on its own `Factory defaults tables:` summary
 *    line, which is where a reader takes them from. objectui#7454's instance,
 *    the one known member of the class, was aligned in objectui#7574 before this
 *    class landed, which is why there is no ledger section here: a ledger with
 *    nothing in it is a mechanism asserting nothing, and it would read exactly
 *    like a populated one. The abstention counts below are printed on every run
 *    for the same reason the dynamic-key count is — an instrument's blind spot
 *    is a number, not a silence.
 *
 *    Deliberately NOT judged (counted instead), and each abstention is a
 *    decision. Each bullet NAMES THE COUNTER it increments rather than
 *    restating that counter's value: all four are on the `Factory defaults
 *    tables:` summary line of every run, and a value transcribed into this
 *    comment is true only until the next table moves — objectui#8102 is the
 *    card that measured this paragraph claiming five rows the tree had not
 *    carried since objectui#7887.
 *
 *      - A first argument that does not resolve to an object literal — a table
 *        built by a spread, a call, or an identifier this parser cannot follow
 *        to its `const`. Counted as an unreadable TABLE
 *        (`factoryUnreadableTables`), which is the loudest of these numbers: it
 *        is not one row leaving the surface, it is all of them.
 *      - A row whose key is computed, or whose value is not a static string
 *        (`factoryUnreadableRows`). Same abstention as a computed
 *        `defaultValue` in class 3, and for the same reason: there is no text
 *        to compare.
 *      - A row whose key `en` does not define (`factoryRowsNoEnKey`). That is
 *        class 1's shape, not this one's, and the two stay disjoint exactly as
 *        classes 1 and 3 do. It is worth knowing that class 1 CANNOT reach
 *        these: it judges call sites, and a table row with no call site
 *        anywhere is invisible to it. The worked example is objectui#7874's
 *        five `timeline.relative.*` rows in
 *        `packages/plugin-timeline/src/useTimelineTranslation.ts` — no `en`
 *        leaf and no caller, so this counter was the only reader in the repo
 *        that could see them, and once it did they were retired in
 *        objectui#7887. That is the whole argument for printing the count
 *        rather than absorbing it, and the argument does not need the bucket to
 *        be occupied: an empty one is the outcome the printing bought, and the
 *        day it stops being empty the run says so.
 *      - A key that resolves only through its plural suffixes, or an `en` leaf
 *        this parser could not read as a string (`factoryUnjudgedRows`). There
 *        is no single form to compare against; picking one would be an
 *        invention. Same words as class 3's own abstention, because it is the
 *        same abstention.
 *
 *    A NESTED object literal inside a table is deliberately NOT descended into,
 *    and this is the one place where copying
 *    `packages/i18n/src/__tests__/fallback-placeholder-spelling-3512.test.ts`'s
 *    table reader would be wrong. That test recurses with a dotted prefix; this
 *    class must not, because `fallbackT` does a FLAT `defaults[key]` lookup — a
 *    row spelled `{ calendar: { today: 'Today' } }` is never read by anything at
 *    runtime, so comparing it against `en.calendar.today` would green-light a
 *    dead row. It falls into "value is not a static string" instead, where a
 *    dead row belongs — inside `factoryUnreadableRows`, with the rest of that
 *    bullet, where the run prints it. The abstention is what stops the first
 *    one being read as healthy.
 *
 *    THE OTHER HALF OF THE POPULATION — objectui#7877, the B half of the
 *    ruling on objectui#7567 Q2. Three tables hand-roll `fallbackT`'s literal
 *    needle instead of taking the factory, so the walk above cannot see them:
 *    nothing in the source says which local function is a `fallbackT`. Two of
 *    them are reachable no other way (`GANTT_DEFAULT_TRANSLATIONS`,
 *    `IMPORT_DEFAULT_TRANSLATIONS`); the third,
 *    `TIMELINE_DEFAULT_TRANSLATIONS`, also reaches the factory and is already
 *    counted above.
 *
 *    Covering them takes a DECLARATION — which is why objectui#7567 shipped
 *    the registry-free half first and split this out, and why the population
 *    here is `packages/test-support/src/hand-rolled-tables.json` and not a
 *    heuristic. Option C on that card (gate every `Record<string, string>`
 *    that looks like a defaults map, inferred rather than declared) was
 *    rejected for inventing a heuristic where a declaration is available.
 *
 *    The two halves keep SEPARATE counters, a separate collapse floor and a
 *    separate summary line, and that separation is the point rather than
 *    tidiness: the factory walk compares hundreds of rows — its own summary
 *    line says how many — so a registry that stopped resolving anything at all
 *    would be invisible inside a combined number,
 *    and this half's verdict — also "0 drifted" — would be read off an empty
 *    scan set. Its floor is 150 against a measured 215 (80 + 135), chosen to
 *    sit above the LARGER of the two tables so that losing either one fails.
 *
 *    What keeps the declaration from rotting is not diligence and does not
 *    live here:
 *    `packages/i18n/src/__tests__/fallback-placeholder-spelling-3512.test.ts`
 *    asserts that the set of runtime files carrying the hand-rolled needle
 *    equals a pinned list, and that every declared entry contributes rows. A
 *    fourth hand-rolled `fallbackT` turns that case red naming its own file.
 *    Because this gate reads the SAME bytes that test reads rather than a
 *    copy of them, that one ratchet covers both readers — the reason the data
 *    moved to JSON on objectui#6923's ruling instead of being duplicated here
 *    and pinned.
 *
 * ## Dynamic keys: the explicit policy
 *
 * A key that is not a string literal cannot be resolved statically. Those call
 * sites are **not checked and not failed** — they are COUNTED, and the count is
 * printed on every run, so the unanalyzable surface is visible rather than
 * silently absorbed. The `missing-prefix` class above recovers the part of it
 * that can be decided, and class 6 recovers the part of THAT which a declared
 * vocabulary can settle; what neither reaches is a dynamic key with no static
 * head at all (`t(key)` on a variable — 35 sites), which nothing but a type
 * checker could resolve. Same treatment, same reason, for the deliberate
 * `I18N_PROBE_FLAG` misses (see below) and for the skipped binding classes.
 *
 * ## Key-building helpers: the leg that needs no call site (objectui#7592)
 *
 * Everything above starts at a `t()`/`tt()` call and reads its arguments. A
 * module that BUILDS a key and hands it to a translator it received as a plain
 * function VALUE has no such call for the walk to start from:
 *
 *   export function toolTitleKey(name) { return `ns.family.${name}`; }
 *   // …
 *   return translate ? translate(toolTitleKey(trimmed), english) : english;
 *
 * `translate` is a parameter, not `t`/`tt`, so the callee never matches; and the
 * file holds no `t(` spelling at all, so the pre-filter below drops it before
 * anything is even parsed. Both reverse-sweep legs and both family ratchets are
 * therefore blind at once — measured on `chatbot.tool.*`, whose 35 live,
 * rendering keys put 33 entries into `check-i18n-dead-keys.mjs`'s CONFIRMED
 * tier, 22% of it, one deletion away from reverting every AI tool card to
 * English in nine locales (objectui#7592, the regression cloud#1658 filed and
 * objectui#7254 fixed).
 *
 * So the head is read WHERE IT IS WRITTEN instead. A KEY BUILDER is a function
 * whose whole body is one returned template literal whose head is a dotted key
 * prefix that resolves against `en`; its head and tail feed `dynamicHeads` and
 * `dynamicFamilies` exactly as a template ARGUMENT would, which means the
 * family lands under the same two ratchets: undeclared is a red, and a builder
 * that stops being one turns its declaration stale, also a red. That is the
 * anti-vacuous half — a detection leg that silently degrades to a no-op is the
 * failure mode this whole class of card is about.
 *
 * Three boundaries, each load-bearing and each measured on this tree:
 *
 *   1. ONE returned template, nothing else. A multi-statement helper composes
 *      its head from things this parser cannot follow, and reading its first
 *      template anyway would invent families out of unrelated strings.
 *   2. The head must RESOLVE against `en` (`headMatches`), which is what makes
 *      this a key probe rather than a template-literal census: 97 files hold a
 *      dotted template, and requiring the head to prefix a real pack path is
 *      what leaves the builder shapes that are about i18n. The consequence is
 *      deliberate and is the one place this leg differs from the argument
 *      position: a builder whose head matches NOTHING is not recognised at all,
 *      so it never raises `missing-prefix`. Judging it would make every
 *      `` `${a}.${b}` `` in the repo a candidate defect.
 *   3. The registered local tables are skipped, same scope rule the call-site
 *      classifier uses — a builder inside `metadata-admin/` builds `engine.*`
 *      keys that are not in any pack by design.
 *
 * Blast radius on this checkout: 1 builder, 1 head, 47 extra files parsed out of
 * 1572 walked. The leg is narrow BY MEASUREMENT, not by hope.
 *
 * ## The probe exclusion
 *
 * `useObjectLabel` probes convention keys (`{ns}.objects.{name}.label`) that are
 * SUPPOSED to miss — it falls back to the server-resolved label. Those calls
 * carry `[I18N_PROBE_FLAG]: true`, and this gate excludes them by that flag, not
 * by path, so a probe written anywhere is excluded and a non-probe call in
 * `useObjectLabel.ts` is not. Both of today's probe sites happen to use dynamic
 * keys, so the flag currently only moves them out of the dynamic counter; the
 * exclusion is still load-bearing for the literal-key probe someone writes next,
 * and `scripts/__tests__/check-i18n-call-site-keys.test.ts` pins that shape.
 *
 * ## The baseline
 *
 * `scripts/i18n-call-site-key-baseline.json` lists the keys already missing on
 * `main` when this gate landed, each with the issue tracking its fix — classes 1,
 * 2 and 6 only; classes 3, 4 and 5 have no baseline and never needed one. It is a
 * ratchet, not an allowlist: a key that is NOT in it fails, and an entry that no
 * longer fires (key added to `en`, or its last call site deleted) ALSO fails, so
 * the file can only shrink. Fixing the debt means adding the key to
 * `packages/i18n/src/locales/en.ts` — which immediately makes
 * `all-locales-key-parity.test.ts` demand it in the other nine packs, which is
 * the correct order.
 */

import ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** Hook names whose `t` reaches i18next. See the header for why a name is enough. */
export const PACK_HOOK = /^use[A-Za-z0-9_]*(Translation|Translate|T)$/;

/**
 * The defaults-table factory, and `plugin-detail`'s re-export alias for it
 * (objectui#7567). Both spellings are ONE function —
 * `packages/plugin-detail/src/useDetailTranslation.ts` declares
 * `export const createSafeTranslationHook = createSafeTranslation` — so a class
 * that knew only the canonical name would silently skip
 * `DETAIL_DEFAULT_TRANSLATIONS`, the very table objectui#4401's hand-written
 * mirror test was written for. Same set, same reason, as the objectui#3512 test
 * in `packages/i18n/src/__tests__/`.
 */
export const FACTORY_NAMES = new Set(['createSafeTranslation', 'createSafeTranslationHook']);

/**
 * The DECLARED hand-rolled tables — objectui#7877, the B half of the ruling on
 * objectui#7567 Q2.
 *
 * Two tables re-implement `fallbackT` instead of taking the factory above, so
 * the factory-resolved walk cannot see them: nothing in the source says which
 * local function is a `fallbackT`, which is why covering them takes a
 * declaration and why objectui#7567 shipped A (registry-free) first and split
 * this out. Option C on that card — inferring the population by pattern-matching
 * identifier names or every `Record<string, string>` — was REJECTED for
 * inventing a heuristic where a declaration is available; if a future edit finds
 * itself matching on names, it is building C.
 *
 * ⚠️ This is not a second list. It is the SAME BYTES
 * `packages/test-support/src/defaults-table-scan.ts` reads, reached through the
 * `exports` subpath objectui#6923 ruled for data that has to cross the
 * `.mjs` / TypeScript boundary (`zod-wrapper-keys` is the first instance, read
 * the same way by two other gates in this directory). A bare
 * `node scripts/check-*.mjs` cannot import that module: its `exports` entry
 * resolves to TypeScript source with no build artefact. Copying the list here
 * and pinning the copies to each other was the alternative, and the reason it
 * was not taken is written out in that module's header — a copy CAN be stale for
 * the window between the two edits, and a scan population that quietly loses an
 * entry reports "0 drifted" while judging nothing.
 *
 * `createRequire` rather than `import … with { type: 'json' }` for the reason
 * `check-action-forward-parity.mjs` already records: this module is loaded both
 * by `node` (the gate run) and by Vite's SSR transform (its pin tests in
 * `scripts/__tests__/`), and under the latter an attributed JSON import yields
 * no default export.
 *
 * The registry carries `TIMELINE_DEFAULT_TRANSLATIONS` too, because it mirrors
 * the needle-file set objectui#3512's completeness case pins — but that table
 * ALSO reaches the factory, so this class de-duplicates against the tables the
 * factory walk already scanned rather than counting its rows twice. That
 * overlap is reported, not swallowed.
 */
export const HAND_ROLLED_TABLES = createRequire(import.meta.url)(
  '@object-ui/test-support/hand-rolled-tables',
);

/**
 * Annotations that mark a forwarded `t` as a translator. Only used to tell a
 * forwarded translator apart from an unrelated `t` parameter; provenance (which
 * table it reaches) comes from the file, not from the type.
 */
export const TRANSLATOR_TYPE =
  /Translat|\bTFunction\b|\bTFn\b|\(\s*key\s*:|\(\s*keyOrKeys\s*:|\(\s*k\s*:\s*string/;

/** The option flag `useObjectLabel` sets on its deliberate convention-key misses. */
export const PROBE_FLAG_NAMES = /I18N_PROBE_FLAG|__ouiLabelProbe/;

/**
 * i18next option names that CONTROL the lookup rather than fill a hole
 * (objectui#3845). `interpolationOptions()` reports a call site's option names
 * RAW, this set unfiltered — the filtering happens at the comparison, PER
 * DIRECTION (objectui#4206), and the two directions want opposite answers:
 * subtracted from the call site's names when judging `inert` (a reserved name
 * like `count`, i18next's plural selector, must never itself be called inert),
 * but left IN when judging `unfilled` (a call site that DOES pass `count` must
 * still be recognised as having filled a `{{count}}` hole — `count` is also
 * its own hole's name, and dropping it from both directions, as the rule did
 * before #4206, made `unfilled` structurally unable to ever contain `count`,
 * hiding real misses like objectui#4157). See the header (class 4) for the
 * worked example.
 *
 * `replace` is absent on purpose: it does not merely fail to be interpolation
 * data, it REDIRECTS where the data comes from, so a call site carrying one is
 * abstained on rather than having one name dropped.
 */
export const RESERVED_OPTION_NAMES = new Set([
  // plural / context selection — and `count` is also its own `{{count}}` hole
  'count',
  'ordinal',
  'context',
  // the default a miss falls back to, in all its plural spellings
  'defaultValue',
  'defaultValue_zero',
  'defaultValue_one',
  'defaultValue_two',
  'defaultValue_few',
  'defaultValue_many',
  'defaultValue_other',
  // namespace / language selection
  'ns',
  'lng',
  'lngs',
  'fallbackLng',
  // return shape and post-processing
  'returnObjects',
  'returnDetails',
  'returnedObjectHandler',
  'joinArrays',
  'postProcess',
  'postProcessorOptions',
  // interpolation and key parsing control
  'interpolation',
  'skipInterpolation',
  'keySeparator',
  'nsSeparator',
  'escapeValue',
  // missing-key handling
  'parseMissingKeyHandler',
  'missingKeyNoValueFallbackToKey',
  'appendNamespaceToMissingKey',
]);

/**
 * Keys whose `{{hole}}` is filled by the CONSUMER of the translated string
 * rather than by i18next (objectui#3845). Every entry is a decision with a
 * reason, the way `EXCLUDED_TRANSLATORS` is — and the self-test verifies each
 * one's premise against both the `en` pack and the named source file, so an
 * entry cannot outlive the substitution it describes.
 *
 * i18next leaves an unmatched `{{name}}` in the output verbatim, which is what
 * makes a second substitution stage possible at all: the string travels through
 * `t()` with its hole intact and the component fills it afterwards. That used
 * to require this registry, because a call-site-filled `{{hole}}` is otherwise
 * indistinguishable from an i18next hole somebody forgot to pass an argument
 * for — `auth.forgotPassword.successDescription` was the one entry, exempted
 * from the `unfilled` check while `ForgotPasswordForm.tsx` filled it downstream.
 *
 * objectui#4135's 2026-08-11 maintainer ruling retired that entry by fixing the
 * ambiguity at its source instead of fencing it: a hole filled downstream of
 * `t()` is now ALWAYS spelled with SINGLE braces (`{x}`), which sits outside
 * i18next's `{{…}}` syntax and is therefore invisible to `holesOf()` — safe by
 * construction, no exemption needed. `resendOtpCountdownText`'s `{seconds}`
 * (`apps/console/src/pages/auth/ForgotPasswordPage.tsx`) was already this
 * shape; `successDescription` now matches it. The registry mechanism stays in
 * place, empty, for the day a future case genuinely cannot avoid a
 * double-brace hole filled outside i18next — the self-test below still checks
 * every entry it holds, whatever that count is.
 */
export const EXTERNALLY_INTERPOLATED_HOLES = [];

/**
 * The interpolation names an `en` value has holes for (objectui#3845).
 *
 * i18next's default interpolation is `{{name}}`; `{{name, format}}` names a
 * formatter, `{{- name}}` asks for the unescaped value, and `{{a.b}}` reads a
 * keypath off the option called `a`. Today's pack uses none of the three — all
 * 84 distinct holes in `en` are bare names — but reading through them costs four
 * lines and stops the first one that appears from being read as a different
 * hole (or, for the keypath, as a missing option nobody passes).
 */
export function holesOf(value) {
  const names = new Set();
  for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const name = match[1]
      .split(',')[0] // `{{n, number}}` — the formatter is not part of the name
      .trim()
      .replace(/^-\s*/, '') // `{{- html}}` — the unescape marker is not either
      .split('.')[0] // `{{user.name}}` is filled by the option called `user`
      .trim();
    if (name) names.add(name);
  }
  return names;
}

/**
 * A `{{…}}` pair and its contents. `[^{}]*` deliberately: a placeholder never
 * nests braces, and refusing to cross one keeps an unterminated `{{` from
 * swallowing the rest of the sentence into a bogus "placeholder".
 */
const DOUBLE_BRACE = /\{\{([^{}]*)\}\}/g;

/** Every `{{` occurrence, matched or not — the balance check's other half. */
const DOUBLE_BRACE_OPEN = /\{\{/g;

/**
 * The one placeholder spelling `createSafeTranslation`'s `fallbackT` resolves.
 * The option name comes from `Object.entries(options)` and is spliced into the
 * needle raw (``value.split(`{{${k}}}`)``), so the accepted name is exactly a
 * bare identifier: no whitespace, no format spec, no `-` prefix, no keypath.
 */
const CANONICAL_HOLE_NAME = /^[A-Za-z0-9_]+$/;

/** i18next's nesting syntax. The fallback has no notion of it at all. */
const NESTING_MARKER = '$t(';

/** Why one placeholder is not something `fallbackT` can resolve. */
function unresolvableReason(inner) {
  if (inner !== inner.trim()) return 'whitespace inside the braces';
  if (inner.startsWith('-')) return 'the {{- x}} unescape prefix';
  if (inner.includes(',')) return 'an i18next format spec';
  if (inner.includes('.')) return 'a dotted/keyed placeholder path';
  return 'a non-identifier placeholder name';
}

/**
 * Placeholder spellings the provider-less fallback cannot resolve
 * (objectui#4905, class 7 — the rule is objectui#3512's, applied to the one
 * copy surface that card left out).
 *
 * `fallbackT` interpolates with an EXACT literal needle, so it recognises
 * `{{name}}` and nothing else. i18next — which serves the SAME string whenever
 * an `I18nProvider` is mounted — additionally recognises `{{ name }}`,
 * `{{count, number}}`, `{{- name}}` and `$t(otherKey)`. Those four render
 * correctly through the provider and leak literal braces without one, which is
 * a divergence only a provider-less host ever sees.
 *
 * Returns one human-readable violation per offending placeholder, and `[]` for
 * text both paths render identically.
 *
 * ## What is structurally out of range, and why that matters
 *
 *   - **Single braces.** `{shown}` / `{seconds}` is objectui#4135's spelling for
 *     a hole filled DOWNSTREAM of `t()`. Only the inside of a `{{…}}` pair is
 *     ever inspected, so a single-brace hole cannot reach a verdict here —
 *     excluded by where the rule looks, not by an allow-list that could rot.
 *   - **JSX object literals.** `style={{ opacity: 0 }}` is `{{` that is syntax,
 *     not copy. This rule never greps source text: it is handed the TEXT of a
 *     string literal or the literal segments of a template, and a JSX brace is
 *     not inside either.
 *
 * ## The sibling copy, named rather than hidden — and now pinned to it
 *
 * `packages/i18n/src/__tests__/placeholder-spelling-rule.ts`
 * (`placeholderViolations`, enforced by `fallback-placeholder-spelling-3512.test.ts`)
 * carries the same rule over the ten locale packs and the discovered defaults
 * TABLES. This copy exists because that gate is a vitest suite reading copy
 * tables and this one is a node script reading call-site ARGUMENTS — the walk
 * that finds a `defaultValue` is the classifier this file already owns, and
 * rebuilding it there was rejected on objectui#4905.
 *
 * Until objectui#7310 the only thing holding the two together was that each
 * names the other and each has its own self-test, which is a promise rather
 * than a mechanism: it survives exactly as long as whoever widens one of them
 * happens to read both. `scripts/__tests__/placeholder-spelling-parity.test.ts`
 * is the mechanism — it feeds one corpus (both self-tests' cases, a grammar
 * matrix over every dialect and boundary, every string leaf of the ten packs
 * and every discovered defaults row) through BOTH implementations and fails
 * naming the input they disagreed on. Merging the two was measured first and is
 * closed in both directions; that file's header records what was measured.
 *
 * ⇒ Widening this rule means widening it on BOTH sides, in one change. The
 * parity gate is not a thing to relax when it goes red — it going red IS the
 * defect objectui#7310 filed.
 */
export function unresolvableSpellings(value) {
  const out = [];
  const regions = [...value.matchAll(DOUBLE_BRACE)];
  for (const region of regions) {
    const inner = region[1];
    if (CANONICAL_HOLE_NAME.test(inner)) continue;
    out.push(`${JSON.stringify(region[0])} — ${unresolvableReason(inner)}; the fallback resolves only {{name}}`);
  }
  // An unterminated `{{` renders as literal braces on BOTH paths, so it is not
  // an i18next divergence — but it is never intentional copy, and the regions
  // above cannot report what they did not match. A hole straddling a template
  // substitution (`` `{{ ${name} }}` ``) lands here, which is the one shape
  // neither interpolator can resolve.
  const opens = (value.match(DOUBLE_BRACE_OPEN) ?? []).length;
  if (opens > regions.length) out.push('an unterminated `{{` with no closing `}}`');
  if (value.includes(NESTING_MARKER)) {
    out.push('`$t(` — i18next nesting, which the fallback emits verbatim');
  }
  return out;
}

/**
 * `t` bindings that do NOT resolve against the locale packs. Every entry is a
 * decision with a reason; an imported `t` from anywhere else is a hard error
 * (`unregistered-translator`) rather than a silent skip.
 *
 * `forwardedScope` is the directory whose files may receive this table's `t` as
 * a parameter or prop. Without it, a component that takes `t` from a
 * metadata-admin parent reads as pack-backed and its `engine.*` keys report as
 * missing — 89 such false reds, measured, across `CelPredicateField.tsx`,
 * `CelTestRunDialog.tsx`, `ConditionalFormattingEditor.tsx`,
 * `PermissionAdvancedFacets.tsx` and `PermissionMatrixEditor.tsx`.
 */
export const EXCLUDED_TRANSLATORS = [
  {
    module: 'packages/app-shell/src/views/metadata-admin/i18n.ts',
    forwardedScope: ['packages/app-shell/src/views/metadata-admin/'],
    reason:
      'module-local engine.* label table (a plain Record lookup, not i18next); ' +
      'its keys are not in any locale pack by design — see that file\'s header',
  },
];

// ── dynamic key families: the vocabulary registry (objectui#4964) ─────────────

/**
 * Every pack-backed dynamic key family in the repo, each declaring how its
 * member set is known — or declaring, with a reason, that it cannot be known.
 *
 * ## Why a registry rather than inference
 *
 * `missing-prefix` (class 2) is the only claim about a template key that is
 * true without knowing the substitution: if the static HEAD matches nothing,
 * every expansion misses. Its own header says so. The cost is that the
 * complement — a head that resolves and a MEMBER that does not — is invisible
 * to the whole gate farm, because the other two i18n gates are pack-vs-pack:
 * ten packs identically missing `filterBuilder.operators.isNull` is full
 * parity, and full parity is green. Users read the raw key
 * (objectui#4964; the measured instance was fixed in objectui#4962).
 *
 * Closing that needs the member set, and a member set is a decision, not a
 * measurement: `t(`grid.import.jobStatus.${job.status}`)` is exactly checkable
 * only because `ImportJobStatus` is a union of five string literals somewhere,
 * while `t(`approvalsInbox.${key}`)` forwards a `key: string` parameter and has
 * no member set at all. This file parses source without a type checker (see
 * `collectEnKeys`'s header — no build step, no TS loader), so it cannot follow
 * `job.status` to its declaration. What it CAN do is read a declaration a human
 * NAMES, from the module that holds it.
 *
 * So each family below is one of two things, and the split is the point:
 *
 *   - `vocabulary` — the member set is a named declaration this file reads from
 *     source. Every `head + member + tail` is then checked as an ordinary key,
 *     and a member missing from `en` is a `missing-member` finding.
 *   - `enumerable: false` — there is no static member set. The family keeps its
 *     prefix check and NOTHING ELSE, and the `reason` says why. Pretending
 *     otherwise would produce either false reds (guessing a vocabulary) or a
 *     check that silently skips the family (the failure mode this card names).
 *
 * ## Both ratchet directions
 *
 * A head observed in the scan with no entry here is `undeclared-dynamic-family`
 * and fails: a new template family cannot land unguarded, which is what let the
 * twenty-odd families below accumulate unmeasured. An entry whose head no
 * longer appears is `stale-dynamic-family` and fails too, so this list can only
 * describe families that exist. And a `vocabulary` that resolves to ZERO
 * members is `empty-vocabulary` — a vacuous exact check reads identical to a
 * passing one, and that is the one way this class could quietly cover less than
 * the prefix check it sits on top of. The prefix check itself is untouched: it
 * still runs for every dynamic head, declared or not.
 *
 * `kind` tells the reader what shape the declaration is:
 *
 *   `union`          `type X = 'a' | 'b'`                    -> the literals
 *   `array`          `const X = ['a', 'b'] as const`         -> the elements
 *   `arrayField`     `const X = [{ value: 'a' }, …]` + field -> that field's values
 *   `objectKeys`     `const X = { a: …, b: … }`              -> the property names
 *   `objectField`    `const X = { a: { k: 'x' } }` + field   -> that field's values
 *   `set`            `const X = new Set(['a', 'b'])`         -> the elements
 *   `interfaceField` `interface X { f: 'a' | 'b' }` + field  -> that property's literals
 *
 * And `enumerable: false` carries a `why`, because the four reasons are not the
 * same finding and only one of them is permanent:
 *
 *   `runtime-data`        the substitution is server- or user-supplied. There is
 *                         no member set to know, at any point, by anyone.
 *   `external-vocabulary` the member set exists and is authoritative, but it
 *                         lives in a dependency (`@objectstack/spec`), not in
 *                         this repo's source. Bridgeable — by a repo-local
 *                         exhaustive `Record<Union, …>` this reader can read.
 *   `unnamed-union`       the member set is written inline (a parameter
 *                         annotation, an anonymous state type) rather than as a
 *                         declaration that can be named. Bridgeable by naming it.
 *   `open-forwarder`      the call site takes `key: string` and forwards it, so
 *                         the family is the whole namespace and the template is
 *                         a namespace prefix, not a member position.
 */
/**
 * @typedef {{ module: string, name: string,
 *   kind: 'union' | 'array' | 'arrayField' | 'objectKeys' | 'objectField' | 'set' | 'interfaceField',
 *   field?: string }} VocabularySpec
 * @typedef {{ head: string, vocabulary?: VocabularySpec, enumerable?: boolean,
 *   why?: 'runtime-data' | 'external-vocabulary' | 'unnamed-union' | 'open-forwarder',
 *   reason?: string }} DynamicKeyFamily
 *
 * @type {DynamicKeyFamily[]}
 */
export const DYNAMIC_KEY_FAMILIES = [
  {
    head: 'appDesigner.fieldDesigner.typeCategory.',
    vocabulary: { module: 'packages/plugin-designer/src/FieldDesigner.tsx', name: 'FieldTypeCategory', kind: 'union' },
  },
  {
    head: 'approvalsInbox.',
    enumerable: false,
    why: 'open-forwarder',
    reason:
      'ApprovalsInboxPage and RecordApprovalsPanel both wrap the pack in ' +
      '`tr(key: string, defaultValue: string)`, so the template head is the whole ' +
      '`approvalsInbox` namespace (169 keys) and the substitution is every leaf under it. ' +
      'There is no member position to check; the literal keys are at the `tr()` call sites, ' +
      'which pass strings this file cannot follow through the helper.',
  },
  {
    head: 'capability.group.',
    vocabulary: { module: 'packages/fields/src/widgets/CapabilityMultiSelectField.tsx', name: 'SCOPE_ORDER', kind: 'array' },
  },
  {
    head: 'capability.label.',
    vocabulary: { module: 'packages/fields/src/widgets/CapabilityMultiSelectField.tsx', name: 'CURATED_CAPABILITY_LABELS', kind: 'set' },
  },
  {
    head: 'chatbot.tool.',
    // Reached through the KEY-BUILDER leg, not a call site: `toolTitleKey()` in
    // packages/plugin-chatbot/src/tool-display.ts builds the key and the module
    // spells no `t(` at all (objectui#7592).
    enumerable: false,
    why: 'external-vocabulary',
    reason:
      'The member set is the platform tool registry — `PLATFORM_TOOLS_BY_PACKAGE` in ' +
      '`@objectstack/spec/system` — and this reader opens repo source only (see readVocabulary). ' +
      'No repo-local exhaustive Record mirrors it, and writing one here would be a SECOND ' +
      'registry to keep in sync with a pinned spec that already lags the cloud runtime. The set ' +
      'identity is pinned one layer out instead, where the registry can be imported: ' +
      'packages/plugin-chatbot/src/__tests__/toolLabels-locale-parity-7481.test.ts requires every ' +
      'registered tool to carry a non-empty label in all ten packs (objectui#7481).',
  },
  {
    head: 'common.',
    enumerable: false,
    why: 'unnamed-union',
    reason:
      "`useChatbotLabel` annotates its parameter `key: 'openChat' | 'closeChat'` inline. The " +
      'member set is real and closed, but it is not a declaration this reader can be pointed ' +
      'at. Naming that union would make the family exactly checkable — a one-line change in ' +
      'packages/plugin-chatbot/src/FloatingChatbotTrigger.tsx, deliberately left to the owner ' +
      'rather than folded into the gate card.',
  },
  {
    head: 'console.ai.group.',
    vocabulary: { module: 'packages/app-shell/src/console/ai/ConversationsSidebar.tsx', name: 'ConversationGroupKey', kind: 'union' },
  },
  {
    head: 'console.identityImport.policy.',
    vocabulary: { module: 'packages/app-shell/src/views/identityImport.ts', name: 'IdentityPasswordPolicy', kind: 'union' },
  },
  {
    head: 'console.identityImport.policyHint.',
    vocabulary: { module: 'packages/app-shell/src/views/identityImport.ts', name: 'IdentityPasswordPolicy', kind: 'union' },
  },
  {
    head: 'console.settingsHub.categories.',
    enumerable: false,
    why: 'runtime-data',
    reason:
      'The category is a free string off each settings manifest, grouped at render time. ' +
      'Any plugin can ship a new one, so the set is not knowable from this repo at all — ' +
      "the call site's `defaultValue: category` is the correct treatment, not a gate entry.",
  },
  {
    head: 'dashboard.filters.range.',
    enumerable: false,
    why: 'external-vocabulary',
    reason:
      'The presets the bar renders are `DATE_RANGE_PRESETS` from `@objectstack/spec/ui`, a ' +
      'dependency. This reader reads repo source only (see readVocabulary), and the repo has ' +
      'no exhaustive `Record<DateRangePreset, …>` to read instead. ' +
      '`packages/types/src/data-protocol.ts`\'s `FilterBuilderDateRangePreset` is a DIFFERENT ' +
      'vocabulary (the filter builder\'s) and using it here would be a guess, which is worse ' +
      'than this declaration.',
  },
  {
    head: 'dashboard.trend.',
    vocabulary: { module: 'packages/plugin-dashboard/src/DatasetWidget.tsx', name: 'TREND_LABEL_DEFAULTS', kind: 'objectKeys' },
  },
  {
    head: 'filterBuilder.operators.',
    vocabulary: { module: 'packages/components/src/custom/filter-builder.tsx', name: 'defaultOperators', kind: 'arrayField', field: 'value' },
  },
  {
    head: 'gantt.link.rejected.',
    vocabulary: { module: 'packages/plugin-gantt/src/GanttView.tsx', name: 'GanttLinkRejection', kind: 'union' },
  },
  {
    head: 'gantt.linkEnd.',
    enumerable: false,
    why: 'unnamed-union',
    reason:
      "`endLabel(e: 'start' | 'end')` and the `linkDrag` state's `sourceEnd`/`targetEnd` both " +
      'spell the union inline; GanttView exports `GanttLinkType` and `GanttLinkRejection` but ' +
      'no endpoint type. Naming it would make this family exactly checkable.',
  },
  {
    head: 'gantt.linkType.',
    vocabulary: { module: 'packages/plugin-gantt/src/GanttView.tsx', name: 'GanttLinkType', kind: 'union' },
  },
  {
    head: 'gantt.viewMode.',
    vocabulary: { module: 'packages/plugin-gantt/src/GanttView.tsx', name: 'GanttViewMode', kind: 'union' },
  },
  {
    head: 'grid.import.confidence.',
    vocabulary: { module: 'packages/plugin-grid/src/importParsers.ts', name: 'MappingConfidence', kind: 'union' },
  },
  {
    head: 'grid.import.jobStatus.',
    // `ImportJobStatus` itself is a Zod enum in `@objectstack/spec/api`, out of
    // this reader's reach — but `IMPORT_JOB_STATUS_VARIANT` is declared
    // `Record<ImportJobStatus, …>`, so tsc already requires its keys to be
    // exactly that union. Reading the Record is reading the union, with the
    // exhaustiveness enforced by the type checker this file does not run.
    vocabulary: { module: 'packages/plugin-grid/src/ImportWizard.tsx', name: 'IMPORT_JOB_STATUS_VARIANT', kind: 'objectKeys' },
  },
  {
    head: 'grid.import.type.',
    vocabulary: { module: 'packages/plugin-grid/src/importParsers.ts', name: 'InferredType', kind: 'union' },
  },
  {
    head: 'home.recentApps.itemType.',
    // `RecentItem` became a union of two entry shapes (objectui#11678); its
    // `type` members are the one literal union both shapes draw their arms from.
    vocabulary: { module: 'packages/app-shell/src/context/RecentItemsProvider.tsx', name: 'RecentItemType', kind: 'union' },
  },
  {
    head: 'managedByBadge.',
    // The member is `variant.i18nKey`, NOT the `VARIANTS` key — the two agree
    // today and the gate must not assume they will, so the field is read.
    vocabulary: { module: 'packages/app-shell/src/components/ManagedByBadge.tsx', name: 'VARIANTS', kind: 'objectField', field: 'i18nKey' },
  },
  {
    head: 'marketplace.category.',
    enumerable: false,
    why: 'runtime-data',
    reason:
      '`MarketplacePackage.category` is `string | null` off the registry API — a marketplace ' +
      'the platform does not own decides the set. The 15 members `en` carries are a curated ' +
      'subset, not the vocabulary.',
  },
  {
    head: 'marketplace.disclosure.runtime.',
    vocabulary: { module: 'packages/app-shell/src/console/marketplace/PluginDisclosure.tsx', name: 'RUNTIME_FALLBACK', kind: 'objectKeys' },
  },
  {
    head: 'organization.invitations.status.',
    vocabulary: { module: 'packages/app-shell/src/console/organizations/manage/InvitationsPage.tsx', name: 'StatusFilter', kind: 'union' },
  },
  {
    head: 'report.aggregate.',
    enumerable: false,
    why: 'external-vocabulary',
    reason:
      "The aggregate name comes from a chart series' `aggregate`, whose vocabulary is the " +
      "spec's chart-aggregate enum in `@objectstack/spec/ui`. No repo-local exhaustive Record " +
      'mirrors it, so there is nothing here to read.',
  },
];

/**
 * Read the literal members of a named declaration, from source.
 *
 * Returns `null` when the declaration is not found or is not the declared
 * shape — which the caller reports rather than absorbs, because a registry
 * entry pointing at a moved or rewritten declaration must not silently degrade
 * into "no members to check".
 *
 * @param {string} root
 * @param {VocabularySpec} spec
 * @returns {string[] | null}
 */
export function readVocabulary(root, spec) {
  const file = join(root, spec.module);
  if (!existsSync(file)) return null;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

  const unwrap = (node) => {
    let n = node;
    while (n && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || (ts.isSatisfiesExpression?.(n) ?? false))) {
      n = n.expression;
    }
    return n;
  };
  const literal = (node) => {
    const inner = unwrap(node);
    return inner && (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) ? inner.text : null;
  };
  const propertyName = (prop) =>
    ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)
      ? prop.name.text
      : null;

  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isTypeAliasDeclaration(node) && node.name.text === spec.name) {
      // A `type X = { … }` object literal type answers `interfaceField` too, so
      // the registry never has to know which of the two spellings a shape uses.
      found = ts.isTypeLiteralNode(node.type) ? { type: node.type, members: node.type.members } : { type: node.type };
    } else if (ts.isInterfaceDeclaration(node) && node.name.text === spec.name) {
      found = { members: node.members };
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === spec.name) {
      found = { value: node.initializer ? unwrap(node.initializer) : null };
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) return null;

  const members = [];
  if (spec.kind === 'union' || spec.kind === 'interfaceField') {
    let type = found.type;
    if (spec.kind === 'interfaceField') {
      const members = found.members;
      if (!members) return null;
      const property = members.find(
        (m) => ts.isPropertySignature(m) && m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === spec.field,
      );
      if (!property || !property.type) return null;
      type = property.type;
    }
    if (!type) return null;
    // A single-member union is a bare LiteralType, not a UnionType.
    const arms = ts.isUnionTypeNode(type) ? type.types : [type];
    for (const arm of arms) {
      if (!ts.isLiteralTypeNode(arm) || !ts.isStringLiteral(arm.literal)) return null;
      members.push(arm.literal.text);
    }
    return members;
  }

  const value0 = found.value;
  if (!value0) return null;
  let value = value0;
  if (spec.kind === 'set') {
    if (!ts.isNewExpression(value) || !value.arguments || value.arguments.length !== 1) return null;
    value = unwrap(value.arguments[0]);
  }

  if (spec.kind === 'array' || spec.kind === 'set') {
    if (!value || !ts.isArrayLiteralExpression(value)) return null;
    for (const element of value.elements) {
      const text = literal(element);
      if (text === null) return null;
      members.push(text);
    }
    return members;
  }
  if (spec.kind === 'arrayField') {
    if (!ts.isArrayLiteralExpression(value)) return null;
    for (const element of value.elements) {
      const object = unwrap(element);
      if (!object || !ts.isObjectLiteralExpression(object)) return null;
      const prop = object.properties.find((p) => ts.isPropertyAssignment(p) && propertyName(p) === spec.field);
      if (!prop) return null;
      const text = literal(prop.initializer);
      if (text === null) return null;
      members.push(text);
    }
    return members;
  }
  if (spec.kind === 'objectKeys' || spec.kind === 'objectField') {
    if (!ts.isObjectLiteralExpression(value)) return null;
    for (const prop of value.properties) {
      if (!ts.isPropertyAssignment(prop)) return null;
      const name = propertyName(prop);
      if (name === null) return null;
      if (spec.kind === 'objectKeys') {
        members.push(name);
        continue;
      }
      const nested = unwrap(prop.initializer);
      if (!nested || !ts.isObjectLiteralExpression(nested)) return null;
      const inner = nested.properties.find((p) => ts.isPropertyAssignment(p) && propertyName(p) === spec.field);
      if (!inner) return null;
      const text = literal(inner.initializer);
      if (text === null) return null;
      members.push(text);
    }
    return members;
  }
  return null;
}

/** Directories never scanned: build output, deps, and test/mock trees. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '__mocks__']);
const TEST_FILE = /(^|[/\\])__tests__[/\\]|\.test\.tsx?$|\.spec\.tsx?$/;

/** i18next resolves `key` when the pack defines any of these plural forms. */
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

// ── the `en` pack ────────────────────────────────────────────────────────────

/**
 * Read a node as a static string, or return `null` if it is not one.
 *
 * `'a' + 'b'` counts: a pack may wrap a long sentence that way (none does
 * today), and a leaf this returns `null` for is a leaf the
 * `default-value-drift` rule cannot judge — so folding the concatenation here
 * is what keeps such a key inside the checked surface instead of silently
 * outside it.
 */
function staticString(node, source) {
  const inner = unwrapExpression(node);
  if (!inner) return null;
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return inner.text;
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(inner.left, source);
    const right = staticString(inner.right, source);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/**
 * Every piece of an expression that is STATIC TEXT, or `null` when none of it
 * is (objectui#4905).
 *
 * `staticString` above answers "is this whole expression one readable string",
 * which is what the drift rule needs — it compares a sentence. The spelling
 * rule asks something weaker and therefore reaches further: a template literal
 * is not a readable sentence, but its literal SEGMENTS are text a placeholder
 * can be misspelled in, and that text renders verbatim on a provider-less host.
 * `` `Uploading… ({{ pct }}%)` `` is `null` to `staticString` and two segments
 * here, and the second is where the defect lives.
 *
 * The segments are judged one by one rather than joined, because joining them
 * would invent adjacencies the runtime never produces: the substitution between
 * two segments becomes arbitrary text at runtime, so a `{{` in one and a `}}`
 * in the next is not a placeholder either interpolator can resolve, and reading
 * it as one would be the false green.
 */
function staticTextSegments(node, source) {
  const inner = unwrapExpression(node);
  if (!inner) return null;
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return [inner.text];
  if (ts.isTemplateExpression(inner)) {
    return [inner.head.text, ...inner.templateSpans.map((span) => span.literal.text)];
  }
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticTextSegments(inner.left, source);
    const right = staticTextSegments(inner.right, source);
    if (left === null && right === null) return null;
    return [...(left ?? []), ...(right ?? [])];
  }
  return null;
}

/**
 * Dotted leaf paths of `packages/i18n/src/locales/en.ts`, read from its AST,
 * plus the leaf VALUES — the strings the app actually renders.
 *
 * Parsed rather than imported so the gate needs no build step and no TS loader.
 * `scripts/__tests__/check-i18n-call-site-keys.test.ts` pins this extraction
 * against the real module evaluated by vitest, keys AND values, so the two
 * cannot drift.
 *
 * `values` holds only leaves that read as a static string. Every leaf is in
 * `leaves` either way: the key rules judge existence and need no value, and the
 * value rule declines to judge what it could not read rather than guessing.
 *
 * @returns {{ leaves: Set<string>, branches: Set<string>, values: Map<string, string> }}
 */
export function collectEnKeys(root) {
  const file = join(root, 'packages/i18n/src/locales/en.ts');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

  const unwrap = (node) => {
    let n = node;
    while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || (ts.isSatisfiesExpression?.(n) ?? false)) n = n.expression;
    return n;
  };

  let literal = null;
  const findEn = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'en' &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(init)) literal = init;
    }
    ts.forEachChild(node, findEn);
  };
  findEn(source);
  if (!literal) throw new Error(`cannot find the \`const en = { … }\` object literal in ${file}`);

  const leaves = new Set();
  const branches = new Set();
  const values = new Map();
  const walk = (object, prefix) => {
    for (const prop of object.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        throw new Error(`unsupported property form in ${file} at ${prefix || '<root>'}: ${ts.SyntaxKind[prop.kind]}`);
      }
      const name =
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)
          ? prop.name.text
          : null;
      if (name === null) {
        throw new Error(`unsupported key form in ${file} at ${prefix || '<root>'}`);
      }
      const path = prefix ? `${prefix}.${name}` : name;
      const value = unwrap(prop.initializer);
      if (ts.isObjectLiteralExpression(value)) {
        branches.add(path);
        walk(value, path);
      } else {
        leaves.add(path);
        const text = staticString(value, source);
        if (text !== null) values.set(path, text);
      }
    }
  };
  walk(literal, '');
  return { leaves, branches, values };
}

// ── source walk ──────────────────────────────────────────────────────────────

/** Every non-test `.ts`/`.tsx` file under `packages/` and `apps/`. */
export function collectSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !TEST_FILE.test(full)) out.push(full);
    }
  };
  for (const top of ['packages', 'apps']) {
    const dir = join(root, top);
    if (existsSync(dir)) walk(dir);
  }
  return out.sort();
}

/** The scope node a declaration belongs to (function body, block, file, …). */
function enclosingScope(node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isSourceFile(current) ||
      ts.isBlock(current) ||
      ts.isModuleBlock(current) ||
      ts.isCaseBlock(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isForStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isForInStatement(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Resolve a relative import specifier to a repo-relative file path.
 *
 * An ESM-correct specifier addresses the EMITTED file: `./i18n.js` is how a
 * package whose build preserves specifiers has to spell `i18n.ts`, because
 * Node's resolver does not extension-search relative specifiers (objectui#4538,
 * enforced per pull request by `pnpm check:esm-specifiers`). So the emitted
 * extension is stripped back to its source before the candidate walk.
 *
 * Not cosmetic: `@object-ui/app-shell` converted under objectui#5357 and its
 * registered local translator started resolving to
 * `…/metadata-admin/i18n.js` — a path with no file behind it — which turned
 * every call site through that table into an `unregistered-translator` finding.
 * The specifier was right and this resolver was wrong.
 */
function resolveImport(root, fromFile, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  const base = resolve(dirname(fromFile), specifier);
  const asSource = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  // Source spelling first, then the literal one, so a package that really does
  // ship a `.js` file next to its TypeScript still resolves to that file.
  for (const candidateBase of asSource === base ? [base] : [asSource, base]) {
    for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
      const candidate = candidateBase + suffix;
      if (existsSync(candidate) && statSync(candidate).isFile()) return relative(root, candidate);
    }
  }
  return relative(root, base);
}

/**
 * Collect every declaration of `t`/`tt` in a file, with the shape that produced
 * it. Kinds: `packHook`, `import`, `localFunction`, `forwarded`, `other`.
 */
function collectBindings(root, file, source) {
  const bindings = [];
  const add = (name, declaration, kind, detail) =>
    bindings.push({
      name,
      kind,
      detail,
      scope: enclosingScope(declaration) ?? source,
      pos: declaration.getStart(source),
    });
  const named = (name) => name === 't' || name === 'tt';

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      const specifier = node.moduleSpecifier.getText(source).slice(1, -1);
      for (const element of node.importClause.namedBindings.elements) {
        if (named(element.name.text)) {
          add(element.name.text, node, 'import', resolveImport(root, file, specifier));
        }
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name && named(node.name.text)) {
      add(node.name.text, node, 'localFunction', 'declared in this file');
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isNonNullExpression(init)) {
        init = init.expression;
      }
      let kind = 'other';
      let detail = ts.SyntaxKind[init.kind];
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
        detail = `${init.expression.text}()`;
        if (PACK_HOOK.test(init.expression.text)) kind = 'packHook';
      } else if (ts.isCallExpression(init)) {
        detail = `${init.expression.getText(source)}()`;
      } else if (ts.isIdentifier(init)) {
        // `const { t } = props` — a forwarded translator, same hop as a parameter.
        kind = 'forwarded';
        detail = `destructured from \`${init.text}\``;
      }

      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const property = element.propertyName ? element.propertyName.getText(source) : element.name.getText(source);
          if (property !== 't' && property !== 'tt') continue;
          if (!ts.isIdentifier(element.name)) continue;
          add(element.name.text, node, kind === 'other' ? 'other' : kind, detail);
        }
      } else if (ts.isIdentifier(node.name) && named(node.name.text)) {
        add(node.name.text, node, kind, detail);
      }
    }

    if (ts.isParameter(node)) {
      if (ts.isIdentifier(node.name) && named(node.name.text)) {
        const annotation = node.type ? node.type.getText(source).replace(/\s+/g, ' ') : '';
        add(node.name.text, node, TRANSLATOR_TYPE.test(annotation) ? 'forwarded' : 'other', `parameter: ${annotation || '(untyped)'}`);
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const property = element.propertyName ? element.propertyName.getText(source) : element.name.getText(source);
          if (property !== 't' && property !== 'tt') continue;
          if (!ts.isIdentifier(element.name)) continue;
          // A destructured prop: prefer the member's own type off an inline
          // type literal, else the whole annotation (`SomeProps`).
          let annotation = node.type ? node.type.getText(source).replace(/\s+/g, ' ') : '';
          if (node.type && ts.isTypeLiteralNode(node.type)) {
            for (const member of node.type.members) {
              if (ts.isPropertySignature(member) && member.name.getText(source) === property && member.type) {
                annotation = member.type.getText(source).replace(/\s+/g, ' ');
              }
            }
          }
          add(element.name.text, node, 'forwarded', `prop: ${annotation || '(untyped)'}`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

/** Nearest binding of `name` visible at `position`: deepest scope, then latest declaration. */
function bindingAt(bindings, source, name, position) {
  let best = null;
  for (const binding of bindings) {
    if (binding.name !== name) continue;
    if (!binding.scope) continue;
    if (position < binding.scope.getStart(source) || position > binding.scope.getEnd()) continue;
    if (!best) {
      best = binding;
      continue;
    }
    const deeper = binding.scope.getStart(source) > best.scope.getStart(source);
    const sameScope = binding.scope === best.scope;
    if (deeper) best = binding;
    else if (sameScope && binding.pos <= position && (best.pos > position || binding.pos > best.pos)) best = binding;
  }
  return best;
}

/** Strip `as`/parenthesis wrappers, which callers use to satisfy the key type. */
function unwrapExpression(node) {
  let current = node;
  while (current && (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current))) {
    current = current.expression;
  }
  return current;
}

/** Literal keys a first argument denotes, plus whether any part of it is dynamic. */
function literalKeysOf(argument, source) {
  const keys = [];
  let dynamic = false;
  const read = (node) => {
    if (!node) {
      dynamic = true;
      return;
    }
    const inner = unwrapExpression(node);
    if (inner !== node) {
      read(inner);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      keys.push(node.text);
    } else if (ts.isArrayLiteralExpression(node)) {
      // `tt(['common.total', 'dashboard.total'], 'Total')` — a migration chain.
      for (const element of node.elements) read(element);
    } else if (ts.isConditionalExpression(node)) {
      read(node.whenTrue);
      read(node.whenFalse);
    } else {
      dynamic = true;
    }
  };
  read(argument);
  return { keys, dynamic };
}

/**
 * The inline `defaultValue` an options argument carries (objectui#3810).
 *
 * `{ present: false }`            — no `defaultValue` property at all.
 * `{ present: true, text }`       — a static string this rule can compare.
 * `{ present: true, text: null }` — written, but computed (a template with a
 *                                   substitution, a variable, a ternary). Not
 *                                   comparable, so it is counted, never failed.
 *
 * `segments` is the same expression read for STATIC TEXT rather than for a
 * whole sentence (objectui#4905): `null` when nothing in it is readable text,
 * otherwise every literal piece. A computed default is `text: null` and can
 * still carry segments — that is the surface class 7 judges and class 3 cannot.
 */
function inlineDefaultValue(node, source) {
  for (const argument of node.arguments.slice(1)) {
    const inner = unwrapExpression(argument);
    if (!inner || !ts.isObjectLiteralExpression(inner)) continue;
    for (const property of inner.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
      if (name !== 'defaultValue') continue;
      return {
        present: true,
        text: staticString(property.initializer, source),
        segments: staticTextSegments(property.initializer, source),
      };
    }
  }
  return { present: false, text: null, segments: null };
}

/**
 * The interpolation option names a call site passes (objectui#3845).
 *
 * `{ readable: true, names }`  — the full name set, RESERVED NAMES INCLUDED
 *                                (objectui#4206 — the caller decides whether to
 *                                filter, and which direction to filter it for;
 *                                doing it here would make it impossible to tell
 *                                "passed `count`" from "passed nothing" once a
 *                                key doubles as a hole name). An empty set is a
 *                                real answer: it says this call passes nothing
 *                                to interpolate.
 * `{ readable: false }`        — the name set is not statically knowable, so the
 *                                rule abstains rather than guessing at it.
 *
 * Only the properties of the options OBJECT LITERAL itself are read. An inner
 * `t('fields.image.imageAlt', { index })` written as one of those property
 * VALUES contributes nothing, because its arguments are its own — which is the
 * whole difference between this and the regex that first measured the class.
 */
function interpolationOptions(node, source) {
  let object = null;
  for (const argument of node.arguments.slice(1)) {
    const inner = unwrapExpression(argument);
    if (!inner) return { readable: false };
    if (ts.isObjectLiteralExpression(inner)) {
      // `t(key, 'Default', { name })` is legal i18next; the first object wins,
      // the way `inlineDefaultValue` reads it.
      if (object === null) object = inner;
      continue;
    }
    // A positional default (`tt(key, 'Save')`) carries no options.
    if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateExpression(inner)) continue;
    // `t(key, options)` — an options bag this parser cannot open.
    return { readable: false };
  }

  const names = new Set();
  if (object === null) return { readable: true, names };

  for (const property of object.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      // Reserved names are NOT filtered here (objectui#4206) — see the doc
      // comment above.
      names.add(property.name.text);
      continue;
    }
    // A spread, a method, an accessor: the name set is open, so do not judge it.
    if (!ts.isPropertyAssignment(property)) return { readable: false };
    if (ts.isComputedPropertyName(property.name)) {
      // The probe flag is the one computed name with a known meaning, and those
      // call sites returned before reaching here. Anything else is unreadable.
      return { readable: false };
    }
    const name =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
        ? property.name.text
        : null;
    if (name === null) return { readable: false };
    // i18next reads interpolation data OUT of `replace` when it is present, so
    // the top-level names stop being the answer to this question entirely.
    if (name === 'replace') return { readable: false };
    // Reserved names are NOT filtered here (objectui#4206) — see the doc
    // comment above.
    names.add(name);
  }
  return { readable: true, names };
}

/**
 * The fallback written as this call's SIBLING, i.e. `t(key) || 'English'`
 * (objectui#4117), or `null` when the call is not in that position at all.
 *
 * `node.parent` is the whole mechanism, and the direction matters: only the
 * LEFT operand of `||`/`??` is this class. The mirror shape,
 * `someValue || t('key')`, is the healthy one — a runtime value falling back to
 * a translation — and `main` carries 94 of those.
 *
 * `optional` reports `t?.(key)`, where the call itself can evaluate to
 * `undefined` and the fallback is therefore LIVE. `literal` reports whether the
 * right operand is a static string or a template literal, which is the only
 * form this rule judges; `text` is that string, or the right operand's source
 * for a template, purely so the report can quote it.
 */
function siblingFallback(node, source) {
  let current = node;
  let parent = node.parent;
  while (
    parent &&
    (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent))
  ) {
    current = parent;
    parent = parent.parent;
  }
  if (!parent || !ts.isBinaryExpression(parent) || parent.left !== current) return null;
  const operator = parent.operatorToken.kind;
  if (operator !== ts.SyntaxKind.BarBarToken && operator !== ts.SyntaxKind.QuestionQuestionToken) return null;

  const right = unwrapExpression(parent.right);
  const text = staticString(right, source);
  // A template WITH substitutions is still a literal fallback — the whole point
  // of the five divergent rows this class was filed over. `staticString` cannot
  // fold it, so read it as source; the verdict is "delete", never "compare".
  const isTemplate = !!right && ts.isTemplateExpression(right);
  return {
    operator: operator === ts.SyntaxKind.BarBarToken ? '||' : '??',
    optional: !!node.questionDotToken,
    literal: text !== null || isTemplate,
    text: text !== null ? text : right ? right.getText(source).replace(/\s+/g, ' ') : '',
  };
}

/** The literal head of a template key, i.e. everything before the first `${`. */
function staticHead(argument) {
  const inner = unwrapExpression(argument);
  // `t(`ns.${x}` as any)` is the same key shape as `t(`ns.${x}`)`; the cast is
  // there to satisfy a key type, and reading through it is what found the fifth
  // dead template family (`marketplace.disclosure.runtime.`).
  if (!inner || !ts.isTemplateExpression(inner)) return '';
  return inner.head.text;
}

/**
 * The head/tail shape of a template key (objectui#4964).
 *
 * `` `managedByBadge.${v.i18nKey}.short` `` is head `managedByBadge.`, tail
 * `.short`, one substitution — so a member `config` expands to the full key
 * `managedByBadge.config.short`, and checking the head plus the member alone
 * would ask for a BRANCH that is not the leaf the call site renders.
 *
 * `tail` is reported only for a SINGLE-substitution template. With two or more
 * (`` `${ns}.${suffix}` ``) there is no one member position, so no expansion
 * this file could build is the key — those sites are counted, never expanded.
 *
 * @returns {{ head: string, tail: string | null } | null}
 */
function templateShape(argument) {
  const inner = unwrapExpression(argument);
  if (!inner || !ts.isTemplateExpression(inner)) return null;
  const head = inner.head.text;
  if (inner.templateSpans.length !== 1) return { head, tail: null };
  return { head, tail: inner.templateSpans[0].literal.text };
}

/**
 * The key family a KEY BUILDER declares (objectui#7592).
 *
 * A key builder is a function whose ENTIRE body is one returned template
 * literal — `function toolTitleKey(n) { return `ns.family.${n}`; }`, or the
 * concise-arrow spelling of the same thing. The head/tail it yields is the same
 * shape `templateShape()` reads off a key ARGUMENT, so the caller can record it
 * through the identical bookkeeping; see the header section "Key-building
 * helpers" for why the argument position never sees this shape at all.
 *
 * Shape only. Whether the head is an i18n key at all is the CALLER's test
 * (`headMatches`), because that answer needs the `en` pack and this does not.
 *
 * @returns {{ head: string, tail: string | null } | null}
 */
function keyBuilderShape(node) {
  if (
    !ts.isFunctionDeclaration(node) &&
    !ts.isFunctionExpression(node) &&
    !ts.isArrowFunction(node) &&
    !ts.isMethodDeclaration(node)
  ) {
    return null;
  }
  const body = node.body;
  if (!body) return null;
  // A block body must be exactly `return <expr>` — boundary 1 in the header.
  let returned = body;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) return null;
    returned = body.statements[0].expression;
  }
  const shape = templateShape(returned);
  if (!shape || !KEY_PREFIX_HEAD.test(shape.head)) return null;
  return shape;
}

/**
 * A template head that is a dotted key prefix ending at a segment boundary
 * (`chatbot.tool.`). The trailing dot is required: it is what separates a key
 * family from a template that merely contains a dot (a URL, a version, a CSS
 * custom property), and it is the shape every entry in DYNAMIC_KEY_FAMILIES has.
 */
const KEY_PREFIX_HEAD = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.$/;

// ── the `createSafeTranslation` defaults tables (objectui#7567) ──────────────

/**
 * The initializer of a `const <name> = …` declared anywhere in `source`.
 *
 * Not scoped to the top level on purpose: a factory table is conventionally a
 * module constant, but nothing enforces that, and a table declared inside a
 * block would otherwise silently leave the checked surface rather than being
 * counted as unreadable.
 */
function declaredConstant(source, name) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/** The module specifier a named import of `name` comes from, or `null`. */
function namedImportSpecifier(source, name) {
  let specifier = null;
  ts.forEachChild(source, (node) => {
    if (specifier !== null) return;
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        // `import { X as Y }` — the table is declared under its ORIGINAL name in
        // the other module, so that is the name to look for there.
        if (element.name.text === name) specifier = { module: node.moduleSpecifier.text, declaredAs: (element.propertyName ?? element.name).text };
      }
    }
  });
  return specifier;
}

/**
 * A `createSafeTranslation` first argument, resolved to the object literal the
 * runtime will index (objectui#7567).
 *
 * Three shapes reach it on this tree: an inline literal, a `const` in the same
 * file, and a `const` imported over a RELATIVE specifier. A package specifier
 * is deliberately not followed — resolving `@object-ui/x` means resolving a
 * workspace graph, and a table this returns `null` for is reported as an
 * unreadable table rather than skipped, which is the loud outcome.
 *
 * @returns {{ literal: ts.ObjectLiteralExpression, source: ts.SourceFile, name: string } | { literal: null, name: string }}
 */
function resolveFactoryTable(root, source, argument, parseModule) {
  const inner = unwrapExpression(argument);
  if (!inner) return { literal: null, name: '(no argument)' };
  if (ts.isObjectLiteralExpression(inner)) return { literal: inner, source, name: '(inline table)' };
  if (!ts.isIdentifier(inner)) return { literal: null, name: ts.SyntaxKind[inner.kind] };

  const name = inner.text;
  let initializer = declaredConstant(source, name);
  let owner = source;
  if (initializer === null) {
    const imported = namedImportSpecifier(source, name);
    if (imported === null || !imported.module.startsWith('.')) return { literal: null, name };
    const relPath = resolveImport(root, source.fileName, imported.module);
    const module = parseModule(join(root, relPath));
    if (module === null) return { literal: null, name };
    initializer = declaredConstant(module, imported.declaredAs);
    owner = module;
  }
  if (initializer === null) return { literal: null, name };
  const literal = unwrapExpression(initializer);
  if (!literal || !ts.isObjectLiteralExpression(literal)) return { literal: null, name };
  return { literal, source: owner, name };
}

// ── the analysis ─────────────────────────────────────────────────────────────

/**
 * `families` and `handRolled` are injectable so the synthetic-repo tests can pin
 * the registry RULES against a registry they control. The real run always uses
 * the module constants, and every CLI path below calls `analyze(root)` with no
 * options at all — so there is no configuration path a call site could quietly
 * narrow, which for `handRolled` is the same property its collapse floor exists
 * to protect (objectui#7877).
 *
 * @returns {{ findings: Array, counters: Record<string, number>, enKeyCount: number,
 *   referencedKeys: Set<string>, referencedBranches: Set<string>, dynamicHeads: Set<string>,
 *   dynamicFamilies: Map<string, { tails: Set<string>, sites: Array, multiSubstitution: number }> }}
 */
export function analyze(
  root,
  /** @type {{ families?: DynamicKeyFamily[], handRolled?: { file: string, name: string }[] }} */
  { families = DYNAMIC_KEY_FAMILIES, handRolled = HAND_ROLLED_TABLES } = {},
) {
  const { leaves, branches, values } = collectEnKeys(root);
  const resolvesLeaf = (key) => leaves.has(key) || PLURAL_SUFFIXES.some((suffix) => leaves.has(key + suffix));
  // Materialised once, not inside the predicate: spreading a 2.6k-entry Set per
  // candidate head is the shape that made `all-locales-key-parity` quadratic
  // (7.51s -> 25ms once hoisted; see AGENTS.md 测试纪律).
  const everyPath = [...leaves, ...branches];
  const headMatches = (head) => everyPath.some((key) => key.startsWith(head));

  const registeredModules = new Set(EXCLUDED_TRANSLATORS.map((entry) => entry.module));
  const localScopes = EXCLUDED_TRANSLATORS.flatMap((entry) => entry.forwardedScope ?? []);
  const externallyFilled = new Map(
    EXTERNALLY_INTERPOLATED_HOLES.map((entry) => [entry.key, new Set(entry.holes)]),
  );

  // Reverse-sweep bookkeeping (objectui#4658): every literal key a PACK call
  // site asks for (`referencedKeys` — plural suffixes included, so a base key
  // that resolves through `_one`/`_other` marks the suffixed leaf as live
  // too), every branch consumed wholesale via `returnObjects: true`
  // (`referencedBranches` — every leaf under it is live), and the static head
  // of every dynamic/template key (`dynamicHeads` — any leaf sharing that
  // prefix is a possible runtime target, so it counts as live). Populated by
  // this SAME walk, not a second parse, so the two directions of "does this
  // key have a call site" can never drift apart from each other. Unused by
  // this gate's own findings/counters; `scripts/check-i18n-dead-keys.mjs` is
  // the consumer.
  //
  // objectui#7592 — a head also reaches both Sets from a KEY BUILDER, a helper
  // whose body is one returned template literal, with no `t()` call anywhere in
  // its module. Same bookkeeping, same ratchets; see the header section
  // "Key-building helpers".
  const referencedKeys = new Set();
  const referencedBranches = new Set();
  const dynamicHeads = new Set();

  // objectui#4964 — per-head census of the PACK-backed template call sites, so
  // the registry below is evaluated against what the scan actually saw rather
  // than against itself. Keyed by static head; `tails` holds the literal text
  // after the single substitution (`.short` for
  // `` `managedByBadge.${v.i18nKey}.short` ``), `''` when the substitution ends
  // the template.
  /** @type {Map<string, { tails: Set<string>, sites: Array, multiSubstitution: number }>} */
  const dynamicFamilies = new Map();

  const findings = [];
  const counters = {
    filesScanned: 0,
    callSites: 0,
    packCallSites: 0,
    literalKeys: 0,
    resolvedKeys: 0,
    dynamicKeySites: 0,
    headlessDynamicKeySites: 0,
    keyBuilderSites: 0,
    declaredFamilies: 0,
    enumerableFamilies: 0,
    notEnumerableFamilies: 0,
    checkedMembers: 0,
    unexpandableFamilySites: 0,
    probeSites: 0,
    skippedLocalTable: 0,
    skippedNotATranslator: 0,
    skippedMethodCall: 0,
    literalDefaultValues: 0,
    matchingDefaultValues: 0,
    computedDefaultValues: 0,
    unjudgedDefaultValues: 0,
    spellingJudgedDefaults: 0,
    spellingJudgedResidueDefaults: 0,
    opaqueDefaultText: 0,
    judgedInterpolation: 0,
    unjudgedInterpolation: 0,
    opaqueOptions: 0,
    siblingFallbacks: 0,
    judgedSiblingFallbacks: 0,
    computedSiblingFallbacks: 0,
    optionalCallFallbacks: 0,
    unjudgedSiblingFallbacks: 0,
    // objectui#7567 — class 8's own census. `factorySites` counts INVOCATIONS
    // and `factoryTables` counts the distinct literals behind them; the two
    // differ the moment one table is passed to two factories, and reporting
    // only the first would overstate the surface.
    factorySites: 0,
    factoryTables: 0,
    factoryUnreadableTables: 0,
    factoryRows: 0,
    factoryComparedRows: 0,
    factoryMatchingRows: 0,
    factoryRowsNoEnKey: 0,
    factoryUnjudgedRows: 0,
    factoryUnreadableRows: 0,
    // objectui#7877 — the widened half's own census, deliberately a SEPARATE
    // set of counters rather than added into the factory numbers. Two reasons,
    // both load-bearing: the collapse floor below has to be able to fail for
    // this half alone (a factory walk of hundreds of rows would otherwise mask
    // a registry that resolved nothing), and the abstention counts are what turn
    // a blind spot into a card — objectui#7874 exists purely because the
    // factory half printed its 5 abstaining rows instead of absorbing them.
    handRolledDeclared: 0,
    handRolledTables: 0,
    handRolledAlreadyFactoryCovered: 0,
    handRolledUnreadableTables: 0,
    handRolledRows: 0,
    handRolledComparedRows: 0,
    handRolledMatchingRows: 0,
    handRolledRowsNoEnKey: 0,
    handRolledUnjudgedRows: 0,
    handRolledUnreadableRows: 0,
  };

  // objectui#7567 — a table may be declared in a module the factory imports, so
  // this reader parses on demand and caches; and one table passed to two
  // factories is scanned ONCE, keyed by the literal's own position, so the row
  // counts stay a census rather than a multiset.
  /** @type {Map<string, ts.SourceFile | null>} */
  const factoryModules = new Map();
  const parseModule = (absolute) => {
    if (factoryModules.has(absolute)) return factoryModules.get(absolute);
    let parsed = null;
    try {
      if (existsSync(absolute) && statSync(absolute).isFile()) {
        parsed = ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      }
    } catch {
      parsed = null;
    }
    factoryModules.set(absolute, parsed);
    return parsed;
  };
  const scannedTables = new Set();

  /**
   * Compare one defaults table against `en`, row by row (objectui#7567).
   *
   * The finding is located at the ROW, not at the `createSafeTranslation` call,
   * because the row is where the fix goes — and for an imported table those are
   * in two different files.
   */
  const scanDefaultsTable = (literal, owner, tableName, half) => {
    const ownerRel = relative(root, owner.fileName).split('\\').join('/');
    for (const property of literal.properties) {
      counters[`${half}Rows`] += 1;
      const { line, character } = owner.getLineAndCharacterOfPosition(property.getStart(owner));
      const at = { file: ownerRel, line: line + 1, column: character + 1 };
      if (!ts.isPropertyAssignment(property)) {
        // A spread or a shorthand: this reader cannot say which keys it brings.
        counters[`${half}UnreadableRows`] += 1;
        continue;
      }
      const key =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNoSubstitutionTemplateLiteral(property.name)
          ? property.name.text
          : null;
      if (key === null) {
        counters[`${half}UnreadableRows`] += 1;
        continue;
      }
      // NOT descended into — `fallbackT` indexes `defaults[key]` flat, so a
      // nested literal is a row nothing can ever read. See the header.
      const text = staticString(property.initializer, owner);
      if (text === null) {
        counters[`${half}UnreadableRows`] += 1;
        continue;
      }
      if (!resolvesLeaf(key)) {
        // class 1's shape, and class 1 cannot reach it: it judges CALL SITES,
        // and a table row nothing calls has none. Counted, printed, never failed.
        counters[`${half}RowsNoEnKey`] += 1;
        continue;
      }
      const enValue = values.get(key);
      if (enValue === undefined) {
        // A plural family, or an `en` leaf that is not a readable static string.
        counters[`${half}UnjudgedRows`] += 1;
        continue;
      }
      counters[`${half}ComparedRows`] += 1;
      if (enValue === text) counters[`${half}MatchingRows`] += 1;
      else
        findings.push({
          reason: half === 'factory' ? 'factory-default-drift' : 'hand-rolled-default-drift',
          ...at,
          detail: key,
          expected: enValue,
          actual: text,
          table: tableName,
        });
    }
  };

  /** Every `createSafeTranslation(...)` invocation in one parsed file. */
  const scanFactorySites = (source) => {
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && FACTORY_NAMES.has(node.expression.text)) {
        counters.factorySites += 1;
        const { literal, source: owner, name } = resolveFactoryTable(root, source, node.arguments[0], parseModule);
        if (literal === null) {
          // The loudest abstention in this class: not one row leaving the
          // checked surface, all of them. See the header.
          counters.factoryUnreadableTables += 1;
        } else {
          const id = `${owner.fileName}#${literal.getStart(owner)}`;
          if (!scannedTables.has(id)) {
            scannedTables.add(id);
            counters.factoryTables += 1;
            scanDefaultsTable(literal, owner, name, 'factory');
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  };

  // objectui#7592 — the key-builder leg. `keyBuilderShape()` answers the SHAPE
  // question; `headMatches` is the one that makes it a key probe rather than a
  // census of every dotted template. Findings are deliberately never raised
  // here: `missing-prefix` is an argument-position rule and a builder whose head
  // resolves to nothing is simply not a key builder (header, boundary 2).
  const recordKeyBuilders = (source, relPath) => {
    const visit = (node) => {
      const shape = keyBuilderShape(node);
      if (shape && headMatches(shape.head)) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        counters.keyBuilderSites += 1;
        dynamicHeads.add(shape.head);
        const family = dynamicFamilies.get(shape.head) ?? { tails: new Set(), sites: [], multiSubstitution: 0 };
        if (shape.tail === null) family.multiSubstitution += 1;
        else family.tails.add(shape.tail);
        family.sites.push({ file: relPath, line: line + 1, column: character + 1 });
        dynamicFamilies.set(shape.head, family);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };

  /**
   * The widened half (objectui#7877): the DECLARED hand-rolled tables.
   *
   * Runs AFTER the file walk on purpose — `scannedTables` is only complete once
   * every factory site has been resolved, and `TIMELINE_DEFAULT_TRANSLATIONS` is
   * in the registry AND reachable from the factory. De-duplicating on the
   * literal's own position (the same id the factory half keys on) is what keeps
   * the row counts a census rather than a multiset; the overlap is counted and
   * printed rather than silently dropped.
   *
   * A declared table that no longer resolves is an UNREADABLE TABLE, never a
   * skip — that is the whole registry rotting in the direction nothing else
   * would notice, and the floor below is what makes it fatal rather than quiet.
   */
  const scanHandRolledTables = () => {
    for (const { file, name } of handRolled) {
      counters.handRolledDeclared += 1;
      const absolute = join(root, file);
      const source = parseModule(absolute);
      const initializer = source === null ? null : declaredConstant(source, name);
      const literal = initializer === null ? null : unwrapExpression(initializer);
      if (literal === null || !ts.isObjectLiteralExpression(literal)) {
        counters.handRolledUnreadableTables += 1;
        continue;
      }
      const id = `${source.fileName}#${literal.getStart(source)}`;
      if (scannedTables.has(id)) {
        // Declared here and reachable from the factory too. Its rows are already
        // in the factory census; counting them again would inflate both halves.
        counters.handRolledAlreadyFactoryCovered += 1;
        continue;
      }
      scannedTables.add(id);
      counters.handRolledTables += 1;
      scanDefaultsTable(literal, source, `${name} (${file})`, 'handRolled');
    }
  };

  for (const file of collectSourceFiles(root)) {
    counters.filesScanned += 1;
    const text = readFileSync(file, 'utf8');
    const relPath = relative(root, file).split('\\').join('/');
    const isLocalTableFile = registeredModules.has(relPath);

    // `createSafeTranslation` is the factory every pack-backed hook in this repo
    // is built from. If one is bound to a name this gate would not recognise as
    // a hook, every call through it silently leaves the checked surface — so say
    // so instead of skipping it.
    for (const match of text.matchAll(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*createSafeTranslation\s*\(/g)) {
      if (!PACK_HOOK.test(match[1])) {
        const line = text.slice(0, match.index).split('\n').length;
        findings.push({
          reason: 'unrecognised-hook',
          file: relPath,
          line,
          column: 1,
          detail: match[1],
        });
      }
    }

    // `?\.` is not decoration: `packages/app-shell/src/layout/ContextSelectors.tsx`
    // spells EVERY call `t?.(…)` because its `t` is an optional prop, so it holds
    // no `t(` at all and this pre-filter used to drop the whole file — silently,
    // out of all five classes at once (objectui#4117).
    const hasTranslatorCall = /\btt?\s*(?:\?\.)?\s*\(/.test(text);
    // objectui#7592 — the key-builder leg's own pre-filter, because a builder's
    // module need hold no `t(` spelling at all (the measured one does not, and
    // the line above used to drop it unparsed). `.${` is the adjacency a dotted
    // key template always has and that essentially nothing else in TS source
    // does: 97 files match it, 47 of which the line above rejects — that 47 is
    // the whole added parse cost, against 1572 files walked.
    const hasKeyTemplate = text.includes('.${');
    // objectui#7567 — and a THIRD reason to parse, for the same structural
    // reason as the other two: class 8's subject is a defaults TABLE, not a
    // call, and the two do not co-occur — `useTimelineTranslation.ts` and its
    // siblings declare a factory and its table and never write `t(` at all.
    const declaresFactory = text.includes('createSafeTranslation');
    if (!hasTranslatorCall && !hasKeyTemplate && !declaresFactory) continue;
    // Each leg below is guarded by its OWN predicate, never by "this file was
    // parsed". That is the load-bearing half of having three: a leg gated on
    // the union would silently inherit the other two's widenings, and each
    // card's measured blast radius (#7592's 1 builder over 47 extra files,
    // #7567's 32 factory sites) would stop being a reading about that leg.
    let source = factoryModules.get(file) ?? null;
    if (source === null) {
      source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      factoryModules.set(file, source);
    }
    if (declaresFactory) scanFactorySites(source);

    // A file's provenance: which table its own `t` reaches. A forwarded `t`
    // inherits it, because the parser cannot follow the value across modules.
    const inLocalScope = localScopes.some((dir) => relPath.startsWith(dir)) || isLocalTableFile;

    // Boundary 3: a builder inside a registered local table builds keys no pack
    // defines by design, so it must not mark pack leaves live.
    if (hasKeyTemplate && !inLocalScope) recordKeyBuilders(source, relPath);

    if (!hasTranslatorCall) continue;
    const bindings = collectBindings(root, file, source);

    let provenance = inLocalScope ? 'local' : null;
    for (const binding of bindings) {
      if (binding.kind === 'packHook' && provenance === null) provenance = 'pack';
      if (binding.kind === 'import' && registeredModules.has(binding.detail)) provenance = 'local';
    }

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        let name = null;
        let isMethod = false;
        if (ts.isIdentifier(callee)) name = callee.text;
        else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) && callee.name.text === 't') {
          name = 't';
          isMethod = true;
        }

        if (name === 't' || name === 'tt') {
          counters.callSites += 1;
          const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
          const at = { file: relPath, line: line + 1, column: character + 1 };

          if (isMethod) {
            // `someObject.t(...)` — the receiver's type is unknowable here.
            counters.skippedMethodCall += 1;
            ts.forEachChild(node, visit);
            return;
          }

          const binding = bindingAt(bindings, source, name, node.getStart(source));
          const kind = binding ? binding.kind : 'forwarded'; // no declaration in this file = it came from outside

          if (kind === 'import' && !registeredModules.has(binding.detail)) {
            findings.push({ reason: 'unregistered-translator', ...at, detail: binding.detail });
            ts.forEachChild(node, visit);
            return;
          }
          if (kind === 'import' || kind === 'localFunction' || (kind === 'forwarded' && provenance === 'local')) {
            counters.skippedLocalTable += 1;
            ts.forEachChild(node, visit);
            return;
          }
          if (kind === 'other') {
            counters.skippedNotATranslator += 1;
            ts.forEachChild(node, visit);
            return;
          }

          // PACK: `packHook`, or a forwarded translator in a non-local file.
          counters.packCallSites += 1;

          let isProbe = false;
          let returnsObjects = false;
          for (const argument of node.arguments.slice(1)) {
            if (!ts.isObjectLiteralExpression(argument)) continue;
            for (const property of argument.properties) {
              if (!ts.isPropertyAssignment(property)) continue;
              if (ts.isComputedPropertyName(property.name) && PROBE_FLAG_NAMES.test(property.name.expression.getText(source))) {
                isProbe = true;
              }
              if (
                ts.isIdentifier(property.name) &&
                property.name.text === 'returnObjects' &&
                property.initializer.kind === ts.SyntaxKind.TrueKeyword
              ) {
                returnsObjects = true;
              }
            }
          }
          if (isProbe) {
            // Deliberate convention-key miss — excluded by the flag, not by path.
            counters.probeSites += 1;
            ts.forEachChild(node, visit);
            return;
          }

          const argument = node.arguments[0];
          const { keys, dynamic } = literalKeysOf(argument, source);
          for (const key of keys) {
            counters.literalKeys += 1;
            if (resolvesLeaf(key) || (returnsObjects && branches.has(key))) counters.resolvedKeys += 1;
            else findings.push({ reason: 'missing-key', ...at, detail: key });
            // Reverse-sweep bookkeeping — see the comment where these Sets are
            // declared. Recorded for every literal key regardless of whether it
            // resolves: a typo'd key referencing nothing in `en` cannot mark any
            // pack leaf live anyway, so there is nothing to guard here.
            referencedKeys.add(key);
            for (const suffix of PLURAL_SUFFIXES) referencedKeys.add(key + suffix);
            if (returnsObjects && branches.has(key)) referencedBranches.add(key);
          }

          // objectui#3810 — the inline default is dead code the moment the key
          // exists, so it must not say something else. Deliberately narrow: one
          // literal key, whose `en` leaf is a plain string. A key `en` does not
          // define is `missing-key`'s territory and is NOT reported here too;
          // keeping the two classifications disjoint is what lets either output
          // be read on its own.
          // The single `en` value this call site renders, or `undefined` when
          // there is not exactly one that this parser could read as a string.
          // Shared by classes 3 and 4: both judge a call site against the
          // sentence the pack actually serves it, and both decline together.
          const key = !dynamic && keys.length === 1 ? keys[0] : null;
          const enValue = key !== null && !returnsObjects ? values.get(key) : undefined;

          const inlineDefault = inlineDefaultValue(node, source);
          if (inlineDefault.present && inlineDefault.text === null) {
            counters.computedDefaultValues += 1;
          } else if (inlineDefault.present) {
            counters.literalDefaultValues += 1;
            if (enValue === undefined) {
              // No single static key, or a key whose `en` leaf this parser could
              // not read as a string — including the plural families, where
              // there is no one form to compare against. Counted, never failed.
              counters.unjudgedDefaultValues += 1;
            } else if (enValue === inlineDefault.text) {
              counters.matchingDefaultValues += 1;
            } else {
              findings.push({ reason: 'default-value-drift', ...at, detail: key, expected: enValue, actual: inlineDefault.text });
            }
          }

          // objectui#4905 — class 7. Whatever the drift rule decided above, the
          // TEXT this default carries is text `fallbackT` may be asked to
          // render, and `fallbackT` resolves exactly one placeholder spelling.
          // Judged on every inline default, not only the ones drift leaves
          // unpinned: a pinned default is byte-equal to its `en` value and
          // objectui#3512 holds `en` to the same rule, so those come back green
          // twice over — which is what makes the count a live control on this
          // rule rather than a set of three strings nobody would notice
          // emptying.
          if (inlineDefault.present) {
            // The folded sentence when there is one, else the literal pieces of
            // a template — never both, so a `+`-concatenated default is judged
            // whole rather than once per operand.
            const subjects = inlineDefault.text !== null ? [inlineDefault.text] : (inlineDefault.segments ?? []);
            const pinnedByDrift = inlineDefault.text !== null && enValue !== undefined;
            if (subjects.length === 0) {
              // A bare runtime value (`defaultValue: label`). There is no text
              // to spell, and saying so is not the same as saying it is fine.
              counters.opaqueDefaultText += 1;
            } else {
              counters.spellingJudgedDefaults += 1;
              if (!pinnedByDrift) counters.spellingJudgedResidueDefaults += 1;
              for (const subject of subjects) {
                for (const violation of unresolvableSpellings(subject)) {
                  findings.push({
                    reason: 'unresolvable-default-spelling',
                    ...at,
                    detail: key ?? '(dynamic key)',
                    expected: subject,
                    actual: violation,
                  });
                }
              }
            }
          }

          // objectui#3845 — what this call site passes must be what the `en`
          // value has holes for, in both directions. Judged on the same
          // preconditions as class 3, plus a readable option-name set.
          if (enValue === undefined) {
            counters.unjudgedInterpolation += 1;
          } else {
            const options = interpolationOptions(node, source);
            if (!options.readable) {
              counters.opaqueOptions += 1;
            } else {
              const downstream = externallyFilled.get(key) ?? new Set();
              const holes = new Set([...holesOf(enValue)].filter((hole) => !downstream.has(hole)));
              // objectui#4206 — the reservation applies PER DIRECTION, not to a
              // shared set on either side. `count` is legitimate to PASS without
              // a visible `{{count}}` hole (i18next's plural selector), so
              // `namesForInert` drops it — a reserved option can never itself be
              // called inert. It stays IN the raw `options.names` used for
              // `unfilled`, because that direction needs to know whether `count`
              // was actually passed: dropping it there too (as before #4206)
              // made a real `{{count}}` miss (objectui#4157) indistinguishable
              // from a call site that filled it.
              const namesForInert = new Set([...options.names].filter((name) => !RESERVED_OPTION_NAMES.has(name)));
              const inert = [...namesForInert].filter((option) => !holes.has(option)).sort();
              const unfilled = [...holes].filter((hole) => !options.names.has(hole)).sort();
              counters.judgedInterpolation += 1;
              if (inert.length > 0 || unfilled.length > 0) {
                findings.push({ reason: 'interpolation-parity', ...at, detail: key, expected: enValue, inert, unfilled });
              }
            }
          }

          // objectui#4117 — the fallback spelled as a SIBLING of the call
          // rather than as one of its arguments. Existence is the defect, so
          // there is nothing to compare; every abstention below is a case where
          // "the right operand cannot render" stops being true.
          const sibling = siblingFallback(node, source);
          if (sibling !== null) {
            counters.siblingFallbacks += 1;
            if (sibling.optional) {
              // `t?.(key)` is `undefined` when the prop is absent, so the
              // fallback is LIVE. Not a parser limitation — a real path.
              counters.optionalCallFallbacks += 1;
            } else if (enValue === undefined || enValue === '') {
              // No single readable value — or one that is itself falsy, which is
              // the one way a non-optional `t()` can let `||` through.
              counters.unjudgedSiblingFallbacks += 1;
            } else if (!sibling.literal) {
              // `t(key) || label` renders a runtime value, not a second copy of
              // the sentence. Same abstention as a computed `defaultValue`.
              counters.computedSiblingFallbacks += 1;
            } else {
              counters.judgedSiblingFallbacks += 1;
              findings.push({
                reason: 'dead-sibling-fallback',
                ...at,
                detail: key,
                expected: enValue,
                actual: sibling.text,
                operator: sibling.operator,
              });
            }
          }

          if (dynamic) {
            counters.dynamicKeySites += 1;
            const head = staticHead(argument);
            if (head && !headMatches(head)) {
              findings.push({ reason: 'missing-prefix', ...at, detail: head });
            }
            // Reverse-sweep bookkeeping: a leaf sharing this prefix is a
            // possible runtime target of the substitution, so it is live —
            // recorded even when `head` matches nothing today, which is
            // harmless (nothing in `en` starts with it either).
            if (head) dynamicHeads.add(head);

            // objectui#4964 — the family census the exact-member check runs on.
            // Recorded for EVERY pack-backed template site, including the ones
            // whose head matches nothing, so the registry describes the same
            // set the prefix rule sees rather than a subset of it.
            const shape = templateShape(argument);
            if (shape && shape.head) {
              const family = dynamicFamilies.get(shape.head) ?? { tails: new Set(), sites: [], multiSubstitution: 0 };
              if (shape.tail === null) family.multiSubstitution += 1;
              else family.tails.add(shape.tail);
              family.sites.push(at);
              dynamicFamilies.set(shape.head, family);
            } else if (!head) {
              // Not a template at all — `t(key)` on a variable. There is no
              // static head, so neither the prefix rule nor this one can say
              // anything; the counter is the only visible trace.
              counters.headlessDynamicKeySites += 1;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  scanHandRolledTables();

  // ── the dynamic-family registry, evaluated (objectui#4964) ─────────────────
  //
  // Three rules, and the order matters: the two ratchet directions run over the
  // census and the registry FIRST, so a family that is undeclared or stale is
  // reported as itself rather than as an absence of member findings. Only then
  // are the declared vocabularies expanded. The prefix rule above has already
  // run for every one of these heads and is not consulted here — this class can
  // only ADD findings to a family, never take the prefix check away from one.
  const declaredHeads = new Set();
  for (const family of families) {
    if (declaredHeads.has(family.head)) {
      findings.push({ reason: 'duplicate-family', file: 'scripts/check-i18n-call-site-keys.mjs', line: 0, detail: family.head });
      continue;
    }
    declaredHeads.add(family.head);
    counters.declaredFamilies += 1;

    const observed = dynamicFamilies.get(family.head);
    if (!observed) {
      // Stale: the last call site with this head is gone. Deleting the entry is
      // the fix, and failing on it is what keeps the list a description of the
      // repo instead of an accumulating wishlist.
      findings.push({ reason: 'stale-dynamic-family', file: 'scripts/check-i18n-call-site-keys.mjs', line: 0, detail: family.head });
      continue;
    }
    if (family.enumerable === false) {
      counters.notEnumerableFamilies += 1;
      continue;
    }
    counters.enumerableFamilies += 1;

    const members = readVocabulary(root, family.vocabulary);
    if (members === null) {
      // The declaration moved, was renamed, or is no longer the declared shape.
      // Reported, never absorbed: silently reading it as "no members" is
      // exactly the vacuous-green this class exists to make impossible.
      findings.push({
        reason: 'unreadable-vocabulary',
        ...observed.sites[0],
        detail: family.head,
        expected: `${family.vocabulary.kind} ${family.vocabulary.name} in ${family.vocabulary.module}`,
      });
      continue;
    }
    if (members.length === 0) {
      findings.push({
        reason: 'empty-vocabulary',
        ...observed.sites[0],
        detail: family.head,
        expected: `${family.vocabulary.kind} ${family.vocabulary.name} in ${family.vocabulary.module}`,
      });
      continue;
    }

    counters.unexpandableFamilySites += observed.multiSubstitution;
    const missing = [];
    for (const tail of [...observed.tails].sort()) {
      for (const member of members) {
        const key = `${family.head}${member}${tail}`;
        counters.checkedMembers += 1;
        if (!resolvesLeaf(key)) missing.push(key);
      }
    }
    // One finding PER missing key, not one per family: the baseline is keyed by
    // the exact key, the same as classes 1 and 2, so a family paying off three
    // of five members shrinks the file by three lines instead of staying whole.
    for (const key of missing.sort()) {
      findings.push({ reason: 'missing-member', ...observed.sites[0], detail: key, expected: family.head });
    }
  }

  for (const [head, observed] of dynamicFamilies) {
    if (declaredHeads.has(head)) continue;
    findings.push({ reason: 'undeclared-dynamic-family', ...observed.sites[0], detail: head });
  }

  return { findings, counters, enKeyCount: leaves.size, referencedKeys, referencedBranches, dynamicHeads, dynamicFamilies };
}

// ── baseline ─────────────────────────────────────────────────────────────────

export function readBaseline(root) {
  const file = join(root, 'scripts/i18n-call-site-key-baseline.json');
  if (!existsSync(file)) return { missingKeys: {}, missingPrefixes: {}, missingMembers: {} };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return {
    missingKeys: parsed.missingKeys ?? {},
    missingPrefixes: parsed.missingPrefixes ?? {},
    missingMembers: parsed.missingMembers ?? {},
  };
}

/**
 * Split findings against the baseline. `unexpected` fails the build; `stale`
 * fails it too — a baseline entry whose defect is gone must be deleted, so the
 * file can only shrink.
 */
export function applyBaseline(findings, baseline) {
  const unexpected = [];
  const seenKeys = new Set();
  const seenPrefixes = new Set();
  const seenMembers = new Set();

  for (const finding of findings) {
    if (finding.reason === 'missing-key' && Object.hasOwn(baseline.missingKeys ?? {}, finding.detail)) {
      seenKeys.add(finding.detail);
      continue;
    }
    if (finding.reason === 'missing-prefix' && Object.hasOwn(baseline.missingPrefixes ?? {}, finding.detail)) {
      seenPrefixes.add(finding.detail);
      continue;
    }
    if (finding.reason === 'missing-member' && Object.hasOwn(baseline.missingMembers ?? {}, finding.detail)) {
      seenMembers.add(finding.detail);
      continue;
    }
    unexpected.push(finding);
  }

  const stale = [
    ...Object.keys(baseline.missingKeys ?? {}).filter((key) => !seenKeys.has(key)).map((key) => ({ kind: 'missingKeys', entry: key })),
    ...Object.keys(baseline.missingPrefixes ?? {}).filter((p) => !seenPrefixes.has(p)).map((entry) => ({ kind: 'missingPrefixes', entry })),
    ...Object.keys(baseline.missingMembers ?? {}).filter((m) => !seenMembers.has(m)).map((entry) => ({ kind: 'missingMembers', entry })),
  ];

  return { unexpected, stale };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HINTS = {
  'missing-key':
    'The key exists in no locale pack. Add it to `packages/i18n/src/locales/en.ts`' +
    ' — that is the source of truth, and adding it there makes' +
    ' `packages/i18n/src/__tests__/all-locales-key-parity.test.ts` demand the same key' +
    ' in the other nine packs, which is the point. An inline' +
    ' `t(key, { defaultValue: "…" })` is NOT a fix: it renders English at this one' +
    ' call site and leaves the string untranslatable everywhere (objectui#3517).',
  'missing-prefix':
    'No key in `en` begins with this template literal\'s static head, so every value the' +
    ' substitution can take is missing. Add the whole family to' +
    ' `packages/i18n/src/locales/en.ts`.',
  'missing-member':
    'The template family\'s head resolves, so `missing-prefix` is satisfied — but this' +
    ' SPECIFIC member of the vocabulary the call site iterates has no leaf in `en`' +
    ' (objectui#4964). Ten packs missing it identically is full parity, so neither pack' +
    ' gate can see it and the user reads the raw key. Add the key to' +
    ' `packages/i18n/src/locales/en.ts`, which makes `all-locales-key-parity.test.ts`' +
    ' demand it in the other nine packs. If the member is genuinely unreachable at' +
    ' runtime, the fix is in the VOCABULARY (delete the dead member), never in this' +
    ' registry — narrowing a declared vocabulary to make a red go away is how an exact' +
    ' check silently becomes a smaller one.',
  'undeclared-dynamic-family':
    'A pack-backed template key — at a call site, or built by a helper (objectui#7592) —' +
    ' whose static head is not in DYNAMIC_KEY_FAMILIES' +
    ' (objectui#4964). Prefix-checking alone cannot see a member missing from all ten' +
    ' packs, so every family must say how its member set is known: add an entry with a' +
    ' `vocabulary` naming the declaration the call site iterates (a union, a const array,' +
    ' an object table), or — if the substitution genuinely has no static member set —' +
    ' `enumerable: false` with the reason. `enumerable: false` is a real answer and is' +
    ' preferred over a guessed vocabulary; what is not allowed is silence.',
  'stale-dynamic-family':
    'A DYNAMIC_KEY_FAMILIES entry whose head no longer appears at any pack-backed call' +
    ' site — nor, since objectui#7592, at any key-building helper. Delete the entry, OR' +
    ' find out why the head stopped being seen: for a family that reaches the scan through' +
    ' a builder, this finding is also how a detection leg that quietly stopped detecting' +
    ' announces itself. Either way the registry describes the repo, and an entry nothing' +
    ' exercises is an exact check running against nothing.',
  'duplicate-family':
    'Two DYNAMIC_KEY_FAMILIES entries declare the same head. Only the first would be' +
    ' evaluated, so the second is either dead or a contradiction. Merge them.',
  'unreadable-vocabulary':
    'The declaration this family names could not be read as the `kind` it declares — it' +
    ' moved, was renamed, or was rewritten into a shape this reader does not parse' +
    ' (a spread, a computed member, a derived expression). Reported rather than absorbed:' +
    ' reading it as "no members" would turn the exact check vacuous while the run stayed' +
    ' green. Repoint the entry, or change its `kind`.',
  'empty-vocabulary':
    'The declaration this family names resolved to ZERO members, so the exact check would' +
    ' assert nothing while reading exactly like a passing one. Either the declaration is' +
    ' genuinely empty (delete the family, or the call site) or the reader picked up the' +
    ' wrong binding.',
  'unregistered-translator':
    'This file imports a `t` from a module this gate does not know. If that module is a' +
    ' pack-backed re-export, it should be called through a `use*Translation` hook so its' +
    ' keys are checked; if it is a module-local label table like' +
    ' `packages/app-shell/src/views/metadata-admin/i18n.ts`, register it in' +
    ' EXCLUDED_TRANSLATORS with a reason.',
  'unrecognised-hook':
    '`createSafeTranslation(...)` bound to a name outside the `use*Translation` /' +
    ' `use*Translate` / `use*T` convention. Every call through it would leave this' +
    ' gate\'s checked surface silently — rename it to the convention.',
  'default-value-drift':
    'The key EXISTS in `en`, so i18next serves the pack value and this inline' +
    ' `defaultValue` never renders — but it says something else, which misleads every' +
    ' later reader of this component and becomes the visible copy the day the key is' +
    ' renamed (objectui#3810). Fix it at the CALL SITE: copy the `en` value in' +
    ' byte-for-byte, ellipsis and capitalisation included. Do NOT edit' +
    ' `packages/i18n/src/locales/en.ts` to match the call site — the pack value is what' +
    ' users read today, and changing it makes `scripts/check-i18n-en-drift.mjs` demand' +
    ' the same change in the other nine packs. If the pack value is genuinely the wrong' +
    ' copy for this spot, that is a copy change in its own PR, or the call site is asking' +
    ' for the wrong key.',
  'factory-default-drift':
    'A `createSafeTranslation` defaults row says something other than the `en` value of the same' +
    ' key (objectui#7567). That table is the pack value\'s STAND-IN: `fallbackT` resolves' +
    ' `defaults[key] || defaultValue || key`, so with an `I18nProvider` the pack wins and with' +
    ' none this row is what renders — the same control labelled two different ways depending on' +
    ' where it is mounted, and the difference is invisible in the console, which is where anyone' +
    ' would look. objectui#7454 was the measured instance. Fix it in the TABLE: copy the `en`' +
    ' value in byte-for-byte, ellipsis and capitalisation included. Do NOT edit' +
    ' `packages/i18n/src/locales/en.ts` to match the table — the pack value is what users read' +
    ' today, and changing it makes `scripts/check-i18n-en-drift.mjs` demand the same change in' +
    ' the other nine packs. If the row is genuinely dead (no key in `en`, no caller), delete the' +
    ' row rather than inventing a pack entry for it.',
  'hand-rolled-default-drift':
    'Same failure as `factory-default-drift`, on the half that needs a DECLARED registry to be' +
    ' seen at all (objectui#7877). This table hand-rolls `fallbackT` rather than taking' +
    ' `createSafeTranslation`, so nothing in its source says it is a defaults table and the' +
    ' factory-resolved walk cannot reach it; it is checked because' +
    ' `packages/test-support/src/hand-rolled-tables.json` names it. The consequence is the' +
    ' same and so is the fix: copy the `en` value into the TABLE byte-for-byte. Do NOT edit' +
    ' `packages/i18n/src/locales/en.ts` to match the table — that changes what users read and' +
    ' obliges the other nine packs through `scripts/check-i18n-en-drift.mjs`. If the row is' +
    ' genuinely dead (no key in `en`, no caller), delete the row.',
  'interpolation-parity':
    'The arguments this call site passes are not the holes the `en` value has (objectui#3845).' +
    ' An INERT argument is one i18next drops on the floor — no hole to receive it, no warning,' +
    ' and the intent behind it disappears. An UNFILLED hole is worse: i18next leaves the braces' +
    ' in place and the user reads a literal `{{name}}`. Fix it at the CALL SITE by default —' +
    ' delete the argument nothing consumes, or pass the one the sentence asks for. Editing' +
    ' `packages/i18n/src/locales/en.ts` to add or drop a hole is a COPY change: it changes what' +
    ' users read and obliges the other nine packs through `scripts/check-i18n-en-drift.mjs`, so' +
    ' it needs to be a deliberate decision in its own right rather than a way to silence this.' +
    ' If the hole is filled by whatever CONSUMES the translated string rather than by i18next' +
    ' (a label handed to a component that substitutes it later), register the key in' +
    ' EXTERNALLY_INTERPOLATED_HOLES with the file that does the substitution — and note that' +
    ' those keys must still NOT be passed the argument, or i18next consumes the hole before the' +
    ' consumer gets to see it.',
  'unresolvable-default-spelling':
    'This inline `defaultValue` spells a placeholder in a dialect only i18next understands' +
    ' (objectui#4905). `createSafeTranslation`\'s `fallbackT` interpolates with an EXACT literal' +
    ' needle — ``value.split(`{{${k}}}`)`` — so `{{name}}` is the only spelling it resolves,' +
    ' while i18next also accepts `{{ name }}`, `{{count, number}}`, `{{- name}}` and `$t(key)`.' +
    ' The consequence is invisible where we usually look: WITH an `I18nProvider` the pack value' +
    ' wins and this string never renders at all; without one it renders and the braces reach the' +
    ' user verbatim. Fix it at the CALL SITE by respelling the hole as `{{name}}` — the' +
    ' maintainer\'s objectui#4135 ruling is that `{{x}}` is exclusively i18next-bound copy, so' +
    ' teaching the fallback more dialects is not the fix. A hole this component fills ITSELF,' +
    ' downstream of `t()`, is spelled with SINGLE braces (`{x}`) and is out of this rule\'s range' +
    ' by construction. Same rule, same reasons, over the copy TABLES:' +
    ' `packages/i18n/src/__tests__/fallback-placeholder-spelling-3512.test.ts`.',
  'dead-sibling-fallback':
    'The key EXISTS in `en`, and this fallback is written as the call\'s SIBLING' +
    ' (`t(key) || \'English\'`) rather than as an argument — so it is dead on every path, not just' +
    ' the provider one (objectui#4117). With a provider the pack wins. WITHOUT one, react-i18next\'s' +
    ' not-ready `t` returns the KEY, which is truthy, so `||` skips this string too and the user' +
    ' reads a raw `console.objectView.delete` — strictly worse than an inline `defaultValue`, which' +
    ' at least renders English there. DELETE the operator and the right-hand string; do NOT align it' +
    ' with the `en` value, because aligning it would bless a second fallback spelling when the point' +
    ' is that there is one (`defaultValue`, governed by `default-value-drift`). If this call site' +
    ' genuinely needs English on a provider-less host, that is `t(key, { defaultValue: \'…\' })`.' +
    ' Note the mirror shape `someValue || t(key)` is HEALTHY and is not reported: only the LEFT' +
    ' operand of `||`/`??` is this class.',
};

/** JSON-quoted, with every non-ASCII byte escaped — `...` vs `…` must be visible. */
const quote = (text) =>
  JSON.stringify(text).replace(/[^\x20-\x7e]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const root = resolve(scriptDir, '..');
  const { findings, counters, enKeyCount } = analyze(root);

  // Guard against a refactor quietly emptying the comparison: with no keys and
  // no call sites every assertion below is trivially satisfied. Same reason
  // `all-locales-key-parity.test.ts` opens with a size assertion.
  if (enKeyCount < 2000 || counters.packCallSites < 1000) {
    console.error(
      `The scan collapsed: ${enKeyCount} en keys and ${counters.packCallSites} pack-backed call sites.` +
        ' Expected thousands of both — the extractor or the file walk is broken, and an' +
        ' empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  // The same guard for class 7's own subject (objectui#4905). The rule above is
  // silent on a tree with no inline defaults in it, and silent is exactly how a
  // broken `inlineDefaultValue` or `staticTextSegments` would read — so the
  // spelling verdict asserts it had something to judge, rather than inheriting
  // the key-count guard's word for it.
  if (counters.spellingJudgedDefaults < 500) {
    console.error(
      `The inline-default spelling scan collapsed: ${counters.spellingJudgedDefaults} default(s) with readable` +
        ` text, ${counters.opaqueDefaultText} without. Expected hundreds — this repo carries` +
        ' roughly a thousand inline defaults, so a number this small means the reader stopped' +
        ' reading them and the spelling rule is passing on an empty set.',
    );
    process.exit(1);
  }

  // The same guard again for class 8's subject (objectui#7567), and it is the
  // one this class needs most: its whole verdict on this tree is "0 drifted",
  // which is indistinguishable from "the table reader stopped resolving tables"
  // unless the size of what it compared is asserted. `factoryComparedRows` was
  // 841 over 32 tables when the class landed.
  if (counters.factoryComparedRows < 500) {
    console.error(
      `The factory-defaults scan collapsed: ${counters.factoryComparedRows} row(s) compared over` +
        ` ${counters.factoryTables} table(s), ${counters.factoryUnreadableTables} table(s) unreadable.` +
        ' Expected hundreds — this repo carries 30-odd `createSafeTranslation` tables, so a number' +
        ' this small means the resolver stopped following them and the comparison is passing on an' +
        ' empty set.',
    );
    process.exit(1);
  }

  // The widened half's OWN floor (objectui#7877). It is a separate threshold on
  // a separate counter on purpose: `factoryComparedRows` runs to the hundreds,
  // so a registry that resolved nothing at all would sail through the guard
  // above while this
  // half reported "0 drifted" over 0 rows — the exact reading objectui#7567's
  // ⛔ #2 forbids, one level down.
  //
  // How 150 was chosen, rather than picked: measured on this tree the two
  // registry entries the factory walk cannot reach compare 80
  // (`GANTT_DEFAULT_TRANSLATIONS`) and 135 (`IMPORT_DEFAULT_TRANSLATIONS`)
  // rows, 215 together. The threshold sits ABOVE the larger of the two, so
  // losing EITHER declared table — not just both — collapses the scan into a
  // failure instead of a quieter green. A floor below 135 would let the bigger
  // table carry the smaller one's disappearance.
  if (counters.handRolledComparedRows < 150) {
    console.error(
      `The hand-rolled defaults scan collapsed: ${counters.handRolledComparedRows} row(s) compared over` +
        ` ${counters.handRolledTables} table(s) from ${counters.handRolledDeclared} declared,` +
        ` ${counters.handRolledUnreadableTables} table(s) unreadable.` +
        ' Expected 200-odd — the registry in `packages/test-support/src/hand-rolled-tables.json`' +
        ' names two tables the factory walk cannot reach, and a number this small means one of' +
        ' them stopped resolving and this half is passing on an empty set.',
    );
    process.exit(1);
  }

  const { unexpected, stale } = applyBaseline(findings, readBaseline(root));

  console.log(
    `Scanned ${counters.filesScanned} files, ${counters.callSites} t()/tt() call sites: ` +
      `${counters.packCallSites} pack-backed (${counters.resolvedKeys}/${counters.literalKeys} literal keys resolve), ` +
      `${counters.dynamicKeySites} dynamic-key (report-only), ${counters.probeSites} probe-flagged, ` +
      `${counters.skippedLocalTable} module-local table, ${counters.skippedNotATranslator} not a translator, ` +
      `${counters.skippedMethodCall} method call.`,
  );
  console.log(
    `Inline defaults: ${counters.literalDefaultValues} literal ` +
      `(${counters.matchingDefaultValues} match their en value, ${counters.unjudgedDefaultValues} not comparable), ` +
      `${counters.computedDefaultValues} computed (report-only).`,
  );
  console.log(
    `Inline default spelling: ${counters.spellingJudgedDefaults} default(s) carry readable text and are held to ` +
      `the one placeholder spelling the provider-less fallback resolves — ${counters.spellingJudgedResidueDefaults} ` +
      `of them on call sites the drift rule cannot pin, ${counters.opaqueDefaultText} with no readable text at all.`,
  );
  console.log(
    `Factory defaults tables: ${counters.factorySites} createSafeTranslation site(s) over ` +
      `${counters.factoryTables} distinct table(s) (${counters.factoryUnreadableTables} unreadable) — ` +
      `${counters.factoryComparedRows} row(s) compared against their en value, ` +
      `${counters.factoryMatchingRows} matching, ${counters.factoryRowsNoEnKey} on a key en does not define, ` +
      `${counters.factoryUnjudgedRows} with no single comparable en value, ` +
      `${counters.factoryUnreadableRows} unreadable.`,
  );
  console.log(
    `Hand-rolled defaults tables: ${counters.handRolledDeclared} declared, ` +
      `${counters.handRolledTables} scanned here (${counters.handRolledAlreadyFactoryCovered} already ` +
      `covered by the factory walk, ${counters.handRolledUnreadableTables} unreadable) — ` +
      `${counters.handRolledComparedRows} row(s) compared against their en value, ` +
      `${counters.handRolledMatchingRows} matching, ${counters.handRolledRowsNoEnKey} on a key en does not define, ` +
      `${counters.handRolledUnjudgedRows} with no single comparable en value, ` +
      `${counters.handRolledUnreadableRows} unreadable.`,
  );
  console.log(
    `Interpolation parity: ${counters.judgedInterpolation} call sites compared against their en value's holes, ` +
      `${counters.unjudgedInterpolation} with no single comparable en value, ${counters.opaqueOptions} with an ` +
      `unreadable option set, ${EXTERNALLY_INTERPOLATED_HOLES.length} key(s) whose holes are filled downstream.`,
  );
  console.log(
    `Dynamic key families: ${counters.declaredFamilies} declared — ${counters.enumerableFamilies} with a ` +
      `static vocabulary (${counters.checkedMembers} member key(s) checked exactly), ` +
      `${counters.notEnumerableFamilies} with no enumerable member set (prefix-checked only), ` +
      `${counters.unexpandableFamilySites} multi-substitution site(s) not expandable, ` +
      `${counters.headlessDynamicKeySites} dynamic call site(s) with no static head at all, ` +
      `${counters.keyBuilderSites} head(s) read off a key-building helper rather than a call site.`,
  );
  console.log(
    `Sibling fallbacks: ${counters.siblingFallbacks} call site(s) sit left of a ||/?? — ` +
      `${counters.judgedSiblingFallbacks} judged, ${counters.computedSiblingFallbacks} with a non-literal ` +
      `right operand, ${counters.optionalCallFallbacks} an optional call (fallback is live), ` +
      `${counters.unjudgedSiblingFallbacks} with no single comparable en value.`,
  );

  // Split by class before printing: the two key classes say "en does not define
  // this", the drift class says "en defines it differently", the parity class
  // says "en defines it with different holes", and one paragraph cannot honestly
  // introduce all three.
  const drift = unexpected.filter((finding) => finding.reason === 'default-value-drift');
  const factoryDrift = unexpected.filter((finding) => finding.reason === 'factory-default-drift');
  const handRolledDrift = unexpected.filter((finding) => finding.reason === 'hand-rolled-default-drift');
  const parity = unexpected.filter((finding) => finding.reason === 'interpolation-parity');
  const siblings = unexpected.filter((finding) => finding.reason === 'dead-sibling-fallback');
  const spelling = unexpected.filter((finding) => finding.reason === 'unresolvable-default-spelling');
  // objectui#4964's classes read on their own too: they are all about a template
  // family whose HEAD resolves, which is precisely the case the two key classes
  // above declare out of scope.
  const FAMILY_CLASSES = new Set([
    'missing-member',
    'undeclared-dynamic-family',
    'stale-dynamic-family',
    'duplicate-family',
    'unreadable-vocabulary',
    'empty-vocabulary',
  ]);
  const families = unexpected.filter((finding) => FAMILY_CLASSES.has(finding.reason));
  const VALUE_CLASSES = new Set([
    'default-value-drift',
    'factory-default-drift',
    'hand-rolled-default-drift',
    'interpolation-parity',
    'dead-sibling-fallback',
    'unresolvable-default-spelling',
  ]);
  const keyFindings = unexpected.filter(
    (finding) => !VALUE_CLASSES.has(finding.reason) && !FAMILY_CLASSES.has(finding.reason),
  );

  if (unexpected.length === 0 && stale.length === 0) {
    console.log(
      `Every in-scope call-site key resolves against the en pack (${enKeyCount} keys), every` +
        ' literal inline defaultValue matches the value the pack serves, every readable' +
        ' createSafeTranslation defaults row repeats it too, every call site passes' +
        ' exactly the arguments that value has holes for, every inline defaultValue spells its' +
        ' placeholders the one way the provider-less fallback resolves, no call site carries a' +
        ' literal fallback beside itself, and every dynamic key family either checks its members' +
        ' against a declared vocabulary or says in writing why it has none.',
    );
    process.exit(0);
  }

  if (keyFindings.length > 0) {
    const distinct = new Set(keyFindings.map((f) => `${f.reason} :: ${f.detail}`));
    console.error(
      `\n${keyFindings.length} call site${keyFindings.length === 1 ? '' : 's'} reference${keyFindings.length === 1 ? 's' : ''} ` +
        `a key the en pack does not define (${distinct.size} distinct):`,
    );
    for (const finding of keyFindings) {
      console.error(`  ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ${finding.detail}`);
    }
  }

  if (drift.length > 0) {
    const distinct = new Set(drift.map((finding) => finding.detail));
    console.error(
      `\n${drift.length} inline defaultValue${drift.length === 1 ? '' : 's'} contradict${drift.length === 1 ? 's' : ''} ` +
        `the en value of a key that EXISTS (${distinct.size} distinct key${distinct.size === 1 ? '' : 's'}) — ` +
        'the pack value is what renders, so the call site is stating a sentence nobody sees:',
    );
    for (const finding of drift) {
      console.error(`  ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ${finding.detail}`);
      console.error(`      en renders: ${quote(finding.expected)}`);
      console.error(`      call site:  ${quote(finding.actual)}`);
    }
  }

  if (factoryDrift.length > 0) {
    const distinct = new Set(factoryDrift.map((finding) => finding.detail));
    console.error(
      `\n${factoryDrift.length} createSafeTranslation defaults row${factoryDrift.length === 1 ? '' : 's'} ` +
        `contradict${factoryDrift.length === 1 ? 's' : ''} the en value of a key that EXISTS ` +
        `(${distinct.size} distinct key${distinct.size === 1 ? '' : 's'}) — that table stands in for the ` +
        'pack on a provider-less host, so this control is labelled one way there and another in the ' +
        'console:',
    );
    for (const finding of factoryDrift) {
      console.error(`  ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ${finding.detail}  (${finding.table})`);
      console.error(`      en renders:      ${quote(finding.expected)}`);
      console.error(`      defaults table:  ${quote(finding.actual)}`);
    }
  }

  if (handRolledDrift.length > 0) {
    const distinct = new Set(handRolledDrift.map((finding) => finding.detail));
    console.error(
      `\n${handRolledDrift.length} hand-rolled defaults row${handRolledDrift.length === 1 ? '' : 's'} ` +
        `contradict${handRolledDrift.length === 1 ? 's' : ''} the en value of a key that EXISTS ` +
        `(${distinct.size} distinct key${distinct.size === 1 ? '' : 's'}) — this table hand-rolls ` +
        '`fallbackT`, so it is reached through the declared registry in ' +
        '`packages/test-support/src/hand-rolled-tables.json` rather than through the factory; the ' +
        'consequence on a provider-less host is identical:',
    );
    for (const finding of handRolledDrift) {
      console.error(`  ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ${finding.detail}  (${finding.table})`);
      console.error(`      en renders:      ${quote(finding.expected)}`);
      console.error(`      defaults table:  ${quote(finding.actual)}`);
    }
  }

  if (parity.length > 0) {
    const distinct = new Set(parity.map((finding) => finding.detail));
    console.error(
      `\n${parity.length} call site${parity.length === 1 ? '' : 's'} pass${parity.length === 1 ? 'es' : ''} ` +
        `arguments that do not match the holes in the en value (${distinct.size} distinct ` +
        `key${distinct.size === 1 ? '' : 's'}) — an inert argument is dropped in silence, an ` +
        'unfilled hole renders its own braces to the user:',
    );
    for (const finding of parity) {
      console.error(`  ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ${finding.detail}`);
      console.error(`      en renders: ${quote(finding.expected)}`);
      if (finding.inert.length > 0) console.error(`      inert (passed, no hole):     ${finding.inert.join(', ')}`);
      if (finding.unfilled.length > 0) console.error(`      unfilled (hole, no argument): ${finding.unfilled.join(', ')}`);
    }
  }

  if (siblings.length > 0) {
    const distinct = new Set(siblings.map((finding) => finding.detail));
    console.error(
      `\n${siblings.length} call site${siblings.length === 1 ? '' : 's'} carr${siblings.length === 1 ? 'ies' : 'y'} ` +
        `a literal fallback as the call's SIBLING (${distinct.size} distinct ` +
        `key${distinct.size === 1 ? '' : 's'}) — the key exists, so nothing can ever reach the right ` +
        'operand; delete it:',
    );
    for (const finding of siblings) {
      console.error(`  ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ${finding.detail}`);
      console.error(`      en renders:  ${quote(finding.expected)}`);
      console.error(`      dead ${finding.operator} operand: ${quote(finding.actual)}`);
    }
  }

  if (spelling.length > 0) {
    const distinct = new Set(spelling.map((finding) => `${finding.file}:${finding.line}`));
    console.error(
      `\n${spelling.length} placeholder${spelling.length === 1 ? '' : 's'} in an inline defaultValue ` +
        `cannot be resolved by the provider-less fallback (${distinct.size} call ` +
        `site${distinct.size === 1 ? '' : 's'}) — with a provider i18next renders ` +
        'them correctly, so the braces reach the user only where nobody is looking:',
    );
    for (const finding of spelling) {
      console.error(`  ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ${finding.detail}`);
      console.error(`      default text: ${quote(finding.expected)}`);
      console.error(`      ${finding.actual}`);
    }
  }

  if (families.length > 0) {
    console.error(
      `\n${families.length} dynamic-family finding${families.length === 1 ? '' : 's'} — the head resolves, so the` +
        ' prefix rule is satisfied; these are about the MEMBERS behind it:',
    );
    for (const finding of families) {
      console.error(`  ${finding.file}:${finding.line}:${finding.column}  [${finding.reason}]  ${finding.detail}`);
      if (finding.expected) console.error(`      ${finding.expected}`);
    }
  }

  for (const reason of Object.keys(HINTS)) {
    if (unexpected.some((finding) => finding.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }

  if (stale.length > 0) {
    console.error(
      `\n${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} stale — the defect is gone, so the` +
        ' entry must go too (this file is a ratchet; it only shrinks):',
    );
    for (const entry of stale) console.error(`  ${entry.kind}: ${entry.entry}`);
  }

  console.error('\nSee the header of scripts/check-i18n-call-site-keys.mjs.');
  process.exit(1);
}

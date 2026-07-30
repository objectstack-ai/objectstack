---
"@objectstack/spec": minor
---

fix(spec): `defineApp` type-checked its navigation again — the #4171 fix only covered half the annotation (#3786)

`NavigationItemSchema` is recursive, so it cannot infer its own type and carries a
hand-written annotation instead. #4171 fixed that annotation's **Output** half: it
had been `z.ZodType<any>`, which made the exported `NavigationItem` `any` for every
consumer — a type that constrains nothing, which reads exactly like a type that
works.

`z.ZodType` takes two parameters, `<Output, Input>`, and **`Input` defaults to
`unknown`**. Naming only the first left the input half at that default, so
`z.input<typeof AppSchema>` resolved `navigation` to `unknown` — and `unknown`
accepts everything. `defineApp(config: z.input<typeof AppSchema>)` is the documented
authoring entry point, and it took

```ts
defineApp({
  name: 'my_app',
  label: 'My App',
  navigation: [{ totally: 'made up' }, 42, 'nonsense'],   // compiled clean
});
```

with no complaint. Every authoring path through the app schema — `AppInput`,
`NavigationAreaSchema`, `NavigationContributionSchema` — was unchecked the same way.
Parsing was never affected: the schema rejected all of the above at runtime. It was
only the compile-time contract that lied, which is why nothing in the test suite
noticed. #4171's fix was verified through `z.infer`; nobody re-measured `z.input`,
and half a fix looks identical to a whole one.

**The fix.** A new exported `NavigationItemInput` describes the authoring side, and
the annotation now names both parameters. The two unions genuinely differ and one
cannot serve both: `GroupNavItemSchema.expanded` and `UrlNavItemSchema.target` carry
`.default()`, so those keys are **required** in the parsed output and **omissible**
when authoring. Reusing `NavigationItem` as the input type would force authors to
write values the schema exists to supply.

**What this changes for you.** Nothing at runtime, and nothing for code that reads a
parsed app. Code that *authors* navigation through `defineApp`, `AppInput`, or
`z.input` of any schema embedding `NavigationItemSchema` is now type-checked where it
previously was not, so genuinely malformed navigation that used to compile will now
surface as a compile error — the errors are pre-existing bugs becoming visible, not
new restrictions. Two notes on what the checked type says:

- Authoring types (`AppInput`, `NavigationItemInput`) let you omit `expanded` and
  `target`; the parsed types (`App`, `NavigationItem`) still guarantee both are
  present.
- If you annotate a hand-written literal with the parsed type (`const APP: App = {…}`)
  rather than the authoring type, you must spell out every defaulted key. That was
  already true and is unchanged — this release just makes the authoring alternative
  actually check its contents.

**The mechanism, not a comment.** `src/ui/app.nav-type-assertions.ts` is a non-test
`src` module (the package's `tsc --noEmit` CI gate excludes test files) holding
compile-level probes for both unions and, critically, for the **wiring** between them
and the schema. A correct `NavigationItemInput` that no schema references would leave
every authoring path back at `unknown` — precisely the state being fixed — so the
load-bearing assertions go through `AppInput` and fail the moment the annotation loses
its second parameter. Each probe was mutation-tested: dropping the `Input` parameter,
removing the `expanded` default, and leaking `children` onto a flat nav branch each
turn the corresponding assertion red.

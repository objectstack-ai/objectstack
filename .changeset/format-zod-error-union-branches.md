---
'@objectstack/spec': minor
---

`formatZodError` no longer cuts a union branch's rejection down to `Invalid input` (#4971).

Zod raises exactly one issue for a failed `z.union` — `invalid_union`, whose own
`message` is the literal string `"Invalid input"` — and keeps each branch's real
issues one level down in `issue.errors[]`. `formatZodError` mapped `error.issues`
and never descended, so every rejection behind a union reached the author as:

```
Action ref (1 issue):

  ✗ (root): Invalid input
```

while the same class of mistake on a plain `strictObject` rendered its full
prescription. The prose was never lost — the REST error body and
`ZodError.message` carry the payload through. What dropped it is every consumer
that flattens to one line, and `formatZodError` is one: it is this package's
documented CLI formatter and what `defineStack` throws through, so an author
whose stack config has a union mistake reads it on every command that loads the
stack. Every `strictObject` that sits inside a union was affected; `ActionRef` /
`GuardRef` in `automation/state-machine.zod.ts` are the measured specimens, and
the surface grows with each #4001 strictness batch.

The formatter now expands a failed union one level deeper:

```
Action ref (1 issue):

  ✗ (root): Invalid input
    ✗ (root): Unrecognized key(s) on this action reference: `args`. Until #4001 …
```

**What gets printed, and what deliberately does not.** Printing every branch is
the failure this fix must not cause — a plain union of four strict members
reports one bad key once per member, which is why `view.zod.ts`'s
`submitBehavior` moved to `discriminatedUnion`. So branches are selected, not
dumped:

- A branch that only says the value is the wrong **kind** at its root
  (`expected string, received object`, from the `z.string()` member of
  `z.union([z.string(), SomeObject])`) carries no prescription and is dropped.
  When *every* branch is one — `z.union([z.string(), z.number()])` handed an
  object — nothing is expanded and the output is byte-identical to before.
- Among the rest, the branch reporting the **fewest** issues wins: the member
  the author was aiming at complains only about the stray key, while the others
  also report a wrong discriminator and their own missing requireds. A
  `unrecognized_keys` issue breaks a tie, declaration order breaks what remains.
- Branches that genuinely tie are all rendered (max 3), and identical verdicts
  across them are printed once — so a single unknown key is reported once, never
  once per branch.
- Nested unions expand recursively with absolute paths
  (`✗ states.s.on.GO.actions.0: …`), bounded to three levels.

The issue **count** in the header is unchanged: it stays `error.issues.length`,
so the CLI keeps agreeing with the structural consumers about how many things
are wrong — a union is one issue however many lines explain it.

User-visible for anyone who prints `formatZodError` / `formatZodIssue` /
`safeParsePretty` output, including `defineStack`'s thrown message. No schema,
signature or accepted input changes.

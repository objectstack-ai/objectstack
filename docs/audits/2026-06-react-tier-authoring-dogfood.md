# React-tier authoring dogfood (ADR-0081)

> ## ⚠️ Superseded on three points (2026-08-21, #10284)
>
> **The conclusion below still holds; three pieces of its evidence have rotted.**
> Re-measured against `origin/main` at `b05a543654`: the loop still closes —
> generated contract → author reads it → `os validate` enforces it — and a wrong
> prop is still caught before it renders. What has changed since 2026-06 is one
> file path, one block family, and the CLI banners quoted under "Evidence".
>
> The body below is **left as written, deliberately.** An audit is a dated record
> of what someone actually observed, and that is where its authority comes from;
> a document titled *2026-06* that described August behaviour would be misleading
> in a way no reader could detect. Read the body through the three corrections
> here.
>
> ### 1. The example page's path moved
>
> **The body says** (step 2) the page is
> `examples/app-showcase/src/pages/renewals-pipeline.page.ts`. **It is now**
> `examples/app-showcase/src/ui/pages/renewals-pipeline.page.ts` — the same file,
> one directory deeper. Measured:
>
> ```
> $ ls examples/app-showcase/src/pages/renewals-pipeline.page.ts
> ls: cannot access 'examples/app-showcase/src/pages/renewals-pipeline.page.ts': No such file or directory
>
> $ find . -name '*renewals*' -not -path './node_modules/*' -not -path './.git/*'
> ./examples/app-showcase/src/ui/pages/renewals-pipeline.page.ts
> ```
>
> ### 2. The `record:*` blocks it describes are out of the react tier
>
> **The body says** the contract includes `<RecordHighlights>` /
> `<RecordRelatedList>` / `<RecordPath>` (step 1), and that selecting an account
> "drives `<RecordHighlights>` + `<ObjectChart>` + `<RecordRelatedList>`"
> (step 2). **Neither holds.** The whole `record:*` family was withdrawn from the
> react tier (#4413): each one takes its record from the context a *record* page
> mounts, and a `kind:'react'` page mounts none — so the `objectName`/`recordId`
> the contract published for them were read by no renderer. The ledger, and the
> prop-bound block that replaces each one, are `REACT_RECORD_BLOCK_ALTERNATIVES`
> and the comment above it in `packages/spec/src/ui/react-blocks.ts`.
>
> The generated contract now publishes four blocks, none of them a `Record*`:
>
> ```
> $ grep -n '^## ' skills/objectstack-ui/references/react-blocks.md
> 14:## `<ObjectForm>` — `object-form`
> 55:## `<ListView>` — `list-view`
> 80:## `<ObjectChart>` — `object-chart`
> 105:## `<Block>` — `(any)` *(no spec schema — overlay only)*
> 113:## Injected scope (closure variables, reference directly — not props)
> ```
>
> And the gate this audit is about now **rejects** those blocks here rather than
> letting them render empty. Putting `<RecordHighlights>` back on the renewals
> page and re-running the real CLI:
>
> ```
> $ node ../../packages/cli/bin/run.js validate      # cwd examples/app-showcase
>   → Running author-time rules (41)...
>
>   ✗ Author-time rules failed (1 issue)
>   • page "showcase_renewals_pipeline" › <RecordHighlights>: <RecordHighlights> renders "record:highlights", which reads its record from the record context a record page mounts — a kind:'react' page never mounts one, so the block renders empty no matter how it is bound (its objectName/recordId are not read by the renderer).
>       On a react page bind the record yourself: <ObjectForm objectName="…" mode="view" recordId={…} fields={[…]} />, or read the record with useAdapter().findOne and lay the strip out in JSX.
>       rule: react-block-needs-record-context  at pages[27].source
>                                                  # exit 1
> ```
>
> So step 2 describes an authoring shape the gate it is auditing now refuses. The
> page was rewritten to bind by its own props (an `<ObjectForm mode="view">` plus
> a `<ListView>` filtered on the child's lookup); its docstring records why.
>
> ### 3. The quoted CLI banners no longer exist
>
> **The body's "Evidence" quotes** `→ Checking React-source page props
> (ADR-0081)...` and `✗ React-source page prop check failed (1 issue)`. **Neither
> string is anywhere in the tree** — the only hits are this audit quoting itself:
>
> ```
> $ grep -rn "React-source page" --exclude-dir=node_modules --exclude-dir=.git .
> ./docs/audits/2026-06-react-tier-authoring-dogfood.md:29:→ Checking React-source page props (ADR-0081)...
> ./docs/audits/2026-06-react-tier-authoring-dogfood.md:39:✗ React-source page prop check failed (1 issue)
> ```
>
> This is the correction that matters most: those two lines read as current CLI
> behaviour, so a doc author quoting them publishes output no version of the
> product has ever printed. `validateReactPageProps` is no longer a hand-wired
> `os validate` step with a banner of its own — it joined the shared
> reference-integrity suite (`packages/lint/src/reference-integrity-suite.ts`),
> which runs from the author-time rule registry, so `os validate`, `os lint` and
> `os build` all reach it, and it reports under the registry's single banner.
>
> The real output, captured from the CLI built at `b05a543654` and run against
> `examples/app-showcase`. **Authored correctly → passes** (replaces the body's
> first block):
>
> ```
> $ node ../../packages/cli/bin/run.js validate      # cwd examples/app-showcase
>   → Validating against ObjectStack Protocol...
>   → Running author-time rules (41)...
>   → Checking capability providers (#3366)...
>   → Checking package docs (ADR-0046)...
>
>   ✓ Validation passed (1302ms)
>                                                  # exit 0
> ```
>
> **Authored wrong → caught** (replaces the body's second block), injecting the
> same two mistakes: drop the required `objectName` on `<ObjectChart>`, and typo
> `onSuccess` as `onSucces` on `<ObjectForm>`:
>
> ```
>   → Running author-time rules (41)...
>
>   ✗ Author-time rules failed (1 issue)
>   • page "showcase_renewals_pipeline" › <ObjectChart>: <ObjectChart> is missing the required prop "objectName".
>       Pass objectName={…}. See the react-tier component contract.
>       rule: react-prop-missing-required  at pages[27].source
>                                                  # exit 1
> ```
>
> **The warning and the error never appear in one run, which the body's block
> implies they do.** The error gate exits before advisories are rendered, so with
> both mistakes injected the `onSucces` warning is not printed at all. It does
> still exist, worded exactly as the body has it — with *only* the typo injected
> it appears in the advisory list that follows the pass banner:
>
> ```
>   ✓ Validation passed (1298ms)
>   …
>   ⚠ page "showcase_renewals_pipeline" › <ObjectForm>: <ObjectForm> has prop "onSucces" — did you mean "onSuccess"?
>                                                  # exit 0
> ```
>
> The severity split the body describes is therefore intact — a missing required
> binding is a fatal error, a near-miss prop name is a non-fatal warning — only
> the interleaved rendering is not real.
>
> The body's `pages[29]` reads `pages[27]` above. That is positional drift from
> pages added to the showcase since, not a defect — the index is a pointer into
> the stack as loaded and was never a stable citation. Recorded here only so it
> is not re-reported as rot.

Goal: prove the loop the react-tier was built for actually closes — **an author
(human or AI) writes a `kind:'react'` page knowing every component's props from
the contract, and `os validate` catches it when they don't.** Not "the gate has
unit tests" — an end-to-end run through the real CLI on a real app.

## The loop

1. **Contract** — `skills/objectstack-ui/references/react-blocks.md` lists every
   injected block (`<ObjectForm>`, `<ListView>`, `<ObjectChart>`, `<RecordHighlights>`,
   `<RecordRelatedList>`, `<RecordPath>`, …) and the exact props each accepts,
   tagged `data` / `binding` / `controlled` / `callback`. It is **generated** from
   the spec schemas (`packages/spec/src/ui/react-blocks.ts`), so it can't drift
   into fiction.
2. **Author** — `examples/app-showcase/src/pages/renewals-pipeline.page.ts` was
   written straight from that contract (no guessing): a renewals manager works a
   `<ListView>` of accounts, and selecting one drives `<RecordHighlights>` +
   `<ObjectChart>` + `<RecordRelatedList>` and a slide-out `<ObjectForm formType="drawer">`.
   Five server-connected blocks, every prop taken from the contract.
3. **Gate** — `os validate` step 3d (`validateReactPageProps`, ADR-0081 Phase 2)
   parses each react page's real JSX and checks block usage against the contract.

## Evidence

**Authored-correctly → passes.** With the page wired into the showcase stack:

```
→ Checking React-source page props (ADR-0081)...
✓ Validation passed (98ms)            # exit 0
```

**Authored-wrong → caught.** Injecting two realistic mistakes — dropping the
required `objectName` binding on `<ObjectChart>`, and a `onSucces` typo of the
`onSuccess` callback on `<ObjectForm>`:

```
⚠ page "showcase_renewals_pipeline" › <ObjectForm>: <ObjectForm> has prop "onSucces" — did you mean "onSuccess"?
✗ React-source page prop check failed (1 issue)
  • page "showcase_renewals_pipeline" › <ObjectChart>: <ObjectChart> is missing the required prop "objectName".
      rule: react-prop-missing-required  at pages[29].source
                                          # exit 1
```

The missing required binding is an **error** (fails the build); the near-miss prop
name is a **warning** (likely typo, surfaced but non-fatal — the contract's data
props are a curated subset so arbitrary unknown props aren't flagged, keeping
false positives near zero).

## Conclusion

The three pieces — **generated contract**, **author reads it**, **validate enforces
it** — compose into a working loop. An AI handed `react-blocks.md` writes correct
props, and a wrong prop is caught at `os validate` time before it ever renders.
`renewals-pipeline.page.ts` stays in the showcase as the golden, validated example.

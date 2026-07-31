---
'@objectstack/spec': major
'@objectstack/service-automation': patch
---

feat(spec)!: retire `waitEventConfig.timeoutMs` / `.onTimeout` — `wait` never had a timeout (#4158)

Both keys described a timeout and neither delivered one, so protocol 18 removes the pair
rather than leaving a promise the runtime does not keep (PD #10).

- **`onTimeout`** had **zero** readers. No path ever inspected it, so neither `'fail'` nor
  `'continue'` ever happened — and its `.default('fail')` stamped a decision nothing made
  onto every wait node. The showcase set `onTimeout: 'continue'`, which did nothing.
- **`timeoutMs`** said *"maximum wait time before timeout"* while its only reader used it
  as the timer **duration** when `timerDuration` was absent. It did something, just not
  what it claimed.

Together they declared a timeout `wait` does not have: a run resumes when its timer
elapses or its signal arrives, never on a deadline. Real timeout semantics are left
unimplemented deliberately — they should be built to a requirement, not retrofitted to
fit two keys that happened to be declared.

`timeoutMs` **converts to `timerDuration`** rather than being dropped, because that is
what it did. It is stringified on the way: the target is `z.string()` while `timeoutMs`
was `z.number()`, and `parseIsoDuration` reads a bare numeric string as milliseconds — so
`timeoutMs: 60000` and `timerDuration: '60000'` are the same wait. Moving the number
unstringified would have produced a block that no longer parses, which a test pins. With
`timerDuration` already set it is dropped instead: the executor's `??` never looked past
the duration, so it was already dead metadata.

Both leave the **load path** (`retiredFromLoadPath`), which is the registry's existing
split: a key retired for being *renamed* keeps a load window, because punishing an author
for a spelling nobody warned them about is pointless; a key that **misdescribed itself**
does not, because silently absorbing it lets the author keep believing they configured a
timeout. That is why `api.requireAuth`, the tool/app/flow inert keys and RLS `priority`
all left it too. The migration chain converts stored sources mechanically; the schema
tombstones name the replacement.

One fixture interaction worth recording: the #4045 lift fixture used
`waitEventConfig.timeoutMs` to demonstrate its fourth ledger entry, and the fixture
harness replays the whole table — so its `after` described an end state protocol 18 makes
unreachable. It now lifts `eventType` instead. The harness caught this itself.

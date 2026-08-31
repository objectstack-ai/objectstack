# Should CPU-heavy `check:*` runs be routed through `os-verify-lock`? — the measurement

**Date:** 2026-08-31 · **Box:** one container, 4 cores, 16 GB, 3-4 sibling dev agents live
throughout · **Instrument:** `scripts/pm/os-verify-lock.sh --report` ledger + direct timing

This audit delivers the four quantities `scripts/pm/os-verify-lock.sh` names as unmeasured in
its `WHAT THIS LOCK DOES NOT COVER` header. It **implements nothing** and changes nothing about
what the lock serialises. The routing decision it feeds is a separate, maintainer-facing call —
this file is only the number that call was waiting on.

> ⚠️ **Shared-box seconds throughout.** Every absolute below was taken on a box carrying other
> agents' unlocked work; ambient load ranged from 1.2 to 19.6 across the session. The header's
> own prescription applies to this file too: **quote the ratios, not the absolutes.** Where a
> conclusion depends on an absolute, it is stated as a bound and the direction of the bound is
> named.

---

## Answer in one line

**Every routing policy measured is worse than routing nothing, on the quantity that decides it.**
Today 2.0% of locked runs return exit 99 (a NOT MEASURED run). Across a 64-cell sweep of four
routing policies, four demand levels and four levels of CPU credit handed to routing, **the best
cell is 4.0% and the worst is 65.7%** — no cell reaches today's 2.0%. Routing converts
measurements into non-measurements at 2x to 33x the current rate.

---

## Quantity 1 — Gate-run cost distribution · MEASURED

All 116 `check:*` families in the root `package.json`, each run once as `pnpm check:NAME`, wall
time captured with the exit code taken before any pipe. Two families hit the 120 s harness
timeout and were re-run uncensored; their real values are used below.

| bucket | families | % of families | gate-seconds | % of total cost |
|---|---:|---:|---:|---:|
| under 1 s | 6 | 5.2% | 5.8 s | 0.5% |
| 1-2 s | 48 | 41.4% | 64.7 s | 5.6% |
| 2-5 s | 31 | 26.7% | 96.0 s | 8.3% |
| 5-10 s | 20 | 17.2% | 146.3 s | 12.7% |
| 10-30 s | 6 | 5.2% | 99.5 s | 8.6% |
| 30-100 s | 3 | 2.6% | 206.4 s | 17.9% |
| over 100 s | 2 | 1.7% | 534.5 s | 46.3% |

**Whole farm, run serially: 1153 s (19.2 min). p50 = 2.3 s, p90 = 9.5 s, p95 = 23.1 s, max = 305.5 s.**

The heavy tail:

| rank | family | cost | gap to next |
|---:|---|---:|---:|
| 1 | `check:pm-dispatch-gates` | 305.5 s | x1.33 |
| 2 | `check:query-options-erasure` | 229.0 s | **x2.33** |
| 3 | `check:slot-lookup` | 98.3 s | x1.41 |
| 4 | `check:stall-guard` | 69.9 s | **x1.83** |
| 5 | `check:engine-double-contract` | 38.2 s | **x1.65** |
| 6 | `check:changeset-gate-self-tests` | 23.1 s | x1.09 |
| 7 | `check:entry-guard` | 21.1 s | x1.18 |

**Is there a clean threshold?** Partly, and the honest answer has two halves.

- **The concentration is extreme and real.** 5 families (4.3% of the farm) carry **64.3%** of all
  gate-seconds; the top 2 alone carry **46.3%**.
- **The cut point is defensible but not razor-sharp.** Ranks 1-5 are separated by steps of x1.33,
  x2.33, x1.41 and x1.83, and rank 5 stands x1.65 clear of rank 6. Below rank 6 the distribution is
  **smooth** — every consecutive gap is x1.30 or less, most under x1.10. So a threshold exists at
  roughly **30 s**, isolating exactly 5 families, and there is nothing resembling a threshold
  anywhere below that.

### ⚠️ Correction to the premise: "most are sub-second" is false as invoked, true as scripted

The card records the farm as *"176 families; most are sub-second."* As measured, **only 6 of 116
families finish in under a second, and the fastest is 934 ms.** The reason is not that the gates
are heavy — it is that the invocation is:

| measurement | time |
|---|---:|
| `pnpm check:node-version` (three reps) | 966 / 989 / 971 ms |
| `node scripts/check-node-version.mjs` (the same gate, no pnpm) | **101 ms** |
| `node scripts/check-console-sha.mjs` | **57 ms** |
| `node -e 'process.exit(0)'` (control) | 39 ms |

**For the light families roughly 97% of the measured wall time is pnpm's own startup, not gate
work.** Both readings are true of different things, and the routing question needs the first: what
would be routed is the command an agent types, and that command costs ~970 ms before the gate
begins. The farm count has also moved — `dispatch-gates.mjs` now discovers **190** families across
29 workflow files, against the card's 176.

---

## Quantity 2 — Queue-depth effect · MEASURED, and the sign is not the one the card allowed for

The card leaves open that *"serialised-but-uncontended can beat parallel-but-thrashing on 4
cores."* It does not, at any concurrency measured. One fixed CPU-bound gate was run at W = 1, 2, 4
and 8 concurrent copies; aggregate throughput is the figure of merit, because W = 1 **is** the
routed world for gate runs.

| sweep | ambient load | W=1 | W=2 | W=4 | W=8 |
|---|---|---:|---:|---:|---:|
| `check:objectql-double-limit`, rep 1 | 2.0 - 3.1 | 4.12 | 7.31 | **9.80** | 7.57 |
| `check:adr-anchors` | 8.5 - 11.3 | 9.40 | 9.27 | 9.28 | **10.13** |
| `check:objectql-double-limit`, rep 2 | 11.6 - 19.6 | 4.34 | 5.94 | 5.26 | **6.64** |

(gates per minute; **bold** = best in row)

**W = 1 is never the throughput maximum — in three sweeps out of three.** Two regimes:

- **Box not already saturated** (rep 1, load ~2-3): parallelism pays hard. Serialising costs
  **2.38x aggregate gate throughput**.
- **Box already saturated** (`adr-anchors` and rep 2, load 8.5-19.6): the curve goes flat.
  Serialising costs approximately nothing, because the cores were already the binding constraint.

So the trade is asymmetric in a way that settles the sign: **the best case for routing is "costs
nothing", and the ordinary case is "costs 1.8x to 2.4x". There is no measured case where it wins.**
Even 2x over-subscription (W = 8 on 4 cores, plus siblings) beat serialisation by 1.53x-1.84x.

⛔ **What this instrument cannot see.** The ledger lives in the container's `/tmp`, so it answers
only within one container lifetime; the current file spans 16.1 h across 2 boots. Per-agent
**end-to-end wall time** — the card's preferred framing for (2) — is **NOT MEASURED**: nothing
records when an agent's card starts or ends, and no ledger field carries an agent identity. What is
measured is aggregate gate throughput at the box, which bounds it: an agent cannot finish its gate
work faster than the box completes gate work.

---

## Quantity 3 — Budget fit · MEASURED, and it is decisive

The acquisition budget is **540 s** (`HARD_CAP_S`), unchanged. A run that cannot acquire inside it
returns exit 99, and exit 99 is a **NOT MEASURED** run — no gate was decided by it.

### Baseline, from the real ledger (99 records, 16.1 h, 2 boots)

| quantity | value |
|---|---|
| server utilisation | **rho = 23.5%** |
| arrival rate | 6.14 locked runs / h |
| mean service time | 148 s (p50 125 s, p90 387 s, max 1118 s) |
| acquisition wait, over runs that waited at all | n = 26, p50 151 s, **p90 536 s**, max 540 s |
| queue-timeouts (exit 99) | **2 of 99 = 2.0%** |
| queue depth on arrival | p50 1, p90 1, max 2 |

Two facts about that baseline decide most of the question before any simulation:

1. **The wait distribution is already pressed flat against the cap.** p90 of the waiting
   population is **536 s** against a 540 s budget. There is no headroom to spend.
2. **The lock is idle 76.5% of the time, and still 2% of runs time out.** The load is not high, it
   is *bursty and heavy-tailed* — which is exactly the regime where adding work is punished
   super-linearly.

### The arithmetic that needs no model

The two heaviest families cost **305.5 s + 229.0 s = 534.5 s**. The acquisition budget is 540 s.

> **Routing just the top two families means one gate sweep can occupy 99.0% of another caller's
> entire acquisition budget, by itself, with the lock otherwise empty.**

### Trace-driven simulation

The ledger's `ts`, `held` and `waited` fields reconstruct each run's arrival time exactly
(`arrival = ts - held - waited`). Replaying those arrivals through a FIFO single server with a
540 s budget — a job whose wait would exceed the budget never acquires and consumes no server
time — reproduces the observed record:

| | simulated | observed |
|---|---|---|
| exit 99 | 2 (2.0%) | 2 (2.0%) |
| waited-at-all n | 27 | 26 |
| wait p50 / p90 | 151 s / 536 s | 151 s / 536 s |

⚠️ The quantiles match, and the direction of the residual error is known and favourable to
routing: the trace cannot contain holders it never recorded (a free-hand `flock` holder takes no
ticket and writes no ledger row), so **every routed figure below is a lower bound on the harm.**

Synthetic gate sweeps were then injected at rate G and the build population re-measured.
`f` is the build service-time multiplier once gates no longer run alongside a holder — i.e. the
credit routing is given for the CPU it frees. `f = 1.00` gives routing no credit; `f = 0.60`
assumes builds get 40% faster, which is **more** than the concurrency sweep above can support
(removing ~1 competing process was worth x1.12; removing 3 was worth x1.68).

**Build exit-99 rate. Today's value is 2.0%.**

| policy | added rho | f=1.00 | f=0.85 | f=0.70 | f=0.60 |
|---|---:|---:|---:|---:|---:|
| **route ALL 116** (1153 s/sweep) G=1 | 32% | 13.1% | 10.1% | 7.1% | 6.1% |
| G=2 | 63% | 23.2% | 20.2% | 14.1% | 8.1% |
| G=4 | 129% | 45.5% | 42.4% | 38.4% | 40.4% |
| G=8 | 256% | 59.6% | 60.6% | 59.6% | 65.7% |
| **route >= 10 s, 11 fams** (840 s/sweep) G=1 | 23% | 8.1% | 8.1% | 9.1% | 7.1% |
| G=2 | 46% | 17.2% | 13.1% | 13.1% | 12.1% |
| G=4 | 94% | 40.4% | 35.4% | 38.4% | 36.4% |
| G=8 | 186% | 58.6% | 59.6% | 59.6% | 61.6% |
| **route >= 30 s, 5 fams** (741 s/sweep) G=1 | 20% | 8.1% | 7.1% | 7.1% | **4.0%** |
| G=2 | 41% | 16.2% | 13.1% | 13.1% | 9.1% |
| G=4 | 83% | 36.4% | 29.3% | 30.3% | 29.3% |
| G=8 | 164% | 48.5% | 46.5% | 48.5% | 48.5% |
| **route >= 60 s, 4 fams** (703 s/sweep) G=1 | 19% | 8.1% | 5.1% | 7.1% | **4.0%** |
| G=2 | 39% | 17.2% | 14.1% | 12.1% | 8.1% |
| G=4 | 79% | 33.3% | 36.4% | 29.3% | 31.3% |
| G=8 | 156% | 45.5% | 48.5% | 50.5% | 50.5% |

**No cell reaches the 2.0% baseline.** The minimum over all 64 cells is 4.0% — double today's
rate — and it occurs only at the lowest demand, the narrowest policy, and a CPU credit larger than
the measurement supports.

### What demand is realistic

A real derived family for an ordinary card is **7 families** (measured: `dispatch-gates.mjs` on
this PR's own diff), rising to 16 once a changeset exists — not 116. At the measured median of
2.3 s that is roughly 20-40 s per sweep. But a card touching a gate script or `scripts/pm/` pulls
the self-test families in, and those sweeps cost 300-800 s. With 4 agents sweeping ~2-3 times per
card, plausible fleet demand lands at **added rho ~7-25%** — the G=1 to G=2 rows, where the build
exit-99 rate is **4.0% to 23.2%**, i.e. 2x to 12x today.

⛔ **Fleet gate-run arrival rate is NOT MEASURED, and cannot be measured with this instrument.**
Gate runs are unlocked today, so they take no ticket and write no ledger row — the ledger is blind
to exactly the population routing would add. G is therefore swept rather than fitted, and the
conclusion is stated as its robustness across the sweep, not as a point estimate.

---

## Quantity 4 — The partial option · MEASURED. It wins its bracket and loses the question.

Routing only the heavy families **does** dominate routing everything, monotonically. At G=4,
f=1.00: route ALL 45.5%, `>=10 s` 40.4%, `>=30 s` 36.4%, `>=60 s` 33.3%.

But the improvement is small, and the reason is structural rather than incidental:

| policy | families | gate-seconds per sweep | % of the whole farm's cost |
|---|---:|---:|---:|
| route ALL | 116 | 1153 s | 100% |
| route >= 10 s | 11 | 840 s | 72.8% |
| route >= 30 s | 5 | 741 s | 64.3% |
| route >= 60 s | 4 | 703 s | 61.0% |

> **Dropping 112 of 116 families removes only 39% of the routed load, because the heavy families
> *are* the load.** There is no version of "route only the expensive ones" that is also "route
> only a little" — the threshold from quantity 1 selects precisely the families whose service times
> are a large fraction of the whole 540 s budget.

So the partial option is the **best routing policy** and is still **worse than not routing**. Its
one genuine merit is orthogonal to CPU: the 5 heavy families are the ones whose unlocked runs most
distort a concurrent holder's timings, so routing them buys *measurement hygiene* even though it
costs measurement *availability*. That trade is a judgement, not a number, and it belongs to
whoever takes the routing decision.

---

## What this measurement did not touch

- **No routing was implemented.** Nothing about what the lock serialises changed. The only edit
  beside this file is a header pointer in `scripts/pm/os-verify-lock.sh` retiring the sentence that
  called this trade unmeasured.
- **The lock is not the expensive part.** Acquire-plus-release on a free lock measured **~90 ms**
  (4 consecutive reps: 88, 93, 93, 94 ms) — an order of magnitude *cheaper* than the ~970 ms pnpm
  startup every routed gate would pay anyway. A fifth rep, taken first, cost 58 106 ms because a
  sibling held the lock; that is the contention, not the mechanism.
- **The `#12538` premise needs a correction.** The wait budget was **not** raised: `HARD_CAP_S`
  and `DEFAULT_WAIT_S` are both still 540, and the script's own header argues at length that this
  constant cannot be raised, because the budget is spent inside one foreground turn that a ~600 s
  harness ceiling kills. What that card moved is `SLOT_MAX_AGE_S` (now `HARD_CAP_S * 3` = 1620 s),
  re-based on last relinquish. Any reasoning that assumed a larger acquisition budget is wrong in
  the other direction.

## Reproducing

```
bash scripts/pm/os-verify-lock.sh --report      # the baseline population
bash scripts/pm/os-verify-lock.sh --show-budget # the 540 s cap under test
node scripts/pm/dispatch-gates.mjs              # a real derived family for a card
```

The per-family timings, the concurrency sweep and the simulation were produced by throwaway
harnesses in the run's scratchpad; every input they consumed is either the ledger named by
`--report` or a `pnpm check:NAME` invocation timed directly, and both are reproducible from the
commands above.

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, TryCatchConfigSchema } from '@objectstack/spec/automation';
import type { TryCatchConfigParsed, TryCatchErrorValue } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine, StepLogEntry } from '../engine.js';
import { parseNodeConfig } from './parse-config.js';
import { currentLoopIteration } from './loop-frame.js';

/**
 * `try_catch` built-in node — **structured try/catch/retry** (ADR-0031 §Decision 3).
 *
 * Runs the protected `try` region; if it throws (a node fails), an optional
 * `retry` policy re-runs the `try` region with exponential backoff. If the
 * region still fails after retries, the optional `catch` region runs with the
 * caught error bound to `errorVariable` (default `$error`) — `{ nodeId,
 * message }`, plus `code` (#14419) when the failing node's own result set a
 * platform-classified one (e.g. `create_record`'s `DUPLICATE_RECORD`), so the
 * catch region can branch on `{$error.code}` instead of only ever seeing a
 * string, plus `iteration` and `item` (#14456) when the container is running
 * inside a `loop` body, so a caught per-row failure names the ROW it lost and
 * not merely that one was lost. Both regions are self-contained single-entry/single-exit sub-graphs
 * validated at `registerFlow()`, executed in the **enclosing variable scope**
 * via {@link AutomationEngine.runRegion}.
 *
 * Outcome:
 *  - `try` (or a retry) succeeds → the node succeeds, downstream continues.
 *  - `try` exhausts retries, a `catch` is present and succeeds → the node
 *    succeeds (the error was handled).
 *  - `try` exhausts retries and there is **no** `catch` (or `catch` itself
 *    fails) → the node fails, surfacing to the flow's fault edge / error handling.
 *
 * What the RUN LOG records (#7546) is a separate question from those outcomes,
 * and the two must not be conflated. Every **failed** try attempt now
 * contributes its steps to `childSteps`, tagged `regionKind: 'try'` (and
 * `retryAttempt: <n>` when a retry policy is declared), ahead of the steps of
 * whichever region finally succeeded. So a recovered container still reports
 * `success` — that model is unchanged and deliberately so — while the log
 * underneath it now answers the three questions it previously could not: WHAT
 * failed (the failing node's own `failure` step, with its error), HOW MANY
 * attempts ran (count the distinct `retryAttempt` values), and WHICH node threw.
 *
 * This is the low-code-native error model — the same `fault` + exponential-
 * backoff retry the engine already implements, surfaced as a construct rather
 * than BPMN boundary events.
 */
export function registerTryCatchNode(engine: AutomationEngine, ctx: PluginContext): void {
  engine.registerNodeExecutor({
    type: 'try_catch',
    descriptor: defineActionDescriptor({
      type: 'try_catch',
      version: '1.0.0',
      name: 'Try / Catch',
      description: 'Run a protected region with optional retry and a catch handler (structured error handling).',
      icon: 'shield-alert',
      category: 'logic',
      source: 'builtin',
      supportsRetry: true,
      configSchema: {
        type: 'object',
        properties: {
          try: {
            type: 'object',
            description: 'Protected region (single-entry/single-exit sub-graph)',
            properties: { nodes: { type: 'array' }, edges: { type: 'array' } },
          },
          catch: {
            type: 'object',
            description: 'Handler region run when the try region fails',
            properties: { nodes: { type: 'array' }, edges: { type: 'array' } },
          },
          errorVariable: { type: 'string', description: 'Variable holding the caught error in the catch region — a `TryCatchErrorValue`: `nodeId`, `message`, and `iteration` / `item` when the failure happened inside a loop body' },
          retry: {
            type: 'object',
            properties: {
              maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
              // `backoffMs` (was `retryDelayMs`) since spec 17.0.0 — one retry
              // policy spelling across job.retryPolicy and try_catch (#4661).
              backoffMs: { type: 'integer', minimum: 0 },
              backoffMultiplier: { type: 'number', minimum: 1 },
              maxRetryDelayMs: { type: 'integer', minimum: 0 },
              jitter: { type: 'boolean' },
            },
          },
        },
        required: ['try'],
      },
    }),
    async execute(node, variables, context) {
      // Parse against the ADR-0031 contract. Note the retry defaults now come
      // from the CONTRACT (RetryPolicySchema): a declared `retry` block that
      // omits `backoffMs` gets the documented 1000ms base delay, where this
      // executor historically filled in 0 — the declared default is the
      // enforced one (#4277). Since spec 17.0.0 that contract is one shared
      // declaration with `job.retryPolicy`, and the base delay is spelled
      // `backoffMs` (was `retryDelayMs`, tombstoned + converted — #4661).
      const parsed = parseNodeConfig<TryCatchConfigParsed>('try_catch', node.id, TryCatchConfigSchema, node.config);
      if (!parsed.ok) return parsed.refusal;
      const cfg = parsed.config;
      const tryRegion = cfg.try;
      const catchRegion = cfg.catch;
      const errorVariable = cfg.errorVariable || '$error';
      const retry = cfg.retry;

      const ctxOrEmpty = context ?? ({} as AutomationContext);
      // #14456 — the enclosing loop's row identity, when this container is a
      // loop body's containment wrapper. `undefined` outside a loop, and that
      // absence is the contract's own answer ("not in a loop"), not a gap:
      // `TryCatchErrorValueSchema` declares `iteration` / `item` present only
      // for a failure that happened inside a loop body. Read ONCE here rather
      // than per region: the frame cannot change while this node executes, and
      // one read is one place for the next reader to look.
      const loopFrame = currentLoopIteration(variables);
      const maxRetries = retry?.maxRetries ?? 0;
      const baseDelay = retry?.backoffMs ?? 0;
      const multiplier = retry?.backoffMultiplier ?? 1;
      const maxDelay = retry?.maxRetryDelayMs ?? 30000;
      const useJitter = retry?.jitter === true;

      // Run the try region, retrying with exponential backoff up to maxRetries.
      //
      // #7546: every FAILED attempt's steps accumulate here and ride out on
      // `childSteps` ahead of whatever ultimately succeeded. Before this, they
      // were discarded in the `catch (err)` arm below and a caught failure left
      // no forensic trace: the container's own step read `success`, no step
      // carried `regionKind: 'try'`, none carried `status: 'failure'`, and the
      // only evidence a failure had occurred was the catch region's side
      // effects. An operator (or an agent) reading such a log was not merely
      // under-informed — the log pointed at the wrong conclusion, namely that
      // the try region had never run.
      //
      // Retry/throw semantics are UNCHANGED by this: the loop still retries the
      // same number of times, still falls through to the same catch, and the
      // container still reports `success` when it recovers. Only the record of
      // what happened changes.
      let lastError = 'unknown error';
      // #14419 — the classified `code` (ADR-0112 `StandardErrorCode`, e.g.
      // `DUPLICATE_RECORD`) of whichever node inside the try region last
      // failed, when that node's executor set one. Captured from `$error`
      // (below) rather than from the caught exception itself: a node that
      // FAILS BY RETURNING (`{ success: false, code }`, the common shape)
      // never throws anything carrying `code` — the engine writes it onto the
      // shared `$error` variable before it converts that returned failure
      // into the exception this loop catches, and this read happens before
      // either the next retry attempt or this executor's own `errorVariable`
      // write (below) can shadow it. Without this, a `try_catch`'s catch
      // region could never distinguish "the row is already there" from any
      // other failure — the whole point of #14419.
      let lastErrorCode: string | undefined;
      const failedAttemptSteps: StepLogEntry[] = [];
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          let delay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
          if (useJitter) delay = delay * (0.5 + Math.random() * 0.5);
          if (delay > 0) await new Promise(r => setTimeout(r, delay));
        }
        // Sink for THIS attempt's partial steps, filled by `runRegion` only if
        // the attempt throws (#7546).
        const attemptSteps: StepLogEntry[] = [];
        // #14948 review — the run-wide `$error` this attempt STARTS with. The
        // engine rewrites `$error` (a fresh object, see engine.ts's
        // `executeNode`) only when a failing node RETURNS `{ success: false }`,
        // or when it THROWS through a node that has its OWN `fault` edge — and
        // a node inside this region's synthetic sub-flow never has one (the
        // sub-flow carries only the region's own edges). So a node that FAILS
        // BY THROWING (a `timeoutMs` firing, a dying nested container, a
        // thrown guard) leaves `$error` exactly as an EARLIER failure left it.
        // Without this identity check, that earlier failure's `code` (e.g. a
        // sibling row's `DUPLICATE_RECORD`) leaks onto an unrelated later
        // failure's binding — a store failure misread as a duplicate through
        // the very door this card exists to close.
        const errorBefore = variables.get('$error');
        try {
          // #1479: surface the successful try region's steps.
          const trySteps = await engine.runRegion(
            tryRegion,
            variables,
            ctxOrEmpty,
            {
              parentNodeId: node.id,
              regionKind: 'try',
              // #14456 — forward the ENCLOSING loop's iteration so a step this
              // region ran says which region ran it AND which row it ran for.
              // `runRegion`'s tagger fills only fields the INNERMOST tagger
              // left undefined, so a loop's own tagger can never reach past
              // this one to a try/catch step; forwarding at this call site is
              // what closes that, and it leaves both the tagger and `parallel`
              // untouched (a branch step already carries its own `iteration`,
              // and nothing here changes what `parallel` writes).
              ...(loopFrame ? { iteration: loopFrame.iteration } : {}),
              // Only tag the attempt index when a retry ladder is actually
              // declared: on a plain `try_catch` every step would carry a
              // constant `retryAttempt: 0`, which is noise rather than signal.
              ...(maxRetries > 0 ? { retryAttempt: attempt } : {}),
            },
            attemptSteps,
          );
          return {
            success: true,
            output: { attempts: attempt + 1, caught: false },
            childSteps: [...failedAttemptSteps, ...trySteps],
          };
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          const innerError = variables.get('$error');
          // Only a `$error` that actually CHANGED (identity, not content —
          // two failures can legitimately share a message) belongs to THIS
          // attempt's failure; one that is `===` `errorBefore` is stale
          // carry-over from whatever failed earlier in the run.
          lastErrorCode =
            innerError !== errorBefore && innerError && typeof innerError === 'object' && 'code' in innerError
              ? ((innerError as { code?: unknown }).code as string | undefined)
              : undefined;
          failedAttemptSteps.push(...attemptSteps);
        }
      }

      // The try region (and any retries) failed. Run the catch handler if present.
      if (catchRegion != null) {
        // #14456 — the caught error is a `TryCatchErrorValue` (declared in
        // `packages/spec`, PR #14452): `nodeId` + `message`, plus the ROW
        // IDENTITY when the failure happened inside a loop body. Without
        // `iteration` / `item` a caught per-row failure is attributable to no
        // row — the catch region can record THAT something failed and never
        // WHICH thing, and `message` names one only when it happens to echo
        // the template.
        //
        // `code` (#14419) is bound alongside but is NOT declared on
        // `TryCatchErrorValueSchema`, so it is spelled as an explicit widening
        // of the declared type rather than dropped — dropping it would regress
        // a catch region's ability to branch on `{$error.code}`. Filed as a
        // spec-lane gap; this file is not the place to change the contract.
        const errorValue: TryCatchErrorValue & { code?: string } = {
          nodeId: node.id,
          message: lastError,
          ...(lastErrorCode ? { code: lastErrorCode } : {}),
          ...(loopFrame ? { iteration: loopFrame.iteration, item: loopFrame.item } : {}),
        };
        variables.set(errorVariable, errorValue);
        // #14222: sink for the catch region's OWN partial steps, filled by
        // `runRegion` only if the handler itself throws. Without it the catch
        // region's completed steps unwound with the stack exactly as the try
        // region's did before #7546 — see the failing-catch return below.
        const catchAttemptSteps: StepLogEntry[] = [];
        try {
          // #1479: surface the catch handler region's steps.
          const catchSteps = await engine.runRegion(
            catchRegion,
            variables,
            ctxOrEmpty,
            {
              parentNodeId: node.id,
              regionKind: 'catch',
              // #14456 — same forwarding as the try region above: the handler's
              // steps carry the row they handled, with `regionKind` still
              // naming the region.
              ...(loopFrame ? { iteration: loopFrame.iteration } : {}),
            },
            catchAttemptSteps,
          );
          return {
            success: true,
            output: { attempts: maxRetries + 1, caught: true, error: lastError },
            // #7546: the failed attempts come FIRST — they happened first, and
            // the run log is ordered. The catch handler's steps read as the
            // response to them rather than as the whole story.
            childSteps: [...failedAttemptSteps, ...catchSteps],
          };
        } catch (catchErr) {
          const catchMsg = catchErr instanceof Error ? catchErr.message : String(catchErr);
          // #14222 — the THIRD returned-failure path, and the last one still
          // discarding its record. #13803 taught the engine to fold a dying
          // container's steps off the THROW channel and #14184 taught the
          // returned-failure branch the same, but only the no-`catch` producer
          // was taught to supply them. This return is the worst of the three
          // for an operator, because TWO regions ran: the try region may have
          // written rows before it failed, the handler may have written more
          // before IT failed, and the run log kept a step for neither — so the
          // #4354 summary folded over that log reported `acted: 0` over writes
          // that had genuinely landed. `acted: 0` on a failed run reads as
          // "nothing happened, safe to re-run".
          //
          // Ordering mirrors the successful-catch return directly above: the
          // failed try attempts come FIRST because they happened first, then
          // whatever the handler got through. `runRegion` has already tagged
          // both sets (`parentNodeId`, `regionKind: 'try'` / `'catch'`) on its
          // failure path as well as its success path, so the two halves stay
          // distinguishable in the log without anything being tagged here.
          //
          // Additive to the RECORD only: this return already reported failure
          // with this error text, already produced a `NODE_FAILURE` step and
          // was already routable by a `fault` edge. No engine change — the
          // #14184 fold on `if (!result.success)` is already the reader.
          return {
            success: false,
            error: `try_catch '${node.id}': catch region failed — ${catchMsg}`,
            childSteps: [...failedAttemptSteps, ...catchAttemptSteps],
          };
        }
      }

      // No catch handler — surface the failure to the flow's fault edge / error
      // handling.
      //
      // #14184 — and the try region's steps ride out WITH it. They used to be
      // withheld here on purpose, because the engine spliced `childSteps` only
      // on a SUCCESSFUL node result and attaching them to a failing one really
      // was dead weight. #13803 taught the engine's THROW arm to fold a dying
      // container's carried steps, and this card teaches its returned-failure
      // arm the same, so the sink now has a reader on both channels.
      //
      // Withholding them was the #13803 defect one construct over. The try
      // region's nodes may have written rows before one of them failed; the run
      // log kept no step for any of them, so the #4354 summary folded over that
      // log reported `acted: 0` for a region that had genuinely written. `acted:
      // 0` on a failed run reads as "nothing happened, safe to re-run", which
      // for a non-idempotent region invites double-execution.
      //
      // Purely additive to the RECORD: this return already reported failure,
      // already produced a `NODE_FAILURE` step, already set `$error` and was
      // already routable by a `fault` edge. Adding `childSteps` moves none of
      // that — unlike the rejected "make `loop` swallow its throw and return"
      // shape (see `partial-steps.ts`), which would have changed all four.
      return {
        success: false,
        error: `try_catch '${node.id}': try region failed — ${lastError}`,
        childSteps: failedAttemptSteps,
      };
    },
  });

  ctx.logger.info('[TryCatch Node] 1 built-in node executor registered');
}

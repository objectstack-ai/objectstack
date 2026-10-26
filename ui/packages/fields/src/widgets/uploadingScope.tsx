import * as React from 'react';

/**
 * An ambient "is any upload still in flight?" scope for a whole form subtree.
 *
 * ## Why this exists beside `onUploadingChange`, and why it is not a second contract
 *
 * `onUploadingChange` (ADR-0059) is a PER-WIDGET prop: a host that renders one
 * upload control and knows its name can pass a callback and keep the answer
 * itself. That is `ActionParamDialog`, which holds a `Record<paramName, boolean>`
 * because it lays out its own params one by one.
 *
 * A record form cannot do that. Its fields are rendered by the `form` node
 * renderer from a `fields` array — the host hands over a list of field configs
 * and never touches the widget — and its upload widgets may sit an arbitrary
 * number of levels down (a section, a tab, a line-items subform). There is no
 * place in that chain where the form host can attach a per-widget callback, so
 * a record form was left with no notion of upload state at all and could submit
 * mid-upload: the record was written WITHOUT the attachment and reported
 * success (objectui#10166).
 *
 * The scope is the aggregation, not a second producer. `useUploadingSignal` is
 * still the ONE place a widget's in-flight state is published; it drives the
 * host prop and this scope from that same call, so the two can never disagree.
 * A widget reports nothing extra and knows nothing about the scope, and a host
 * that mounts no provider (every host on `main` today) is unaffected — the
 * context read answers `null` and the reporting hook is inert.
 *
 * ## The one thing a mount-bound report cannot see (objectui#10180)
 *
 * A widget's in-flight state is React state, so it ends when the widget
 * unmounts — and an upload does not. `FileField` does not abort its upload
 * when it unmounts; the promise settles later and hands the value to the
 * `onChange` it captured, which the form still accepts. So "the widget
 * unmounted" is not "the upload ended". A wizard step the user leaves is the
 * everyday case: leaving the step drops the widget's report, the wizard's final
 * gate reads `false` while the upload is still running, and a Create pressed in
 * that window writes the record WITHOUT the attachment and reports success.
 *
 * The in-repo upload widgets therefore also hold the scope for the lifetime of
 * the upload ITSELF, through {@link useUploadingScopeHold}: taken when the
 * upload starts, released when its promise settles, whether or not the widget
 * is still mounted by then. While the widget is mounted the two entries start
 * and stop together, so they cannot disagree; after it unmounts the hold is the
 * only entry left, and it is the true one. The hold is internal to this package
 * — it is not exported from the package entry.
 */

/**
 * The write half of a scope. Kept separate from the boolean so a widget that
 * only REPORTS does not re-render when some other widget's upload flips —
 * reporters read this context, the host owns the boolean.
 */
interface UploadingScopeSink {
  /**
   * Record whether the widget registered under `id` is currently uploading.
   * Reporting `false` for an unknown id is a no-op, which is what makes the
   * unmount release below safe to call unconditionally.
   */
  report: (id: string, uploading: boolean) => void;
}

const UploadingScopeSinkContext = React.createContext<UploadingScopeSink | null>(null);

/** What {@link useUploadingScope} hands a host. */
export interface UploadingScope {
  /** True while at least one upload widget inside the scope is in flight. */
  anyUploading: boolean;
  /**
   * Passed to {@link UploadingScopeProvider}. Opaque to the host: it is the
   * channel the widgets report on, not state the host is meant to read.
   */
  sink: UploadingScopeSink;
}

/**
 * Own an uploading scope. The host reads `anyUploading` to gate its own submit
 * and to say WHY that control is disabled, and renders its form subtree inside
 * {@link UploadingScopeProvider}.
 *
 * The host owns the state rather than reading it back out of the context on
 * purpose: a provider cannot consume its own value, and splitting it would give
 * "is anything uploading" two authors.
 */
export function useUploadingScope(): UploadingScope {
  // The ids currently in flight, not a count: a widget that reports `true`
  // twice (a re-mount under the same `useId`, a double-fired effect under
  // StrictMode) must not be able to leave a counter permanently above zero,
  // which would wedge Save forever with no way out.
  const [inFlight, setInFlight] = React.useState<readonly string[]>([]);

  // ── Nesting CHAINS; an inner scope does NOT shadow an outer one.
  //
  // This hook runs in the HOST, which sits inside any enclosing provider — so
  // the context read here is the scope ABOVE, and this scope registers in it as
  // if it were one more widget.
  //
  // The direction is forced by what an outer Save actually writes. A
  // master-detail form persists parent AND children in one batch, and its child
  // rows are edited by nested `ObjectForm`s that own scopes of their own. If the
  // inner scope shadowed, the outer Save would see the parent's uploads and be
  // blind to every child's — it would gate, look gated, and still write a row
  // without its attachment. A gate that covers the parent and not the child is
  // worse than no gate, because it reads as coverage.
  //
  // Chaining cannot under-report: an upload anywhere below a host is in flight
  // for every host above it too, and those hosts' saves all encompass it.
  const outerSink = React.useContext(UploadingScopeSinkContext);
  const outerRef = React.useRef(outerSink);
  outerRef.current = outerSink;
  const scopeId = React.useId();

  const sink = React.useMemo<UploadingScopeSink>(
    () => ({
      report(id, uploading) {
        setInFlight((prev) => {
          const known = prev.includes(id);
          // Returning the SAME array when nothing changed is what keeps an
          // idle form from re-rendering on every widget mount.
          if (uploading === known) return prev;
          return uploading ? [...prev, id] : prev.filter((x) => x !== id);
        });
      },
    }),
    // Identity is a render-cost hint only (AGENTS.md #10): the updater is
    // functional, so a recomputed `sink` behaves identically.
    [],
  );

  const anyUploading = inFlight.length > 0;

  // Report this whole scope upward, and release it on unmount for the same
  // reason a widget releases itself: a nested form torn down mid-upload must
  // not wedge its parent's Save.
  React.useEffect(() => {
    outerRef.current?.report(scopeId, anyUploading);
  }, [anyUploading, scopeId]);
  React.useEffect(
    () => () => {
      outerRef.current?.report(scopeId, false);
    },
    [scopeId],
  );

  return { anyUploading, sink };
}

/**
 * Publish a host's {@link useUploadingScope} to every upload widget rendered
 * below it. Nesting is legal and CHAINS: an inner scope gates its own Save on
 * its own uploads AND reports itself to the scope above, so an outer Save whose
 * write encompasses the inner content is never blind to it. See
 * {@link useUploadingScope} for why the direction is not a preference.
 */
export function UploadingScopeProvider({
  scope,
  children,
}: {
  scope: UploadingScope;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <UploadingScopeSinkContext.Provider value={scope.sink}>
      {children}
    </UploadingScopeSinkContext.Provider>
  );
}

/**
 * Report this widget's in-flight state to the enclosing scope, if there is one.
 * Called by `useUploadingSignal` so every widget that already publishes to a
 * host prop publishes here too, from the same state.
 *
 * ⚠️ The unmount release is load-bearing, not tidiness. A widget removed while
 * its upload is in flight — a section collapsing, a tab switching, a subform
 * row deleted — would otherwise leave its id in the set with nothing left to
 * ever clear it, and the form's Save would stay disabled for the rest of the
 * session. That failure mode is worse than the defect this scope fixes,
 * because it has no user-visible cause at all.
 *
 * This report covers the widget's MOUNTED lifetime only. The upload's own
 * lifetime, which can outlast the widget, is covered by
 * {@link useUploadingScopeHold} — that is what keeps the release above from
 * also releasing an upload that is still running (objectui#10180).
 */
export function useUploadingScopeReport(uploading: boolean): void {
  const sink = React.useContext(UploadingScopeSinkContext);
  const id = React.useId();
  // Read through a ref so a provider that re-publishes its sink does not
  // re-run the report effect, and so the unmount cleanup below can stay
  // mount-scoped while still reaching the current sink.
  const sinkRef = React.useRef(sink);
  sinkRef.current = sink;

  React.useEffect(() => {
    sinkRef.current?.report(id, uploading);
  }, [uploading, id]);

  React.useEffect(
    () => () => {
      sinkRef.current?.report(id, false);
    },
    [id],
  );
}

/** Ids of upload holds; distinct from `useId` output, which is `:r…:`-shaped. */
let holdSequence = 0;

const releaseNothing = (): void => {};

/**
 * Hold the enclosing scope "uploading" for the lifetime of ONE upload
 * (objectui#10180). The returned `hold()` is called when an upload starts and
 * answers that upload's `release()`, to be called once its promise settles —
 * in a `finally`, so a failed upload releases too.
 *
 * ## Why this is separate from the mount-bound report
 *
 * {@link useUploadingScopeReport} has to release on unmount (see there), and
 * an upload keeps running after the widget that started it has unmounted —
 * `FileField` does not abort it, and its settle still reaches the form's
 * `onChange`. Leaving a wizard step mid-upload is exactly that: the step's
 * widgets unmount, their reports are released, and without this hold the
 * wizard's final gate read `false` while the file was still on its way, so a
 * Create pressed in that window wrote the record without it.
 *
 * ## Why this cannot wedge the form
 *
 * The entry is released by the upload's own settle, not by a render, so it is
 * cleared exactly when the upload ends, mounted widget or not. It can stay
 * held only as long as the upload itself stays unsettled — the same bound a
 * mounted widget's report already has — and while it is held the host shows
 * the reason it gives for any upload in flight.
 *
 * The sink is captured when the upload STARTS: the scope the user picked the
 * file under is the one whose save the file belongs to. A release that reaches
 * a scope whose host has since unmounted is a no-op, and that host already
 * released itself from any scope above it on the way out.
 *
 * Inert without a provider, like the report. Not exported from the package
 * entry: it is how this package's own upload widgets report, not a contract.
 */
export function useUploadingScopeHold(): () => () => void {
  const sink = React.useContext(UploadingScopeSinkContext);
  const sinkRef = React.useRef(sink);
  sinkRef.current = sink;
  return React.useCallback(() => {
    const target = sinkRef.current;
    if (!target) return releaseNothing;
    holdSequence += 1;
    const id = `upload-hold:${holdSequence}`;
    target.report(id, true);
    let released = false;
    return () => {
      // Idempotent, so a caller that releases on two paths cannot report an
      // unknown id's `false` twice — harmless today, but not worth relying on.
      if (released) return;
      released = true;
      target.report(id, false);
    };
  }, []);
}

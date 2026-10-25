/**
 * ObjectUI — @object-ui/react-runtime (ADR: kind:'react')
 *
 * Inlined, vendored react-runner (github.com/nihgwu/react-runner, MIT): transpile
 * a JSX/TSX source string with Sucrase, then eval it with an injected scope
 * (React, your registered components, page data) and render in the MAIN React
 * tree. NO sandbox — this is the *trusted* execution tier, gated to enterprise/
 * private deployments where authors are trusted. Inlined (not depended) so we
 * fully control the scope/imports surface and can lazy-load it behind a flag.
 */
import React, { Component, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { transform as sucrase } from 'sucrase';

export type Scope = Record<string, unknown>;

const normalizeCode = (code: string): string =>
  code.replace(/^(\s*)(<[^>]*>|function[(\s]|\(\)[\s=]|class\s)(.*)/, '$1export default $2$3');

/** Transpile JSX/TS → JS (classic runtime; imports → require). */
export const transform = (code: string): string =>
  sucrase(code, { transforms: ['jsx', 'typescript', 'imports'], production: true }).code.substring(13);

const createRequire =
  (imports: Scope = {}) =>
  (module: string): unknown => {
    if (!Object.prototype.hasOwnProperty.call(imports, module)) {
      throw new Error(`Module not found: '${module}' — provide it via the runtime scope.imports`);
    }
    return imports[module];
  };

const evalCode = (code: string, scope: Scope): unknown => {
  const { default: _d, import: imports, ...rest } = scope as Scope & { import?: Scope };
  const finalScope: Scope = { React, require: createRequire(imports), ...rest };
  const keys = Object.keys(finalScope);
  return new Function(...keys, code)(...keys.map((k) => finalScope[k]));
};

/**
 * Transpile + eval a source string into a React element.
 *
 * Returns null only for an empty source or an explicit `export default null`
 * ("render nothing"). Anything else that fails to produce a component THROWS —
 * `normalizeCode` only inserts the implicit `export default` when the source
 * STARTS with JSX / `function` / `()` / `class`, so the extremely common
 * `const Page = () => …` form exported nothing and used to render a blank page
 * with no error reported anywhere. ReactRunner catches these and shows them.
 */
export function generateElement(code: string, scope: Scope = {}): ReactElement | null {
  if (!code.trim()) return null;
  const exports: Scope = {};
  evalCode(transform(normalizeCode(code)), { render: (v: unknown) => (exports.default = v), ...scope, exports });
  const result = exports.default;
  if (result === undefined) {
    throw new Error(
      'The source exported nothing, so there is no component to render. End it with ' +
        '`export default <YourComponent>`, or start it with JSX, a `function` declaration, ' +
        'or a `class` — those get an implicit default export.',
    );
  }
  if (result === null) return null;
  if (isValidElement(result)) return result;
  if (typeof result === 'function') return createElement(result as React.ComponentType);
  throw new Error(
    `The source default-exported a ${typeof result}. Export a React component or an element.`,
  );
}

export interface ReactRunnerProps {
  code: string;
  scope?: Scope;
  /** rendered when the code throws at transpile/eval/render time */
  fallback?: (error: Error) => ReactNode;
  onError?: (error: Error) => void;
}

/** Marks "nothing compiled yet" — distinct from any real `code`/`scope` value. */
const UNSET = Symbol('unset');

interface ReactRunnerState {
  element: ReactElement | null;
  error: Error | null;
  /** The `code` the current `element`/`error` was produced from. */
  compiledCode: string | typeof UNSET;
  /** The `scope` (by identity) the current `element`/`error` was produced from. */
  compiledScope: Scope | undefined | typeof UNSET;
}

/** Renders a JSX/TSX source string with a built-in error boundary. */
export class ReactRunner extends Component<ReactRunnerProps, ReactRunnerState> {
  state: ReactRunnerState = { element: null, error: null, compiledCode: UNSET, compiledScope: UNSET };

  /**
   * Transpile + eval ONLY when `code` or the `scope` identity actually changed.
   *
   * Recompiling on every render broke this boundary three ways (objectui#2954):
   *   1. React runs this before the re-render that follows
   *      `getDerivedStateFromError`, and the old body unconditionally set
   *      `error: null` — so the error just caught was discarded, an identical
   *      throwing element was rebuilt, and the throw escaped PAST our own
   *      `fallback` to whatever boundary sits above us.
   *   2. `onError` was gated on an `error` that this had already cleared.
   *   3. Every eval mints a fresh `Page` function, so a new element *type* on
   *      each render remounts the page subtree and wipes its `useState`.
   */
  static getDerivedStateFromProps(
    props: ReactRunnerProps,
    state: ReactRunnerState,
  ): Partial<ReactRunnerState> | null {
    if (props.code === state.compiledCode && props.scope === state.compiledScope) return null;
    const compiled = { compiledCode: props.code, compiledScope: props.scope };
    try {
      return { ...compiled, element: generateElement(props.code, props.scope), error: null };
    } catch (error) {
      return { ...compiled, element: null, error: error as Error };
    }
  }
  static getDerivedStateFromError(error: Error): Partial<ReactRunnerState> {
    return { error };
  }
  componentDidMount(): void {
    // A transpile/eval error is already in state by the time we mount, and
    // `componentDidUpdate` never runs for the first render.
    if (this.state.error) this.props.onError?.(this.state.error);
  }
  componentDidUpdate(_prevProps: ReactRunnerProps, prevState: ReactRunnerState): void {
    // Report each error once, on the transition — the state now persists, so
    // firing on every subsequent render would repeat the same one forever.
    if (this.state.error && this.state.error !== prevState.error) this.props.onError?.(this.state.error);
  }
  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback
        ? this.props.fallback(this.state.error)
        : createElement('pre', { style: { color: 'crimson', padding: 16, whiteSpace: 'pre-wrap' } }, String(this.state.error));
    }
    return this.state.element;
  }
}

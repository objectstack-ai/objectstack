/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * JsonSourceEditor — Monaco-backed JSON editor for the metadata
 * designer's "Source" tab. Replaces the old textarea so power users
 * get syntax highlighting, bracket matching, folding, and inline
 * error squigglies driven by the server-side `_diagnostics` payload.
 *
 * Markers: `issues[]` use dotted (or array) JSON paths matching the
 * Zod issue shape. We resolve each path to a Monaco range with
 * `jsonc-parser` so the squiggle lands on the offending value (or
 * the property key when the value is absent). Unresolved paths fall
 * back to a marker on line 1, so nothing is silently lost.
 */

import React from 'react';
import { Skeleton } from '@object-ui/components';
import * as jsonc from 'jsonc-parser';
import { useMetadataLocale, t } from './i18n.js';
import { useMonacoFallback } from './useMonacoFallback.js';

// Lazy: Monaco's React wrapper itself pulls in the editor core
// (~3MB), so we keep it out of the initial app-shell chunk.
//
// The NAMED `Editor` export, not `default`: `@monaco-editor/react@4.7.0` is
// CommonJS and ships no `exports` map, so under this package's `nodenext`
// resolution the default is the module NAMESPACE rather than the component,
// and `React.lazy` rejects it (TS2345 — objectui#5440).
//
// It is the SAME component, not a near-enough substitute — checked in the
// installed 4.7.0 rather than assumed from the name. Its own typings alias one
// declaration to both spellings (`export { _default as Editor, ...,
// _default as default }`), and the two are identical at runtime in its CJS
// build and its ESM build alike. That is what makes this safe under `bundler`
// resolution too, which is what the console actually bundles with and where
// the previous spelling worked.
const LazyMonaco = React.lazy(async () => {
  const mod = await import('@monaco-editor/react');
  return { default: mod.Editor };
});

export interface JsonIssue {
  /** Dotted path (e.g. `fields.owner.type`) or empty for root. */
  path: string;
  message: string;
  /** Defaults to `'error'`. */
  severity?: 'error' | 'warning';
}

export interface JsonSourceEditorProps {
  value: unknown;
  onChange: (next: Record<string, unknown>) => void;
  readOnly?: boolean;
  issues?: JsonIssue[];
  /** Pixel or CSS-length height. Defaults to `60vh`. */
  height?: string | number;
  /** Grace period (ms) before the textarea fallback engages. Test-tunable. */
  fallbackDelayMs?: number;
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

/** Parse a dotted JSON path like `fields.owner.0.type` to segments. */
function splitPath(p: string): Array<string | number> {
  if (!p) return [];
  return p.split('.').map((seg) => {
    const n = Number(seg);
    return Number.isInteger(n) && String(n) === seg ? n : seg;
  });
}

export function JsonSourceEditor({
  value,
  onChange,
  readOnly,
  issues,
  height = '60vh',
  fallbackDelayMs = 4000,
}: JsonSourceEditorProps) {
  const locale = useMetadataLocale();
  const [text, setText] = React.useState<string>(() => stringify(value));
  const [parseError, setParseError] = React.useState<string | null>(null);
  const lastCommittedRef = React.useRef<string>(text);

  // Hold onto Monaco's editor + namespace so we can repaint markers
  // when either the source text or the issues prop changes.
  const editorRef = React.useRef<any>(null);
  const monacoRef = React.useRef<any>(null);

  // Monaco's core is fetched lazily and, by default, from a public CDN, and it
  // also spins up web workers. When any of that is blocked — offline /
  // air-gapped / CSP-restricted installs — the editor mounts an empty shell
  // with no error and the Source tab looks blank. `useMonacoFallback` fast-fails
  // to a plain textarea the moment the CDN loader rejects, and also backstops
  // the "resolved but painted nothing" case via a `.view-line` DOM poll, so the
  // source is always readable and editable. The editor mounts only once the
  // loader has resolved: mounted earlier, its own `loader.init()` on a failing
  // install logs an error and leaks an uncaught one (objectui#11800).
  const [monacoStatus, containerRef] = useMonacoFallback(fallbackDelayMs);

  // Match against the dark class our app-shell toggles on <html>; pick
  // a Monaco theme that doesn't fight the rest of the chrome.
  const [theme, setTheme] = React.useState<'vs-dark' | 'light'>(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light';
  });
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () =>
      setTheme(root.classList.contains('dark') ? 'vs-dark' : 'light');
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // Push markers from `issues` onto Monaco's model. We rebuild on
  // every relevant change rather than diffing — sweeping `setModelMarkers`
  // is cheap and avoids stale squigglies when issues drop off.
  const applyMarkers = React.useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    if (!issues || issues.length === 0) {
      monaco.editor.setModelMarkers(model, 'objectui-diagnostics', []);
      return;
    }

    let tree: jsonc.Node | undefined;
    try {
      tree = jsonc.parseTree(text);
    } catch {
      tree = undefined;
    }

    const markers = issues.map((iss) => {
      const segs = splitPath(iss.path);
      let startLine = 1;
      let startCol = 1;
      let endLine = 1;
      let endCol = 2;
      const node = tree ? jsonc.findNodeAtLocation(tree, segs) : undefined;
      if (node) {
        const start = model.getPositionAt(node.offset);
        const end = model.getPositionAt(node.offset + node.length);
        startLine = start.lineNumber;
        startCol = start.column;
        endLine = end.lineNumber;
        endCol = end.column;
      }
      const sev =
        iss.severity === 'warning'
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Error;
      return {
        severity: sev,
        message: iss.path ? `${iss.path}: ${iss.message}` : iss.message,
        startLineNumber: startLine,
        startColumn: startCol,
        endLineNumber: endLine,
        endColumn: endCol,
        source: 'metadata',
      };
    });
    monaco.editor.setModelMarkers(model, 'objectui-diagnostics', markers);
  }, [issues, text]);

  React.useEffect(() => {
    applyMarkers();
  }, [applyMarkers]);

  // Resync the buffer when the parent draft changes externally (Save,
  // Reset, inspector-driven patches). Only sync when the upstream
  // value differs from what we last committed so user keystrokes
  // aren't clobbered while typing.
  React.useEffect(() => {
    const next = stringify(value);
    if (next !== lastCommittedRef.current) {
      setText(next);
      lastCommittedRef.current = next;
      setParseError(null);
    }
  }, [value]);

  const handleChange = (next: string | undefined) => {
    const v = next ?? '';
    setText(v);
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setParseError(null);
        lastCommittedRef.current = v;
        onChange(parsed as Record<string, unknown>);
      } else {
        setParseError(t('engine.form.rootJsonObject', locale));
      }
    } catch (err: any) {
      setParseError(err?.message ?? t('engine.form.invalidJson', locale));
    }
  };

  const handleMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Defer one tick so the model has settled before the first paint.
    setTimeout(applyMarkers, 0);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        data-testid="source-editor"
        className="border rounded overflow-hidden bg-background"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        {monacoStatus === 'unavailable' ? (
          <textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            aria-label="JSON source"
            className="w-full h-full resize-none bg-background p-3 font-mono text-xs leading-relaxed outline-none"
          />
        ) : monacoStatus === 'loading' ? (
          <Skeleton className="w-full h-full" />
        ) : (
          <React.Suspense fallback={<Skeleton className="w-full h-full" />}>
            <LazyMonaco
              value={text}
              language="json"
              theme={theme}
              onChange={handleChange}
              onMount={handleMount}
              options={{
                readOnly,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                folding: true,
                wordWrap: 'on',
                tabSize: 2,
                renderLineHighlight: 'line',
                scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
              }}
            />
          </React.Suspense>
        )}
      </div>
      {parseError && (
        <div className="text-xs text-destructive flex items-start gap-1.5">
          <span aria-hidden>⚠</span>
          <span>{parseError}</span>
        </div>
      )}
    </div>
  );
}

export default JsonSourceEditor;

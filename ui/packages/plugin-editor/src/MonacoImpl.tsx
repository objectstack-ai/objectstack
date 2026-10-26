/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { configureBundledMonaco, isBundledMonacoLoaded } from './bundledMonaco';

export interface MonacoImplProps {
  value?: string;
  language?: string;
  theme?: 'vs-dark' | 'light';
  height?: string;
  onChange?: (value: string | undefined) => void;
  readOnly?: boolean;
  className?: string;
}

type MonacoStatus = 'loading' | 'ready' | 'unavailable';

/**
 * MonacoImpl - The heavy implementation that imports Monaco Editor
 * This component is lazy-loaded to avoid including Monaco in the initial bundle
 *
 * The editor mounts only once the bundled Monaco has been handed to the loader
 * (`bundledMonaco.ts`): mounted earlier, `<Editor>`'s own `loader.init()` would
 * fetch Monaco from the loader's default CDN instead. When the editor chunk
 * cannot be loaded, the same text is edited in a plain textarea rather than
 * behind a "Loading..." that never ends.
 */
export default function MonacoImpl({
  value = '',
  language = 'javascript',
  theme = 'vs-dark',
  height = '400px',
  onChange,
  readOnly = false,
  className = '',
}: MonacoImplProps) {
  const [status, setStatus] = React.useState<MonacoStatus>(() =>
    isBundledMonacoLoaded() ? 'ready' : 'loading',
  );

  React.useEffect(() => {
    let cancelled = false;
    configureBundledMonaco(loader).then(
      () => {
        if (!cancelled) setStatus('ready');
      },
      (reason: unknown) => {
        if (cancelled) return;
        console.warn(
          `Monaco editor unavailable: ${reason instanceof Error ? reason.message : String(reason)}. The code editor falls back to a plain textarea.`,
        );
        setStatus('unavailable');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'unavailable') {
    return (
      <div className={className}>
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          aria-label={`${language} source`}
          style={{ height }}
          className="block w-full resize-y bg-background p-3 font-mono text-sm leading-relaxed outline-none"
        />
      </div>
    );
  }

  if (status === 'loading') {
    return <div className={className} style={{ height }} aria-busy="true" />;
  }

  return (
    <div className={className}>
      <Editor
        height={height}
        language={language}
        theme={theme}
        value={value}
        onChange={onChange}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
      />
    </div>
  );
}

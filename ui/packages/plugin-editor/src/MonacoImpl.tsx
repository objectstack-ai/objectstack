/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Editor from '@monaco-editor/react';

export interface MonacoImplProps {
  value?: string;
  language?: string;
  theme?: 'vs-dark' | 'light';
  height?: string;
  onChange?: (value: string | undefined) => void;
  readOnly?: boolean;
  className?: string;
}

/**
 * MonacoImpl - The heavy implementation that imports Monaco Editor
 * This component is lazy-loaded to avoid including Monaco in the initial bundle
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

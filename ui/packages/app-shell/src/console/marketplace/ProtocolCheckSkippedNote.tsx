// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { AlertTriangle } from 'lucide-react';

/**
 * The install result's caution line for an answer that carries
 * `protocolCheckSkipped` (objectstack#30326): drawn inside the install result
 * note, under its own sentence, in a caution colour of its own, because the
 * install succeeded and the note around it says so. `text` is the sentence
 * from {@link import('./protocolCheckSkipped.js').protocolCheckSkippedText}.
 */
export function ProtocolCheckSkippedNote({ text, className }: { text: string; className?: string }) {
  return (
    <p
      data-testid="protocol-check-skipped"
      className={`mt-2 flex items-start gap-1.5 whitespace-normal text-amber-700 dark:text-amber-400 ${className ?? ''}`}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { splitRefusal } from '../utils/refusalLead.js';

/**
 * A refused write's message: its first plain sentence, and the whole message
 * behind "More" (objectui#13332).
 *
 * The caller keeps its own box — the colours, the `role="alert"`, the test id
 * — and puts this inside it, so every surface that shows a server refusal
 * reads the same way: one sentence first, the code, the field path and the
 * rest of the server's text one click away, selectable and copyable as sent.
 * See {@link splitRefusal} for how the sentence is found. A message that is a
 * single sentence renders as it always did, with no disclosure.
 */
export function RefusalMessage({ text, className }: { text: string; className?: string }) {
  const { t } = useObjectTranslation();
  const { lead, full } = splitRefusal(text);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  // Nothing to disclose: the text alone, with no wrapper, so the caller's box
  // reads exactly as it did before this component existed.
  if (full === null) return <>{lead}</>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
    } catch {
      // Denied or unavailable: the text is on screen and selectable.
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('min-w-0', className)}>
      <span data-testid="refusal-lead">{lead}</span>{' '}
      <CollapsibleTrigger
        className="group inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100"
        data-testid="refusal-more"
      >
        {open ? t('refusalDetails.less') : t('refusalDetails.more')}
        <ChevronDown
          className="size-3 transition-transform group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex items-start gap-1 rounded border border-destructive/30 bg-background/60 p-2">
          <pre
            data-testid="refusal-detail"
            className="min-w-0 flex-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs select-text"
          >
            {full}
          </pre>
          <button
            type="button"
            onClick={() => { void copy(); }}
            aria-label={copied ? t('refusalDetails.copied') : t('refusalDetails.copy')}
            title={copied ? t('refusalDetails.copied') : t('refusalDetails.copy')}
            className="shrink-0 rounded p-1 opacity-80 hover:bg-destructive/10 hover:opacity-100"
            data-testid="refusal-copy"
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

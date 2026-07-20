import { describe, expect, it } from 'vitest';
import { defineStack } from './stack.zod';

// framework#3265/#3308 — defineStack validates `requires` tokens against the
// platform capability vocabulary at the PRODUCER (authoring time): an unknown
// token is a hard error (no runtime provides it → declared ≠ enforced). The
// deprecated `aiStudio`/`aiSeat` aliases were removed in #3308, so those now
// reject like any other typo — there is no canonicalization step left.

describe('defineStack requires validation (#3265/#3308)', () => {
  it('canonical declarations pass through untouched', () => {
    const stack = defineStack({ requires: ['ai', 'ai-studio', 'ai-seat', 'hierarchy-security', 'governance'] });
    expect(stack.requires).toEqual(['ai', 'ai-studio', 'ai-seat', 'hierarchy-security', 'governance']);
  });

  it('THROWS on an unknown token (a typo no runtime provides), naming it', () => {
    expect(() => defineStack({ requires: ['automations'] })).toThrowError(
      /capability validation failed[\s\S]*'automations' is not a known platform capability/,
    );
  });

  it('the removed camelCase aliases now REJECT like any other unknown token (#3308)', () => {
    expect(() => defineStack({ requires: ['aiStudio'] })).toThrowError(
      /'aiStudio' is not a known platform capability/,
    );
    expect(() => defineStack({ requires: ['aiSeat'] })).toThrowError(
      /'aiSeat' is not a known platform capability/,
    );
  });

  it('reports every distinct unknown token but not known ones', () => {
    let msg = '';
    try {
      defineStack({ requires: ['ai', 'automations', 'analytiks', 'ai'] });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain("'automations'");
    expect(msg).toContain("'analytiks'");
    expect(msg).toContain('(2 issues)');
    expect(msg).not.toContain("'ai' is not"); // known token isn't flagged
  });

  it('non-strict mode skips validation by contract (unknown token passes through)', () => {
    const stack = defineStack({ requires: ['aiStudio'] }, { strict: false });
    expect(stack.requires).toEqual(['aiStudio']);
  });
});

import { describe, expect, it } from 'vitest';
import { parseVerdict } from '../adapters/ai-verify';

// Adapter test (copied in only with --adapter ai-verify). Exercises the strict judge-reply parse.

describe('parseVerdict', () => {
  it('parses a plain JSON object', () => {
    const v = parseVerdict('{"claims":[{"claim":"a","supported":true},{"claim":"b","supported":false,"reason":"not in sources"}]}');
    expect(v.claims).toHaveLength(2);
    expect(v.claims[1]).toMatchObject({ supported: false, reason: 'not in sources' });
  });

  it('tolerates a ```json fence and surrounding prose', () => {
    const v = parseVerdict('Here is my assessment:\n```json\n{"claims":[{"claim":"x","supported":true}]}\n```\nDone.');
    expect(v.claims[0]).toMatchObject({ claim: 'x', supported: true });
  });

  it('treats any non-true "supported" as unsupported (fail-safe)', () => {
    const v = parseVerdict('{"claims":[{"claim":"a","supported":"yes"},{"claim":"b","supported":1}]}');
    expect(v.claims.every((c) => c.supported === false)).toBe(true);
  });

  it('throws on a reply with no JSON object or no claims array (→ loop treats as unverified)', () => {
    expect(() => parseVerdict('I think it looks fine honestly')).toThrow(/no JSON/);
    expect(() => parseVerdict('{"verdict":"ok"}')).toThrow(/claims array/);
  });
});

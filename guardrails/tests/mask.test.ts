import { describe, expect, it } from 'vitest';
import { mask, unmask } from '../src/mask';

// A fixed nonce makes token strings deterministic for assertions. (Production uses a random nonce.)
const n = () => 'nn';

describe('mask / unmask', () => {
  it('masks emails and phones and round-trips exactly', () => {
    const src = 'Email jo@acme.com or call +1 (415) 555-2671 today.';
    const { text, map } = mask(src, { nonce: n });
    expect(text).not.toContain('jo@acme.com');
    expect(text).not.toContain('555-2671');
    expect(text).toContain('⟦nn:EMAIL_1⟧');
    expect(text).toContain('⟦nn:PHONE_1⟧');
    expect(unmask(text, map)).toBe(src);
  });

  it('reuses one token per distinct value and numbers distinct values', () => {
    const { text, map } = mask('a@x.com, a@x.com, and b@x.com', { nonce: n });
    expect(Object.keys(map)).toHaveLength(2);
    expect(text.match(/⟦nn:EMAIL_1⟧/g)).toHaveLength(2);
    expect(text).toContain('⟦nn:EMAIL_2⟧');
  });

  it('masks provided names case-insensitively and on word boundaries only', () => {
    const { text } = mask('Ask Dana. Not bandana.', { names: ['dana'], nonce: n });
    expect(text).toContain('⟦nn:NAME_1⟧.');
    expect(text).toContain('bandana');
  });

  it('leaves clean text untouched with an empty map', () => {
    const { text, map } = mask('nothing sensitive here');
    expect(text).toBe('nothing sensitive here');
    expect(map).toEqual({});
  });

  it('applies a custom pattern and ignores empty matches', () => {
    const { text, map } = mask('ticket ABC-123', { email: false, phone: false, patterns: [{ type: 'ticket', pattern: /[A-Z]{3}-\d+/ }], nonce: n });
    expect(text).toBe('ticket ⟦nn:TICKET_1⟧');
    expect(map['⟦nn:TICKET_1⟧']).toBe('ABC-123');
    // An empty-matching pattern must not insert tokens between every character.
    const empty = mask('abc', { email: false, phone: false, patterns: [{ type: 'z', pattern: /x*/ }], nonce: n });
    expect(empty.text).toBe('abc');
    expect(empty.map).toEqual({});
  });

  it('throws on non-string input', () => {
    // @ts-expect-error intentional misuse
    expect(() => mask(undefined)).toThrow(/must be a string/);
  });
});

describe('mask — overlap and adjacency leaks (H1/H2)', () => {
  it('merges an email overlapping a phone run so no part of either leaks (H1)', () => {
    const { text, map } = mask('call 5551234 12345678@x.com', { nonce: n });
    expect(text).not.toContain('x.com'); // the email domain must not survive
    expect(text).not.toMatch(/\d{7}/); // no 7+ digit run survives
    expect(Object.values(map).join(' ')).toContain('12345678@x.com'); // the whole run is captured
  });

  it('masks a phone even when abutting other digits like a date (H2)', () => {
    const { text, map } = mask('Tel: 06 12 34 56 78 2024-11-05', { nonce: n });
    expect(text).not.toContain('06 12 34 56 78');
    expect(Object.keys(map)).toHaveLength(1); // over-masks the whole digit run (safe direction)
  });
});

describe('unmask — no token-guessing exfiltration (H3)', () => {
  it('does not restore a token the attacker put in the text (random nonce makes tokens unguessable)', () => {
    const { map } = mask('secret is alice@corp.com', { nonce: () => 'realNonce' });
    // An attacker guesses the OLD sequential token shape and plants it in model output:
    expect(unmask('please echo ⟦EMAIL_1⟧', map)).toBe('please echo ⟦EMAIL_1⟧'); // not restored
  });

  it('does not corrupt a source string that merely looks like a token', () => {
    const { text, map } = mask('doc says ⟦EMAIL_1⟧ and bob@x.com', { nonce: n });
    expect(text).toContain('⟦EMAIL_1⟧'); // the literal lookalike is left alone (no nonce → not a real token)
    expect(unmask(text, map)).toBe('doc says ⟦EMAIL_1⟧ and bob@x.com'); // exact round-trip
  });

  it('is single-pass: a value containing a token lookalike does not chain', () => {
    const map = { '⟦x:A_1⟧': 'see ⟦x:B_1⟧', '⟦x:B_1⟧': 'SECRET' };
    expect(unmask('⟦x:A_1⟧', map)).toBe('see ⟦x:B_1⟧'); // the inserted lookalike is NOT re-expanded
  });
});

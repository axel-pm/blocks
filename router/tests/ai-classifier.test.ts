import { describe, expect, it } from 'vitest';
import { matchReplyToTier } from '../adapters/ai-classifier';

// Adapter test (copied in only with --adapter ai-classifier). Exercises the strict reply parse that
// stops a chatty or substring-y model reply from being mis-mapped to the wrong tier (H1).

describe('matchReplyToTier', () => {
  const tiers = ['light', 'lightweight', 'deep'] as const;

  it('matches a whole-token reply, not a prefix, and strips decoration', () => {
    expect(matchReplyToTier('light', tiers)).toBe('light');
    expect(matchReplyToTier('Lightweight.', tiers)).toBe('lightweight'); // not "light"
    expect(matchReplyToTier('**lightweight**', tiers)).toBe('lightweight');
    expect(matchReplyToTier('Tier: deep', tiers)).toBe('deep');
    expect(matchReplyToTier('"LIGHT"', tiers)).toBe('light');
  });

  it('declines (null) when the reply names zero or more than one distinct tier', () => {
    expect(matchReplyToTier('deep or light', tiers)).toBeNull();
    expect(matchReplyToTier('not deep, light', tiers)).toBeNull();
    expect(matchReplyToTier('', tiers)).toBeNull();
    expect(matchReplyToTier('I would refuse to answer', tiers)).toBeNull();
  });

  it('does not match a tier name embedded in an ordinary word', () => {
    expect(matchReplyToTier('banana', ['a', 'b'] as const)).toBeNull(); // "a" is not a standalone token
    expect(matchReplyToTier("I can't tell how deep this is", ['standard', 'deep'] as const)).toBe('deep'); // "deep" IS a token here
  });
});

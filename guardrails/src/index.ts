// Public surface of the guardrails block's pure core. Copy `src/` in, import from here.
export type { CapStore, CapVerdict, MaskOptions, MaskResult, PiiPattern, PiiSpan } from './types';
export { mask, unmask } from './mask';
export { createSpendCap, evaluate } from './cap';
export type { SpendCap, SpendCapConfig } from './cap';
export { fenceText, looksInjected, systemRule, SYSTEM_RULE } from './untrusted';
export type { FenceOptions } from './untrusted';

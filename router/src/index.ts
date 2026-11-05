// Public surface of the router block's pure core. Copy `src/` in, import from here.
export type { Classifier, RouteResult, RouteVia, Rule, RouterConfig } from './types';
export { createRouter } from './router';
export type { Router } from './router';
export { byContext, byKeywords, byMaxLength, byMinLength } from './heuristics';

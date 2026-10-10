/**
 * JARVIS-X is completely free: one plan, every feature included, no limits.
 *
 * This module keeps the small API the rest of the app was written against
 * (can / limit / rank) so features stay simple: everything is allowed.
 * @module core/plans
 */

export const PLAN = { id: 'free', name: 'Free', tagline: 'Every feature included — no plans, no payments, no limits' };
export const PLANS = { free: PLAN };

export const can = () => true;
export const limit = () => Infinity;
export const rank = () => 0;
export const requiredPlan = () => 'free';

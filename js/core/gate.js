/**
 * Feature access. JARVIS-X has a single free plan with every feature, so
 * every check passes. The functions remain as no-ops so modules can call
 * them without caring about plans.
 * @module core/gate
 */
export const planBadge = () => null;
export const featureBadge = () => null;
export const allowed = () => true;
export const planLimit = () => Infinity;
export const gate = () => true;
export const upgradePrompt = () => {};
export const lockOverlay = (el) => el;
export const withinLimit = () => true;

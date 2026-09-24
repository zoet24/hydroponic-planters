/**
 * Build-time feature flags.
 *
 * The AI preset builder is paused. Rather than leave two buttons that lead
 * nowhere, the entry points are hidden behind this flag — flip it in `.env`
 * when the screen exists:
 *
 *   VITE_AI_PRESETS=true
 */
export const AI_PRESETS_ENABLED = import.meta.env.VITE_AI_PRESETS === 'true';

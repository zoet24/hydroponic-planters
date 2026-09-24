import raw from './data/builtin-presets.json' with { type: 'json' };
import { Preset, type Preset as PresetType } from './preset';

/**
 * Built-in presets, authored as JSON so they can be edited without touching code.
 *
 * They are validated against the full `Preset` schema — cross-field rules and all
 * — at module load, so a bad edit fails fast and loudly rather than reaching a
 * pump. Built-ins are never passed through `clampToSafety`: if one needs
 * clamping, it is wrong and should be fixed here.
 *
 * Values are starting points to tune on the real tower, not findings.
 */
export const BUILTIN_PRESETS: readonly PresetType[] = Object.freeze(
  raw.map((entry, i) => {
    const parsed = Preset.safeParse(entry);
    if (!parsed.success) {
      const id = (entry as { id?: string }).id ?? `index ${i}`;
      throw new Error(
        `Built-in preset "${id}" fails the safety schema: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    return parsed.data;
  }),
);

export const BUILTIN_PRESET_IDS: readonly string[] = Object.freeze(BUILTIN_PRESETS.map((p) => p.id));

export function findBuiltinPreset(id: string): PresetType | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}

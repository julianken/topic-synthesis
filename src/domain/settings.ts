export type Level = 'intro' | 'intermediate' | 'advanced';

export interface Settings {
  level: Level;
  /** Breadth/depth knob, 1 (shallow) .. 5 (deep). */
  depth: number;
  /** Free-form audience descriptor, e.g. "high-school", "self-taught dev". */
  audience: string;
}

export type SettingsBucket = string;

/**
 * Coarsen settings into a bucket key. Page sharing (a later config change) keys
 * on (concept, settingsBucket), so the bucket is deliberately lossy — many
 * nearby settings collapse to one bucket so a generated page can be reused. v1
 * buckets on level + a clamped depth band; audience is intentionally excluded
 * (too sparse to ever share on).
 */
export function bucketize(settings: Settings): SettingsBucket {
  return `${settings.level}:d${clampDepth(settings.depth)}`;
}

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return 3;
  return Math.min(5, Math.max(1, Math.round(depth)));
}

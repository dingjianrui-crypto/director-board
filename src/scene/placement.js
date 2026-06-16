import { DEFAULT_PLACEMENT_MAX_SLOPE_DEGREES } from "./constants.js";

export function isSurfacePlaceable(
  normal,
  maxSlopeDegrees = DEFAULT_PLACEMENT_MAX_SLOPE_DEGREES,
) {
  const normalized = normalizeVector(normal);
  const dotWithUp = clamp(normalized.y, -1, 1);
  const angleDegrees = (Math.acos(dotWithUp) * 180) / Math.PI;

  return angleDegrees <= maxSlopeDegrees;
}

function normalizeVector(vector) {
  const x = Number(vector?.x ?? vector?.[0] ?? 0);
  const y = Number(vector?.y ?? vector?.[1] ?? 0);
  const z = Number(vector?.z ?? vector?.[2] ?? 0);
  const length = Math.hypot(x, y, z);

  if (length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: x / length,
    y: y / length,
    z: z / length,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

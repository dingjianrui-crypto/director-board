export const DEFAULT_MAX_SCENE_FILE_SIZE_BYTES = 200 * 1024 * 1024;
export const DEFAULT_PLACEMENT_MAX_SLOPE_DEGREES = 35;

export const SPLAT_FILE_TYPES = new Set([
  "ply",
  "spz",
  "splat",
  "ksplat",
  "sog",
  "zip",
  "rad",
]);

export const COLLISION_FILE_TYPES = new Set(["glb", "gltf", "obj"]);

export const DEFAULT_SCENE_TRANSFORM = Object.freeze({
  position: Object.freeze([0, 0, 0]),
  rotation: Object.freeze([0, 0, 0]),
  scale: 1,
});

export const DEFAULT_SCENE_WORLD_SETTINGS = Object.freeze({
  visible: true,
  opacity: 1,
  renderMode: "auto",
  collision: Object.freeze({
    visibleInEditor: false,
    displayMode: "hidden",
  }),
});

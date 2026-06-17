import {
  DEFAULT_SCENE_TRANSFORM,
  DEFAULT_SCENE_WORLD_SETTINGS,
} from "./constants.js";

export function createSceneFromAssets(assets, options = {}) {
  if (!assets || typeof assets.id !== "string") {
    throw new TypeError("Valid scene assets are required.");
  }

  const sceneId = options.id ?? createId("scene");
  const sceneName = options.name ?? `Scene ${sceneId}`;

  return {
    id: sceneId,
    name: sceneName,
    slug: options.slug ?? "NEW SCENE",
    origin: options.origin ?? "user",
    builtInId: options.builtInId,
    assets: cloneSceneAssets(assets),
    world: createSceneWorld(assets),
    objects: [],
    cameras: [],
    shots: [],
  };
}

export function createSceneWorld(assets) {
  return {
    transform: cloneTransform(
      assets.defaults?.transform ?? DEFAULT_SCENE_TRANSFORM,
    ),
    visible:
      assets.source !== "blank" &&
      (assets.defaults?.visible ?? DEFAULT_SCENE_WORLD_SETTINGS.visible),
    opacity: assets.defaults?.opacity ?? DEFAULT_SCENE_WORLD_SETTINGS.opacity,
    renderMode:
      assets.defaults?.renderMode ?? DEFAULT_SCENE_WORLD_SETTINGS.renderMode,
    gridY: assets.defaults?.gridY,
    collision: {
      visibleInEditor:
        assets.defaults?.collision?.visibleInEditor ??
        DEFAULT_SCENE_WORLD_SETTINGS.collision.visibleInEditor,
      displayMode:
        assets.defaults?.collision?.displayMode ??
        DEFAULT_SCENE_WORLD_SETTINGS.collision.displayMode,
    },
  };
}

export function updateSceneWorldSettings(scene, settings) {
  return {
    ...scene,
    world: {
      ...scene.world,
      ...settings,
      transform: settings?.transform
        ? cloneTransform(settings.transform)
        : scene.world.transform,
      collision: settings?.collision
        ? { ...scene.world.collision, ...settings.collision }
        : scene.world.collision,
    },
  };
}

export function cloneSceneAssets(assets) {
  return {
    ...assets,
    splat: assets.splat ? { ...assets.splat } : undefined,
    collision: assets.collision ? { ...assets.collision } : undefined,
    defaults: assets.defaults
      ? {
          ...assets.defaults,
          transform: assets.defaults.transform
            ? cloneTransform(assets.defaults.transform)
            : undefined,
          viewpoint: assets.defaults.viewpoint
            ? {
                eye: [...assets.defaults.viewpoint.eye],
                target: [...assets.defaults.viewpoint.target],
              }
            : undefined,
          splatTransform: assets.defaults.splatTransform
            ? {
                ...assets.defaults.splatTransform,
                axes: assets.defaults.splatTransform.axes
                  ? [...assets.defaults.splatTransform.axes]
                  : undefined,
              }
            : undefined,
          collision: assets.defaults.collision
            ? { ...assets.defaults.collision }
            : undefined,
        }
      : undefined,
  };
}

function cloneTransform(transform) {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: transform.scale,
  };
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

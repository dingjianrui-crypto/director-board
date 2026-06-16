import {
  DEFAULT_ENVIRONMENT_TRANSFORM,
  DEFAULT_SCENE_ENVIRONMENT_SETTINGS,
} from "./constants.js";

export function createSceneFromEnvironmentTemplate(template, options = {}) {
  if (!template || typeof template.id !== "string") {
    throw new TypeError("A valid environment template is required.");
  }

  const sceneId = options.id ?? createId("scene");
  const sceneName = options.name ?? `Scene ${sceneId}`;

  return {
    id: sceneId,
    name: sceneName,
    environment: createSceneEnvironmentInstance(template),
    characters: [],
    props: [],
    cameras: [],
    shots: [],
    board: {},
  };
}

export function createSceneEnvironmentInstance(template) {
  return {
    templateId: template.id,
    transform: cloneTransform(
      template.defaults?.transform ?? DEFAULT_ENVIRONMENT_TRANSFORM,
    ),
    visible: template.defaults?.visible ?? DEFAULT_SCENE_ENVIRONMENT_SETTINGS.visible,
    opacity: template.defaults?.opacity ?? DEFAULT_SCENE_ENVIRONMENT_SETTINGS.opacity,
    renderMode:
      template.defaults?.renderMode ?? DEFAULT_SCENE_ENVIRONMENT_SETTINGS.renderMode,
    collision: {
      visibleInEditor:
        template.defaults?.collision?.visibleInEditor ??
        DEFAULT_SCENE_ENVIRONMENT_SETTINGS.collision.visibleInEditor,
      displayMode:
        template.defaults?.collision?.displayMode ??
        DEFAULT_SCENE_ENVIRONMENT_SETTINGS.collision.displayMode,
    },
  };
}

export function updateSceneEnvironmentSettings(scene, settings) {
  if (settings && Object.hasOwn(settings, "templateId")) {
    throw new Error("A scene's environment template cannot be changed.");
  }

  return {
    ...scene,
    environment: {
      ...scene.environment,
      ...settings,
      transform: settings?.transform
        ? cloneTransform(settings.transform)
        : scene.environment.transform,
      collision: settings?.collision
        ? { ...scene.environment.collision, ...settings.collision }
        : scene.environment.collision,
    },
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

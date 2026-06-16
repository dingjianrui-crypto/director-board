import type {
  BoardObject,
  DirectorCamera,
  DirectorScene,
  SceneAssets,
  SceneTransform,
  Shot,
} from "./types";

export const DEFAULT_SCENE_TRANSFORM: SceneTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
};

export const blankSceneAssets: SceneAssets = {
  id: "assets-blank",
  name: "Blank",
  source: "blank",
};

export const starterSceneAssets: SceneAssets = {
  id: "assets-starter-procedural",
  name: "Starter Blockout",
  source: "procedural",
  defaults: {
    viewpoint: {
      eye: [4.2124, 3.5025, 10.1708],
      target: [0.0000, 1.4800, 1.0000],
    },
  },
};

export const starterObjects: BoardObject[] = [
  {
    id: "obj-maya",
    name: "Actor1",
    kind: "character",
    model: "standing",
    color: "#d86b4d",
    position: [-1.8, 0, 0.2],
    rotationY: 0.25,
    scale: 1,
  },
  {
    id: "obj-dan",
    name: "Actor2",
    kind: "character",
    model: "seated",
    color: "#2f84d7",
    position: [0.95, 0, -0.05],
    rotationY: -0.35,
    scale: 1,
  },
  {
    id: "obj-actor-3",
    name: "Actor 3",
    kind: "character",
    model: "standing",
    color: "#4db6a2",
    position: [1.55, 0, -0.35],
    rotationY: -0.1,
    scale: 1,
  },
  {
    id: "obj-actor-4",
    name: "Actor 4",
    kind: "character",
    model: "standing",
    color: "#b38a52",
    position: [2.35, 0, 0.05],
    rotationY: 0.15,
    scale: 1,
  },
  {
    id: "prop-table",
    name: "Kitchen Table",
    kind: "prop",
    model: "table",
    color: "#a8673f",
    position: [-0.15, 0, 0.55],
    rotationY: 0,
    scale: 1,
  },
  {
    id: "prop-chair-1",
    name: "Chair 1",
    kind: "prop",
    model: "chair",
    color: "#b78b60",
    position: [-0.85, 0, 1.08],
    rotationY: 0,
    scale: 1,
  },
  {
    id: "prop-chair-2",
    name: "Chair 2",
    kind: "prop",
    model: "chair",
    color: "#b78b60",
    position: [0.95, 0, 1.05],
    rotationY: Math.PI,
    scale: 1,
  },
  {
    id: "prop-counter",
    name: "Counter",
    kind: "prop",
    model: "counter",
    color: "#d7dce0",
    position: [-2.65, 0, -0.35],
    rotationY: 0,
    scale: 1,
  },
];

export const starterCameras: DirectorCamera[] = [
  {
    id: "cam-a",
    name: "camera-1",
    lens: 28,
    position: [3.7, 1.2, 2.8],
    lookAt: [0.3, 1, 0.25],
    roll: 0,
    frame: "MCU",
  },
  {
    id: "cam-b",
    name: "camera-2",
    lens: 38,
    position: [1.25, 2.35, 4.2],
    lookAt: [-0.6, 1, 0.3],
    roll: 0,
    frame: "MS",
  },
  {
    id: "cam-c",
    name: "camera-3",
    lens: 65,
    position: [-3.6, 1.35, 1.75],
    lookAt: [0.45, 1, 0.45],
    roll: 0,
    frame: "CU",
  },
];

export const starterShot: Shot = {
  id: "shot-1",
  name: "Shot 1",
  cameraId: "cam-a",
  lens: 28,
  frame: "MCU",
  duration: "4s",
};

export function createBlankDraftScene(): DirectorScene {
  return {
    id: "scene-draft",
    name: "Untitled Scene",
    slug: "NEW SCENE",
    origin: "draft",
    assets: cloneSceneAssets(blankSceneAssets),
    world: createSceneWorld(blankSceneAssets),
    objects: [],
    cameras: [],
    shots: [],
  };
}

export function createStarterScene(): DirectorScene {
  return {
    id: "scene-starter",
    name: "Starter Scene",
    slug: "INT. KITCHEN - NIGHT",
    origin: "built-in",
    builtInId: "starter",
    assets: cloneSceneAssets(starterSceneAssets),
    world: createSceneWorld(starterSceneAssets),
    objects: starterObjects.map((object) => ({ ...object, position: [...object.position] })),
    cameras: starterCameras.map((camera) => ({
      ...camera,
      position: [...camera.position],
      lookAt: [...camera.lookAt],
    })),
    shots: [starterShot],
  };
}

export function createSceneWorld(assets: SceneAssets): DirectorScene["world"] {
  const transform = assets.defaults?.transform ?? DEFAULT_SCENE_TRANSFORM;

  return {
    transform: cloneTransform(transform),
    visible: assets.source !== "blank" && (assets.defaults?.visible ?? true),
    opacity: assets.defaults?.opacity ?? 1,
    renderMode: assets.defaults?.renderMode ?? "auto",
    gridY: assets.defaults?.gridY,
    collision: {
      visibleInEditor: assets.defaults?.collision?.visibleInEditor ?? false,
      displayMode: assets.defaults?.collision?.displayMode ?? "hidden",
    },
  };
}

export function cloneSceneAssets(assets: SceneAssets): SceneAssets {
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
          collision: assets.defaults.collision
            ? { ...assets.defaults.collision }
            : undefined,
        }
      : undefined,
  };
}

function cloneTransform(transform: SceneTransform): SceneTransform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: transform.scale,
  };
}

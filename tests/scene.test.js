import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_SCENE_FILE_SIZE_BYTES,
  SceneManifestError,
  SceneValidationError,
  createSceneFromAssets,
  formatCameraName,
  getCameraBookmarkStorageKey,
  isSurfacePlaceable,
  parseBuiltInSceneManifest,
  updateSceneWorldSettings,
  validateSceneImportFolder,
} from "../src/scene/index.js";

const validManifest = [
  {
    id: "kitchen",
    name: "Kitchen",
    splat: {
      path: "/assets/environments/kitchen/scene.spz",
      sizeBytes: 123,
      fileType: "spz",
    },
    collision: {
      path: "/assets/environments/kitchen/collision.glb",
      sizeBytes: 456,
      fileType: "glb",
    },
  },
];

test("parses built-in scene manifest entries", () => {
  const assets = parseBuiltInSceneManifest(validManifest);

  assert.deepEqual(assets, [
    {
      id: "kitchen",
      name: "Kitchen",
      source: "built-in",
      splat: {
        path: "/assets/environments/kitchen/scene.spz",
        sizeBytes: 123,
        fileType: "spz",
      },
      collision: {
        path: "/assets/environments/kitchen/collision.glb",
        sizeBytes: 456,
        fileType: "glb",
      },
      defaults: undefined,
    },
  ]);
});

test("parses built-in scene viewpoint defaults", () => {
  const assets = parseBuiltInSceneManifest([
    {
      ...validManifest[0],
      defaults: {
        viewpoint: {
          eye: [-1.9057, -0.1362, 9.4594],
          target: [-1.5351, -0.1019, 8.5312],
        },
      },
    },
  ]);

  assert.deepEqual(assets[0].defaults, {
    viewpoint: {
      eye: [-1.9057, -0.1362, 9.4594],
      target: [-1.5351, -0.1019, 8.5312],
    },
  });
});

test("parses built-in scene splat transform defaults", () => {
  const assets = parseBuiltInSceneManifest([
    {
      ...validManifest[0],
      defaults: {
        entityScale: 1.25,
        splatTransform: {
          axes: [1, 1, 1],
          scale: 3,
        },
      },
    },
  ]);

  assert.deepEqual(assets[0].defaults, {
    entityScale: 1.25,
    splatTransform: {
      axes: [1, 1, 1],
      scale: 3,
    },
  });
});

test("rejects invalid built-in scene viewpoint defaults", () => {
  assert.throws(
    () =>
      parseBuiltInSceneManifest([
        {
          ...validManifest[0],
          defaults: {
            viewpoint: {
              eye: [-1.9057, -0.1362],
              target: [-1.5351, -0.1019, 8.5312],
            },
          },
        },
      ]),
    (error) =>
      error instanceof SceneManifestError &&
      error.code === "invalid-defaults" &&
      error.details.fieldName === "defaults.viewpoint.eye",
  );
});

test("rejects invalid built-in scene splat transform defaults", () => {
  assert.throws(
    () =>
      parseBuiltInSceneManifest([
        {
          ...validManifest[0],
          defaults: {
            splatTransform: {
              axes: [1, 0, 1],
            },
          },
        },
      ]),
    (error) =>
      error instanceof SceneManifestError &&
      error.code === "invalid-defaults" &&
      error.details.fieldName === "defaults.splatTransform.axes",
  );
});

test("rejects invalid built-in scene entity scale defaults", () => {
  assert.throws(
    () =>
      parseBuiltInSceneManifest([
        {
          ...validManifest[0],
          defaults: {
            entityScale: 0,
          },
        },
      ]),
    (error) =>
      error instanceof SceneManifestError &&
      error.code === "invalid-defaults" &&
      error.details.fieldName === "defaults.entityScale",
  );
});

test("rejects duplicate built-in scene ids", () => {
  assert.throws(
    () => parseBuiltInSceneManifest([...validManifest, ...validManifest]),
    (error) =>
      error instanceof SceneManifestError &&
      error.code === "duplicate-scene-id",
  );
});

test("validates an imported scene folder with one splat and one mesh", () => {
  const result = validateSceneImportFolder([
    { name: "scene.spz", size: 100 },
    { name: "collision.glb", size: 200 },
  ]);

  assert.equal(result.splat.name, "scene.spz");
  assert.equal(result.splat.fileType, "spz");
  assert.equal(result.collision.name, "collision.glb");
  assert.equal(result.collision.fileType, "glb");
});

test("rejects imported scene folders with extra files", () => {
  assert.throws(
    () =>
      validateSceneImportFolder([
        { name: "scene.spz", size: 100 },
        { name: "collision.glb", size: 200 },
        { name: "notes.txt", size: 10 },
      ]),
    (error) =>
      error instanceof SceneValidationError &&
      error.code === "invalid-file-count",
  );
});

test("rejects uploaded files over the configured per-file size limit", () => {
  assert.throws(
    () =>
      validateSceneImportFolder([
        {
          name: "scene.spz",
          size: DEFAULT_MAX_SCENE_FILE_SIZE_BYTES + 1,
        },
        { name: "collision.glb", size: 200 },
      ]),
    (error) =>
      error instanceof SceneValidationError &&
      error.code === "file-too-large",
  );
});

test("creates a scene from scene-owned assets", () => {
  const [assets] = parseBuiltInSceneManifest(validManifest);
  const scene = createSceneFromAssets(assets, {
    id: "scene-1",
    name: "Kitchen scene",
    origin: "built-in",
    builtInId: "kitchen",
  });

  assert.equal(scene.id, "scene-1");
  assert.equal(scene.name, "Kitchen scene");
  assert.equal(scene.origin, "built-in");
  assert.equal(scene.builtInId, "kitchen");
  assert.equal(scene.assets.id, "kitchen");
  assert.deepEqual(scene.objects, []);
  assert.deepEqual(scene.cameras, []);
  assert.deepEqual(scene.shots, []);
});

test("updates scene world settings without mutating scene assets", () => {
  const [assets] = parseBuiltInSceneManifest(validManifest);
  const scene = createSceneFromAssets(assets);
  const updated = updateSceneWorldSettings(scene, {
    opacity: 0.5,
    collision: { visibleInEditor: true, displayMode: "wireframe" },
  });

  assert.equal(updated.assets.id, "kitchen");
  assert.equal(updated.world.opacity, 0.5);
  assert.equal(updated.world.collision.visibleInEditor, true);
  assert.equal(updated.world.collision.displayMode, "wireframe");
});

test("uses camera-n naming and camera name storage keys", () => {
  const cameraName = formatCameraName(3);

  assert.equal(cameraName, "camera-3");
  assert.equal(getCameraBookmarkStorageKey(cameraName), "camera-3");
});

test("accepts surfaces within slope threshold", () => {
  assert.equal(isSurfacePlaceable({ x: 0, y: 1, z: 0 }, 35), true);
  assert.equal(isSurfacePlaceable({ x: 1, y: 0, z: 0 }, 35), false);
});

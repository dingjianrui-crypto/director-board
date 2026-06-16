import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_ENVIRONMENT_FILE_SIZE_BYTES,
  EnvironmentManifestError,
  EnvironmentValidationError,
  createSceneFromEnvironmentTemplate,
  formatCameraName,
  getCameraBookmarkStorageKey,
  isSurfacePlaceable,
  parseBuiltInEnvironmentManifest,
  updateSceneEnvironmentSettings,
  validateEnvironmentUploadFolder,
} from "../src/environment/index.js";

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

test("parses built-in environment manifest entries", () => {
  const templates = parseBuiltInEnvironmentManifest(validManifest);

  assert.deepEqual(templates, [
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

test("rejects duplicate built-in environment ids", () => {
  assert.throws(
    () => parseBuiltInEnvironmentManifest([...validManifest, ...validManifest]),
    (error) =>
      error instanceof EnvironmentManifestError &&
      error.code === "duplicate-environment-id",
  );
});

test("validates an uploaded environment folder with one splat and one mesh", () => {
  const result = validateEnvironmentUploadFolder([
    { name: "scene.spz", size: 100 },
    { name: "collision.glb", size: 200 },
  ]);

  assert.equal(result.splat.name, "scene.spz");
  assert.equal(result.splat.fileType, "spz");
  assert.equal(result.collision.name, "collision.glb");
  assert.equal(result.collision.fileType, "glb");
});

test("rejects uploaded environment folders with extra files", () => {
  assert.throws(
    () =>
      validateEnvironmentUploadFolder([
        { name: "scene.spz", size: 100 },
        { name: "collision.glb", size: 200 },
        { name: "notes.txt", size: 10 },
      ]),
    (error) =>
      error instanceof EnvironmentValidationError &&
      error.code === "invalid-file-count",
  );
});

test("rejects uploaded files over the configured per-file size limit", () => {
  assert.throws(
    () =>
      validateEnvironmentUploadFolder([
        {
          name: "scene.spz",
          size: DEFAULT_MAX_ENVIRONMENT_FILE_SIZE_BYTES + 1,
        },
        { name: "collision.glb", size: 200 },
      ]),
    (error) =>
      error instanceof EnvironmentValidationError &&
      error.code === "file-too-large",
  );
});

test("creates a scene from an environment template", () => {
  const [template] = parseBuiltInEnvironmentManifest(validManifest);
  const scene = createSceneFromEnvironmentTemplate(template, {
    id: "scene-1",
    name: "Kitchen scene",
  });

  assert.equal(scene.id, "scene-1");
  assert.equal(scene.name, "Kitchen scene");
  assert.equal(scene.environment.templateId, "kitchen");
  assert.deepEqual(scene.characters, []);
  assert.deepEqual(scene.props, []);
  assert.deepEqual(scene.cameras, []);
  assert.deepEqual(scene.shots, []);
});

test("prevents changing a scene's environment template", () => {
  const [template] = parseBuiltInEnvironmentManifest(validManifest);
  const scene = createSceneFromEnvironmentTemplate(template);

  assert.throws(
    () => updateSceneEnvironmentSettings(scene, { templateId: "warehouse" }),
    /cannot be changed/,
  );
});

test("updates scene-instance environment settings without mutating template id", () => {
  const [template] = parseBuiltInEnvironmentManifest(validManifest);
  const scene = createSceneFromEnvironmentTemplate(template);
  const updated = updateSceneEnvironmentSettings(scene, {
    opacity: 0.5,
    collision: { visibleInEditor: true, displayMode: "wireframe" },
  });

  assert.equal(updated.environment.templateId, "kitchen");
  assert.equal(updated.environment.opacity, 0.5);
  assert.equal(updated.environment.collision.visibleInEditor, true);
  assert.equal(updated.environment.collision.displayMode, "wireframe");
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

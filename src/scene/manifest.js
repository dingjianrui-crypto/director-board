import {
  COLLISION_FILE_TYPES,
  SPLAT_FILE_TYPES,
} from "./constants.js";
import { getFileExtension } from "./file-types.js";

export class SceneManifestError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "SceneManifestError";
    this.code = code;
    this.details = details;
  }
}

export function parseBuiltInSceneManifest(manifest) {
  if (!Array.isArray(manifest)) {
    throw new SceneManifestError(
      "Built-in scene manifest must be an array.",
      "invalid-manifest",
    );
  }

  const ids = new Set();

  return manifest.map((item, index) => {
    const assets = normalizeManifestItem(item, index);

    if (ids.has(assets.id)) {
      throw new SceneManifestError(
        `Duplicate built-in scene id "${assets.id}".`,
        "duplicate-scene-id",
        { id: assets.id },
      );
    }

    ids.add(assets.id);
    return assets;
  });
}

function normalizeManifestItem(item, index) {
  if (!item || typeof item !== "object") {
    throw new SceneManifestError(
      `Manifest entry at index ${index} must be an object.`,
      "invalid-manifest-item",
      { index },
    );
  }

  assertNonEmptyString(item.id, "id", index);
  assertNonEmptyString(item.name, "name", index);

  const splat = normalizeAsset(item.splat, SPLAT_FILE_TYPES, "splat", index);
  const collision = normalizeAsset(
    item.collision,
    COLLISION_FILE_TYPES,
    "collision",
    index,
  );
  const defaults = normalizeDefaults(item.defaults, index);

  return {
    id: item.id,
    name: item.name,
    source: "built-in",
    splat,
    collision,
    defaults,
  };
}

function normalizeDefaults(defaults, index) {
  if (defaults === undefined) return undefined;

  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    throw new SceneManifestError(
      `Manifest entry at index ${index} has invalid defaults.`,
      "invalid-defaults",
      { index },
    );
  }

  const normalized = { ...defaults };
  if (Object.hasOwn(defaults, "viewpoint")) {
    normalized.viewpoint = normalizeViewpoint(defaults.viewpoint, index);
  }
  if (Object.hasOwn(defaults, "splatTransform")) {
    normalized.splatTransform = normalizeSplatTransform(
      defaults.splatTransform,
      index,
    );
  }
  if (Object.hasOwn(defaults, "entityScale")) {
    if (!Number.isFinite(defaults.entityScale) || defaults.entityScale <= 0) {
      throw new SceneManifestError(
        `Manifest entry at index ${index} has invalid defaults.entityScale.`,
        "invalid-defaults",
        { index, fieldName: "defaults.entityScale" },
      );
    }
    normalized.entityScale = defaults.entityScale;
  }

  return normalized;
}

function normalizeSplatTransform(transform, index) {
  if (!transform || typeof transform !== "object" || Array.isArray(transform)) {
    throw new SceneManifestError(
      `Manifest entry at index ${index} has invalid defaults.splatTransform.`,
      "invalid-defaults",
      { index, fieldName: "defaults.splatTransform" },
    );
  }

  const normalized = {};
  if (Object.hasOwn(transform, "axes")) {
    normalized.axes = normalizeAxisSigns(
      transform.axes,
      "defaults.splatTransform.axes",
      index,
    );
  }
  if (Object.hasOwn(transform, "scale")) {
    if (!Number.isFinite(transform.scale) || transform.scale <= 0) {
      throw new SceneManifestError(
        `Manifest entry at index ${index} has invalid defaults.splatTransform.scale.`,
        "invalid-defaults",
        { index, fieldName: "defaults.splatTransform.scale" },
      );
    }
    normalized.scale = transform.scale;
  }

  return normalized;
}

function normalizeViewpoint(viewpoint, index) {
  if (!viewpoint || typeof viewpoint !== "object" || Array.isArray(viewpoint)) {
    throw new SceneManifestError(
      `Manifest entry at index ${index} has invalid defaults.viewpoint.`,
      "invalid-defaults",
      { index, fieldName: "defaults.viewpoint" },
    );
  }

  return {
    eye: normalizeVector3(viewpoint.eye, "defaults.viewpoint.eye", index),
    target: normalizeVector3(
      viewpoint.target,
      "defaults.viewpoint.target",
      index,
    ),
  };
}

function normalizeVector3(value, fieldName, index) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new SceneManifestError(
      `Manifest entry at index ${index} has invalid ${fieldName}.`,
      "invalid-defaults",
      { index, fieldName },
    );
  }

  return [...value];
}

function normalizeAxisSigns(value, fieldName, index) {
  const axes = normalizeVector3(value, fieldName, index);
  if (axes.some((coordinate) => coordinate !== -1 && coordinate !== 1)) {
    throw new SceneManifestError(
      `Manifest entry at index ${index} has invalid ${fieldName}.`,
      "invalid-defaults",
      { index, fieldName },
    );
  }

  return axes;
}

function normalizeAsset(asset, supportedTypes, fieldName, index) {
  if (!asset || typeof asset !== "object") {
    throw new SceneManifestError(
      `Manifest entry at index ${index} must include ${fieldName} asset metadata.`,
      "missing-asset",
      { index, fieldName },
    );
  }

  assertNonEmptyString(asset.path, `${fieldName}.path`, index);

  if (!Number.isFinite(asset.sizeBytes) || asset.sizeBytes < 0) {
    throw new SceneManifestError(
      `Manifest entry at index ${index} has an invalid ${fieldName}.sizeBytes value.`,
      "invalid-asset-size",
      { index, fieldName },
    );
  }

  const fileType = asset.fileType ?? getFileExtension(asset.path);
  if (!supportedTypes.has(fileType)) {
    throw new SceneManifestError(
      `Manifest entry at index ${index} has an unsupported ${fieldName} file type.`,
      "unsupported-asset-type",
      { index, fieldName, fileType },
    );
  }

  return {
    path: asset.path,
    sizeBytes: asset.sizeBytes,
    fileType,
  };
}

function assertNonEmptyString(value, fieldName, index) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SceneManifestError(
      `Manifest entry at index ${index} must include ${fieldName}.`,
      "missing-field",
      { index, fieldName },
    );
  }
}

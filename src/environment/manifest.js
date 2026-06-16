import {
  COLLISION_FILE_TYPES,
  SPLAT_FILE_TYPES,
} from "./constants.js";
import { getFileExtension } from "./file-types.js";

export class EnvironmentManifestError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "EnvironmentManifestError";
    this.code = code;
    this.details = details;
  }
}

export function parseBuiltInEnvironmentManifest(manifest) {
  if (!Array.isArray(manifest)) {
    throw new EnvironmentManifestError(
      "Built-in environment manifest must be an array.",
      "invalid-manifest",
    );
  }

  const ids = new Set();

  return manifest.map((item, index) => {
    const template = normalizeManifestItem(item, index);

    if (ids.has(template.id)) {
      throw new EnvironmentManifestError(
        `Duplicate built-in environment id "${template.id}".`,
        "duplicate-environment-id",
        { id: template.id },
      );
    }

    ids.add(template.id);
    return template;
  });
}

function normalizeManifestItem(item, index) {
  if (!item || typeof item !== "object") {
    throw new EnvironmentManifestError(
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
    throw new EnvironmentManifestError(
      `Manifest entry at index ${index} has invalid defaults.`,
      "invalid-defaults",
      { index },
    );
  }

  const normalized = { ...defaults };
  if (Object.hasOwn(defaults, "viewpoint")) {
    normalized.viewpoint = normalizeViewpoint(defaults.viewpoint, index);
  }

  return normalized;
}

function normalizeViewpoint(viewpoint, index) {
  if (!viewpoint || typeof viewpoint !== "object" || Array.isArray(viewpoint)) {
    throw new EnvironmentManifestError(
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
    throw new EnvironmentManifestError(
      `Manifest entry at index ${index} has invalid ${fieldName}.`,
      "invalid-defaults",
      { index, fieldName },
    );
  }

  return [...value];
}

function normalizeAsset(asset, supportedTypes, fieldName, index) {
  if (!asset || typeof asset !== "object") {
    throw new EnvironmentManifestError(
      `Manifest entry at index ${index} must include ${fieldName} asset metadata.`,
      "missing-asset",
      { index, fieldName },
    );
  }

  assertNonEmptyString(asset.path, `${fieldName}.path`, index);

  if (!Number.isFinite(asset.sizeBytes) || asset.sizeBytes < 0) {
    throw new EnvironmentManifestError(
      `Manifest entry at index ${index} has an invalid ${fieldName}.sizeBytes value.`,
      "invalid-asset-size",
      { index, fieldName },
    );
  }

  const fileType = asset.fileType ?? getFileExtension(asset.path);
  if (!supportedTypes.has(fileType)) {
    throw new EnvironmentManifestError(
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
    throw new EnvironmentManifestError(
      `Manifest entry at index ${index} must include ${fieldName}.`,
      "missing-field",
      { index, fieldName },
    );
  }
}

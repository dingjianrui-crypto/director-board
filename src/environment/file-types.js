import { COLLISION_FILE_TYPES, SPLAT_FILE_TYPES } from "./constants.js";

export function getFileExtension(fileName) {
  if (typeof fileName !== "string") {
    return "";
  }

  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot < 0 || lastDot === trimmed.length - 1) {
    return "";
  }

  return trimmed.slice(lastDot + 1).toLowerCase();
}

export function isSplatFile(fileName) {
  return SPLAT_FILE_TYPES.has(getFileExtension(fileName));
}

export function isCollisionMeshFile(fileName) {
  return COLLISION_FILE_TYPES.has(getFileExtension(fileName));
}

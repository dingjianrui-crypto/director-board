export function formatCameraName(cameraNumber) {
  if (!Number.isInteger(cameraNumber) || cameraNumber < 1) {
    throw new TypeError("Camera number must be a positive integer.");
  }

  return `camera-${cameraNumber}`;
}

export function getCameraBookmarkStorageKey(cameraName) {
  if (typeof cameraName !== "string" || cameraName.trim().length === 0) {
    throw new TypeError("Camera name is required.");
  }

  return cameraName;
}

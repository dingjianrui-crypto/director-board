import { DEFAULT_MAX_ENVIRONMENT_FILE_SIZE_BYTES } from "./constants.js";
import {
  getFileExtension,
  isCollisionMeshFile,
  isSplatFile,
} from "./file-types.js";

export class EnvironmentValidationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "EnvironmentValidationError";
    this.code = code;
    this.details = details;
  }
}

function assertFileDescriptor(file) {
  if (!file || typeof file.name !== "string") {
    throw new EnvironmentValidationError(
      "Each uploaded folder entry must include a file name.",
      "invalid-file-descriptor",
      { file },
    );
  }

  if (!Number.isFinite(file.size) || file.size < 0) {
    throw new EnvironmentValidationError(
      `File "${file.name}" must include a valid size.`,
      "invalid-file-size",
      { fileName: file.name },
    );
  }
}

export function validateEnvironmentUploadFolder(
  files,
  options = {},
) {
  const maxFileSizeBytes =
    options.maxFileSizeBytes ?? DEFAULT_MAX_ENVIRONMENT_FILE_SIZE_BYTES;

  if (!Array.isArray(files)) {
    throw new EnvironmentValidationError(
      "Uploaded environment must be provided as a folder file list.",
      "invalid-folder",
    );
  }

  if (files.length !== 2) {
    throw new EnvironmentValidationError(
      "Uploaded environment folders must contain exactly one splat file and one collision mesh file.",
      "invalid-file-count",
      { fileCount: files.length },
    );
  }

  for (const file of files) {
    assertFileDescriptor(file);

    if (file.size > maxFileSizeBytes) {
      throw new EnvironmentValidationError(
        `File "${file.name}" exceeds the configured per-file size limit.`,
        "file-too-large",
        {
          fileName: file.name,
          sizeBytes: file.size,
          maxFileSizeBytes,
        },
      );
    }
  }

  const splatFiles = files.filter((file) => isSplatFile(file.name));
  const collisionFiles = files.filter((file) => isCollisionMeshFile(file.name));

  if (splatFiles.length !== 1 || collisionFiles.length !== 1) {
    throw new EnvironmentValidationError(
      "Uploaded environment folders must contain exactly one supported splat file and one supported collision mesh file.",
      "invalid-environment-files",
      {
        splatFileCount: splatFiles.length,
        collisionFileCount: collisionFiles.length,
      },
    );
  }

  return {
    splat: toAssetFile(splatFiles[0]),
    collision: toAssetFile(collisionFiles[0]),
  };
}

function toAssetFile(file) {
  return {
    name: file.name,
    sizeBytes: file.size,
    fileType: getFileExtension(file.name),
    file,
  };
}

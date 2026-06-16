/// <reference types="vite/client" />

declare module "./environment/index.js" {
  export const DEFAULT_MAX_ENVIRONMENT_FILE_SIZE_BYTES: number;
  export const DEFAULT_PLACEMENT_MAX_SLOPE_DEGREES: number;
  export class EnvironmentValidationError extends Error {
    code: string;
    details: Record<string, unknown>;
  }
  export function validateEnvironmentUploadFolder(
    files: Array<{ name: string; size: number }>,
    options?: { maxFileSizeBytes?: number },
  ): {
    splat: { name: string; sizeBytes: number; fileType: string; file: File };
    collision: { name: string; sizeBytes: number; fileType: string; file: File };
  };
  export function formatCameraName(cameraNumber: number): string;
}

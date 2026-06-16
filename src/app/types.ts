export type Vector3Tuple = [number, number, number];

export type EnvironmentTransform = {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: number;
};

export type EnvironmentTemplate = {
  id: string;
  name: string;
  source: "built-in" | "upload" | "procedural";
  splat?: {
    path: string;
    sizeBytes: number;
    fileType: string;
    objectUrl?: string;
    file?: File;
  };
  collision?: {
    path: string;
    sizeBytes: number;
    fileType: string;
    objectUrl?: string;
    file?: File;
  };
  defaults?: Partial<{
    transform: EnvironmentTransform;
    visible: boolean;
    opacity: number;
    renderMode: "auto" | "quality" | "balanced" | "fast";
    gridY: number;
    collision: Partial<{
      visibleInEditor: boolean;
      displayMode: "hidden" | "wireframe" | "transparent" | "walkable";
    }>;
  }>;
};

export type SceneEnvironment = {
  templateId: string;
  transform: EnvironmentTransform;
  visible: boolean;
  opacity: number;
  renderMode: "auto" | "quality" | "balanced" | "fast";
  gridY?: number;
  collision: {
    visibleInEditor: boolean;
    displayMode: "hidden" | "wireframe" | "transparent" | "walkable";
  };
};

export type BoardObjectKind = "character" | "prop";

export type BoardObject = {
  id: string;
  name: string;
  kind: BoardObjectKind;
  model: string;
  color: string;
  position: Vector3Tuple;
  rotationY: number;
  scale: number;
};

export type DirectorCamera = {
  id: string;
  name: string;
  lens: number;
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  roll: number;
  frame: string;
};

export type Shot = {
  id: string;
  name: string;
  cameraId: string;
  lens: number;
  frame: string;
  duration: string;
  thumbnail?: string;
};

export type DirectorScene = {
  id: string;
  name: string;
  slug: string;
  environment: SceneEnvironment;
  objects: BoardObject[];
  cameras: DirectorCamera[];
  shots: Shot[];
};

export type Selection =
  | { type: "environment" }
  | { type: "object"; id: string }
  | { type: "camera"; id: string }
  | { type: "shot"; id: string };

export type ViewMode = "move" | "rotate";

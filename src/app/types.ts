export type Vector3Tuple = [number, number, number];

export type EditorViewpoint = {
  eye: Vector3Tuple;
  target: Vector3Tuple;
};

export type SceneTransform = {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: number;
};

export type SceneAsset = {
  path: string;
  sizeBytes: number;
  fileType: string;
  objectUrl?: string;
  file?: File;
};

export type SceneAssetSource = "blank" | "built-in" | "upload" | "procedural";

export type SceneAssets = {
  id: string;
  name: string;
  source: SceneAssetSource;
  splat?: SceneAsset;
  collision?: SceneAsset;
  defaults?: Partial<{
    transform: SceneTransform;
    viewpoint: EditorViewpoint;
    visible: boolean;
    opacity: number;
    renderMode: "auto" | "quality" | "balanced" | "fast";
    gridY: number;
    entityScale: number;
    splatTransform: Partial<{
      axes: Vector3Tuple;
      scale: number;
    }>;
    collision: Partial<{
      visibleInEditor: boolean;
      displayMode: "hidden" | "wireframe" | "transparent" | "walkable";
    }>;
  }>;
};

export type SceneWorld = {
  transform: SceneTransform;
  visible: boolean;
  opacity: number;
  renderMode: "auto" | "quality" | "balanced" | "fast";
  gridY?: number;
  collision: {
    visibleInEditor: boolean;
    displayMode: "hidden" | "wireframe" | "transparent" | "walkable";
  };
};

export type SceneOrigin = "draft" | "built-in" | "user";

export type BoardObjectKind = "character" | "prop";
export type CharacterPose = "t-pose" | "standing" | "sitting";

export type BoardObject = {
  id: string;
  name: string;
  kind: BoardObjectKind;
  model: string;
  modelFile?: string;
  modelFileType?: string;
  modelColor?: string;
  color: string;
  position: Vector3Tuple;
  rotationY: number;
  scale: number;
  pose?: CharacterPose;
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
  cameraId?: string;
  viewpoint?: EditorViewpoint;
  lens: number;
  frame: string;
  duration: string;
  thumbnail?: string;
};

export type DirectorScene = {
  id: string;
  name: string;
  slug: string;
  origin: SceneOrigin;
  builtInId?: string;
  assets: SceneAssets;
  world: SceneWorld;
  objects: BoardObject[];
  cameras: DirectorCamera[];
  shots: Shot[];
};

export type Selection =
  | { type: "scene" }
  | { type: "object"; id: string }
  | { type: "camera"; id: string }
  | { type: "shot"; id: string };

export type ViewMode = "move" | "rotate";

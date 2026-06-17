import {
  Box,
  Camera,
  Check,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Film,
  Grid3X3,
  Move3D,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UserRound,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MAX_SCENE_FILE_SIZE_BYTES,
  SceneValidationError,
  formatCameraName,
  parseBuiltInSceneManifest,
  validateSceneImportFolder,
} from "../scene/index.js";
import {
  cloneSceneAssets,
  createBlankDraftScene,
  createSceneWorld,
  createStarterScene,
  DEFAULT_SCENE_TRANSFORM,
} from "./sample-data";
import {
  deleteImportedScene,
  loadImportedScenes,
  saveImportedScene,
} from "./project-storage";
import type {
  BoardObject,
  BoardObjectKind,
  DirectorCamera,
  DirectorScene,
  EditorViewpoint,
  SceneAssets,
  SceneTransform,
  SceneWorld,
  Selection,
  Shot,
  Vector3Tuple,
  ViewMode,
} from "./types";
import {
  ThreeViewport,
  type CollisionAlignmentReadout,
  type SceneSizingReadout,
  type SplatAlignmentReadout,
  type ThreeViewportHandle,
} from "./ThreeViewport";

const frameOptions = ["EWS", "WS", "FS", "MS", "MCU", "CU", "ECU", "OTS"];
const lensOptions = [14, 18, 24, 28, 35, 50, 65, 85, 100, 135];
const BUILT_IN_SCENE_MANIFEST_PATH = "/assets/environments/manifest.json";
const SHOT_CAPTURE_SIZE = { width: 1440, height: 1080 };

const orientationPresets = [
  { label: "Spark", rotation: [0, 0, 0] },
  { label: "Z-up", rotation: [-Math.PI / 2, 0, 0] },
  { label: "Flip Z", rotation: [0, 0, Math.PI] },
] satisfies Array<{ label: string; rotation: Vector3Tuple }>;

export function App() {
  const viewportRef = useRef<ThreeViewportHandle>(null);
  const [scenes, setScenes] = useState<DirectorScene[]>([
    createBlankDraftScene(),
    createStarterScene(),
  ]);
  const [activeSceneId, setActiveSceneId] = useState("scene-draft");
  const [dirtySceneIds, setDirtySceneIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>({ type: "scene" });
  const [viewMode, setViewMode] = useState<ViewMode>("move");
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | undefined>();
  const [editorViewpoint, setEditorViewpoint] = useState<{
    sceneId: string;
    viewpoint: EditorViewpoint;
  }>();
  const [collisionAlignments, setCollisionAlignments] = useState<
    Record<string, CollisionAlignmentReadout | undefined>
  >({});
  const [splatAlignments, setSplatAlignments] = useState<
    Record<string, SplatAlignmentReadout | undefined>
  >({});
  const [sceneSizings, setSceneSizings] = useState<
    Record<string, SceneSizingReadout | undefined>
  >({});
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    let cancelled = false;

    async function loadSceneLibrary() {
      let builtInSceneAssets: SceneAssets[] = [];
      let importedScenes: DirectorScene[] = [];

      try {
        const response = await fetch(BUILT_IN_SCENE_MANIFEST_PATH);
        if (!response.ok) {
          throw new Error(`Manifest request failed with ${response.status}`);
        }
        builtInSceneAssets = parseBuiltInSceneManifest(
          await response.json(),
        ) as SceneAssets[];
      } catch {
        if (!cancelled) setStatus("Could not load built-in scene manifest.");
      }

      try {
        importedScenes = await loadImportedScenes();
      } catch {
        if (!cancelled) setStatus("Could not restore imported scenes.");
      }

      if (cancelled || (builtInSceneAssets.length === 0 && importedScenes.length === 0)) {
        return;
      }

      setScenes((current) => {
        const existingIds = new Set(current.map((scene) => scene.id));
        const builtInScenes = builtInSceneAssets.map(createBuiltInSplatScene);
        const additions = [...builtInScenes, ...importedScenes].filter(
          (scene) => !existingIds.has(scene.id),
        );
        if (additions.length === 0) return current;
        return [...current, ...additions];
      });
    }

    void loadSceneLibrary();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeScene = scenes.find((scene) => scene.id === activeSceneId) ?? scenes[0];
  const sceneList = scenes.filter((scene) => scene.origin !== "draft");
  const activeSceneIsDirty = dirtySceneIds.has(activeScene.id);
  const selectedCamera =
    selection.type === "camera"
      ? activeScene.cameras.find((camera) => camera.id === selection.id)
      : activeScene.cameras[0];
  const selectedObject =
    selection.type === "object"
      ? activeScene.objects.find((object) => object.id === selection.id)
      : undefined;
  const selectedShot =
    selection.type === "shot"
      ? activeScene.shots.find((shot) => shot.id === selection.id)
      : undefined;
  const currentEditorViewpoint =
    editorViewpoint?.sceneId === activeScene.id
      ? editorViewpoint.viewpoint
      : undefined;
  const currentCollisionAlignment = collisionAlignments[activeScene.id];
  const currentSplatAlignment = splatAlignments[activeScene.id];
  const currentSceneSizing = sceneSizings[activeScene.id];

  const sceneListLabel = useMemo(
    () => `${sceneList.length} scene${sceneList.length === 1 ? "" : "s"}`,
    [sceneList.length],
  );

  useEffect(() => {
    const camera = selectedCamera ?? activeScene.cameras[0];
    if (!camera) {
      setPreviewImage(undefined);
      return;
    }

    let cancelled = false;
    let retryTimeout = 0;
    let frameId = 0;

    const refreshPreview = (attempt = 0) => {
      frameId = window.requestAnimationFrame(() => {
        if (cancelled) return;
        const image = viewportRef.current?.capture(camera.id, {
          width: 400,
          height: 300,
        });
        if (image || attempt >= 8) {
          setPreviewImage(image);
          return;
        }
        retryTimeout = window.setTimeout(() => refreshPreview(attempt + 1), 80);
      });
    };

    refreshPreview();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(retryTimeout);
    };
  }, [activeScene, selectedCamera]);

  function updateScene(updater: (scene: DirectorScene) => DirectorScene) {
    setScenes((current) =>
      current.map((scene) => (scene.id === activeScene.id ? updater(scene) : scene)),
    );
    setDirtySceneIds((current) => new Set(current).add(activeScene.id));
  }

  function switchScene(sceneId: string) {
    if (sceneId === activeScene.id) {
      setSelection({ type: "scene" });
      return;
    }

    promptToSaveDirtyScene();
    setActiveSceneId(sceneId);
    setSelection({ type: "scene" });
  }

  function createNewBlankScene() {
    promptToSaveDirtyScene();

    const draft = {
      ...createBlankDraftScene(),
      id: `scene-draft-${Date.now().toString(36)}`,
    };
    setScenes((current) => [...current.filter((scene) => scene.origin !== "draft"), draft]);
    setActiveSceneId(draft.id);
    setSelection({ type: "scene" });
    setStatus("Created a blank draft scene");
  }

  function promptToSaveDirtyScene() {
    if (!dirtySceneIds.has(activeScene.id)) return;

    const shouldSave = window.confirm(
      `Save changes to "${activeScene.name}" as a user scene before switching?`,
    );
    if (shouldSave) {
      saveScene(activeScene, { stayOnCurrent: false });
    }
  }

  function saveScene(scene = activeScene, options: { stayOnCurrent?: boolean } = {}) {
    if (scene.origin === "user") {
      setDirtySceneIds((current) => {
        const next = new Set(current);
        next.delete(scene.id);
        return next;
      });
      setStatus(`Saved ${scene.name}`);
      return scene.id;
    }

    const copyName =
      scene.origin === "draft" ? scene.name : createCopyName(scene.name, scenes);
    const copy: DirectorScene = {
      ...cloneScene(scene),
      id: `scene-user-${Date.now().toString(36)}`,
      name: copyName,
      origin: "user",
      builtInId: undefined,
    };

    setScenes((current) => [...current, copy]);
    setDirtySceneIds((current) => {
      const next = new Set(current);
      next.delete(scene.id);
      return next;
    });
    if (options.stayOnCurrent ?? true) {
      setActiveSceneId(copy.id);
      setSelection({ type: "scene" });
    }
    setStatus(`Saved ${copy.name}`);
    return copy.id;
  }

  async function deleteScene(scene = activeScene) {
    if (scene.origin !== "user") {
      setStatus("Built-in scenes cannot be deleted.");
      return;
    }

    const shouldDelete = window.confirm(
      `Delete "${scene.name}"? This removes it from this browser.`,
    );
    if (!shouldDelete) return;

    try {
      if (scene.assets.source === "upload") {
        await deleteImportedScene(scene);
      }

      const fallbackScene =
        scenes.find((entry) => entry.id !== scene.id && entry.origin === "draft") ??
        scenes.find((entry) => entry.id !== scene.id) ??
        createBlankDraftScene();

      setScenes((current) => {
        const remaining = current.filter((entry) => entry.id !== scene.id);
        return remaining.length > 0 ? remaining : [fallbackScene];
      });
      setDirtySceneIds((current) => {
        const next = new Set(current);
        next.delete(scene.id);
        return next;
      });
      setActiveSceneId(fallbackScene.id);
      setSelection({ type: "scene" });
      setStatus(`Deleted ${scene.name}`);
    } catch {
      setStatus(`Could not delete ${scene.name}.`);
    }
  }

  function addObject(kind: BoardObjectKind, model: string) {
    const index = activeScene.objects.length + 1;
    const object: BoardObject = {
      id: `obj-${Date.now().toString(36)}`,
      name: kind === "character" ? `Actor ${index}` : modelName(model, index),
      kind,
      model,
      color: kind === "character" ? "#7fc8a9" : "#b78b60",
      position: [0.4 + index * 0.18, 0, 0.6],
      rotationY: 0,
      scale: getNewObjectScale(activeScene, currentSceneSizing),
    };

    updateScene((scene) => ({ ...scene, objects: [...scene.objects, object] }));
    setSelection({ type: "object", id: object.id });
  }

  function addCamera() {
    const cameraNumber = activeScene.cameras.length + 1;
    const camera: DirectorCamera = {
      id: `cam-${Date.now().toString(36)}`,
      name: formatCameraName(cameraNumber),
      lens: 35,
      position: [2.8, 1.35, 2.8],
      lookAt: [0, 1, 0],
      roll: 0,
      frame: "MS",
    };

    updateScene((scene) => ({ ...scene, cameras: [...scene.cameras, camera] }));
    setSelection({ type: "camera", id: camera.id });
  }

  function updateCamera(cameraId: string, patch: Partial<DirectorCamera>) {
    updateScene((scene) => ({
      ...scene,
      cameras: scene.cameras.map((camera) =>
        camera.id === cameraId ? { ...camera, ...patch } : camera,
      ),
    }));
  }

  function updateObject(objectId: string, patch: Partial<BoardObject>) {
    updateScene((scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        object.id === objectId ? { ...object, ...patch } : object,
      ),
    }));
  }

  function deleteSelection() {
    if (selection.type === "object") {
      const object = activeScene.objects.find((entry) => entry.id === selection.id);
      if (!object) return;

      updateScene((scene) => ({
        ...scene,
        objects: scene.objects.filter((entry) => entry.id !== selection.id),
      }));
      setSelection(
        activeScene.cameras[0]
          ? { type: "camera", id: activeScene.cameras[0].id }
          : { type: "scene" },
      );
      setStatus(`Deleted ${object.name}`);
      return;
    }

    if (selection.type === "camera") {
      const camera = activeScene.cameras.find((entry) => entry.id === selection.id);
      if (!camera) return;
      const remainingCameras = activeScene.cameras.filter(
        (entry) => entry.id !== selection.id,
      );

      updateScene((scene) => ({
        ...scene,
        cameras: scene.cameras.filter((entry) => entry.id !== selection.id),
      }));
      setSelection(
        remainingCameras[0]
          ? { type: "camera", id: remainingCameras[0].id }
          : activeScene.objects[0]
            ? { type: "object", id: activeScene.objects[0].id }
            : { type: "scene" },
      );
      setStatus(`Deleted ${camera.name}`);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      const isEditingText =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditingText) return;
      if (selection.type !== "object" && selection.type !== "camera") return;

      event.preventDefault();
      deleteSelection();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeScene, selection]);

  function updateSceneName(name: string) {
    updateScene((scene) => ({ ...scene, name }));
  }

  function updateSceneSlug(slug: string) {
    updateScene((scene) => ({ ...scene, slug }));
  }

  function updateWorld(patch: Partial<SceneWorld>) {
    updateScene((scene) => ({
      ...scene,
      world: {
        ...scene.world,
        ...patch,
        collision: patch.collision
          ? { ...scene.world.collision, ...patch.collision }
          : scene.world.collision,
        transform: patch.transform ?? scene.world.transform,
      },
    }));
  }

  async function handleSceneImport(files: FileList | null) {
    if (!files) return;

    try {
      const fileArray = Array.from(files);
      const validated = validateSceneImportFolder(fileArray, {
        maxFileSizeBytes: DEFAULT_MAX_SCENE_FILE_SIZE_BYTES,
      });
      const sceneName = suggestSceneName(validated.splat.name, scenes);
      const assets: SceneAssets = {
        id: `assets-${Date.now().toString(36)}`,
        name: sceneName,
        source: "upload",
        splat: {
          path: validated.splat.name,
          sizeBytes: validated.splat.sizeBytes,
          fileType: validated.splat.fileType,
          file: validated.splat.file,
          objectUrl: URL.createObjectURL(validated.splat.file),
        },
        collision: {
          path: validated.collision.name,
          sizeBytes: validated.collision.sizeBytes,
          fileType: validated.collision.fileType,
          file: validated.collision.file,
          objectUrl: URL.createObjectURL(validated.collision.file),
        },
        defaults: {
          transform: cloneTransform(DEFAULT_SCENE_TRANSFORM),
        },
      };
      const scene: DirectorScene = {
        id: `scene-import-${Date.now().toString(36)}`,
        name: sceneName,
        slug: "INT. SCAN - DAY",
        origin: "user",
        assets,
        world: createSceneWorld(assets),
        objects: [],
        cameras: [],
        shots: [],
      };

      await saveImportedScene(scene);
      setScenes((current) => [...current, scene]);
      setActiveSceneId(scene.id);
      setSelection({ type: "scene" });
      setStatus(`Imported ${scene.name}`);
    } catch (error) {
      if (error instanceof SceneValidationError) {
        setStatus(error.message);
        return;
      }

      setStatus("Could not import scene folder.");
    }
  }

  function captureShot() {
    const camera = selectedCamera ?? activeScene.cameras[0];
    if (!camera) {
      setStatus("Add a camera before capturing a shot.");
      return;
    }

    const thumbnail = viewportRef.current?.capture(camera.id, SHOT_CAPTURE_SIZE);
    const shot: Shot = {
      id: `shot-${Date.now().toString(36)}`,
      name: `Shot ${activeScene.shots.length + 1}`,
      cameraId: camera.id,
      lens: camera.lens,
      frame: camera.frame,
      duration: "4s",
      thumbnail,
    };

    updateScene((scene) => ({ ...scene, shots: [...scene.shots, shot] }));
    setSelection({ type: "shot", id: shot.id });
    setStatus(`Captured ${shot.name}`);
  }

  function downloadShot(shot: Shot) {
    if (!shot.thumbnail) {
      setStatus(`${shot.name} has no image to download.`);
      return;
    }

    const link = document.createElement("a");
    link.href = shot.thumbnail;
    link.download = `${shot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "shot"}.png`;
    link.click();
    setStatus(`Downloaded ${shot.name}`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Clapperboard size={16} />
          <span>DirectorBoard</span>
        </div>
        <button className="toolbar-button" onClick={() => saveScene()}>
          <Save size={14} /> Save
        </button>
        <button className="toolbar-button"><Download size={14} /> Export</button>
        <div className="scene-title">
          <label>
            <span>Name</span>
            <input
              aria-label="Scene name"
              value={activeScene.name}
              onChange={(event) => updateSceneName(event.target.value)}
            />
          </label>
          <label>
            <span>Slug</span>
            <input
              aria-label="Scene slug"
              value={activeScene.slug}
              onChange={(event) => updateSceneSlug(event.target.value)}
            />
          </label>
          {activeSceneIsDirty && <small>unsaved</small>}
        </div>
        <div className="toolbar-spacer" />
        <div className="segmented">
          <button className="active">3D</button>
          <button>Top</button>
        </div>
        <div className="segmented">
          <button
            className={viewMode === "move" ? "active" : ""}
            onClick={() => setViewMode("move")}
          >
            <Move3D size={13} /> Move
          </button>
          <button
            className={viewMode === "rotate" ? "active" : ""}
            onClick={() => setViewMode("rotate")}
          >
            <RotateCcw size={13} /> Rotate
          </button>
        </div>
        <label className="checkline">
          <input checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} type="checkbox" />
          labels
        </label>
      </header>

      <main className="workspace">
        <aside className="left-panel">
          <section>
            <h2>Add</h2>
            <div className="action-grid two">
              <button onClick={() => addObject("character", "standing")}><UserRound size={15} /> Character</button>
              <button onClick={addCamera}><Camera size={15} /> Camera</button>
            </div>
            <div className="prop-grid">
              {["cube", "table", "chair", "sofa", "counter", "lamp", "light", "door"].map((prop) => (
                <button key={prop} onClick={() => addObject("prop", prop)}>
                  <Box size={13} />
                  {prop}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>Scenes</h2>
            {sceneList.map((scene) => (
              <div
                key={scene.id}
                className={`scene-row ${scene.origin === "user" ? "deletable" : ""}`}
              >
                <button
                  className={`list-row scene-row-main ${
                    scene.id === activeScene.id && selection.type === "scene" ? "selected" : ""
                  }`}
                  onClick={() => switchScene(scene.id)}
                >
                  <span className={`dot ${scene.id === activeScene.id ? "cyan" : "neutral"}`} />
                  <span>{scene.name}{dirtySceneIds.has(scene.id) ? " *" : ""}</span>
                </button>
                {scene.origin === "user" && (
                  <button
                    className="scene-row-delete"
                    aria-label={`Delete ${scene.name}`}
                    title={`Delete ${scene.name}`}
                    onClick={() => deleteScene(scene)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            <label className="mini-toggle">
              <input
                checked={activeScene.world.visible}
                onChange={(event) => updateWorld({ visible: event.target.checked })}
                type="checkbox"
              />
              splat visible
            </label>
            <label className="mini-toggle">
              <input
                checked={activeScene.world.collision.visibleInEditor}
                onChange={(event) =>
                  updateWorld({
                    collision: {
                      ...activeScene.world.collision,
                      visibleInEditor: event.target.checked,
                    },
                  })
                }
                type="checkbox"
              />
              collision debug
            </label>
            <button
              className="full-button"
              onClick={createNewBlankScene}
            >
              <Plus size={14} /> New
            </button>
            <label className="full-button file-button">
              <FileUp size={14} /> Import
              <input
                type="file"
                multiple
                onChange={(event) => handleSceneImport(event.currentTarget.files)}
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              />
            </label>
            <p className="hint">{sceneListLabel} available</p>
          </section>

          <SceneList
            scene={activeScene}
            selection={selection}
            onSelect={setSelection}
          />
        </aside>

        <section className="stage">
          <ThreeViewport
            ref={viewportRef}
            scene={activeScene}
            selectedCameraId={selectedCamera?.id}
            selection={selection}
            showGrid={showGrid}
            showLabels={showLabels}
            onSelect={setSelection}
            onUpdateCamera={updateCamera}
            onUpdateObject={updateObject}
            onSplatAlignmentChange={(sceneId, alignment) =>
              setSplatAlignments((current) => {
                const existing = current[sceneId];
                if (splatAlignmentsEqual(existing, alignment)) return current;
                return {
                  ...current,
                  [sceneId]: alignment,
                };
              })
            }
            onCollisionAlignmentChange={(sceneId, alignment) =>
              setCollisionAlignments((current) => {
                const existing = current[sceneId];
                if (collisionAlignmentsEqual(existing, alignment)) return current;
                return {
                  ...current,
                  [sceneId]: alignment,
                };
              })
            }
            onSceneSizingChange={(sceneId, sizing) =>
              setSceneSizings((current) => {
                const existing = current[sceneId];
                if (sceneSizingsEqual(existing, sizing)) return current;
                return {
                  ...current,
                  [sceneId]: sizing,
                };
              })
            }
            onViewpointChange={(viewpoint) =>
              setEditorViewpoint({
                sceneId: activeScene.id,
                viewpoint,
              })
            }
            onStatus={setStatus}
          />
          <div className="viewport-overlays">
            <div className="viewport-readout-stack">
              <ViewpointReadout
                viewpoint={currentEditorViewpoint}
              />
              <ScaleReadout
                scene={activeScene}
                splatAlignment={currentSplatAlignment}
                collisionAlignment={currentCollisionAlignment}
                sceneSizing={currentSceneSizing}
              />
            </div>
            <div className="view-chip">
              <Grid3X3 size={13} />
              <label>
                <input checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} type="checkbox" />
                grid
              </label>
            </div>
          </div>
          <CameraPreview
            camera={selectedCamera}
            previewImage={previewImage}
            onCapture={captureShot}
          />
        </section>

        <aside className="right-panel">
          <div className="tabs">
            <button className={selection.type === "scene" ? "active" : ""}>Scene</button>
            <button className={selection.type === "object" ? "active" : ""}>Object</button>
            <button className={selection.type === "camera" ? "active" : ""}>Camera</button>
            <button className={selection.type === "shot" ? "active" : ""}>Shot</button>
          </div>
          {selection.type === "scene" && (
            <SceneInspector
              scene={activeScene}
              onUpdateName={updateSceneName}
              onUpdateSlug={updateSceneSlug}
              onUpdateWorld={updateWorld}
              collisionAlignment={currentCollisionAlignment}
              sceneSizing={currentSceneSizing}
              onDelete={deleteScene}
            />
          )}
          {selectedObject && (
            <ObjectInspector object={selectedObject} onUpdate={updateObject} />
          )}
          {selectedCamera && selection.type === "camera" && (
            <CameraInspector camera={selectedCamera} onUpdate={updateCamera} />
          )}
          {selectedShot && (
            <ShotInspector shot={selectedShot} camera={activeScene.cameras.find((camera) => camera.id === selectedShot.cameraId)} />
          )}
        </aside>
      </main>

      <footer className="bottom-strip">
        <div className="strip-tabs">
          <button className="active"><Film size={14} /> Shots ({activeScene.shots.length})</button>
          <button>Board</button>
          <button>Animatic</button>
          <button>Scene Chat</button>
        </div>
        <div className="shot-list">
          {activeScene.shots.map((shot, index) => (
            <div
              key={shot.id}
              role="button"
              tabIndex={0}
              className={`shot-card ${selection.type === "shot" && selection.id === shot.id ? "selected" : ""}`}
              onClick={() => setSelection({ type: "shot", id: shot.id })}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setSelection({ type: "shot", id: shot.id });
              }}
            >
              <span className="shot-number">{index + 1}</span>
              {shot.thumbnail ? (
                <span className="shot-image-wrap">
                  <img src={shot.thumbnail} alt="" />
                  <button
                    type="button"
                    aria-label={`Download ${shot.name}`}
                    className="shot-download"
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadShot(shot);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      downloadShot(shot);
                    }}
                  >
                    <Download size={13} />
                  </button>
                </span>
              ) : (
                <span className="shot-placeholder"><Video size={22} /></span>
              )}
              <strong>{shot.name}</strong>
              <small>{shot.frame} · {shot.lens}mm · {shot.duration}</small>
            </div>
          ))}
        </div>
        <span className="status">{status}</span>
      </footer>
    </div>
  );
}

function createBuiltInSplatScene(assets: SceneAssets): DirectorScene {
  const sceneName = assets.name.toLowerCase().includes("splat")
    ? assets.name
    : `Splat ${assets.name}`;

  return {
    id: `scene-built-in-${assets.id}`,
    name: sceneName,
    slug: "INT. SCAN - DAY",
    origin: "built-in",
    builtInId: assets.id,
    assets: cloneSceneAssets({
      ...assets,
      name: sceneName,
    }),
    world: createSceneWorld(assets),
    objects: [],
    cameras: [],
    shots: [],
  };
}

function cloneScene(scene: DirectorScene): DirectorScene {
  return {
    ...scene,
    assets: cloneSceneAssets(scene.assets),
    world: {
      ...scene.world,
      transform: cloneTransform(scene.world.transform),
      collision: { ...scene.world.collision },
    },
    objects: scene.objects.map((object) => ({
      ...object,
      position: [...object.position],
    })),
    cameras: scene.cameras.map((camera) => ({
      ...camera,
      position: [...camera.position],
      lookAt: [...camera.lookAt],
    })),
    shots: scene.shots.map((shot) => ({ ...shot })),
  };
}

function createCopyName(name: string, scenes: DirectorScene[]) {
  const base = `${name} Copy`;
  const existingNames = new Set(scenes.map((scene) => scene.name));
  if (!existingNames.has(base)) return base;

  let index = 2;
  while (existingNames.has(`${base} ${index}`)) {
    index += 1;
  }
  return `${base} ${index}`;
}

function suggestSceneName(splatFileName: string, scenes: DirectorScene[]) {
  const base =
    splatFileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .trim() || "Imported Scene";
  const existingNames = new Set(scenes.map((scene) => scene.name));
  if (!existingNames.has(base)) return base;

  let index = 2;
  while (existingNames.has(`${base} ${index}`)) {
    index += 1;
  }
  return `${base} ${index}`;
}

function SceneList({
  scene,
  selection,
  onSelect,
}: {
  scene: DirectorScene;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <section className="scene-list">
      <h2>Scene</h2>
      <h3>Characters</h3>
      {scene.objects.filter((object) => object.kind === "character").map((object) => (
        <button
          key={object.id}
          className={`list-row ${selection.type === "object" && selection.id === object.id ? "selected" : ""}`}
          onClick={() => onSelect({ type: "object", id: object.id })}
        >
          <span className="dot" style={{ background: object.color }} />
          <span>{object.name}</span>
        </button>
      ))}
      <h3>Props & Set</h3>
      {scene.objects.filter((object) => object.kind === "prop").map((object) => (
        <button
          key={object.id}
          className={`list-row ${selection.type === "object" && selection.id === object.id ? "selected" : ""}`}
          onClick={() => onSelect({ type: "object", id: object.id })}
        >
          <span className="dot neutral" />
          <span>{object.name}</span>
        </button>
      ))}
      <h3>Cameras</h3>
      {scene.cameras.map((camera) => (
        <button
          key={camera.id}
          className={`list-row ${selection.type === "camera" && selection.id === camera.id ? "selected" : ""}`}
          onClick={() => onSelect({ type: "camera", id: camera.id })}
        >
          <Camera size={13} />
          <span>{camera.name} {camera.lens}mm</span>
        </button>
      ))}
    </section>
  );
}

function CameraInspector({
  camera,
  onUpdate,
}: {
  camera: DirectorCamera;
  onUpdate: (id: string, patch: Partial<DirectorCamera>) => void;
}) {
  return (
    <div className="inspector">
      <LabeledInput label="Name" value={camera.name} onChange={(name) => onUpdate(camera.id, { name })} />
      <label className="field">
        <span>Lens</span>
        <input
          type="range"
          min="14"
          max="135"
          value={camera.lens}
          onChange={(event) => onUpdate(camera.id, { lens: Number(event.target.value) })}
        />
        <small>{camera.lens}mm</small>
      </label>
      <div className="pill-row">
        {lensOptions.map((lens) => (
          <button
            key={lens}
            className={camera.lens === lens ? "active" : ""}
            onClick={() => onUpdate(camera.id, { lens })}
          >
            {lens}
          </button>
        ))}
      </div>
      <VectorEditor label="Position" value={camera.position} onChange={(position) => onUpdate(camera.id, { position })} />
      <VectorEditor label="Look at" value={camera.lookAt} onChange={(lookAt) => onUpdate(camera.id, { lookAt })} />
      <label className="field">
        <span>Roll</span>
        <input
          type="range"
          min="-25"
          max="25"
          value={camera.roll}
          onChange={(event) => onUpdate(camera.id, { roll: Number(event.target.value) })}
        />
      </label>
      <div className="pill-row">
        {frameOptions.map((frame) => (
          <button
            key={frame}
            className={camera.frame === frame ? "active" : ""}
            onClick={() => onUpdate(camera.id, { frame })}
          >
            {frame}
          </button>
        ))}
      </div>
    </div>
  );
}

function ObjectInspector({
  object,
  onUpdate,
}: {
  object: BoardObject;
  onUpdate: (id: string, patch: Partial<BoardObject>) => void;
}) {
  return (
    <div className="inspector">
      <LabeledInput label="Name" value={object.name} onChange={(name) => onUpdate(object.id, { name })} />
      <VectorEditor label="Position" value={object.position} onChange={(position) => onUpdate(object.id, { position })} />
      <label className="field">
        <span>Rotation</span>
        <input
          type="range"
          min="-3.14"
          max="3.14"
          step="0.01"
          value={object.rotationY}
          onChange={(event) => onUpdate(object.id, { rotationY: Number(event.target.value) })}
        />
      </label>
      <label className="field">
        <span>Scale</span>
        <input
          type="range"
          min="0.1"
          max="4"
          step="0.05"
          value={object.scale}
          onChange={(event) => onUpdate(object.id, { scale: Number(event.target.value) })}
        />
        <small>{object.scale.toFixed(2)}</small>
      </label>
      <label className="field">
        <span>Color</span>
        <input type="color" value={object.color} onChange={(event) => onUpdate(object.id, { color: event.target.value })} />
      </label>
    </div>
  );
}

function SceneInspector({
  scene,
  onUpdateName,
  onUpdateSlug,
  onUpdateWorld,
  collisionAlignment,
  sceneSizing,
  onDelete,
}: {
  scene: DirectorScene;
  onUpdateName: (name: string) => void;
  onUpdateSlug: (slug: string) => void;
  onUpdateWorld: (patch: Partial<DirectorScene["world"]>) => void;
  collisionAlignment?: CollisionAlignmentReadout;
  sceneSizing?: SceneSizingReadout;
  onDelete: (scene: DirectorScene) => void;
}) {
  return (
    <div className="inspector">
      <LabeledInput label="Name" value={scene.name} onChange={onUpdateName} />
      <LabeledInput label="Slug" value={scene.slug} onChange={onUpdateSlug} />
      <div className="readonly-block">
        <span>Assets</span>
        <strong>{scene.assets.name}</strong>
        <small>{scene.origin} · {scene.assets.source}</small>
      </div>
      {scene.assets.collision && (
        <div className="readonly-block">
          <span>Collider Scale</span>
          <strong>
            {collisionAlignment
              ? `${collisionAlignment.scale.toFixed(3)}x`
              : "Auto"}
          </strong>
          <small>
            {collisionAlignment
              ? `${formatAxisSigns(collisionAlignment.axes)} · score ${collisionAlignment.score.toFixed(2)}`
              : "waiting for assets"}
          </small>
        </div>
      )}
      <div className="readonly-block">
        <span>Object Scale</span>
        <strong>{(sceneSizing?.entityScale ?? getNewObjectScale(scene)).toFixed(3)}x</strong>
        <small>
          {sceneSizing
            ? `${sceneSizing.source} · span ${sceneSizing.horizontalSpan.toFixed(2)}`
            : "waiting for scene size"}
        </small>
      </div>
      <VectorEditor
        label="Position"
        value={scene.world.transform.position}
        onChange={(position) =>
          onUpdateWorld({ transform: { ...scene.world.transform, position } })
        }
      />
      <RotationEditor
        value={scene.world.transform.rotation}
        onChange={(rotation) =>
          onUpdateWorld({ transform: { ...scene.world.transform, rotation } })
        }
      />
      <div className="pill-row">
        {orientationPresets.map((preset) => (
          <button
            key={preset.label}
            className={
              rotationsMatch(scene.world.transform.rotation, preset.rotation)
                ? "active"
                : ""
            }
            onClick={() =>
              onUpdateWorld({
                transform: {
                  ...scene.world.transform,
                  rotation: preset.rotation,
                },
              })
            }
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Grid Y</span>
        <input
          type="number"
          step="0.05"
          value={scene.world.gridY ?? 0}
          onChange={(event) => onUpdateWorld({ gridY: Number(event.target.value) })}
        />
      </label>
      <div className="pill-row">
        <button
          onClick={() =>
            onUpdateWorld({ gridY: Number(((scene.world.gridY ?? 0) - 0.1).toFixed(2)) })
          }
        >
          -0.1
        </button>
        <button
          onClick={() =>
            onUpdateWorld({ gridY: Number(((scene.world.gridY ?? 0) + 0.1).toFixed(2)) })
          }
        >
          +0.1
        </button>
        <button onClick={() => onUpdateWorld({ gridY: undefined })}>Reset</button>
      </div>
      <label className="field">
        <span>Scale</span>
        <input
          type="range"
          min="0.1"
          max="3"
          step="0.05"
          value={scene.world.transform.scale}
          onChange={(event) =>
            onUpdateWorld({
              transform: {
                ...scene.world.transform,
                scale: Number(event.target.value),
              },
            })
          }
        />
        <small>{scene.world.transform.scale.toFixed(2)}</small>
      </label>
      <label className="field">
        <span>Opacity</span>
        <input
          type="range"
          min="0.15"
          max="1"
          step="0.05"
          value={scene.world.opacity}
          onChange={(event) => onUpdateWorld({ opacity: Number(event.target.value) })}
        />
      </label>
      <div className="pill-row">
        {(["auto", "quality", "balanced", "fast"] as const).map((mode) => (
          <button
            key={mode}
            className={scene.world.renderMode === mode ? "active" : ""}
            onClick={() => onUpdateWorld({ renderMode: mode })}
          >
            {mode}
          </button>
        ))}
      </div>
      <button
        className="full-button"
        onClick={() =>
          onUpdateWorld({
            collision: {
              ...scene.world.collision,
              visibleInEditor: !scene.world.collision.visibleInEditor,
            },
          })
        }
      >
        {scene.world.collision.visibleInEditor ? <EyeOff size={14} /> : <Eye size={14} />}
        Collision debug
      </button>
      {scene.origin === "user" && (
        <button className="full-button danger-button" onClick={() => onDelete(scene)}>
          <Trash2 size={14} />
          Delete Scene
        </button>
      )}
    </div>
  );
}

function ShotInspector({ shot, camera }: { shot: Shot; camera?: DirectorCamera }) {
  return (
    <div className="inspector">
      <div className="readonly-block">
        <span>{shot.name}</span>
        <strong>{shot.frame} · {shot.lens}mm</strong>
        <small>{camera?.name ?? "missing camera"} · {shot.duration}</small>
      </div>
      {shot.thumbnail && <img className="shot-inspector-image" src={shot.thumbnail} alt="" />}
    </div>
  );
}

function ViewpointReadout({
  viewpoint,
}: {
  viewpoint?: EditorViewpoint;
}) {
  const eyeValue = viewpoint ? formatTuple(viewpoint.eye) : "";
  const targetValue = viewpoint ? formatTuple(viewpoint.target) : "";

  return (
    <div
      className="viewpoint-readout"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="viewpoint-head">
        <strong>Viewpoint</strong>
      </div>
      {viewpoint ? (
        <div className="viewpoint-fields">
          <ViewpointValue label="eye" value={eyeValue} />
          <ViewpointValue label="target" value={targetValue} />
        </div>
      ) : (
        <small>waiting</small>
      )}
    </div>
  );
}

function ViewpointValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="viewpoint-field">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

function CameraPreview({
  camera,
  previewImage,
  onCapture,
}: {
  camera?: DirectorCamera;
  previewImage?: string;
  onCapture: () => void;
}) {
  return (
    <div className="camera-preview">
      <div className="camera-preview-head">
        <span>{camera?.name ?? "No camera"}</span>
        <small>{camera?.lens ?? "--"}mm</small>
      </div>
      <div className="preview-window">
        {previewImage ? (
          <img src={previewImage} alt="" />
        ) : (
          <>
            <Video size={28} />
            <span>{camera?.frame ?? "Frame"}</span>
          </>
        )}
      </div>
      <button onClick={onCapture}><Check size={14} /> Capture Shot</button>
    </div>
  );
}

function ScaleReadout({
  scene,
  splatAlignment,
  collisionAlignment,
  sceneSizing,
}: {
  scene: DirectorScene;
  splatAlignment?: SplatAlignmentReadout;
  collisionAlignment?: CollisionAlignmentReadout;
  sceneSizing?: SceneSizingReadout;
}) {
  const worldScale = scene.world.transform.scale;
  const splatScale = splatAlignment
    ? formatScaleTuple(
        splatAlignment.axes.map(
          (axis) => axis * splatAlignment.scale * worldScale,
        ) as Vector3Tuple,
      )
    : undefined;
  const colliderScale = collisionAlignment
    ? formatScaleTuple(
        collisionAlignment.axes.map(
          (axis) => axis * collisionAlignment.scale * worldScale,
        ) as Vector3Tuple,
      )
    : undefined;

  if (!splatScale && !scene.assets.collision) return null;

  return (
    <div
      className="viewpoint-readout scale-readout"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="viewpoint-head">
        <strong>Scale</strong>
      </div>
      <div className="viewpoint-fields">
        {scene.assets.splat && (
          <ViewpointValue
            label="splat"
            value={splatScale ?? "waiting"}
          />
        )}
        {scene.assets.collision && (
          <ViewpointValue
            label="mesh"
            value={colliderScale ?? "waiting"}
          />
        )}
        <ViewpointValue
          label="object"
          value={`${(sceneSizing?.entityScale ?? getNewObjectScale(scene)).toFixed(3)}x`}
        />
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function VectorEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="vector-row">
        {value.map((component, index) => (
          <input
            key={index}
            type="number"
            step="0.1"
            value={component}
            onChange={(event) => {
              const next = [...value] as [number, number, number];
              next[index] = Number(event.target.value);
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function RotationEditor({
  value,
  onChange,
}: {
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
}) {
  return (
    <div className="field">
      <span>Rotation</span>
      <div className="vector-row">
        {value.map((component, index) => (
          <input
            key={index}
            type="number"
            step="15"
            value={radiansToDegrees(component)}
            onChange={(event) => {
              const next = [...value] as [number, number, number];
              next[index] = degreesToRadians(Number(event.target.value));
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function cloneTransform(transform: SceneTransform): SceneTransform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: transform.scale,
  };
}

function rotationsMatch(a: Vector3Tuple, b: Vector3Tuple) {
  return a.every((value, index) => Math.abs(value - b[index]) < 0.0001);
}

function radiansToDegrees(value: number) {
  return Math.round((value * 180) / Math.PI);
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function formatTuple(tuple: Vector3Tuple) {
  return `[${tuple.map((value) => value.toFixed(4)).join(", ")}]`;
}

function formatScaleTuple(tuple: Vector3Tuple) {
  return `[${tuple.map((value) => value.toFixed(3)).join(", ")}]`;
}

function formatAxisSigns(axes: CollisionAlignmentReadout["axes"]) {
  const labels = ["X", "Y", "Z"];
  return axes
    .map((axis, index) => `${axis < 0 ? "-" : "+"}${labels[index]}`)
    .join(" ");
}

function collisionAlignmentsEqual(
  a: CollisionAlignmentReadout | undefined,
  b: CollisionAlignmentReadout | undefined,
) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.scale - b.scale) < 0.0005 &&
    Math.abs(a.score - b.score) < 0.0005 &&
    a.source === b.source &&
    a.axes.every((axis, index) => axis === b.axes[index])
  );
}

function splatAlignmentsEqual(
  a: SplatAlignmentReadout | undefined,
  b: SplatAlignmentReadout | undefined,
) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.scale - b.scale) < 0.0005 &&
    Math.abs(a.score - b.score) < 0.0005 &&
    a.source === b.source &&
    a.axes.every((axis, index) => axis === b.axes[index])
  );
}

function sceneSizingsEqual(
  a: SceneSizingReadout | undefined,
  b: SceneSizingReadout | undefined,
) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.entityScale - b.entityScale) < 0.0005 &&
    Math.abs(a.horizontalSpan - b.horizontalSpan) < 0.0005 &&
    a.source === b.source &&
    a.size.every((value, index) => Math.abs(value - b.size[index]) < 0.0005)
  );
}

function getNewObjectScale(
  scene: DirectorScene,
  sceneSizing?: SceneSizingReadout,
) {
  const scale = scene.assets.defaults?.entityScale ?? sceneSizing?.entityScale ?? 1;
  return Number(clampNumber(scale, 0.1, 10).toFixed(3));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function modelName(model: string, index: number) {
  return `${model.charAt(0).toUpperCase()}${model.slice(1)} ${index}`;
}

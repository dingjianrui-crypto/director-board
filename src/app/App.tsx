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
  UserRound,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MAX_ENVIRONMENT_FILE_SIZE_BYTES,
  EnvironmentValidationError,
  formatCameraName,
  parseBuiltInEnvironmentManifest,
  validateEnvironmentUploadFolder,
} from "../environment/index.js";
import { createStarterScene, proceduralTemplate } from "./sample-data";
import {
  loadUploadedEnvironmentTemplates,
  saveUploadedEnvironmentTemplate,
} from "./project-storage";
import type {
  BoardObject,
  BoardObjectKind,
  DirectorCamera,
  DirectorScene,
  EnvironmentTransform,
  EnvironmentTemplate,
  Selection,
  Shot,
  Vector3Tuple,
  ViewMode,
} from "./types";
import { ThreeViewport, type ThreeViewportHandle } from "./ThreeViewport";

const frameOptions = ["EWS", "WS", "FS", "MS", "MCU", "CU", "ECU", "OTS"];
const lensOptions = [14, 18, 24, 28, 35, 50, 65, 85, 100, 135];
const DEFAULT_SCAN_TRANSFORM: EnvironmentTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
};
const BUILT_IN_ENVIRONMENT_MANIFEST_PATH = "/assets/environments/manifest.json";

const orientationPresets = [
  { label: "Spark", rotation: [0, 0, 0] },
  { label: "Z-up", rotation: [-Math.PI / 2, 0, 0] },
  { label: "Flip Z", rotation: [0, 0, Math.PI] },
] satisfies Array<{ label: string; rotation: Vector3Tuple }>;

export function App() {
  const viewportRef = useRef<ThreeViewportHandle>(null);
  const [templates, setTemplates] = useState<EnvironmentTemplate[]>([
    proceduralTemplate,
  ]);
  const [scenes, setScenes] = useState<DirectorScene[]>([createStarterScene()]);
  const [activeSceneId, setActiveSceneId] = useState("scene-kitchen-argument");
  const [selection, setSelection] = useState<Selection>({ type: "camera", id: "cam-a" });
  const [viewMode, setViewMode] = useState<ViewMode>("move");
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [previewImage, setPreviewImage] = useState<string | undefined>();
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    let cancelled = false;

    async function loadEnvironmentLibrary() {
      let builtInTemplates: EnvironmentTemplate[] = [];
      let uploadedTemplates: EnvironmentTemplate[] = [];

      try {
        const response = await fetch(BUILT_IN_ENVIRONMENT_MANIFEST_PATH);
        if (!response.ok) {
          throw new Error(`Manifest request failed with ${response.status}`);
        }
        builtInTemplates = parseBuiltInEnvironmentManifest(
          await response.json(),
        ) as EnvironmentTemplate[];
      } catch {
        if (!cancelled) setStatus("Could not load built-in environment manifest.");
      }

      try {
        uploadedTemplates = await loadUploadedEnvironmentTemplates();
      } catch {
        if (!cancelled) setStatus("Could not restore uploaded environment templates.");
      }

      if (cancelled || (builtInTemplates.length === 0 && uploadedTemplates.length === 0)) {
        return;
      }

      setTemplates((current) => {
        const existingIds = new Set(current.map((template) => template.id));
        const additions = [...builtInTemplates, ...uploadedTemplates].filter(
          (template) => !existingIds.has(template.id),
        );
        if (additions.length === 0) return current;
        return [...current, ...additions];
      });
    }

    void loadEnvironmentLibrary();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeScene = scenes.find((scene) => scene.id === activeSceneId) ?? scenes[0];
  const activeTemplate =
    templates.find((template) => template.id === activeScene.environment.templateId) ??
    proceduralTemplate;
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

  const environmentLibraryLabel = useMemo(
    () => `${templates.length} template${templates.length === 1 ? "" : "s"}`,
    [templates.length],
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
  }

  function createSceneFromTemplate(template: EnvironmentTemplate) {
    const sceneNumber = scenes.length + 1;
    const environment = createEnvironmentFromTemplate(template);
    const scene: DirectorScene = {
      id: `scene-${Date.now().toString(36)}`,
      name: `${template.name} Scene ${sceneNumber}`,
      slug: "INT. SCAN - DAY",
      environment,
      objects: [],
      cameras: [],
      shots: [],
    };

    setScenes((current) => [...current, scene]);
    setActiveSceneId(scene.id);
    setSelection({ type: "environment" });
    setStatus(`Created ${scene.name}`);
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
      scale: 1,
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
          : { type: "environment" },
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
            : { type: "environment" },
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

  function updateEnvironment(patch: Partial<DirectorScene["environment"]>) {
    updateScene((scene) => ({
      ...scene,
      environment: {
        ...scene.environment,
        ...patch,
        collision: patch.collision
          ? { ...scene.environment.collision, ...patch.collision }
          : scene.environment.collision,
        transform: patch.transform ?? scene.environment.transform,
      },
    }));
  }

  async function handleEnvironmentUpload(files: FileList | null) {
    if (!files) return;

    try {
      const fileArray = Array.from(files);
      const validated = validateEnvironmentUploadFolder(fileArray, {
        maxFileSizeBytes: DEFAULT_MAX_ENVIRONMENT_FILE_SIZE_BYTES,
      });
      const template: EnvironmentTemplate = {
        id: `template-${Date.now().toString(36)}`,
        name: validated.splat.name.replace(/\.[^.]+$/, ""),
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
          transform: cloneTransform(DEFAULT_SCAN_TRANSFORM),
        },
      };

      await saveUploadedEnvironmentTemplate(template);
      setTemplates((current) => [...current, template]);
      createSceneFromTemplate(template);
    } catch (error) {
      if (error instanceof EnvironmentValidationError) {
        setStatus(error.message);
        return;
      }

      setStatus("Could not import environment folder.");
    }
  }

  function captureShot() {
    const camera = selectedCamera ?? activeScene.cameras[0];
    if (!camera) {
      setStatus("Add a camera before capturing a shot.");
      return;
    }

    const thumbnail = viewportRef.current?.capture(camera.id);
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Clapperboard size={16} />
          <span>DirectorBoard</span>
        </div>
        <button className="toolbar-button"><Save size={14} /> File</button>
        <button className="toolbar-button"><Download size={14} /> Export</button>
        <div className="scene-title">
          <strong>{activeScene.name}</strong>
          <span>{activeScene.slug}</span>
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
            <h2>Environment</h2>
            {templates.map((template) => {
              const isActiveTemplate = template.id === activeTemplate.id;
              return (
                <button
                  key={template.id}
                  className={`list-row ${
                    isActiveTemplate && selection.type === "environment" ? "selected" : ""
                  }`}
                  onClick={() =>
                    isActiveTemplate
                      ? setSelection({ type: "environment" })
                      : createSceneFromTemplate(template)
                  }
                >
                  <span className={`dot ${isActiveTemplate ? "cyan" : "neutral"}`} />
                  <span>{template.name}</span>
                </button>
              );
            })}
            <label className="mini-toggle">
              <input
                checked={activeScene.environment.visible}
                onChange={(event) => updateEnvironment({ visible: event.target.checked })}
                type="checkbox"
              />
              splat visible
            </label>
            <label className="mini-toggle">
              <input
                checked={activeScene.environment.collision.visibleInEditor}
                onChange={(event) =>
                  updateEnvironment({
                    collision: {
                      ...activeScene.environment.collision,
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
              onClick={() => createSceneFromTemplate(activeTemplate)}
            >
              <Plus size={14} /> New scene from template
            </button>
            <label className="full-button file-button">
              <FileUp size={14} /> Import environment folder
              <input
                type="file"
                multiple
                onChange={(event) => handleEnvironmentUpload(event.currentTarget.files)}
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              />
            </label>
            <p className="hint">{environmentLibraryLabel} in project library</p>
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
            template={activeTemplate}
            selectedCameraId={selectedCamera?.id}
            selection={selection}
            showGrid={showGrid}
            showLabels={showLabels}
            onSelect={setSelection}
            onUpdateCamera={updateCamera}
            onStatus={setStatus}
          />
          <div className="viewport-overlays">
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
            <button className={selection.type === "object" ? "active" : ""}>Object</button>
            <button className={selection.type === "camera" ? "active" : ""}>Camera</button>
            <button className={selection.type === "shot" ? "active" : ""}>Shot</button>
          </div>
          {selection.type === "environment" && (
            <EnvironmentInspector
              scene={activeScene}
              template={activeTemplate}
              onUpdate={updateEnvironment}
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
            <button
              key={shot.id}
              className={`shot-card ${selection.type === "shot" && selection.id === shot.id ? "selected" : ""}`}
              onClick={() => setSelection({ type: "shot", id: shot.id })}
            >
              <span className="shot-number">{index + 1}</span>
              {shot.thumbnail ? (
                <img src={shot.thumbnail} alt="" />
              ) : (
                <span className="shot-placeholder"><Video size={22} /></span>
              )}
              <strong>{shot.name}</strong>
              <small>{shot.frame} · {shot.lens}mm · {shot.duration}</small>
            </button>
          ))}
        </div>
        <span className="status">{status}</span>
      </footer>
    </div>
  );
}

function createEnvironmentFromTemplate(
  template: EnvironmentTemplate,
): DirectorScene["environment"] {
  const transform = template.defaults?.transform ?? {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  };

  return {
    templateId: template.id,
    transform: cloneTransform(transform),
    visible: template.defaults?.visible ?? true,
    opacity: template.defaults?.opacity ?? 1,
    renderMode: template.defaults?.renderMode ?? "auto",
    gridY: template.defaults?.gridY,
    collision: {
      visibleInEditor: template.defaults?.collision?.visibleInEditor ?? false,
      displayMode: template.defaults?.collision?.displayMode ?? "hidden",
    },
  };
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
          min="0.5"
          max="1.8"
          step="0.05"
          value={object.scale}
          onChange={(event) => onUpdate(object.id, { scale: Number(event.target.value) })}
        />
      </label>
      <label className="field">
        <span>Color</span>
        <input type="color" value={object.color} onChange={(event) => onUpdate(object.id, { color: event.target.value })} />
      </label>
    </div>
  );
}

function EnvironmentInspector({
  scene,
  template,
  onUpdate,
}: {
  scene: DirectorScene;
  template: EnvironmentTemplate;
  onUpdate: (patch: Partial<DirectorScene["environment"]>) => void;
}) {
  return (
    <div className="inspector">
      <div className="readonly-block">
        <span>Template</span>
        <strong>{template.name}</strong>
        <small>{template.source}</small>
      </div>
      <VectorEditor
        label="Position"
        value={scene.environment.transform.position}
        onChange={(position) =>
          onUpdate({ transform: { ...scene.environment.transform, position } })
        }
      />
      <RotationEditor
        value={scene.environment.transform.rotation}
        onChange={(rotation) =>
          onUpdate({ transform: { ...scene.environment.transform, rotation } })
        }
      />
      <div className="pill-row">
        {orientationPresets.map((preset) => (
          <button
            key={preset.label}
            className={
              rotationsMatch(scene.environment.transform.rotation, preset.rotation)
                ? "active"
                : ""
            }
            onClick={() =>
              onUpdate({
                transform: {
                  ...scene.environment.transform,
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
          value={scene.environment.gridY ?? 0}
          onChange={(event) => onUpdate({ gridY: Number(event.target.value) })}
        />
      </label>
      <div className="pill-row">
        <button
          onClick={() =>
            onUpdate({ gridY: Number(((scene.environment.gridY ?? 0) - 0.1).toFixed(2)) })
          }
        >
          -0.1
        </button>
        <button
          onClick={() =>
            onUpdate({ gridY: Number(((scene.environment.gridY ?? 0) + 0.1).toFixed(2)) })
          }
        >
          +0.1
        </button>
        <button onClick={() => onUpdate({ gridY: undefined })}>Reset</button>
      </div>
      <label className="field">
        <span>Scale</span>
        <input
          type="range"
          min="0.1"
          max="3"
          step="0.05"
          value={scene.environment.transform.scale}
          onChange={(event) =>
            onUpdate({
              transform: {
                ...scene.environment.transform,
                scale: Number(event.target.value),
              },
            })
          }
        />
        <small>{scene.environment.transform.scale.toFixed(2)}</small>
      </label>
      <label className="field">
        <span>Opacity</span>
        <input
          type="range"
          min="0.15"
          max="1"
          step="0.05"
          value={scene.environment.opacity}
          onChange={(event) => onUpdate({ opacity: Number(event.target.value) })}
        />
      </label>
      <div className="pill-row">
        {(["auto", "quality", "balanced", "fast"] as const).map((mode) => (
          <button
            key={mode}
            className={scene.environment.renderMode === mode ? "active" : ""}
            onClick={() => onUpdate({ renderMode: mode })}
          >
            {mode}
          </button>
        ))}
      </div>
      <button
        className="full-button"
        onClick={() =>
          onUpdate({
            collision: {
              ...scene.environment.collision,
              visibleInEditor: !scene.environment.collision.visibleInEditor,
            },
          })
        }
      >
        {scene.environment.collision.visibleInEditor ? <EyeOff size={14} /> : <Eye size={14} />}
        Collision debug
      </button>
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

function cloneTransform(transform: EnvironmentTransform): EnvironmentTransform {
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

function modelName(model: string, index: number) {
  return `${model.charAt(0).toUpperCase()}${model.slice(1)} ${index}`;
}

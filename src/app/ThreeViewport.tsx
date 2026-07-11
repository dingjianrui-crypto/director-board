import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type {
  BoardObject,
  BoardObjectKind,
  CharacterPose,
  DirectorCamera,
  DirectorScene,
  EditorViewpoint,
  Selection,
  ViewMode,
} from "./types";

type SparkModule = {
  SparkRenderer: new (options: { renderer: THREE.WebGLRenderer }) => THREE.Object3D & {
    defaultView?: {
      sort32?: boolean;
      sortRadial?: boolean;
    };
    update?: (options: { scene: THREE.Scene; camera: THREE.Camera }) => Promise<void> | void;
    dispose?: () => void;
  };
  SplatMesh: new (options: Record<string, unknown>) => THREE.Object3D & {
    initialized?: Promise<unknown>;
    isInitialized?: boolean;
    opacity?: number;
    dispose?: () => void;
    getBoundingBox?: (centersOnly?: boolean) => THREE.Box3;
  };
};

type LoadedGltf = {
  asset?: {
    generator?: string;
  };
  parser?: {
    json?: {
      asset?: {
        generator?: string;
      };
      nodes?: Array<{
        matrix?: number[];
      }>;
    };
  };
};

export type ThreeViewportHandle = {
  capture: (
    cameraId: string,
    options?: {
      width?: number;
      height?: number;
    },
  ) => Promise<string | undefined>;
  captureViewpoint: (options?: {
    width?: number;
    height?: number;
  }) => Promise<string | undefined>;
  getViewpoint: () => EditorViewpoint | undefined;
};

export type CollisionAlignmentReadout = {
  scale: number;
  axes: [number, number, number];
  score: number;
  source: "splat-bounds" | "splat-transform" | "default";
};

export type SplatAlignmentReadout = {
  scale: number;
  axes: [number, number, number];
  score: number;
  source: "auto" | "default" | "manifest";
};

export type SceneSizingReadout = {
  entityScale: number;
  horizontalSpan: number;
  size: [number, number, number];
  source: "collision" | "splat" | "manifest" | "default";
};

type Props = {
  scene: DirectorScene;
  selection: Selection;
  selectedCameraId?: string;
  showGrid: boolean;
  showLabels: boolean;
  viewMode: ViewMode;
  onSelect: (selection: Selection) => void;
  onUpdateCamera: (cameraId: string, patch: Partial<DirectorCamera>) => void;
  onUpdateObject: (objectId: string, patch: Partial<BoardObject>) => void;
  onSplatAlignmentChange: (
    sceneId: string,
    alignment: SplatAlignmentReadout | undefined,
  ) => void;
  onCollisionAlignmentChange: (
    sceneId: string,
    alignment: CollisionAlignmentReadout | undefined,
  ) => void;
  onSceneSizingChange: (
    sceneId: string,
    sizing: SceneSizingReadout | undefined,
  ) => void;
  onViewpointChange: (viewpoint: EditorViewpoint) => void;
  onStatus: (message: string) => void;
};

type CameraHandleKind = "position" | "lookAt" | "axisPlane";
type CameraAxisPlane = "xy" | "xz" | "yz";

type CameraHandle = {
  cameraId: string;
  kind: CameraHandleKind;
  axisPlane?: CameraAxisPlane;
};

type CameraDragState = CameraHandle & {
  pointerId: number;
  plane: THREE.Plane;
  offset: THREE.Vector3;
  updateKey: "position" | "lookAt";
};

type ObjectHandleKind = "floorPlane" | "rotateY";

type ObjectHandle = {
  objectId: string;
  kind: ObjectHandleKind;
};

type ObjectDragState = ObjectHandle & {
  pointerId: number;
  plane: THREE.Plane;
  offset: THREE.Vector3;
  startAngle?: number;
  startRotationY?: number;
};

type SceneFrameSource = "splat" | "collision" | "spawn" | "manifest";

type SceneFrameClaim = {
  key: string;
  priority: number;
};

type Viewpoint = {
  eye: THREE.Vector3;
  target: THREE.Vector3;
};

type ScreenLabelAnchor = {
  element: HTMLSpanElement;
  fallbackPosition: THREE.Vector3;
  objectId?: string;
  cameraId?: string;
};

type ScreenLabelPoint = {
  x: number;
  y: number;
  visible: boolean;
};

type ScreenRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const SCAN_SCENE_SCALE = 3;
const SPARK_PHYSICS_SPAWN_EYE = new THREE.Vector3(0, 1.48, 0);
const SPARK_PHYSICS_SPAWN_TARGET = new THREE.Vector3(0, 1.48, 1);
const HUMAN_EYE_HEIGHT = 1.55;
const HUMAN_COLLISION_RADIUS = 0.18;
const HUMAN_MAX_STEP_HEIGHT = 0.35;
const HUMAN_MAX_GROUND_DROP = 1;
const HUMAN_GROUND_RAY_HEADROOM = 0.25;
const KEYBOARD_NAV_SPEED = 1.4;
const KEYBOARD_NAV_VERTICAL_LOOK_THRESHOLD = 0.18;
const DEFAULT_CAPTURE_SIZE = { width: 1920, height: 1080 };
const PLACEABLE_SURFACE_MIN_UP = Math.cos(THREE.MathUtils.degToRad(35));
const COLLISION_FLOOR_BAND_MIN_HEIGHT = 0.08;
const COLLISION_FLOOR_LOW_QUANTILE = 0.05;
const REFERENCE_SCENE_HORIZONTAL_SPAN = 52;
const MIN_ADAPTIVE_ENTITY_SCALE = 0.55;
const MAX_ADAPTIVE_ENTITY_SCALE = 3;
const SUPPORTED_OBJECT_MODEL_TYPES = new Set(["fbx", "glb", "gltf"]);
const OBJECT_MOVE_GIZMO_TARGET_PX = 96;
const OBJECT_ROTATE_GIZMO_TARGET_PX = 92;
const CAMERA_AXIS_GIZMO_TARGET_PX = 104;
const CAMERA_BILLBOARD_HANDLE_TARGET_PX = 48;
const MIN_GIZMO_SCREEN_SCALE = 1;
const MAX_GIZMO_SCREEN_SCALE = 8;
const WEBGL_LABEL_HEIGHT = 0.16;
const WEBGL_LABEL_GAP = 0.08;
const EDITOR_CANVAS_PIXEL_RATIO = 1;

export const ThreeViewport = forwardRef<ThreeViewportHandle, Props>(
  function ThreeViewport(
    {
      scene,
      selection,
      selectedCameraId,
      showGrid,
      showLabels,
      viewMode,
      onSelect,
      onUpdateCamera,
      onUpdateObject,
      onSplatAlignmentChange,
      onCollisionAlignmentChange,
      onSceneSizingChange,
      onViewpointChange,
      onStatus,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const editorCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const gridRef = useRef<THREE.GridHelper | null>(null);
    const sceneWorldRootRef = useRef<THREE.Group | null>(null);
    const objectRootRef = useRef<THREE.Group | null>(null);
    const cameraRootRef = useRef<THREE.Group | null>(null);
    const labelRootRef = useRef<THREE.Group | null>(null);
    const labelOverlayRef = useRef<HTMLDivElement | null>(null);
    const screenLabelAnchorsRef = useRef<ScreenLabelAnchor[]>([]);
    const collisionMeshRef = useRef<THREE.Object3D | null>(null);
    const splatMeshRef = useRef<
      (THREE.Object3D & {
        dispose?: () => void;
        getBoundingBox?: (centersOnly?: boolean) => THREE.Box3;
      }) | null
    >(null);
    const splatBoundsRef = useRef<THREE.Box3 | null>(null);
    const splatAlignmentRef = useRef<SplatAlignmentReadout | null>(null);
    const autoGridYRef = useRef<number | null>(null);
    const sparkRef = useRef<
      (THREE.Object3D & {
        update?: (options: { scene: THREE.Scene; camera: THREE.Camera }) => Promise<void> | void;
        dispose?: () => void;
      }) | null
    >(null);
    const raycasterRef = useRef(new THREE.Raycaster());
    const pointerRef = useRef(new THREE.Vector2());
    const hoveredHandleRef = useRef<CameraHandle | null>(null);
    const dragStateRef = useRef<CameraDragState | null>(null);
    const hoveredObjectHandleRef = useRef<ObjectHandle | null>(null);
    const objectDragStateRef = useRef<ObjectDragState | null>(null);
    const collisionWalkableFloorRef = useRef<{
      key: string;
      y: number | undefined;
    } | null>(null);
    const lastViewpointPublishRef = useRef<{
      time: number;
      key: string;
    } | null>(null);
    const keyboardNavKeysRef = useRef(new Set<string>());
    const collisionSnappedObjectKeysRef = useRef(new Set<string>());
    const framedSceneRef = useRef<{
      key: string;
      priority: number;
    } | null>(null);
    const objectModelCacheRef = useRef(new Map<string, Promise<THREE.Object3D>>());
    const failedObjectModelPathsRef = useRef(new Set<string>());

    const latestRef = useRef({
      scene,
      selection,
      selectedCameraId,
      showGrid,
      showLabels,
      viewMode,
      onSelect,
      onUpdateCamera,
      onUpdateObject,
      onSplatAlignmentChange,
      onCollisionAlignmentChange,
      onSceneSizingChange,
      onViewpointChange,
      onStatus,
    });

    latestRef.current = {
      scene,
      selection,
      selectedCameraId,
      showGrid,
      showLabels,
      viewMode,
      onSelect,
      onUpdateCamera,
      onUpdateObject,
      onSplatAlignmentChange,
      onCollisionAlignmentChange,
      onSceneSizingChange,
      onViewpointChange,
      onStatus,
    };

    useImperativeHandle(ref, () => ({
      capture(cameraId: string, options?: { width?: number; height?: number }) {
        return captureCamera(cameraId, options);
      },
      captureViewpoint(options?: { width?: number; height?: number }) {
        return captureEditorViewpoint(options);
      },
      getViewpoint() {
        return getEditorViewpoint();
      },
    }));

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(EDITOR_CANVAS_PIXEL_RATIO);
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.setClearColor(0x11161d, 1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      host.appendChild(renderer.domElement);

      const threeScene = new THREE.Scene();
      threeScene.fog = new THREE.Fog(0x11161d, 8, 28);

      const editorCamera = new THREE.PerspectiveCamera(
        45,
        host.clientWidth / host.clientHeight,
        0.05,
        100,
      );
      editorCamera.position.set(5, 3.2, 5);

      const controls = new OrbitControls(editorCamera, renderer.domElement);
      controls.target.set(0, 0.85, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;

      const hemi = new THREE.HemisphereLight(0xdde8ff, 0x1f2730, 1.4);
      threeScene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 2.1);
      key.position.set(3.6, 5.5, 2.5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      threeScene.add(key);

      const grid = new THREE.GridHelper(20, 40, 0x2f3b49, 0x222a33);
      grid.position.y = 0;
      threeScene.add(grid);

      const sceneWorldRoot = new THREE.Group();
      sceneWorldRoot.name = "SceneWorldRoot";
      threeScene.add(sceneWorldRoot);
      const objectRoot = new THREE.Group();
      objectRoot.name = "Objects";
      threeScene.add(objectRoot);
      const cameraRoot = new THREE.Group();
      cameraRoot.name = "CameraRigs";
      threeScene.add(cameraRoot);
      const labelRoot = new THREE.Group();
      labelRoot.name = "Labels";
      threeScene.add(labelRoot);

      rendererRef.current = renderer;
      sceneRef.current = threeScene;
      editorCameraRef.current = editorCamera;
      controlsRef.current = controls;
      gridRef.current = grid;
      sceneWorldRootRef.current = sceneWorldRoot;
      objectRootRef.current = objectRoot;
      cameraRootRef.current = cameraRoot;
      labelRootRef.current = labelRoot;

      const resizeRendererToHost = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (width <= 0 || height <= 0) return;
        renderer.setPixelRatio(EDITOR_CANVAS_PIXEL_RATIO);
        renderer.setSize(width, height);
        editorCamera.aspect = width / height;
        editorCamera.updateProjectionMatrix();
        syncCameraMatrices(editorCamera);
        resetRendererViewport(renderer);
        updateScreenLabels();
      };
      const resizeObserver =
        typeof ResizeObserver === "undefined"
          ? undefined
          : new ResizeObserver(resizeRendererToHost);
      resizeObserver?.observe(host);
      const updatePointer = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      };
      const onPointerDown = (event: PointerEvent) => {
        updatePointer(event);
        clearKeyboardNavigation();
        if (startCameraHandleDrag(event)) return;
        if (startObjectHandleDrag(event)) return;
        pickSelection();
      };
      const onPointerMove = (event: PointerEvent) => {
        updatePointer(event);
        if (dragStateRef.current) {
          dragCameraHandle();
          return;
        }
        if (objectDragStateRef.current) {
          dragObjectHandle();
          return;
        }
        updateHoveredCameraHandle();
        updateHoveredObjectHandle();
        updateSelectableCursor();
      };
      const onPointerUp = (event: PointerEvent) => {
        stopCameraHandleDrag(event.pointerId);
        stopObjectHandleDrag(event.pointerId);
      };
      const onPointerLeave = () => {
        if (!dragStateRef.current && !objectDragStateRef.current) {
          setHoveredCameraHandle(null);
          setHoveredObjectHandle(null);
        }
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (!isKeyboardNavKey(event.code) || isTypingTarget(event.target)) return;
        event.preventDefault();
        keyboardNavKeysRef.current.add(event.code);
      };
      const onKeyUp = (event: KeyboardEvent) => {
        if (!isKeyboardNavKey(event.code)) return;
        keyboardNavKeysRef.current.delete(event.code);
      };
      const onBlur = () => {
        clearKeyboardNavigation();
      };
      const onVisibilityChange = () => {
        if (document.visibilityState !== "visible") clearKeyboardNavigation();
      };

      window.addEventListener("resize", resizeRendererToHost);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
      document.addEventListener("visibilitychange", onVisibilityChange);
      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerup", onPointerUp);
      renderer.domElement.addEventListener("pointercancel", onPointerUp);
      renderer.domElement.addEventListener("pointerleave", onPointerLeave);

      let rafId = 0;
      let lastFrameTime = performance.now();
      const renderLoop = () => {
        rafId = requestAnimationFrame(renderLoop);
        const frameTime = performance.now();
        const deltaTime = Math.min((frameTime - lastFrameTime) / 1000, 0.05);
        lastFrameTime = frameTime;
        updateKeyboardNavigation(deltaTime);
        controls.update();
        syncCameraMatrices(editorCamera);
        publishEditorViewpoint(frameTime);
        updateScreenLabels();
        updateCameraHandleFacing();
        updateScreenSizedGizmos();
        void sparkRef.current?.update?.({ scene: threeScene, camera: editorCamera });
        resetRendererViewport(renderer);
        renderer.clear(true, true, true);
        renderer.render(threeScene, editorCamera);
      };
      renderLoop();

      return () => {
        cancelAnimationFrame(rafId);
        resizeObserver?.disconnect();
        window.removeEventListener("resize", resizeRendererToHost);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointermove", onPointerMove);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        renderer.domElement.removeEventListener("pointercancel", onPointerUp);
        renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
        controls.dispose();
        splatMeshRef.current?.dispose?.();
        sparkRef.current?.dispose?.();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }, []);

    useEffect(() => {
      gridRef.current!.visible = showGrid;
      labelRootRef.current!.visible = showLabels;
      if (labelOverlayRef.current) {
        labelOverlayRef.current.hidden = !showLabels;
      }
    }, [showGrid, showLabels]);

    useEffect(() => {
      void rebuildSceneWorld();
    }, [scene.world, scene.assets.id]);

    useEffect(() => {
      alignGridToSceneGround(sceneWorldRootRef.current);
    }, [scene.world.gridY, scene.world.transform.position]);

    useEffect(() => {
      snapSceneObjectsToCollisionSurface();
      rebuildObjects();
      rebuildCameras();
      rebuildLabels();
    }, [scene.objects, scene.cameras, selection, showLabels, viewMode]);

    async function rebuildSceneWorld() {
      const root = sceneWorldRootRef.current;
      if (!root) return;

      clearGroup(root);
      splatMeshRef.current?.dispose?.();
      splatMeshRef.current = null;
      splatBoundsRef.current = null;
      splatAlignmentRef.current = null;
      collisionMeshRef.current = null;
      autoGridYRef.current = null;
      latestRef.current.onSplatAlignmentChange(scene.id, undefined);
      latestRef.current.onCollisionAlignmentChange(scene.id, undefined);
      latestRef.current.onSceneSizingChange(scene.id, undefined);

      applySceneWorldTransform(root);
      alignGridToSceneGround(root);

      frameEditorCameraAtSparkPhysicsSpawn(root);
      frameEditorCameraAtManifestViewpoint();

      if (scene.assets.splat) {
        await loadSplat(root);
      } else if (scene.world.visible && scene.assets.source !== "blank") {
        buildProceduralKitchen(root);
      }

      if (scene.assets.collision) {
        await loadCollisionMesh(root);
      } else if (scene.assets.source === "procedural") {
        const collision = buildProceduralCollision();
        root.add(collision);
        collisionMeshRef.current = collision;
        publishSceneSizing("collision");
      }
    }

    function applySceneWorldTransform(root: THREE.Object3D) {
      const { position, rotation, scale } = latestRef.current.scene.world.transform;
      root.position.set(position[0], position[1], position[2]);
      const effectiveRotation = getEffectiveSceneWorldRotation(rotation);
      root.rotation.set(
        effectiveRotation[0],
        effectiveRotation[1],
        effectiveRotation[2],
      );
      root.scale.setScalar(scale);
    }

    function getEffectiveSceneWorldRotation(
      rotation: [number, number, number],
    ): [number, number, number] {
      const hasLegacyRootFlip =
        latestRef.current.scene.assets.source === "upload" &&
        Math.abs(rotation[0] - Math.PI) < 0.0001 &&
        Math.abs(rotation[1]) < 0.0001 &&
        Math.abs(rotation[2]) < 0.0001;

      return hasLegacyRootFlip ? [0, 0, 0] : rotation;
    }

    async function ensureSpark() {
      if (sparkRef.current) return true;
      const renderer = rendererRef.current;
      const threeScene = sceneRef.current;
      const editorCamera = editorCameraRef.current;
      if (!renderer || !threeScene || !editorCamera) return false;

      try {
        const sparkModule = (await import("@sparkjsdev/spark")) as unknown as SparkModule;
        const spark = new sparkModule.SparkRenderer({ renderer });
        if (spark.defaultView) {
          spark.defaultView.sort32 = true;
          spark.defaultView.sortRadial = true;
        }
        threeScene.add(spark);
        sparkRef.current = spark;
        return true;
      } catch (error) {
        console.warn("Spark initialization failed", error);
        const message = error instanceof Error ? error.message : String(error);
        latestRef.current.onStatus(`Spark could not be initialized: ${message}`);
        return false;
      }
    }

    async function loadSplat(root: THREE.Group) {
      const ok = await ensureSpark();
      if (!ok || !scene.assets.splat) {
        buildProceduralKitchen(root);
        return;
      }

      try {
        const sparkModule = (await import("@sparkjsdev/spark")) as unknown as SparkModule;
        const mode = latestRef.current.scene.world.renderMode;
        const splat = new sparkModule.SplatMesh({
          url: scene.assets.splat.objectUrl ?? scene.assets.splat.path,
          fileName: scene.assets.splat.path,
          fileType: scene.assets.splat.fileType,
          raycastable: false,
          lod: mode !== "quality",
          paged: scene.assets.splat.fileType === "rad",
          onProgress: (event: ProgressEvent) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              latestRef.current.onStatus(`Loading splat ${percent}%`);
            } else {
              latestRef.current.onStatus("Loading splat");
            }
          },
          onLoad: () => latestRef.current.onStatus("Scene splat ready"),
        });
        splat.visible = latestRef.current.scene.world.visible;
        splat.opacity = latestRef.current.scene.world.visible
          ? latestRef.current.scene.world.opacity
          : 0;
        const alignment = applySplatCoordinateFix(splat);
        root.add(splat);
        splatMeshRef.current = splat;
        splatAlignmentRef.current = alignment;
        latestRef.current.onSplatAlignmentChange(
          latestRef.current.scene.id,
          alignment,
        );
        await splat.initialized?.catch(() => undefined);
        updateSplatBounds(splat);
        publishSceneSizing("splat");
        if (latestRef.current.scene.world.visible) {
          void retryFrameEditorCameraInsideSplat(root, splat);
        }
      } catch (error) {
        latestRef.current.onStatus("Splat load failed; showing collision/blockout fallback.");
        buildProceduralKitchen(root);
      }
    }

    async function retryFrameEditorCameraInsideSplat(
      root: THREE.Object3D,
      splat: THREE.Object3D & { getBoundingBox?: (centersOnly?: boolean) => THREE.Box3 },
    ) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (sceneWorldRootRef.current !== root || splatMeshRef.current !== splat) return;
        if (frameEditorCameraInsideSplat(root, splat)) return;
        await waitForFrame(80);
      }
    }

    function frameEditorCameraInsideSplat(
      root: THREE.Object3D,
      splat: THREE.Object3D & { getBoundingBox?: (centersOnly?: boolean) => THREE.Box3 },
    ) {
      if (!splat.getBoundingBox) return false;

      const bounds = splat.getBoundingBox(true).clone();
      if (!isUsableBox(bounds)) return false;

      root.updateWorldMatrix(true, true);
      splat.updateWorldMatrix(true, false);
      bounds.applyMatrix4(splat.matrixWorld);
      if (!isUsableBox(bounds)) return false;

      return frameEditorCameraInsideBounds(bounds, "splat");
    }

    function updateSplatBounds(
      splat: THREE.Object3D & { getBoundingBox?: (centersOnly?: boolean) => THREE.Box3 },
    ) {
      if (!splat.getBoundingBox) {
        splatBoundsRef.current = null;
        return;
      }

      const bounds = splat.getBoundingBox(true).clone();
      if (!isUsableBox(bounds)) {
        splatBoundsRef.current = null;
        return;
      }

      splat.updateMatrix();
      bounds.applyMatrix4(splat.matrix);
      splatBoundsRef.current = isUsableBox(bounds) ? bounds : null;
    }

    function frameEditorCameraInsideObject(
      object: THREE.Object3D,
      source: SceneFrameSource,
    ) {
      object.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(object);
      if (!isUsableBox(bounds)) return false;

      if (source === "collision") {
        const walkableViewpoint = findWalkableCollisionViewpoint(object, bounds);
        if (walkableViewpoint) {
          return frameEditorCameraAtViewpoint(walkableViewpoint, bounds, source);
        }
      }

      return frameEditorCameraInsideBounds(bounds, source);
    }

    function frameEditorCameraAtSparkPhysicsSpawn(root: THREE.Object3D) {
      if (latestRef.current.scene.assets.source === "procedural" || !latestRef.current.scene.assets.splat) {
        return false;
      }

      root.updateWorldMatrix(true, false);
      const viewpoint = {
        eye: SPARK_PHYSICS_SPAWN_EYE.clone().applyMatrix4(root.matrixWorld),
        target: SPARK_PHYSICS_SPAWN_TARGET.clone().applyMatrix4(root.matrixWorld),
      };

      return frameEditorCameraAtViewpoint(viewpoint, null, "spawn");
    }

    function frameEditorCameraAtManifestViewpoint() {
      const viewpoint = latestRef.current.scene.assets.defaults?.viewpoint;
      if (!viewpoint) return false;

      return frameEditorCameraAtViewpoint(
        {
          eye: new THREE.Vector3(...viewpoint.eye),
          target: new THREE.Vector3(...viewpoint.target),
        },
        null,
        "manifest",
      );
    }

    function findWalkableCollisionViewpoint(
      object: THREE.Object3D,
      bounds: THREE.Box3,
    ): Viewpoint | null {
      const meshes: Array<THREE.Mesh & { visible: boolean }> = [];
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          meshes.push(mesh as THREE.Mesh & { visible: boolean });
        }
      });
      if (meshes.length === 0) return null;

      const visibility = meshes.map((mesh) => mesh.visible);
      meshes.forEach((mesh) => {
        mesh.visible = true;
      });

      try {
        const raycaster = new THREE.Raycaster();
        const direction = new THREE.Vector3(0, -1, 0);
        const origin = new THREE.Vector3();
        const normalMatrix = new THREE.Matrix3();
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const maxHorizontal = Math.max(size.x, size.z, 0.001);
        const samples = createCollisionSamplePoints(bounds);
        const candidates: Array<{
          point: THREE.Vector3;
          centerDistance: number;
          edgePenalty: number;
        }> = [];

        for (const sample of samples) {
          origin.set(sample.x, bounds.max.y + Math.max(size.y * 0.1, 1), sample.z);
          raycaster.set(origin, direction);
          raycaster.far = Math.max(size.y * 2, 10);

          const hits = raycaster.intersectObjects(meshes, false);
          for (const hit of hits) {
            if (!hit.face) continue;

            normalMatrix.getNormalMatrix(hit.object.matrixWorld);
            const worldNormal = hit.face.normal
              .clone()
              .applyMatrix3(normalMatrix)
              .normalize();
            if (Math.abs(worldNormal.y) < 0.72) continue;

            const centerDistance =
              Math.hypot(hit.point.x - center.x, hit.point.z - center.z) /
              maxHorizontal;
            const edgePenalty = getHorizontalEdgePenalty(hit.point, bounds);
            candidates.push({
              point: hit.point.clone(),
              centerDistance,
              edgePenalty,
            });
          }
        }

        if (candidates.length === 0) return null;

        const lowestY = Math.min(...candidates.map((candidate) => candidate.point.y));
        const floorBand = Math.max(size.y * 0.04, 0.08);
        const floorCandidates = candidates.filter(
          (candidate) => candidate.point.y <= lowestY + floorBand,
        );
        const best = floorCandidates.reduce((currentBest, candidate) => {
          const candidateScore = candidate.centerDistance + candidate.edgePenalty;
          const bestScore = currentBest.centerDistance + currentBest.edgePenalty;
          return candidateScore < bestScore ? candidate : currentBest;
        });

        autoGridYRef.current = best.point.y;
        alignGridToSceneGround(sceneWorldRootRef.current);

        return createViewpointFromFloorPoint(best.point, bounds);
      } finally {
        meshes.forEach((mesh, index) => {
          mesh.visible = visibility[index];
        });
      }
    }

    function frameEditorCameraInsideBounds(
      bounds: THREE.Box3,
      source: SceneFrameSource,
    ) {
      const editorCamera = editorCameraRef.current;
      const controls = controlsRef.current;
      if (!editorCamera || !controls) return false;

      const claim = claimSceneFrame(source);
      if (!claim) return false;

      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const height = Math.max(size.y, 0.001);
      const depth = Math.max(size.z, 0.001);
      const eyeHeight = clamp(height * 0.38, 1.15, Math.max(1.15, height * 0.72));
      const travel = Math.min(Math.max(depth * 0.12, 0.5), Math.max(depth * 0.28, 0.5));
      const eye = new THREE.Vector3(
        center.x,
        bounds.min.y + eyeHeight,
        center.z + travel,
      );
      const target = new THREE.Vector3(
        center.x,
        eye.y,
        center.z - travel,
      );

      keepPointInsideBox(eye, bounds);
      keepPointInsideBox(target, bounds);

      editorCamera.position.copy(eye);
      editorCamera.near = 0.02;
      editorCamera.far = Math.max(100, size.length() * 8);
      editorCamera.lookAt(target);
      editorCamera.updateProjectionMatrix();
      controls.target.copy(target);
      controls.update();
      syncCameraMatrices(editorCamera);
      framedSceneRef.current = claim;
      return true;
    }

    function frameEditorCameraAtViewpoint(
      viewpoint: Viewpoint,
      bounds: THREE.Box3 | null,
      source: SceneFrameSource,
    ) {
      const editorCamera = editorCameraRef.current;
      const controls = controlsRef.current;
      if (!editorCamera || !controls) return false;

      const claim = claimSceneFrame(source);
      if (!claim) return false;

      const size = bounds?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(12, 4, 12);
      editorCamera.position.copy(viewpoint.eye);
      editorCamera.near = 0.02;
      editorCamera.far = Math.max(100, size.length() * 8);
      editorCamera.lookAt(viewpoint.target);
      editorCamera.updateProjectionMatrix();
      controls.target.copy(viewpoint.target);
      controls.update();
      syncCameraMatrices(editorCamera);
      framedSceneRef.current = claim;
      return true;
    }

    function alignGridToSceneGround(root: THREE.Object3D | null) {
      if (!gridRef.current) return;

      gridRef.current.position.y =
        latestRef.current.scene.world.gridY ??
        autoGridYRef.current ??
        root?.position.y ??
        0;
    }

    function updateKeyboardNavigation(deltaTime: number) {
      const camera = editorCameraRef.current;
      const controls = controlsRef.current;
      if (
        !camera ||
        !controls ||
        keyboardNavKeysRef.current.size === 0 ||
        dragStateRef.current ||
        objectDragStateRef.current
      ) {
        return;
      }

      const viewForward = new THREE.Vector3();
      camera.getWorldDirection(viewForward);
      const horizontalForward = viewForward.clone();
      horizontalForward.y = 0;
      if (horizontalForward.lengthSq() === 0) return;
      horizontalForward.normalize();

      const usesVerticalLook =
        Math.abs(viewForward.y) >= KEYBOARD_NAV_VERTICAL_LOOK_THRESHOLD;
      const forward = usesVerticalLook
        ? viewForward.clone().normalize()
        : horizontalForward;
      const right = new THREE.Vector3(
        -horizontalForward.z,
        0,
        horizontalForward.x,
      ).normalize();
      const move = new THREE.Vector3();
      const keys = keyboardNavKeysRef.current;

      if (keys.has("KeyW")) move.add(forward);
      if (keys.has("KeyS")) move.sub(forward);
      if (keys.has("KeyD")) move.add(right);
      if (keys.has("KeyA")) move.sub(right);
      if (move.lengthSq() === 0) return;

      move.normalize().multiplyScalar(KEYBOARD_NAV_SPEED * deltaTime);
      const nextPosition = camera.position.clone().add(move);
      const resolvedPosition = getKeyboardNavResolvedPosition(
        camera.position,
        nextPosition,
        usesVerticalLook && (keys.has("KeyW") || keys.has("KeyS")),
      );

      if (!resolvedPosition) return;

      const appliedMove = resolvedPosition.clone().sub(camera.position);
      camera.position.copy(resolvedPosition);
      controls.target.add(appliedMove);
    }

    function clearKeyboardNavigation() {
      keyboardNavKeysRef.current.clear();
    }

    function publishEditorViewpoint(frameTime: number) {
      const viewpoint = getEditorViewpoint();
      if (!viewpoint) return;

      const key = `${latestRef.current.scene.id}:${JSON.stringify(viewpoint)}`;
      const last = lastViewpointPublishRef.current;
      if (last?.key === key) return;
      if (last && frameTime - last.time < 120) return;

      lastViewpointPublishRef.current = { time: frameTime, key };
      latestRef.current.onViewpointChange(viewpoint);
    }

    function getEditorViewpoint(): EditorViewpoint | undefined {
      const camera = editorCameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) return undefined;

      return {
        eye: viewpointVectorToTuple(camera.position),
        target: viewpointVectorToTuple(controls.target),
      };
    }

    function getKeyboardNavResolvedPosition(
      currentPosition: THREE.Vector3,
      nextPosition: THREE.Vector3,
      preserveVerticalLook: boolean,
    ) {
      if (!latestRef.current.scene.assets.splat || !collisionMeshRef.current) {
        return nextPosition;
      }
      if (hasKeyboardNavWallCollision(currentPosition, nextPosition)) return null;

      const nextGround = getKeyboardNavGroundHit(nextPosition);
      if (preserveVerticalLook) {
        if (!nextGround) return nextPosition;

        return new THREE.Vector3(
          nextPosition.x,
          Math.max(nextPosition.y, nextGround.point.y + HUMAN_GROUND_RAY_HEADROOM),
          nextPosition.z,
        );
      }

      if (nextGround) {
        return new THREE.Vector3(
          nextPosition.x,
          nextGround.point.y + HUMAN_EYE_HEIGHT,
          nextPosition.z,
        );
      }

      const currentGround = getKeyboardNavGroundHit(currentPosition);
      if (currentGround) return null;

      return nextPosition;
    }

    function hasKeyboardNavWallCollision(
      currentPosition: THREE.Vector3,
      nextPosition: THREE.Vector3,
    ) {
      const meshes = getCollisionMeshes();
      if (meshes.length === 0) return false;

      const delta = nextPosition.clone().sub(currentPosition);
      delta.y = 0;
      const distance = delta.length();
      if (distance === 0) return false;

      const direction = delta.normalize();
      const origins = [
        currentPosition.clone(),
        currentPosition.clone().add(new THREE.Vector3(0, -0.45, 0)),
        currentPosition.clone().add(new THREE.Vector3(0, -0.9, 0)),
      ];

      for (const origin of origins) {
        raycasterRef.current.set(origin, direction);
        raycasterRef.current.far = distance + HUMAN_COLLISION_RADIUS;
        const hits = raycasterRef.current.intersectObjects(meshes, false);
        if (hits.some((hit) => {
          const normal = getHitWorldNormal(hit);
          return !normal || Math.abs(normal.y) < 0.55;
        })) {
          return true;
        }
      }

      return false;
    }

    function getKeyboardNavGroundHit(position: THREE.Vector3) {
      const meshes = getCollisionMeshes();
      if (meshes.length === 0) return undefined;

      raycasterRef.current.set(
        new THREE.Vector3(
          position.x,
          position.y + HUMAN_GROUND_RAY_HEADROOM,
          position.z,
        ),
        new THREE.Vector3(0, -1, 0),
      );
      raycasterRef.current.far =
        HUMAN_EYE_HEIGHT + HUMAN_MAX_GROUND_DROP + HUMAN_GROUND_RAY_HEADROOM;
      const hits = raycasterRef.current.intersectObjects(meshes, false);

      return hits.find((hit) => {
        const targetEyeY = hit.point.y + HUMAN_EYE_HEIGHT;
        const eyeDelta = targetEyeY - position.y;
        if (eyeDelta > HUMAN_MAX_STEP_HEIGHT) return false;
        if (eyeDelta < -HUMAN_MAX_GROUND_DROP) return false;
        const normal = getHitWorldNormal(hit);
        return normal ? Math.abs(normal.y) >= 0.55 : true;
      });
    }

    function getCollisionMeshes() {
      const collision = collisionMeshRef.current;
      if (!collision) return [];

      const meshes: THREE.Mesh[] = [];
      collision.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) meshes.push(mesh);
      });

      return meshes;
    }

    function getHitWorldNormal(hit: THREE.Intersection) {
      if (!hit.face) return undefined;

      return hit.face.normal
        .clone()
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize();
    }

    function isKeyboardNavKey(code: string) {
      return code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD";
    }

    function isTypingTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null;
      return (
        element?.tagName === "INPUT" ||
        element?.tagName === "TEXTAREA" ||
        element?.tagName === "SELECT" ||
        element?.isContentEditable === true
      );
    }

    function claimSceneFrame(
      source: SceneFrameSource,
    ): SceneFrameClaim | null {
      const key = `${latestRef.current.scene.id}:${latestRef.current.scene.assets.id}`;
      const priority = getSceneFramePriority(source);
      if (
        framedSceneRef.current?.key === key &&
        framedSceneRef.current.priority >= priority
      ) {
        return null;
      }

      return { key, priority };
    }

    function getSceneFramePriority(source: SceneFrameSource) {
      if (source === "manifest") return 4;
      if (source === "spawn") return 3;
      return source === "collision" ? 2 : 1;
    }

    async function loadCollisionMesh(root: THREE.Group) {
      if (!scene.assets.collision) return;

      const loader = new GLTFLoader();
      const url = scene.assets.collision.objectUrl ?? scene.assets.collision.path;

      try {
        const gltf = await loader.loadAsync(url);
        const collision = gltf.scene;
        collision.name = "CollisionMesh";
        collision.userData.gltfAsset = getLoadedGltfAsset(gltf as LoadedGltf);
        collision.userData.gltfRootMatrix = getLoadedGltfRootMatrix(
          gltf as LoadedGltf,
        );
        const splatAlignment = applyDetectedSplatCoordinateFix(collision);
        if (splatAlignment) {
          latestRef.current.onSplatAlignmentChange(
            latestRef.current.scene.id,
            splatAlignment,
          );
        }
        const alignment = applyCollisionCoordinateFix(collision);
        collision.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.userData.collision = true;
          mesh.visible = latestRef.current.scene.world.collision.visibleInEditor;
          mesh.material = createCollisionMaterial();
        });
        root.add(collision);
        collisionMeshRef.current = collision;
        latestRef.current.onCollisionAlignmentChange(
          latestRef.current.scene.id,
          alignment,
        );
        publishSceneSizing("collision");
        frameEditorCameraInsideObject(collision, "collision");
        snapSceneObjectsToCollisionSurface();
      } catch (error) {
        latestRef.current.onStatus("Collision mesh load failed; placement falls back to floor plane.");
        const fallback = buildProceduralCollision();
        const alignment = applyCollisionCoordinateFix(fallback);
        root.add(fallback);
        collisionMeshRef.current = fallback;
        latestRef.current.onCollisionAlignmentChange(
          latestRef.current.scene.id,
          alignment,
        );
        publishSceneSizing("collision");
        frameEditorCameraInsideObject(fallback, "collision");
        snapSceneObjectsToCollisionSurface();
      }
    }

    function publishSceneSizing(preferredSource: "collision" | "splat") {
      const sizingBounds = getSceneSizingBounds(preferredSource);
      const manifestScale = latestRef.current.scene.assets.defaults?.entityScale;
      const hasManifestScale =
        Number.isFinite(manifestScale) && manifestScale !== undefined && manifestScale > 0;

      if (!sizingBounds) {
        latestRef.current.onSceneSizingChange(latestRef.current.scene.id, {
          entityScale: hasManifestScale ? manifestScale : 1,
          horizontalSpan: 0,
          size: [0, 0, 0],
          source: hasManifestScale ? "manifest" : "default",
        });
        return;
      }

      const size = sizingBounds.bounds.getSize(new THREE.Vector3());
      const horizontalSpan = getHorizontalSpan(size);
      latestRef.current.onSceneSizingChange(latestRef.current.scene.id, {
        entityScale: hasManifestScale
          ? manifestScale
          : getAdaptiveEntityScale(horizontalSpan),
        horizontalSpan,
        size: vectorToTuple(size),
        source: hasManifestScale ? "manifest" : sizingBounds.source,
      });
    }

    function getSceneSizingBounds(preferredSource: "collision" | "splat") {
      const collisionBounds = getCollisionWorldBounds();
      const splatBounds = getSplatWorldBounds();
      const preferredBounds =
        preferredSource === "collision" ? collisionBounds : splatBounds;
      const fallbackBounds =
        preferredSource === "collision" ? splatBounds : collisionBounds;

      return preferredBounds ?? fallbackBounds;
    }

    function getCollisionWorldBounds() {
      const collision = collisionMeshRef.current;
      if (!collision) return undefined;

      const bounds = new THREE.Box3().setFromObject(collision);
      return isUsableBox(bounds)
        ? {
            bounds,
            source: "collision" as const,
          }
        : undefined;
    }

    function getSplatWorldBounds() {
      const splat = splatMeshRef.current;
      if (!splat?.getBoundingBox) return undefined;

      const bounds = splat.getBoundingBox(true).clone();
      if (!isUsableBox(bounds)) return undefined;

      splat.updateWorldMatrix(true, false);
      bounds.applyMatrix4(splat.matrixWorld);
      return isUsableBox(bounds)
        ? {
            bounds,
            source: "splat" as const,
          }
        : undefined;
    }

    function buildProceduralKitchen(root: THREE.Group) {
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(6.4, 0.08, 4.6),
        new THREE.MeshStandardMaterial({ color: 0x252d33, roughness: 0.85 }),
      );
      floor.position.set(0, -0.04, 0.4);
      floor.receiveShadow = true;
      root.add(floor);

      const backWall = new THREE.Mesh(
        new THREE.BoxGeometry(5.6, 2.4, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x3c464d, roughness: 0.7 }),
      );
      backWall.position.set(0.1, 1.2, -1.6);
      backWall.receiveShadow = true;
      root.add(backWall);

      const sideWall = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 2.4, 3.2),
        new THREE.MeshStandardMaterial({ color: 0x46515a, roughness: 0.75 }),
      );
      sideWall.position.set(-2.75, 1.2, -0.05);
      sideWall.receiveShadow = true;
      root.add(sideWall);

      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.78, 1.75, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x6b4a34, roughness: 0.65 }),
      );
      door.position.set(1.65, 0.88, -1.52);
      root.add(door);

      const windowFrame = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.72, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x213a3b, roughness: 0.4 }),
      );
      windowFrame.position.set(-0.62, 1.25, -1.51);
      root.add(windowFrame);

      const lamp = new THREE.PointLight(0xffd18a, 3.4, 4);
      lamp.position.set(1.65, 1.55, -0.82);
      root.add(lamp);
      const lampShade = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.32, 20),
        new THREE.MeshStandardMaterial({ color: 0xf2c36d, emissive: 0x7a4c13 }),
      );
      lampShade.position.copy(lamp.position);
      root.add(lampShade);
    }

    function buildProceduralCollision() {
      const collision = new THREE.Mesh(
        new THREE.BoxGeometry(6.4, 0.04, 4.6),
        createCollisionMaterial(),
      );
      collision.name = "CollisionFloor";
      collision.position.set(0, 0.01, 0.4);
      collision.visible = latestRef.current.scene.world.collision.visibleInEditor;
      collision.userData.collision = true;
      return collision;
    }

    function createCollisionMaterial() {
      return new THREE.MeshBasicMaterial({
        color: 0x39a8ff,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        wireframe:
          latestRef.current.scene.world.collision.displayMode === "wireframe",
        depthWrite: false,
      });
    }

    function applySplatCoordinateFix(
      splat: THREE.Object3D,
      alignment = getManifestSplatAlignment() ?? getDefaultSplatAlignment(),
    ): SplatAlignmentReadout {
      splat.scale.set(
        alignment.axes[0] * alignment.scale,
        alignment.axes[1] * alignment.scale,
        alignment.axes[2] * alignment.scale,
      );
      return alignment;
    }

    function applyDetectedSplatCoordinateFix(
      collision: THREE.Object3D,
    ): SplatAlignmentReadout | undefined {
      const splat = splatMeshRef.current;
      if (!splat || !usesScanSceneCoordinateFix()) return undefined;

      const alignment = findBestSplatAlignment(collision);
      applySplatCoordinateFix(splat, alignment);
      splatAlignmentRef.current = alignment;
      updateSplatBounds(splat);
      return alignment;
    }

    function getDefaultSplatAlignment(): SplatAlignmentReadout {
      if (!usesScanSceneCoordinateFix()) {
        return {
          scale: 1,
          axes: [1, 1, 1],
          score: 0,
          source: "default",
        };
      }

      return {
        scale: SCAN_SCENE_SCALE,
        axes: [1, -1, 1],
        score: 0,
        source: "default",
      };
    }

    function getManifestSplatAlignment() {
      const override = latestRef.current.scene.assets.defaults?.splatTransform;
      if (!override) return undefined;

      const fallback = getDefaultSplatAlignment();
      return {
        scale: override.scale ?? fallback.scale,
        axes: override.axes ?? fallback.axes,
        score: 0,
        source: "manifest",
      } satisfies SplatAlignmentReadout;
    }

    function findBestSplatAlignment(
      collision: THREE.Object3D,
    ): SplatAlignmentReadout {
      const manifestAlignment = getManifestSplatAlignment();
      if (manifestAlignment) return manifestAlignment;
      const splat = splatMeshRef.current;
      if (!splat?.getBoundingBox) return getDefaultSplatAlignment();

      const rawSplatBounds = splat.getBoundingBox(true).clone();
      if (!isUsableBox(rawSplatBounds)) return getDefaultSplatAlignment();

      const preferredAxes = inferSplatAxesFromCollision(collision);
      const candidates = getAxisSignCandidates().map((axes) => {
        const splatBounds = transformBox(
          rawSplatBounds,
          new THREE.Matrix4().makeScale(
            axes[0] * SCAN_SCENE_SCALE,
            axes[1] * SCAN_SCENE_SCALE,
            axes[2] * SCAN_SCENE_SCALE,
          ),
        );
        const collisionAlignment = findBestCollisionAlignmentForBounds(
          collision,
          splatBounds,
        );
        const viewpointScore = getSplatViewpointScore(splatBounds);
        const preferenceScore = axesMatch(axes, preferredAxes) ? 0 : 0.35;

        return {
          scale: SCAN_SCENE_SCALE,
          axes,
          score: collisionAlignment.score + viewpointScore + preferenceScore,
          source: "auto",
        } satisfies SplatAlignmentReadout;
      });

      return candidates.reduce(
        (best, candidate) => (candidate.score < best.score ? candidate : best),
        candidates[0] ?? getDefaultSplatAlignment(),
      );
    }

    function inferSplatAxesFromCollision(collision: THREE.Object3D) {
      const generator = getCollisionGenerator(collision);
      if (
        generator.includes("THREE.GLTFExporter") ||
        hasThreeExporterRootFlip(collision)
      ) {
        return [1, 1, 1] satisfies [number, number, number];
      }

      return getDefaultSplatAlignment().axes;
    }

    function getCollisionGenerator(collision: THREE.Object3D) {
      const asset = collision.userData.gltfAsset as { generator?: string } | undefined;
      return asset?.generator ?? "";
    }

    function getLoadedGltfAsset(gltf: LoadedGltf) {
      return gltf.asset ?? gltf.parser?.json?.asset;
    }

    function getLoadedGltfRootMatrix(gltf: LoadedGltf) {
      return gltf.parser?.json?.nodes?.[0]?.matrix;
    }

    function hasThreeExporterRootFlip(collision: THREE.Object3D) {
      const matrix = collision.userData.gltfRootMatrix as number[] | undefined;
      if (!Array.isArray(matrix) || matrix.length !== 16) return false;

      return matrix[0] > 0 && matrix[5] < 0 && matrix[10] < 0;
    }

    function getSplatViewpointScore(bounds: THREE.Box3) {
      const viewpoint = latestRef.current.scene.assets.defaults?.viewpoint;
      if (!viewpoint || !isUsableBox(bounds)) return 0;

      const size = bounds.getSize(new THREE.Vector3());
      if (size.y <= 0) return 0;

      const normalizedEyeY = (viewpoint.eye[1] - bounds.min.y) / size.y;
      return Math.abs(normalizedEyeY - 0.22) * 2;
    }

    function applyCollisionCoordinateFix(
      collision: THREE.Object3D,
    ): CollisionAlignmentReadout {
      if (!usesScanSceneCoordinateFix()) {
        collision.scale.setScalar(1);
        return {
          scale: 1,
          axes: [1, 1, 1],
          score: 0,
          source: "default",
        };
      }

      const alignment = findBestCollisionAlignment(collision);

      collision.scale.set(
        alignment.axes[0] * alignment.scale,
        alignment.axes[1] * alignment.scale,
        alignment.axes[2] * alignment.scale,
      );
      return alignment;
    }

    function usesScanSceneCoordinateFix() {
      return latestRef.current.scene.assets.source !== "procedural";
    }

    function findBestCollisionAlignment(
      collision: THREE.Object3D,
    ): CollisionAlignmentReadout {
      const targetBounds = splatBoundsRef.current;

      if (!targetBounds || !isUsableBox(targetBounds)) {
        return getCollisionFallbackAlignment();
      }

      return findBestCollisionAlignmentForBounds(collision, targetBounds);
    }

    function getCollisionFallbackAlignment(): CollisionAlignmentReadout {
      const manifestAlignment = getManifestSplatAlignment();
      if (!usesScanSceneCoordinateFix() || !manifestAlignment) {
        return {
          scale: 1,
          axes: [1, 1, 1],
          score: 0,
          source: "default",
        };
      }

      return {
        scale: manifestAlignment.scale,
        axes: [...manifestAlignment.axes],
        score: 0,
        source: "splat-transform",
      };
    }

    function findBestCollisionAlignmentForBounds(
      collision: THREE.Object3D,
      targetBounds: THREE.Box3,
    ): CollisionAlignmentReadout {
      const candidates: CollisionAlignmentReadout[] = [];
      const originalScale = collision.scale.clone();

      try {
        for (const axes of getAxisSignCandidates()) {
          collision.scale.set(...axes);
          collision.updateWorldMatrix(true, true);
          const sourceBounds = new THREE.Box3().setFromObject(collision);
          if (!isUsableBox(sourceBounds)) continue;

          const scale = getBestUniformScale(sourceBounds, targetBounds);
          if (!Number.isFinite(scale) || scale <= 0) continue;

          const scaledBounds = scaleBoxFromOrigin(sourceBounds, scale);
          candidates.push({
            scale,
            axes,
            score: getBoundsAlignmentScore(scaledBounds, targetBounds),
            source: "splat-bounds",
          });
        }
      } finally {
        collision.scale.copy(originalScale);
        collision.updateWorldMatrix(true, true);
      }

      return candidates.reduce(
        (best, candidate) => (candidate.score < best.score ? candidate : best),
        candidates[0] ?? getCollisionFallbackAlignment(),
      );
    }

    function rebuildObjects() {
      const root = objectRootRef.current;
      if (!root) return;
      clearGroup(root);
      for (const object of latestRef.current.scene.objects) {
        const mesh = createObjectMesh(object);
        mesh.userData.selection = { type: "object", id: object.id };
        root.add(mesh);
      }
    }

    function snapSceneObjectsToCollisionSurface() {
      if (!latestRef.current.scene.assets.collision || objectDragStateRef.current) {
        return;
      }

      for (const object of latestRef.current.scene.objects) {
        const key = `${latestRef.current.scene.id}:${object.id}`;
        if (collisionSnappedObjectKeysRef.current.has(key)) continue;

        const nextPosition = getObjectPositionOnCollisionSurface(
          new THREE.Vector3(...object.position),
        );
        if (!nextPosition) continue;

        collisionSnappedObjectKeysRef.current.add(key);
        if (Math.abs(nextPosition.y - object.position[1]) < 0.001) continue;

        latestRef.current.onUpdateObject(object.id, {
          position: vectorToTuple(nextPosition),
        });
      }
    }

    function getObjectPositionOnCollisionSurface(position: THREE.Vector3) {
      const floorY = getCollisionWalkableFloorY();
      const hit = getPlaceableCollisionHitAtXZ(position.x, position.z);
      if (!hit) {
        return floorY === undefined
          ? undefined
          : new THREE.Vector3(position.x, floorY, position.z);
      }

      return new THREE.Vector3(position.x, hit.point.y, position.z);
    }

    function getPlaceableCollisionHitAtXZ(x: number, z: number) {
      const collision = collisionMeshRef.current;
      const meshes = getCollisionMeshes();
      if (!collision || meshes.length === 0) return undefined;

      const bounds = new THREE.Box3().setFromObject(collision);
      const originY = isUsableBox(bounds)
        ? bounds.max.y + Math.max(bounds.getSize(new THREE.Vector3()).y * 0.1, 1)
        : 20;
      const far = isUsableBox(bounds)
        ? Math.max(bounds.getSize(new THREE.Vector3()).y + 2, 10)
        : 40;

      raycasterRef.current.set(
        new THREE.Vector3(x, originY, z),
        new THREE.Vector3(0, -1, 0),
      );
      raycasterRef.current.far = far;
      const hits = raycasterRef.current.intersectObjects(meshes, false);
      const floorY = getCollisionWalkableFloorY();
      const placeableHits = hits.filter((hit) => {
        const normal = getHitWorldNormal(hit);
        const isWalkable = normal ? Math.abs(normal.y) >= PLACEABLE_SURFACE_MIN_UP : true;
        const isOnFloor =
          floorY === undefined || Math.abs(hit.point.y - floorY) <= getCollisionFloorBandHeight();
        return isWalkable && isOnFloor;
      });
      if (placeableHits.length === 0) return undefined;

      if (floorY === undefined) {
        return placeableHits.reduce((lowest, hit) =>
          hit.point.y < lowest.point.y ? hit : lowest,
        );
      }

      return placeableHits.reduce((closest, hit) =>
        Math.abs(hit.point.y - floorY) < Math.abs(closest.point.y - floorY)
          ? hit
          : closest,
      );
    }

    function getCollisionWalkableFloorY() {
      const key = getCollisionWalkableFloorKey();
      if (collisionWalkableFloorRef.current?.key === key) {
        return collisionWalkableFloorRef.current.y;
      }

      const y = computeCollisionWalkableFloorY() ?? getSceneAuthoredFloorY();
      collisionWalkableFloorRef.current = { key, y };
      return y;
    }

    function getCollisionFloorBandHeight() {
      const collision = collisionMeshRef.current;
      if (!collision) return COLLISION_FLOOR_BAND_MIN_HEIGHT;

      const bounds = new THREE.Box3().setFromObject(collision);
      if (!isUsableBox(bounds)) return COLLISION_FLOOR_BAND_MIN_HEIGHT;

      const scaledBand = bounds.getSize(new THREE.Vector3()).y * 0.01;
      return Math.max(
        Math.min(scaledBand, 0.22),
        COLLISION_FLOOR_BAND_MIN_HEIGHT,
      );
    }

    function computeCollisionWalkableFloorY() {
      const points = getCollisionHorizontalSurfacePoints();
      if (points.length === 0) return undefined;

      const authoredFloorY = getSceneAuthoredFloorY();
      const candidateY =
        authoredFloorY === undefined
          ? getLowWalkableFloorCandidateY(points)
          : points.reduce((closest, point) =>
              Math.abs(point.y - authoredFloorY) <
              Math.abs(closest.y - authoredFloorY)
                ? point
                : closest,
            ).y;
      const floorBand = getCollisionFloorBandHeight();
      const floorPoints = points.filter(
        (point) => Math.abs(point.y - candidateY) <= floorBand,
      );
      if (floorPoints.length === 0) return candidateY;

      return (
        floorPoints.reduce((total, point) => total + point.y, 0) /
        floorPoints.length
      );
    }

    function getLowWalkableFloorCandidateY(points: THREE.Vector3[]) {
      const sortedY = points
        .map((point) => point.y)
        .sort((a, b) => a - b);
      const index = Math.min(
        sortedY.length - 1,
        Math.max(0, Math.floor((sortedY.length - 1) * COLLISION_FLOOR_LOW_QUANTILE)),
      );
      return sortedY[index];
    }

    function getCollisionHorizontalSurfacePoints() {
      const meshes = getCollisionMeshes();
      const points: THREE.Vector3[] = [];
      const position = new THREE.Vector3();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const ab = new THREE.Vector3();
      const ac = new THREE.Vector3();
      const normal = new THREE.Vector3();

      for (const mesh of meshes) {
        const geometry = mesh.geometry;
        const positionAttribute = geometry.getAttribute("position");
        if (!positionAttribute) continue;

        mesh.updateWorldMatrix(true, false);
        const index = geometry.getIndex();
        const triangleCount = index
          ? Math.floor(index.count / 3)
          : Math.floor(positionAttribute.count / 3);

        for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
          const ia = index ? index.getX(triangleIndex * 3) : triangleIndex * 3;
          const ib = index ? index.getX(triangleIndex * 3 + 1) : triangleIndex * 3 + 1;
          const ic = index ? index.getX(triangleIndex * 3 + 2) : triangleIndex * 3 + 2;

          a.fromBufferAttribute(positionAttribute, ia).applyMatrix4(mesh.matrixWorld);
          b.fromBufferAttribute(positionAttribute, ib).applyMatrix4(mesh.matrixWorld);
          c.fromBufferAttribute(positionAttribute, ic).applyMatrix4(mesh.matrixWorld);

          ab.subVectors(b, a);
          ac.subVectors(c, a);
          normal.crossVectors(ab, ac);
          if (normal.lengthSq() === 0) continue;
          normal.normalize();
          if (Math.abs(normal.y) < PLACEABLE_SURFACE_MIN_UP) continue;

          position.copy(a).add(b).add(c).multiplyScalar(1 / 3);
          points.push(position.clone());
        }
      }

      return points;
    }

    function getCollisionWalkableFloorKey() {
      return [
        latestRef.current.scene.id,
        latestRef.current.scene.assets.id,
        latestRef.current.scene.assets.collision?.path,
        latestRef.current.scene.assets.collision?.objectUrl,
        latestRef.current.scene.assets.defaults?.viewpoint?.eye.join(","),
      ].join(":");
    }

    function getSceneAuthoredFloorY() {
      const viewpoint = latestRef.current.scene.assets.defaults?.viewpoint;
      if (!latestRef.current.scene.assets.splat || !viewpoint) return undefined;

      return viewpoint.eye[1] - HUMAN_EYE_HEIGHT;
    }

    function createObjectMesh(object: BoardObject) {
      const group = new THREE.Group();
      group.position.set(...object.position);
      group.rotation.y = object.rotationY;
      group.scale.setScalar(object.scale);
      group.name = object.name;

      const selected =
        latestRef.current.selection.type === "object" &&
        latestRef.current.selection.id === object.id;
      const fallback = new THREE.Group();
      fallback.name = "ObjectFallback";
      if (object.kind === "character") {
        buildCharacter(fallback, object, selected);
      } else {
        buildProp(fallback, object, selected);
      }

      if (object.modelFile) {
        void loadObjectModelIntoGroup(group, fallback, object);
      } else {
        group.add(fallback);
      }

      if (selected) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.42, 0.015, 8, 36),
          new THREE.MeshBasicMaterial({ color: 0x4a9eff }),
        );
        ring.name = "ObjectRotationRing";
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.035;
        ring.userData.objectHandle = { objectId: object.id, kind: "rotateY" };
        ring.userData.baseColor = 0x4a9eff;
        ring.userData.hoverColor = 0xffffff;
        ring.userData.baseScale = 1;
        ring.userData.hoverScale = 1.08;
        group.add(ring);
        group.add(createObjectRotationHitArea(object.id));
        if (latestRef.current.viewMode === "move") {
          group.add(createObjectFloorMoveGizmo(object.id));
        }
      }

      return group;
    }

    function createObjectRotationHitArea(objectId: string) {
      const hitArea = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.76, 64),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      hitArea.name = "ObjectRotationHitArea";
      hitArea.rotation.x = Math.PI / 2;
      hitArea.position.y = 0.055;
      hitArea.userData.objectHandle = { objectId, kind: "rotateY" };
      hitArea.userData.screenTargetPx = OBJECT_ROTATE_GIZMO_TARGET_PX;
      hitArea.userData.screenBaseWorldSize = 1.52;
      return hitArea;
    }

    async function loadObjectModelIntoGroup(
      group: THREE.Group,
      fallback: THREE.Group,
      object: BoardObject,
    ) {
      try {
        const model = await loadObjectModel(object);
        if (!group.parent) {
          disposeObjectTree(model);
          disposeObjectTree(fallback);
          return;
        }

        fallback.parent?.remove(fallback);
        disposeObjectTree(fallback);
        group.add(model);
      } catch (error) {
        if (!group.parent) {
          disposeObjectTree(fallback);
          return;
        }
        if (!fallback.parent) {
          group.add(fallback);
        }
        console.warn(`Could not load model for ${object.name}`, error);
        if (
          object.modelFile &&
          !failedObjectModelPathsRef.current.has(object.modelFile)
        ) {
          failedObjectModelPathsRef.current.add(object.modelFile);
          latestRef.current.onStatus(formatObjectModelLoadError(object, error));
        }
      }
    }

    async function loadObjectModel(object: BoardObject) {
      if (!object.modelFile) {
        throw new Error("Object does not have a model file.");
      }

      const fileType = object.modelFileType || getFileExtension(object.modelFile);
      if (!SUPPORTED_OBJECT_MODEL_TYPES.has(fileType)) {
        throw new Error(`Unsupported object model type: ${fileType || "unknown"}`);
      }

      let sourcePromise = objectModelCacheRef.current.get(object.modelFile);
      if (!sourcePromise) {
        sourcePromise = loadObjectModelSource(object.modelFile, fileType);
        objectModelCacheRef.current.set(object.modelFile, sourcePromise);
      }

      const source = await sourcePromise;
      const model = cloneSkeleton(source) as THREE.Object3D;
      cloneRenderableResources(model);
      applyObjectModelColor(model, object.modelColor);
      prepareObjectModel(model, object.kind, object.pose);
      return model;
    }

    async function loadObjectModelSource(path: string, fileType: string) {
      if (fileType === "fbx") {
        const loader = new FBXLoader();
        return loader.loadAsync(path);
      }

      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(path);
      return gltf.scene;
    }

    function prepareObjectModel(
      model: THREE.Object3D,
      kind: BoardObjectKind,
      pose?: CharacterPose,
    ) {
      model.name = "ObjectModel";
      model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.selection = undefined;
      });

      model.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (bounds.isEmpty() || size.lengthSq() === 0) return;

      const targetSize = kind === "character" ? 1.65 : 1.05;
      const sourceSize =
        kind === "character" ? size.y : Math.max(size.x, size.y, size.z);
      if (sourceSize > 0) {
        model.scale.multiplyScalar(targetSize / sourceSize);
      }

      model.updateWorldMatrix(true, true);
      const normalizedBounds = new THREE.Box3().setFromObject(model);
      const center = normalizedBounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.y -= normalizedBounds.min.y;
      model.position.z -= center.z;

      if (kind === "character" && pose && pose !== "t-pose") {
        const posedMeshes = applyCharacterPose(model, pose);
        model.updateWorldMatrix(true, true);
        refreshSkinnedMeshBounds(posedMeshes);
        const posedBounds =
          getSkinnedMeshWorldBounds(posedMeshes) ??
          new THREE.Box3().setFromObject(model);
        const posedCenter = posedBounds.getCenter(new THREE.Vector3());
        model.position.x -= posedCenter.x;
        model.position.y -= posedBounds.min.y;
        model.position.z -= posedCenter.z;
      }
    }

    function applyCharacterPose(
      model: THREE.Object3D,
      pose: Exclude<CharacterPose, "t-pose">,
    ) {
      const posedMeshes = getPrimaryCharacterSkins(model);
      const bones = new Map<string, THREE.Bone[]>();
      const addBone = (bone: THREE.Bone) => {
        const name = normalizeBoneName(bone.name);
        const matches = bones.get(name) ?? [];
        if (!matches.includes(bone)) {
          matches.push(bone);
          bones.set(name, matches);
        }
      };

      for (const skinnedMesh of posedMeshes) {
        for (const bone of skinnedMesh.skeleton.bones) {
          addBone(bone);
        }
      }
      if (posedMeshes.length === 0) {
        model.traverse((node) => {
          const bone = node as THREE.Bone;
          if (!bone.isBone) return;
          addBone(bone);
        });
      }

      const rotateBone = (
        name: string,
        rotation: [number, number, number],
      ) => {
        const matches = bones.get(name.toLowerCase());
        if (!matches) return;
        for (const bone of matches) {
          const delta = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...rotation, "XYZ"),
          );
          bone.quaternion.premultiply(delta);
        }
      };

      rotateBone("leftarm", [1.28, 0, 0]);
      rotateBone("rightarm", [1.28, 0, 0]);

      if (pose === "sitting") {
        rotateBone("leftupleg", [-1.35, 0, 0.06]);
        rotateBone("rightupleg", [-1.35, 0, -0.06]);
        rotateBone("leftleg", [-1.42, 0, 0]);
        rotateBone("rightleg", [-1.42, 0, 0]);
        rotateBone("leftfoot", [-0.08, 0, 0]);
        rotateBone("rightfoot", [-0.08, 0, 0]);
        rotateBone("spine", [0.08, 0, 0]);
      }

      return posedMeshes;
    }

    function getPrimaryCharacterSkins(model: THREE.Object3D) {
      const skins: THREE.SkinnedMesh[] = [];
      model.traverse((node) => {
        const skinnedMesh = node as THREE.SkinnedMesh;
        if (skinnedMesh.isSkinnedMesh) {
          skins.push(skinnedMesh);
        }
      });
      if (skins.length === 0) return skins;

      skins.sort((a, b) => {
        const aVertices = a.geometry.getAttribute("position")?.count ?? 0;
        const bVertices = b.geometry.getAttribute("position")?.count ?? 0;
        return bVertices - aVertices;
      });
      const primary = skins[0];
      const primaryBones = new Set(primary.skeleton.bones);
      return skins.filter(
        (skin) =>
          skin === primary ||
          skin.skeleton.bones.some((bone) => primaryBones.has(bone)),
      );
    }

    function refreshSkinnedMeshBounds(skinnedMeshes: THREE.SkinnedMesh[]) {
      for (const skinnedMesh of skinnedMeshes) {
        skinnedMesh.skeleton.update();
        skinnedMesh.computeBoundingBox();
        skinnedMesh.computeBoundingSphere();
      }
    }

    function getSkinnedMeshWorldBounds(skinnedMeshes: THREE.SkinnedMesh[]) {
      if (skinnedMeshes.length === 0) return undefined;

      const bounds = new THREE.Box3();
      for (const skinnedMesh of skinnedMeshes) {
        if (!skinnedMesh.boundingBox) continue;
        bounds.union(skinnedMesh.boundingBox);
      }
      return bounds.isEmpty() ? undefined : bounds;
    }

    function cloneRenderableResources(root: THREE.Object3D) {
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.geometry) {
          mesh.geometry = mesh.geometry.clone();
        }
        const material = mesh.material;
        if (Array.isArray(material)) {
          mesh.material = material.map((entry) => entry.clone());
        } else if (material) {
          mesh.material = material.clone();
        }
      });
    }

    function applyObjectModelColor(
      model: THREE.Object3D,
      colorValue?: string,
    ) {
      if (!colorValue) return;
      const color = new THREE.Color(colorValue);

      model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) {
          const colorMaterial = material as THREE.Material & {
            color?: THREE.Color;
          };
          colorMaterial.color?.copy(color);
          material.needsUpdate = true;
        }
      });
    }

    function createObjectFloorMoveGizmo(objectId: string) {
      const gizmo = new THREE.Group();
      gizmo.name = "ObjectFloorMoveGizmo";
      gizmo.position.y = 0.06;
      gizmo.userData.objectHandle = { objectId, kind: "floorPlane" };

      const axisLength = 0.86;
      const headLength = 0.12;
      const headWidth = 0.055;
      gizmo.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 0, 0),
          axisLength,
          0xff4f4f,
          headLength,
          headWidth,
        ),
      );
      gizmo.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(0, 0, 0),
          axisLength,
          0x4a9eff,
          headLength,
          headWidth,
        ),
      );
      gizmo.add(createObjectFloorPlaneHandle(objectId));
      return gizmo;
    }

    function createObjectFloorPlaneHandle(objectId: string) {
      const planeSize = 0.34;
      const planeOffset = planeSize / 2;
      const handle = new THREE.Group();
      handle.name = "ObjectFloorPlaneHandle";
      handle.position.set(planeOffset, 0.01, planeOffset);
      handle.rotation.x = Math.PI / 2;
      handle.userData.objectHandle = { objectId, kind: "floorPlane" };

      const hitArea = new THREE.Mesh(
        new THREE.PlaneGeometry(planeSize * 1.6, planeSize * 1.6),
        new THREE.MeshBasicMaterial({
          color: 0xff38d1,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      hitArea.name = "ObjectFloorPlaneHitArea";
      hitArea.userData.objectHandle = { objectId, kind: "floorPlane" };
      hitArea.userData.screenTargetPx = OBJECT_MOVE_GIZMO_TARGET_PX;
      hitArea.userData.screenBaseWorldSize = planeSize * 1.6;
      handle.add(hitArea);

      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(planeSize, planeSize),
        new THREE.MeshBasicMaterial({
          color: 0xff38d1,
          transparent: true,
          opacity: 0.34,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      fill.name = "ObjectFloorPlaneFill";
      fill.userData.objectHandle = { objectId, kind: "floorPlane" };
      fill.userData.baseColor = 0xff38d1;
      fill.userData.hoverColor = 0xffffff;
      fill.renderOrder = 30;
      handle.add(fill);

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(fill.geometry),
        new THREE.LineBasicMaterial({
          color: 0xff38d1,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      );
      outline.name = "ObjectFloorPlaneOutline";
      outline.userData.objectHandle = { objectId, kind: "floorPlane" };
      outline.userData.baseColor = 0xff38d1;
      outline.userData.hoverColor = 0xffffff;
      outline.renderOrder = 31;
      handle.add(outline);

      return handle;
    }

    function buildCharacter(
      group: THREE.Group,
      object: BoardObject,
      selected: boolean,
    ) {
      const material = new THREE.MeshStandardMaterial({
        color: selected ? 0x2f8cff : object.color,
        roughness: 0.72,
        emissive: selected ? 0x0d2b55 : 0x000000,
      });
      const skin = new THREE.MeshStandardMaterial({
        color: selected ? 0x8fc6ff : 0xc28f62,
        roughness: 0.7,
        emissive: selected ? 0x0a2447 : 0x000000,
      });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.75, 8, 16), material);
      body.position.y = object.model === "seated" ? 0.65 : 0.82;
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 12), skin);
      head.position.y = object.model === "seated" ? 1.18 : 1.42;
      head.castShadow = true;
      group.add(head);
      const legMaterial = new THREE.MeshStandardMaterial({
        color: selected ? 0x2f8cff : 0x2d4f6f,
        roughness: 0.75,
        emissive: selected ? 0x0d2b55 : 0x000000,
      });
      for (const x of [-0.08, 0.08]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.54, 0.08), legMaterial);
        leg.position.set(x, object.model === "seated" ? 0.28 : 0.28, 0);
        leg.castShadow = true;
        group.add(leg);
      }
    }

    function buildProp(
      group: THREE.Group,
      object: BoardObject,
      selected: boolean,
    ) {
      const material = new THREE.MeshStandardMaterial({
        color: selected ? 0x2f8cff : object.color,
        roughness: 0.8,
        emissive: selected ? 0x0d2b55 : 0x000000,
      });
      if (object.model === "table") {
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 0.82), material);
        top.position.y = 0.62;
        top.castShadow = true;
        group.add(top);
        for (const x of [-0.62, 0.62]) {
          for (const z of [-0.3, 0.3]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.08), material);
            leg.position.set(x, 0.3, z);
            leg.castShadow = true;
            group.add(leg);
          }
        }
        return;
      }
      if (object.model === "chair") {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), material);
        seat.position.y = 0.42;
        group.add(seat);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.08), material);
        back.position.set(0, 0.72, -0.18);
        group.add(back);
        return;
      }
      if (object.model === "counter") {
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.82, 0.62), material);
        base.position.y = 0.41;
        group.add(base);
        return;
      }
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), material);
      box.position.y = 0.24;
      box.castShadow = true;
      group.add(box);
    }

    function rebuildCameras() {
      const root = cameraRootRef.current;
      if (!root) return;
      clearGroup(root);
      for (const camera of latestRef.current.scene.cameras) {
        root.add(createCameraRig(camera));
      }
    }

    function createCameraRig(camera: DirectorCamera) {
      const group = new THREE.Group();
      group.position.set(...camera.position);
      const selected =
        latestRef.current.selection.type === "camera" &&
        latestRef.current.selection.id === camera.id;

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 0.44, 0.48),
        new THREE.MeshStandardMaterial({
          color: selected ? 0x2f8cff : 0x54606e,
          roughness: 0.56,
        }),
      );
      body.castShadow = true;
      body.userData.selection = { type: "camera", id: camera.id };
      group.add(body);
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.14, 0.24, 18),
        new THREE.MeshStandardMaterial({ color: 0x0c1015, roughness: 0.4 }),
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.34;
      lens.userData.selection = { type: "camera", id: camera.id };
      group.add(lens);

      const lookAt = new THREE.Vector3(...camera.lookAt);
      group.lookAt(lookAt);

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...camera.position),
          lookAt,
        ]),
        new THREE.LineBasicMaterial({ color: 0x2d8df0, transparent: true, opacity: 0.55 }),
      );
      line.userData.selection = { type: "camera", id: camera.id };
      const wrapper = new THREE.Group();
      wrapper.add(group);
      wrapper.add(line);
      if (selected) {
        group.add(createCameraFacingGizmo(camera.id));
        group.add(createCameraHandle(camera.id, "position", 0x2f8cff));
        wrapper.add(createLookTarget(camera, lookAt));
        wrapper.add(createCameraViewFrame(camera, lookAt));
      }
      return wrapper;
    }

    function createCameraViewFrame(camera: DirectorCamera, lookAt: THREE.Vector3) {
      const position = new THREE.Vector3(...camera.position);
      const distance = Math.max(position.distanceTo(lookAt), 0.001);
      const frameAspect = 16 / 9;
      const frameHeight =
        2 * distance * Math.tan(THREE.MathUtils.degToRad(lensToVerticalFov(camera.lens)) / 2);
      const frameWidth = frameHeight * frameAspect;
      const cameraQuaternion = getDirectorCameraQuaternion(camera);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion);
      const halfRight = right.multiplyScalar(frameWidth / 2);
      const halfUp = up.multiplyScalar(frameHeight / 2);
      const corners = [
        lookAt.clone().add(halfRight).add(halfUp),
        lookAt.clone().sub(halfRight).add(halfUp),
        lookAt.clone().sub(halfRight).sub(halfUp),
        lookAt.clone().add(halfRight).sub(halfUp),
      ];
      const frame = new THREE.Group();
      const fillGeometry = new THREE.BufferGeometry().setFromPoints([
        corners[0],
        corners[1],
        corners[2],
        corners[0],
        corners[2],
        corners[3],
      ]);
      const fill = new THREE.Mesh(
        fillGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x9aa3ad,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      frame.add(fill);

      const greyLineMaterial = new THREE.LineBasicMaterial({
        color: 0x9aa3ad,
        transparent: true,
        opacity: 0.72,
      });
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(corners),
        greyLineMaterial,
      );
      frame.add(outline);

      for (const corner of corners) {
        frame.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([position, corner]),
            greyLineMaterial.clone(),
          ),
        );
      }

      return frame;
    }

    function createCameraFacingGizmo(cameraId: string) {
      const gizmo = new THREE.Group();
      gizmo.userData.cameraFacingGizmo = true;
      gizmo.userData.screenTargetPx = CAMERA_AXIS_GIZMO_TARGET_PX;
      gizmo.userData.screenBaseWorldSize = 0.74;
      gizmo.add(createCameraAxes());
      gizmo.add(createCameraAxisPlaneHandles(cameraId));
      gizmo.add(createCameraAxisPlaneGuides(cameraId));
      return gizmo;
    }

    function createCameraAxes() {
      const axes = new THREE.Group();
      const origin = new THREE.Vector3(0, 0, 0);
      const axisLength = 0.74;
      const headLength = 0.12;
      const headWidth = 0.055;

      axes.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(1, 0, 0),
          origin,
          axisLength,
          0xff4f4f,
          headLength,
          headWidth,
        ),
      );
      axes.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(0, 1, 0),
          origin,
          axisLength,
          0x48d774,
          headLength,
          headWidth,
        ),
      );
      axes.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          origin,
          axisLength,
          0x4a9eff,
          headLength,
          headWidth,
        ),
      );
      return axes;
    }

    function createCameraAxisPlaneGuides(cameraId: string) {
      const guides = new THREE.Group();
      guides.add(createCameraAxisPlaneGuide(cameraId, "xy", ["x", "y"]));
      guides.add(createCameraAxisPlaneGuide(cameraId, "xz", ["x", "z"]));
      guides.add(createCameraAxisPlaneGuide(cameraId, "yz", ["y", "z"]));
      return guides;
    }

    function createCameraAxisPlaneGuide(
      cameraId: string,
      axisPlane: CameraAxisPlane,
      axes: Array<"x" | "y" | "z">,
    ) {
      const length = 2.4;
      const points: THREE.Vector3[] = [];
      for (const axis of axes) {
        const direction =
          axis === "x"
            ? new THREE.Vector3(1, 0, 0)
            : axis === "y"
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(0, 0, 1);
        points.push(new THREE.Vector3(0, 0, 0), direction.clone().multiplyScalar(length));
        points.push(new THREE.Vector3(0, 0, 0), direction.clone().multiplyScalar(-length));
      }

      const guide = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0xb8c0cc,
          transparent: true,
          opacity: 0.74,
          depthTest: false,
        }),
      );
      guide.name = "CameraAxisPlaneGuide";
      guide.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };
      guide.visible = false;
      guide.renderOrder = 28;
      return guide;
    }

    function createCameraAxisPlaneHandles(cameraId: string) {
      const handles = new THREE.Group();
      handles.add(createCameraAxisPlaneHandle(cameraId, "xy", 0xf6f05b));
      handles.add(createCameraAxisPlaneHandle(cameraId, "xz", 0xff38d1));
      handles.add(createCameraAxisPlaneHandle(cameraId, "yz", 0x34e7ff));
      return handles;
    }

    function createCameraAxisPlaneHandle(
      cameraId: string,
      axisPlane: CameraAxisPlane,
      color: number,
    ) {
      const planeSize = 0.2;
      const planeOffset = planeSize / 2;
      const handle = new THREE.Group();
      handle.name = "CameraAxisPlaneHandle";
      handle.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };

      const hitArea = new THREE.Mesh(
        new THREE.PlaneGeometry(planeSize * 1.08, planeSize * 1.08),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      hitArea.name = "CameraAxisPlaneHitArea";
      hitArea.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };
      handle.add(hitArea);

      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(planeSize, planeSize),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.36,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      fill.name = "CameraAxisPlaneFill";
      fill.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };
      fill.userData.baseColor = color;
      fill.userData.hoverColor = 0xffffff;
      fill.renderOrder = 30;
      handle.add(fill);

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(fill.geometry),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      );
      outline.name = "CameraAxisPlaneOutline";
      outline.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };
      outline.userData.baseColor = color;
      outline.userData.hoverColor = 0xffffff;
      outline.renderOrder = 31;
      handle.add(outline);

      if (axisPlane === "xy") {
        handle.position.set(planeOffset, planeOffset, 0);
      } else if (axisPlane === "xz") {
        handle.position.set(planeOffset, 0, planeOffset);
        handle.rotation.x = Math.PI / 2;
      } else {
        handle.position.set(0, planeOffset, planeOffset);
        handle.rotation.y = -Math.PI / 2;
      }

      return handle;
    }

    function createLookTarget(camera: DirectorCamera, lookAt: THREE.Vector3) {
      const target = new THREE.Group();
      target.position.copy(lookAt);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 10),
        new THREE.MeshBasicMaterial({ color: 0xf5c542 }),
      );
      marker.userData.selection = { type: "camera", id: camera.id };
      target.add(marker);
      target.add(createCameraHandle(camera.id, "lookAt", 0xf5c542));
      return target;
    }

    function createCameraHandle(
      cameraId: string,
      kind: CameraHandleKind,
      color: number,
    ) {
      const handle = new THREE.Group();
      handle.userData.billboardHandle = true;
      handle.userData.cameraHandle = { cameraId, kind };
      handle.userData.screenTargetPx = CAMERA_BILLBOARD_HANDLE_TARGET_PX;
      handle.userData.screenBaseWorldSize = 0.46;

      const hitArea = new THREE.Mesh(
        new THREE.PlaneGeometry(0.46, 0.46),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      hitArea.userData.cameraHandle = { cameraId, kind };
      handle.add(hitArea);

      if (kind !== "position") {
        const square = new THREE.Mesh(
          new THREE.PlaneGeometry(0.28, 0.28),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        square.name = "CameraHandleSquare";
        square.visible = false;
        handle.add(square);

        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(square.geometry),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
        );
        outline.name = "CameraHandleSquare";
        outline.visible = false;
        handle.add(outline);
      }

      return handle;
    }

    function rebuildLabels() {
      const root = labelRootRef.current;
      if (root) clearGroup(root);
      clearScreenLabels();

      const overlay = labelOverlayRef.current;
      const useWebGLLabels = usesWebGLLabels();
      for (const object of latestRef.current.scene.objects) {
        const yOffset = object.kind === "character" ? 1.62 * object.scale : 1.62;
        const selected =
          latestRef.current.selection.type === "object" &&
          latestRef.current.selection.id === object.id;
        const fallbackPosition: [number, number, number] = [
          object.position[0],
          object.position[1] + yOffset,
          object.position[2],
        ];
        if (useWebGLLabels && root) {
          root.add(
            createWebGLLabel(
              object.name,
              getObjectWorldLabelPosition(object.id) ??
                new THREE.Vector3(...fallbackPosition),
              selected,
              { type: "object", id: object.id },
            ),
          );
        } else if (overlay) {
          createScreenLabel(object.name, fallbackPosition, selected, {
            objectId: object.id,
          });
        }
      }
      for (const camera of latestRef.current.scene.cameras) {
        const selected =
          latestRef.current.selection.type === "camera" &&
          latestRef.current.selection.id === camera.id;
        const fallbackPosition: [number, number, number] = [
          camera.position[0],
          camera.position[1] + 0.36,
          camera.position[2],
        ];
        if (useWebGLLabels && root) {
          root.add(
            createWebGLLabel(
              camera.name,
              getCameraWorldLabelPosition(camera.id) ??
                new THREE.Vector3(...fallbackPosition),
              selected,
              { type: "camera", id: camera.id },
            ),
          );
        } else if (overlay) {
          createScreenLabel(camera.name, fallbackPosition, selected, {
            cameraId: camera.id,
          });
        }
      }
      updateScreenLabels();
    }

    function usesWebGLLabels() {
      return latestRef.current.scene.assets.source === "procedural";
    }

    function createWebGLLabel(
      text: string,
      position: THREE.Vector3,
      selected: boolean,
      selection: Selection,
    ) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const fontSize = 28;
      const horizontalPadding = 14;
      const verticalPadding = 7;

      if (!context) {
        return new THREE.Group();
      }

      context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
      const textMetrics = context.measureText(text);
      canvas.width = Math.ceil(textMetrics.width + horizontalPadding * 2);
      canvas.height = Math.ceil(fontSize + verticalPadding * 2);

      context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = selected
        ? "rgba(39, 97, 166, 0.86)"
        : "rgba(8, 11, 16, 0.76)";
      drawRoundRect(context, 0, 0, canvas.width, canvas.height, 10);
      context.fill();
      context.fillStyle = "#ffffff";
      context.shadowColor = "rgba(0, 0, 0, 0.88)";
      context.shadowBlur = 6;
      context.shadowOffsetY = 2;
      context.fillText(text, canvas.width / 2, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      const aspect = canvas.width / canvas.height;
      sprite.position.copy(position);
      sprite.scale.set(WEBGL_LABEL_HEIGHT * aspect, WEBGL_LABEL_HEIGHT, 1);
      sprite.center.set(0.5, 0);
      sprite.renderOrder = 60;
      sprite.userData.selection = selection;
      sprite.userData.selectableLabel = true;
      sprite.userData.labelText = text;
      return sprite;
    }

    function drawRoundRect(
      context: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number,
    ) {
      const resolvedRadius = Math.min(radius, width / 2, height / 2);
      context.beginPath();
      context.moveTo(x + resolvedRadius, y);
      context.lineTo(x + width - resolvedRadius, y);
      context.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
      context.lineTo(x + width, y + height - resolvedRadius);
      context.quadraticCurveTo(
        x + width,
        y + height,
        x + width - resolvedRadius,
        y + height,
      );
      context.lineTo(x + resolvedRadius, y + height);
      context.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
      context.lineTo(x, y + resolvedRadius);
      context.quadraticCurveTo(x, y, x + resolvedRadius, y);
      context.closePath();
    }

    function clearScreenLabels() {
      for (const anchor of screenLabelAnchorsRef.current) {
        anchor.element.remove();
      }
      screenLabelAnchorsRef.current = [];
    }

    function createScreenLabel(
      text: string,
      position: [number, number, number],
      selected: boolean,
      target: Pick<ScreenLabelAnchor, "objectId" | "cameraId"> = {},
    ) {
      const overlay = labelOverlayRef.current;
      if (!overlay) return;

      const element = document.createElement("span");
      element.className = selected
        ? "viewport-label viewport-label-selected"
        : "viewport-label";
      element.textContent = text;
      overlay.appendChild(element);
      screenLabelAnchorsRef.current.push({
        element,
        fallbackPosition: new THREE.Vector3(...position),
        ...target,
      });
    }

    function updateScreenLabels() {
      const editorCamera = editorCameraRef.current;
      const overlay = labelOverlayRef.current;
      if (!editorCamera || !overlay) return;

      const { width, height } = overlay.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const projected = new THREE.Vector3();

      for (const anchor of screenLabelAnchorsRef.current) {
        const screenPoint = getScreenLabelPoint(
          anchor,
          editorCamera,
          width,
          height,
          projected,
        );
        const visible = latestRef.current.showLabels && screenPoint.visible;

        anchor.element.hidden = !visible;
        if (!visible) continue;

        anchor.element.style.transform = `translate(-50%, -100%) translate(${screenPoint.x}px, ${screenPoint.y}px)`;
      }
    }

    function getScreenLabelPoint(
      anchor: ScreenLabelAnchor,
      editorCamera: THREE.Camera,
      width: number,
      height: number,
      projected: THREE.Vector3,
    ): ScreenLabelPoint {
      if (anchor.objectId) {
        return (
          getObjectScreenLabelPoint(anchor.objectId, editorCamera, width, height) ??
          projectWorldLabelPoint(anchor.fallbackPosition, editorCamera, width, height, projected)
        );
      }
      if (anchor.cameraId) {
        return (
          getCameraScreenLabelPoint(anchor.cameraId, editorCamera, width, height) ??
          projectWorldLabelPoint(anchor.fallbackPosition, editorCamera, width, height, projected)
        );
      }
      return projectWorldLabelPoint(
        anchor.fallbackPosition,
        editorCamera,
        width,
        height,
        projected,
      );
    }

    function getObjectScreenLabelPoint(
      objectId: string,
      editorCamera: THREE.Camera,
      width: number,
      height: number,
    ) {
      const root = objectRootRef.current?.children.find((child) => {
        const selection = child.userData.selection as Selection | undefined;
        return selection?.type === "object" && selection.id === objectId;
      });
      if (!root) return undefined;

      const bounds = getRenderableObjectBounds(root);
      if (!bounds || !isUsableBox(bounds)) return undefined;

      return getBoundsScreenLabelPoint(bounds, editorCamera, width, height);
    }

    function getObjectWorldLabelPosition(objectId: string) {
      const root = getObjectRootById(objectId);
      if (!root) return undefined;

      const bounds = getRenderableObjectBounds(root);
      if (!bounds || !isUsableBox(bounds)) return undefined;

      const center = bounds.getCenter(new THREE.Vector3());
      return new THREE.Vector3(center.x, bounds.max.y + WEBGL_LABEL_GAP, center.z);
    }

    function getCameraScreenLabelPoint(
      cameraId: string,
      editorCamera: THREE.Camera,
      width: number,
      height: number,
    ) {
      const root = cameraRootRef.current?.children.find((child) =>
        hasCameraSelection(child, cameraId),
      );
      if (!root) return undefined;

      const bounds = getRenderableCameraBounds(root, cameraId);
      if (!bounds || !isUsableBox(bounds)) return undefined;

      return getBoundsScreenLabelPoint(bounds, editorCamera, width, height);
    }

    function getCameraWorldLabelPosition(cameraId: string) {
      const root = getCameraRootById(cameraId);
      if (!root) return undefined;

      const bounds = getRenderableCameraBounds(root, cameraId);
      if (!bounds || !isUsableBox(bounds)) return undefined;

      const center = bounds.getCenter(new THREE.Vector3());
      return new THREE.Vector3(center.x, bounds.max.y + WEBGL_LABEL_GAP, center.z);
    }

    function getObjectRootById(objectId: string) {
      return objectRootRef.current?.children.find((child) => {
        const selection = child.userData.selection as Selection | undefined;
        return selection?.type === "object" && selection.id === objectId;
      });
    }

    function getCameraRootById(cameraId: string) {
      return cameraRootRef.current?.children.find((child) =>
        hasCameraSelection(child, cameraId),
      );
    }

    function getRenderableObjectBounds(root: THREE.Object3D) {
      return getRenderableBounds(root, (mesh) => !findObjectHandle(mesh));
    }

    function getRenderableCameraBounds(root: THREE.Object3D, cameraId: string) {
      return getRenderableBounds(root, (mesh) => {
        const selection = findSelection(mesh) as Selection | undefined;
        return selection?.type === "camera" && selection.id === cameraId;
      });
    }

    function getRenderableBounds(
      root: THREE.Object3D,
      shouldIncludeMesh: (mesh: THREE.Mesh) => boolean,
    ) {
      root.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3();
      const meshBounds = new THREE.Box3();
      let hasBounds = false;

      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry || !shouldIncludeMesh(mesh)) return;

        if (!mesh.geometry.boundingBox) {
          mesh.geometry.computeBoundingBox();
        }
        if (!mesh.geometry.boundingBox) return;

        meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        bounds.union(meshBounds);
        hasBounds = true;
      });

      return hasBounds ? bounds : undefined;
    }

    function hasCameraSelection(root: THREE.Object3D, cameraId: string) {
      let found = false;
      root.traverse((child) => {
        if (found) return;
        const selection = findSelection(child) as Selection | undefined;
        found = selection?.type === "camera" && selection.id === cameraId;
      });
      return found;
    }

    function getBoundsScreenLabelPoint(
      bounds: THREE.Box3,
      editorCamera: THREE.Camera,
      width: number,
      height: number,
    ): ScreenLabelPoint {
      const rect = getBoundsScreenRect(bounds, editorCamera, width, height);
      if (!rect) {
        return { x: 0, y: 0, visible: false };
      }

      return {
        x: (rect.minX + rect.maxX) / 2,
        y: Math.max(0, rect.minY - 6),
        visible: true,
      };
    }

    function getBoundsScreenRect(
      bounds: THREE.Box3,
      editorCamera: THREE.Camera,
      width: number,
      height: number,
    ) {
      const points = getBoxCorners(bounds)
        .map((corner) => projectWorldLabelPoint(corner, editorCamera, width, height))
        .filter((point) => point.visible);
      if (points.length === 0) return undefined;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }

      return { minX, minY, maxX, maxY } satisfies ScreenRect;
    }

    function projectWorldLabelPoint(
      position: THREE.Vector3,
      editorCamera: THREE.Camera,
      width: number,
      height: number,
      target = new THREE.Vector3(),
    ): ScreenLabelPoint {
      target.copy(position).project(editorCamera);
      return {
        x: ((target.x + 1) / 2) * width,
        y: ((-target.y + 1) / 2) * height,
        visible: target.z >= -1 && target.z <= 1,
      };
    }

    function updateCameraHandleFacing() {
      const editorCamera = editorCameraRef.current;
      const cameraRoot = cameraRootRef.current;
      if (!editorCamera || !cameraRoot) return;
      const parentQuaternion = new THREE.Quaternion();
      cameraRoot.traverse((child) => {
        if (!child.userData.billboardHandle && !child.userData.cameraFacingGizmo) {
          return;
        }
        const facingQuaternion = child.userData.cameraFacingGizmo
          ? getCameraFacingGizmoQuaternion()
          : editorCamera.quaternion;
        if (child.parent) {
          child.parent.getWorldQuaternion(parentQuaternion);
          child.quaternion.copy(parentQuaternion.invert().multiply(facingQuaternion));
        } else {
          child.quaternion.copy(facingQuaternion);
        }
      });
    }

    function updateScreenSizedGizmos() {
      const editorCamera = editorCameraRef.current;
      const renderer = rendererRef.current;
      if (!editorCamera || !renderer) return;

      const viewportHeight =
        labelOverlayRef.current?.getBoundingClientRect().height ||
        renderer.domElement.getBoundingClientRect().height;
      if (viewportHeight <= 0) return;

      const roots = [objectRootRef.current, cameraRootRef.current].filter(
        Boolean,
      ) as THREE.Object3D[];
      for (const root of roots) {
        root.traverse((child) => {
          if (!isScreenSizedGizmo(child)) return;
          applyScreenSizedGizmoScale(child, editorCamera, viewportHeight);
        });
      }
    }

    function isScreenSizedGizmo(object: THREE.Object3D) {
      return (
        typeof object.userData.screenTargetPx === "number" &&
        typeof object.userData.screenBaseWorldSize === "number"
      );
    }

    function applyScreenSizedGizmoScale(
      object: THREE.Object3D,
      editorCamera: THREE.Camera,
      viewportHeight: number,
    ) {
      const worldPosition = object.getWorldPosition(new THREE.Vector3());
      const unitsPerPixel = getWorldUnitsPerScreenPixel(
        worldPosition,
        editorCamera,
        viewportHeight,
      );
      if (!Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0) return;

      const parentScale = object.parent?.getWorldScale(new THREE.Vector3());
      const inheritedScale = parentScale
        ? Math.max(
            Math.abs(parentScale.x),
            Math.abs(parentScale.y),
            Math.abs(parentScale.z),
            0.0001,
          )
        : 1;
      const targetWorldSize = object.userData.screenTargetPx * unitsPerPixel;
      const baseWorldSize = Math.max(object.userData.screenBaseWorldSize, 0.0001);
      const scale = clamp(
        targetWorldSize / (baseWorldSize * inheritedScale),
        MIN_GIZMO_SCREEN_SCALE,
        MAX_GIZMO_SCREEN_SCALE,
      );

      if (object.name === "ObjectRotationRing") {
        object.userData.baseScale = scale;
        object.userData.hoverScale = scale * 1.08;
        const owner = findObjectHandle(object);
        const hovered =
          !!owner &&
          !!hoveredObjectHandleRef.current &&
          objectHandlesMatch(owner, hoveredObjectHandleRef.current);
        object.scale.setScalar(hovered ? object.userData.hoverScale : scale);
        return;
      }

      object.scale.setScalar(scale);
    }

    function getWorldUnitsPerScreenPixel(
      worldPosition: THREE.Vector3,
      camera: THREE.Camera,
      viewportHeight: number,
    ) {
      if (camera instanceof THREE.PerspectiveCamera) {
        const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
        const distance = cameraPosition.distanceTo(worldPosition);
        const visibleHeight =
          2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) *
          distance /
          Math.max(camera.zoom, 0.0001);
        return visibleHeight / viewportHeight;
      }

      if (camera instanceof THREE.OrthographicCamera) {
        return (camera.top - camera.bottom) / (viewportHeight * camera.zoom);
      }

      return 0;
    }

    function startCameraHandleDrag(event: PointerEvent) {
      const handle = getCameraHandleHit();
      if (!handle) return false;

      const editorCamera = editorCameraRef.current;
      const renderer = rendererRef.current;
      if (!editorCamera || !renderer) return false;

      const camera = latestRef.current.scene.cameras.find(
        (entry) => entry.id === handle.cameraId,
      );
      if (!camera) return false;

      const updateKey = handle.kind === "lookAt" ? "lookAt" : "position";
      const startPoint = new THREE.Vector3(...camera[updateKey]);
      const normal =
        handle.kind === "axisPlane" && handle.axisPlane
          ? getCameraAxisPlaneNormal(handle.axisPlane)
          : new THREE.Vector3();
      if (handle.kind !== "axisPlane") {
        editorCamera.getWorldDirection(normal);
      }
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        normal,
        startPoint,
      );
      const hitPoint = intersectDragPlane(plane);
      if (!hitPoint) return false;

      dragStateRef.current = {
        ...handle,
        pointerId: event.pointerId,
        plane,
        offset: startPoint.clone().sub(hitPoint),
        updateKey,
      };
      latestRef.current.onSelect({ type: "camera", id: handle.cameraId });
      setHoveredCameraHandle(handle);
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    function dragCameraHandle() {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const hitPoint = intersectDragPlane(dragState.plane);
      if (!hitPoint) return;
      const nextPoint = hitPoint.add(dragState.offset);
      latestRef.current.onUpdateCamera(dragState.cameraId, {
        [dragState.updateKey]: vectorToTuple(nextPoint),
      });
    }

    function stopCameraHandleDrag(pointerId: number) {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== pointerId) return;
      const renderer = rendererRef.current;
      if (renderer?.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
      }
      dragStateRef.current = null;
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
      updateHoveredCameraHandle();
    }

    function startObjectHandleDrag(event: PointerEvent) {
      const handle = getObjectHandleHit();
      if (!handle) return false;

      const editorCamera = editorCameraRef.current;
      const renderer = rendererRef.current;
      if (!editorCamera || !renderer) return false;

      if (handle.kind === "floorPlane") {
        const selectionAtPointer = getSelectionHit(editorCamera, { useGpuPick: true });
        if (
          selectionAtPointer &&
          !selectionMatchesObject(selectionAtPointer as Selection, handle.objectId)
        ) {
          return false;
        }
      }

      const object = latestRef.current.scene.objects.find(
        (entry) => entry.id === handle.objectId,
      );
      if (!object) return false;

      const startPoint = new THREE.Vector3(...object.position);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 1, 0),
        startPoint,
      );
      const hitPoint = intersectDragPlane(plane);
      if (!hitPoint) return false;

      const startAngle =
        handle.kind === "rotateY"
          ? getObjectRotationPointerAngle(hitPoint, startPoint)
          : undefined;
      objectDragStateRef.current = {
        ...handle,
        pointerId: event.pointerId,
        plane,
        offset:
          handle.kind === "floorPlane"
            ? startPoint.clone().sub(hitPoint)
            : new THREE.Vector3(),
        startAngle,
        startRotationY: object.rotationY,
      };
      latestRef.current.onSelect({ type: "object", id: handle.objectId });
      setHoveredObjectHandle(handle);
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    function selectionMatchesObject(selection: Selection, objectId: string) {
      return selection.type === "object" && selection.id === objectId;
    }

    function dragObjectHandle() {
      const dragState = objectDragStateRef.current;
      if (!dragState) return;
      const hitPoint = intersectDragPlane(dragState.plane);
      if (!hitPoint) return;

      if (dragState.kind === "rotateY") {
        const object = latestRef.current.scene.objects.find(
          (entry) => entry.id === dragState.objectId,
        );
        if (!object || dragState.startAngle === undefined) return;
        const center = new THREE.Vector3(...object.position);
        const currentAngle = getObjectRotationPointerAngle(hitPoint, center);
        latestRef.current.onUpdateObject(dragState.objectId, {
          rotationY: normalizeRadians(
            (dragState.startRotationY ?? object.rotationY) +
              currentAngle -
              dragState.startAngle,
          ),
        });
        return;
      }

      const nextPoint = hitPoint.add(dragState.offset);
      const snappedPoint = getObjectPositionOnCollisionSurface(nextPoint) ?? nextPoint;
      latestRef.current.onUpdateObject(dragState.objectId, {
        position: vectorToTuple(snappedPoint),
      });
    }

    function stopObjectHandleDrag(pointerId: number) {
      const dragState = objectDragStateRef.current;
      if (!dragState || dragState.pointerId !== pointerId) return;
      const renderer = rendererRef.current;
      if (renderer?.domElement.hasPointerCapture(pointerId)) {
        renderer.domElement.releasePointerCapture(pointerId);
      }
      objectDragStateRef.current = null;
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
      updateHoveredObjectHandle();
    }

    function getObjectRotationPointerAngle(
      point: THREE.Vector3,
      center: THREE.Vector3,
    ) {
      return Math.atan2(point.x - center.x, point.z - center.z);
    }

    function intersectDragPlane(plane: THREE.Plane) {
      const editorCamera = editorCameraRef.current;
      if (!editorCamera) return undefined;
      setPointerRaycasterFromCamera(editorCamera);
      const hitPoint = new THREE.Vector3();
      return raycasterRef.current.ray.intersectPlane(plane, hitPoint) ?? undefined;
    }

    function setPointerRaycasterFromCamera(editorCamera: THREE.Camera) {
      raycasterRef.current.near = 0;
      raycasterRef.current.far = Infinity;
      syncCameraMatrices(editorCamera);
      raycasterRef.current.setFromCamera(pointerRef.current, editorCamera);
    }

    function updateHoveredCameraHandle() {
      setHoveredCameraHandle(getCameraHandleHit());
    }

    function updateHoveredObjectHandle() {
      setHoveredObjectHandle(getObjectHandleHit());
    }

    function setHoveredCameraHandle(handle: CameraHandle | null) {
      hoveredHandleRef.current = handle;
      const renderer = rendererRef.current;
      const cameraRoot = cameraRootRef.current;
      if (renderer && !dragStateRef.current && !objectDragStateRef.current) {
        renderer.domElement.style.cursor =
          handle?.kind === "axisPlane"
            ? "pointer"
            : hoveredObjectHandleRef.current
              ? "pointer"
              : "";
      }
      if (!cameraRoot) return;
      cameraRoot.traverse((child) => {
        const owner = findCameraHandle(child);
        const hovered =
          handle?.kind === "axisPlane" &&
          !!owner &&
          cameraHandlesMatch(owner, handle);

        if (child.name === "CameraHandleSquare") {
          child.visible = hovered;
          return;
        }

        if (child.name === "CameraAxisPlaneGuide") {
          child.visible = hovered;
          return;
        }

        if (child.name === "CameraAxisPlaneFill") {
          const mesh = child as THREE.Mesh;
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.color.setHex(hovered ? mesh.userData.hoverColor : mesh.userData.baseColor);
          material.opacity = hovered ? 0.68 : 0.36;
          material.needsUpdate = true;
        }
        if (child.name === "CameraAxisPlaneOutline") {
          const line = child as THREE.LineSegments;
          const material = line.material as THREE.LineBasicMaterial;
          material.color.setHex(hovered ? line.userData.hoverColor : line.userData.baseColor);
          material.opacity = hovered ? 1 : 0.95;
          material.needsUpdate = true;
        }
      });
    }

    function setHoveredObjectHandle(handle: ObjectHandle | null) {
      hoveredObjectHandleRef.current = handle;
      const renderer = rendererRef.current;
      const objectRoot = objectRootRef.current;
      if (renderer && !dragStateRef.current && !objectDragStateRef.current) {
        renderer.domElement.style.cursor = handle
          ? "pointer"
          : hoveredHandleRef.current?.kind === "axisPlane"
            ? "pointer"
            : "";
      }
      if (!objectRoot) return;
      objectRoot.traverse((child) => {
        const owner = findObjectHandle(child);
        const hovered = !!owner && !!handle && objectHandlesMatch(owner, handle);

        if (child.name === "ObjectFloorPlaneFill") {
          const mesh = child as THREE.Mesh;
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.color.setHex(hovered ? mesh.userData.hoverColor : mesh.userData.baseColor);
          material.opacity = hovered ? 0.68 : 0.34;
          material.needsUpdate = true;
        }
        if (child.name === "ObjectFloorPlaneOutline") {
          const line = child as THREE.LineSegments;
          const material = line.material as THREE.LineBasicMaterial;
          material.color.setHex(hovered ? line.userData.hoverColor : line.userData.baseColor);
          material.opacity = hovered ? 1 : 0.95;
          material.needsUpdate = true;
        }
        if (child.name === "ObjectRotationRing") {
          const mesh = child as THREE.Mesh;
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.color.setHex(hovered ? mesh.userData.hoverColor : mesh.userData.baseColor);
          const scale = hovered ? mesh.userData.hoverScale : mesh.userData.baseScale;
          mesh.scale.setScalar(scale);
          material.needsUpdate = true;
        }
      });
    }

    function updateSelectableCursor() {
      const renderer = rendererRef.current;
      const editorCamera = editorCameraRef.current;
      if (
        !renderer ||
        !editorCamera ||
        dragStateRef.current ||
        objectDragStateRef.current ||
        hoveredHandleRef.current ||
        hoveredObjectHandleRef.current
      ) {
        return;
      }

      renderer.domElement.style.cursor = getSelectionHit(editorCamera)
        ? "pointer"
        : "";
    }

    function getCameraHandleHit() {
      const editorCamera = editorCameraRef.current;
      const cameraRoot = cameraRootRef.current;
      if (!editorCamera || !cameraRoot) return null;

      updateCameraHandleFacing();
      setPointerRaycasterFromCamera(editorCamera);
      const axisPlaneHitAreas: THREE.Object3D[] = [];
      cameraRoot.traverse((child) => {
        if (child.name === "CameraAxisPlaneHitArea") {
          axisPlaneHitAreas.push(child);
        }
      });
      const axisPlaneHits = raycasterRef.current.intersectObjects(
        axisPlaneHitAreas,
        false,
      );
      if (axisPlaneHits[0]) {
        return findCameraHandle(axisPlaneHits[0].object);
      }

      const hits = raycasterRef.current.intersectObjects(cameraRoot.children, true);
      for (const hit of hits) {
        const handle = findCameraHandle(hit.object);
        if (handle && handle.kind !== "axisPlane") return handle;
      }
      return null;
    }

    function getObjectHandleHit(): ObjectHandle | null {
      const editorCamera = editorCameraRef.current;
      const objectRoot = objectRootRef.current;
      if (!editorCamera || !objectRoot) return null;

      setPointerRaycasterFromCamera(editorCamera);
      const hitAreas: THREE.Object3D[] = [];
      objectRoot.traverse((child) => {
        if (
          latestRef.current.viewMode === "rotate" &&
          child.name === "ObjectRotationHitArea"
        ) {
          hitAreas.push(child);
        }
      });
      const hits = raycasterRef.current.intersectObjects(hitAreas, false);
      if (hits[0]) return findObjectHandle(hits[0].object);

      if (latestRef.current.viewMode === "rotate") return null;
      if (latestRef.current.selection.type !== "object") return null;

      const selectedObjectHits = raycasterRef.current.intersectObjects(
        objectRoot.children,
        true,
      );
      for (const hit of selectedObjectHits) {
        if (hit.object.name === "ObjectFloorPlaneHitArea") continue;
        const selection = findSelection(hit.object) as Selection | undefined;
        if (
          selection?.type === "object" &&
          selection.id === latestRef.current.selection.id
        ) {
          return {
            objectId: selection.id,
            kind: "floorPlane",
          };
        }
      }
      return null;
    }

    function findCameraHandle(object: THREE.Object3D): CameraHandle | null {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current.userData.cameraHandle) {
          return current.userData.cameraHandle as CameraHandle;
        }
        current = current.parent;
      }
      return null;
    }

    function findObjectHandle(object: THREE.Object3D): ObjectHandle | null {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current.userData.objectHandle) {
          return current.userData.objectHandle as ObjectHandle;
        }
        current = current.parent;
      }
      return null;
    }

    function cameraHandlesMatch(a: CameraHandle, b: CameraHandle) {
      return (
        a.cameraId === b.cameraId &&
        a.kind === b.kind &&
        a.axisPlane === b.axisPlane
      );
    }

    function objectHandlesMatch(a: ObjectHandle, b: ObjectHandle) {
      return a.objectId === b.objectId && a.kind === b.kind;
    }

    function getCameraAxisPlaneNormal(axisPlane: CameraAxisPlane) {
      const localNormal =
        axisPlane === "xy"
          ? new THREE.Vector3(0, 0, 1)
          : axisPlane === "xz"
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
      return localNormal.applyQuaternion(getCameraFacingGizmoQuaternion()).normalize();
    }

    function getCameraFacingGizmoQuaternion() {
      const editorCamera = editorCameraRef.current;
      const baseQuaternion = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(1, 1, 1).normalize(),
        new THREE.Vector3(0, 0, 1),
      );
      return editorCamera
        ? editorCamera.quaternion.clone().multiply(baseQuaternion)
        : baseQuaternion;
    }

    function getDirectorCameraQuaternion(camera: DirectorCamera) {
      const cameraObject = new THREE.Object3D();
      cameraObject.position.set(...camera.position);
      cameraObject.lookAt(new THREE.Vector3(...camera.lookAt));
      cameraObject.rotateZ(THREE.MathUtils.degToRad(camera.roll));
      return cameraObject.quaternion.clone();
    }

    function pickSelection() {
      const threeScene = sceneRef.current;
      const editorCamera = editorCameraRef.current;
      if (!threeScene || !editorCamera) return false;

      const selected = getSelectionHit(editorCamera, { useGpuPick: true });
      if (selected) {
        latestRef.current.onSelect(selected as Selection);
        return true;
      }

      return false;
    }

    function getSelectionHit(
      editorCamera: THREE.Camera,
      options: { useGpuPick?: boolean } = {},
    ) {
      setPointerRaycasterFromCamera(editorCamera);

      const screenLabelHit = getScreenSpaceLabelSelectionHit(editorCamera);
      if (screenLabelHit) return screenLabelHit;

      const labelHit = findFirstLabelSelectionHit();
      if (labelHit) return labelHit;

      const objectHits = raycasterRef.current.intersectObjects(
        objectRootRef.current?.children ?? [],
        true,
      );
      const objectHit = objectHits.find(
        (item) => findSelection(item.object) && !findObjectHandle(item.object),
      );
      const selected =
        objectHit
          ? findSelection(objectHit.object)
          : findFirstCameraSelectionHit();
      if (selected) return selected as Selection;

      return options.useGpuPick ? getGpuSelectionHit(editorCamera) : undefined;
    }

    function getScreenSpaceLabelSelectionHit(editorCamera: THREE.Camera) {
      if (!usesWebGLLabels()) return undefined;

      const pointer = getPointerViewportPoint();
      if (!pointer) return undefined;

      const labelRoot = labelRootRef.current;
      if (!labelRoot?.visible) return undefined;

      const hits: Array<{ selection: Selection; rect: ScreenRect; depth: number }> = [];
      labelRoot.traverse((child) => {
        const sprite = child as THREE.Sprite;
        const selection = findSelection(sprite) as Selection | undefined;
        if (!sprite.isSprite || !selection) return;

        const rect = getSpriteScreenRect(
          sprite,
          editorCamera,
          pointer.width,
          pointer.height,
        );
        if (!rect || !isPointInsideScreenRect(pointer, rect, 0)) return;

        const projected = sprite
          .getWorldPosition(new THREE.Vector3())
          .project(editorCamera);
        if (projected.z < -1 || projected.z > 1) return;
        hits.push({ selection, rect, depth: projected.z });
      });

      hits.sort((a, b) => {
        const aArea = (a.rect.maxX - a.rect.minX) * (a.rect.maxY - a.rect.minY);
        const bArea = (b.rect.maxX - b.rect.minX) * (b.rect.maxY - b.rect.minY);
        return a.depth - b.depth || aArea - bArea;
      });

      if (hits[0]) {
        return hits[0].selection;
      }

      return undefined;
    }

    function getPointerViewportPoint() {
      const renderer = rendererRef.current;
      if (!renderer) return undefined;

      const { width, height } = renderer.domElement.getBoundingClientRect();
      if (width <= 0 || height <= 0) return undefined;

      return {
        x: ((pointerRef.current.x + 1) / 2) * width,
        y: ((-pointerRef.current.y + 1) / 2) * height,
        width,
        height,
      };
    }

    function isPointInsideScreenRect(
      pointer: { x: number; y: number },
      rect: ScreenRect,
      inset: number,
    ) {
      return (
        pointer.x >= rect.minX - inset &&
        pointer.x <= rect.maxX + inset &&
        pointer.y >= rect.minY - inset &&
        pointer.y <= rect.maxY + inset
      );
    }

    function getSpriteScreenRect(
      sprite: THREE.Sprite,
      editorCamera: THREE.Camera,
      width: number,
      height: number,
    ): ScreenRect | undefined {
      const position = sprite.getWorldPosition(new THREE.Vector3());
      const scale = sprite.getWorldScale(new THREE.Vector3());
      const cameraRight = new THREE.Vector3().setFromMatrixColumn(
        editorCamera.matrixWorld,
        0,
      );
      const cameraUp = new THREE.Vector3().setFromMatrixColumn(
        editorCamera.matrixWorld,
        1,
      );
      const left = -sprite.center.x * scale.x;
      const right = (1 - sprite.center.x) * scale.x;
      const bottom = -sprite.center.y * scale.y;
      const top = (1 - sprite.center.y) * scale.y;
      const corners = [
        position
          .clone()
          .addScaledVector(cameraRight, left)
          .addScaledVector(cameraUp, bottom),
        position
          .clone()
          .addScaledVector(cameraRight, right)
          .addScaledVector(cameraUp, bottom),
        position
          .clone()
          .addScaledVector(cameraRight, right)
          .addScaledVector(cameraUp, top),
        position
          .clone()
          .addScaledVector(cameraRight, left)
          .addScaledVector(cameraUp, top),
      ];
      const points = corners
        .map((corner) => projectWorldLabelPoint(corner, editorCamera, width, height))
        .filter((point) => point.visible);
      if (points.length === 0) return undefined;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }

      return {
        minX,
        minY,
        maxX,
        maxY,
      };
    }

    function getGpuSelectionHit(editorCamera: THREE.Camera) {
      const renderer = rendererRef.current;
      if (!renderer) return undefined;

      const bufferSize = new THREE.Vector2();
      renderer.getDrawingBufferSize(bufferSize);
      const width = Math.max(1, Math.floor(bufferSize.x));
      const height = Math.max(1, Math.floor(bufferSize.y));
      const pixelX = clamp(
        Math.floor(((pointerRef.current.x + 1) / 2) * width),
        0,
        width - 1,
      );
      const pixelY = clamp(
        Math.floor(((-pointerRef.current.y + 1) / 2) * height),
        0,
        height - 1,
      );
      const pickScene = new THREE.Scene();
      const selectionByColor = new Map<number, Selection>();
      let colorIndex = 1;

      const nextMaterial = (selection: Selection) => {
        const color = colorIndex;
        colorIndex += 1;
        selectionByColor.set(color, selection);
        return new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: true,
          toneMapped: false,
        });
      };

      for (const object of latestRef.current.scene.objects) {
        const root = getObjectRootById(object.id);
        if (!root) continue;
        addPickMeshesFromRoot(root, { type: "object", id: object.id }, nextMaterial, pickScene);
      }

      for (const camera of latestRef.current.scene.cameras) {
        const root = getCameraRootById(camera.id);
        if (!root) continue;
        addPickMeshesFromRoot(root, { type: "camera", id: camera.id }, nextMaterial, pickScene);
      }

      const labelRoot = labelRootRef.current;
      if (labelRoot?.visible) {
        labelRoot.traverse((child) => {
          const selection = findSelection(child) as Selection | undefined;
          const sprite = child as THREE.Sprite;
          if (!selection || !sprite.isSprite) return;

          const color = colorIndex;
          colorIndex += 1;
          selectionByColor.set(color, selection);
          const material = new THREE.SpriteMaterial({
            color,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          });
          const pickSprite = new THREE.Sprite(material);
          pickSprite.position.copy(sprite.getWorldPosition(new THREE.Vector3()));
          pickSprite.scale.copy(sprite.getWorldScale(new THREE.Vector3()));
          pickSprite.center.copy(sprite.center);
          pickSprite.frustumCulled = false;
          pickSprite.renderOrder = sprite.renderOrder;
          pickScene.add(pickSprite);
        });
      }

      const oldRenderTarget = renderer.getRenderTarget();
      const oldViewport = new THREE.Vector4();
      const oldScissor = new THREE.Vector4();
      const oldClearColor = renderer.getClearColor(new THREE.Color());
      const oldClearAlpha = renderer.getClearAlpha();
      renderer.getViewport(oldViewport);
      renderer.getScissor(oldScissor);
      const oldScissorTest = renderer.getScissorTest();
      const renderTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false,
      });
      const pixel = new Uint8Array(4);

      try {
        renderer.setRenderTarget(renderTarget);
        renderer.setViewport(0, 0, width, height);
        renderer.setScissor(0, 0, width, height);
        renderer.setScissorTest(false);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, true, true);
        renderer.render(pickScene, editorCamera);
        renderer.readRenderTargetPixels(
          renderTarget,
          pixelX,
          height - pixelY - 1,
          1,
          1,
          pixel,
        );
      } finally {
        renderer.setRenderTarget(oldRenderTarget);
        renderer.setViewport(oldViewport);
        renderer.setScissor(oldScissor);
        renderer.setScissorTest(oldScissorTest);
        renderer.setClearColor(oldClearColor, oldClearAlpha);
        renderTarget.dispose();
        disposePickScene(pickScene);
      }

      const color = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
      return selectionByColor.get(color);
    }

    function disposePickScene(pickScene: THREE.Scene) {
      pickScene.traverse((child) => {
        const mesh = child as THREE.Mesh | THREE.Sprite;
        const material = mesh.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material?.dispose();
        }
      });
      pickScene.clear();
    }

    function addPickMeshesFromRoot(
      root: THREE.Object3D,
      selection: Selection,
      createMaterial: (selection: Selection) => THREE.MeshBasicMaterial,
      pickScene: THREE.Scene,
    ) {
      root.updateWorldMatrix(true, true);
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry || findObjectHandle(mesh)) return;

        const meshSelection = findSelection(mesh) as Selection | undefined;
        if (meshSelection && meshSelection.type !== selection.type) return;
        if (
          meshSelection &&
          "id" in meshSelection &&
          "id" in selection &&
          meshSelection.id !== selection.id
        ) {
          return;
        }

        const pickMesh = new THREE.Mesh(
          mesh.geometry,
          createMaterial(selection),
        );
        pickMesh.matrix.copy(mesh.matrixWorld);
        pickMesh.matrixAutoUpdate = false;
        pickMesh.frustumCulled = false;
        pickScene.add(pickMesh);
      });
    }

    function findFirstLabelSelectionHit() {
      const labelRoot = labelRootRef.current;
      if (!labelRoot?.visible) return undefined;

      const labelHits = raycasterRef.current.intersectObjects(
        labelRoot.children,
        true,
      );
      const hit = labelHits.find((item) => findSelection(item.object));
      return hit ? findSelection(hit.object) : undefined;
    }

    function findFirstCameraSelectionHit() {
      const cameraRoot = cameraRootRef.current;
      if (!cameraRoot) return undefined;

      const cameraHits = raycasterRef.current.intersectObjects(cameraRoot.children, true);
      const hit = cameraHits.find((item) => findSelection(item.object));
      return hit ? findSelection(hit.object) : undefined;
    }

    function findSelection(object: THREE.Object3D): unknown {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current.userData.selection) return current.userData.selection;
        current = current.parent;
      }
      return undefined;
    }

    async function captureCamera(
      cameraId: string,
      options: { width?: number; height?: number } = {},
    ) {
      const directorCamera = latestRef.current.scene.cameras.find(
        (camera) => camera.id === cameraId,
      );
      if (!directorCamera) return undefined;

      const width = options.width ?? DEFAULT_CAPTURE_SIZE.width;
      const height = options.height ?? DEFAULT_CAPTURE_SIZE.height;
      const camera = createPerspectiveFromDirectorCamera(directorCamera, width / height);
      return captureWithPerspectiveCamera(camera, width, height);
    }

    async function captureEditorViewpoint(
      options: { width?: number; height?: number } = {},
    ) {
      const width = options.width ?? DEFAULT_CAPTURE_SIZE.width;
      const height = options.height ?? DEFAULT_CAPTURE_SIZE.height;
      const camera = createPerspectiveFromEditorCamera(width / height);
      if (!camera) return undefined;

      return captureWithPerspectiveCamera(camera, width, height);
    }

    async function captureWithPerspectiveCamera(
      camera: THREE.PerspectiveCamera,
      width: number,
      height: number,
    ) {
      const renderer = rendererRef.current;
      const threeScene = sceneRef.current;
      if (!renderer || !threeScene) return undefined;

      const collisionVisible = collisionMeshRef.current?.visible ?? false;
      const cameraRootVisible = cameraRootRef.current?.visible ?? false;
      const labelRootVisible = labelRootRef.current?.visible ?? false;
      const gridVisible = gridRef.current?.visible ?? false;

      try {
        if (collisionMeshRef.current) {
          collisionMeshRef.current.visible = false;
        }
        if (cameraRootRef.current) {
          cameraRootRef.current.visible = false;
        }
        if (labelRootRef.current) {
          labelRootRef.current.visible = false;
        }
        if (gridRef.current) {
          gridRef.current.visible = false;
        }

        await sparkRef.current?.update?.({ scene: threeScene, camera });
        if (splatMeshRef.current) {
          return captureWithVisibleFramebuffer(renderer, threeScene, camera, width, height);
        }

        return captureWithRenderTarget(renderer, threeScene, camera, width, height);
      } finally {
        if (collisionMeshRef.current) {
          collisionMeshRef.current.visible = collisionVisible;
        }
        if (cameraRootRef.current) {
          cameraRootRef.current.visible = cameraRootVisible;
        }
        if (labelRootRef.current) {
          labelRootRef.current.visible = labelRootVisible;
        }
        if (gridRef.current) {
          gridRef.current.visible = gridVisible;
        }
        await redrawEditorView(renderer, threeScene);
      }
    }

    function captureWithRenderTarget(
      renderer: THREE.WebGLRenderer,
      threeScene: THREE.Scene,
      camera: THREE.PerspectiveCamera,
      width: number,
      height: number,
    ) {
      const oldRenderTarget = renderer.getRenderTarget();
      const oldViewport = new THREE.Vector4();
      const oldScissor = new THREE.Vector4();
      renderer.getViewport(oldViewport);
      renderer.getScissor(oldScissor);
      const oldScissorTest = renderer.getScissorTest();
      const renderTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false,
      });
      renderTarget.texture.colorSpace = renderer.outputColorSpace;

      try {
        renderer.setRenderTarget(renderTarget);
        renderer.setViewport(0, 0, width, height);
        renderer.setScissor(0, 0, width, height);
        renderer.setScissorTest(false);
        renderer.clear(true, true, true);
        renderer.render(threeScene, camera);
        return renderTargetToDataUrl(renderer, renderTarget, width, height);
      } finally {
        renderer.setRenderTarget(oldRenderTarget);
        renderer.setViewport(oldViewport);
        renderer.setScissor(oldScissor);
        renderer.setScissorTest(oldScissorTest);
        renderTarget.dispose();
      }
    }

    function captureWithVisibleFramebuffer(
      renderer: THREE.WebGLRenderer,
      threeScene: THREE.Scene,
      camera: THREE.PerspectiveCamera,
      width: number,
      height: number,
    ) {
      const oldRenderTarget = renderer.getRenderTarget();
      const oldViewport = new THREE.Vector4();
      const oldScissor = new THREE.Vector4();
      renderer.getViewport(oldViewport);
      renderer.getScissor(oldScissor);
      const oldScissorTest = renderer.getScissorTest();
      const bufferSize = new THREE.Vector2();
      renderer.getDrawingBufferSize(bufferSize);
      const targetAspect = width / height;
      const viewport = fitViewportToAspect(bufferSize.x, bufferSize.y, targetAspect);

      try {
        renderer.setRenderTarget(null);
        renderer.setViewport(0, 0, viewport.width, viewport.height);
        renderer.setScissor(0, 0, viewport.width, viewport.height);
        renderer.setScissorTest(false);
        renderer.clear(true, true, true);
        renderer.render(threeScene, camera);
        return canvasRegionToDataUrl(
          renderer.domElement,
          0,
          0,
          viewport.width,
          viewport.height,
          width,
          height,
        );
      } finally {
        renderer.setRenderTarget(oldRenderTarget);
        renderer.setViewport(oldViewport);
        renderer.setScissor(oldScissor);
        renderer.setScissorTest(oldScissorTest);
      }
    }

    async function redrawEditorView(
      renderer: THREE.WebGLRenderer,
      threeScene: THREE.Scene,
    ) {
      const editorCamera = editorCameraRef.current;
      if (!editorCamera) return;

      await sparkRef.current?.update?.({ scene: threeScene, camera: editorCamera });
      syncCameraMatrices(editorCamera);
      resetRendererViewport(renderer);
      renderer.clear(true, true, true);
      renderer.render(threeScene, editorCamera);
    }

    function fitViewportToAspect(
      bufferWidth: number,
      bufferHeight: number,
      targetAspect: number,
    ) {
      let width = bufferWidth;
      let height = Math.round(width / targetAspect);
      if (height > bufferHeight) {
        height = bufferHeight;
        width = Math.round(height * targetAspect);
      }
      return {
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height)),
      };
    }

    function resetRendererViewport(renderer: THREE.WebGLRenderer) {
      const bufferSize = new THREE.Vector2();
      renderer.getDrawingBufferSize(bufferSize);
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, bufferSize.x, bufferSize.y);
      renderer.setScissor(0, 0, bufferSize.x, bufferSize.y);
      renderer.setScissorTest(false);
    }

    function syncCameraMatrices(camera: THREE.Camera) {
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    }

    function canvasRegionToDataUrl(
      sourceCanvas: HTMLCanvasElement,
      sourceX: number,
      sourceY: number,
      sourceWidth: number,
      sourceHeight: number,
      outputWidth: number,
      outputHeight: number,
    ) {
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d");
      if (!context) return undefined;

      context.drawImage(
        sourceCanvas,
        sourceX,
        sourceCanvas.height - sourceY - sourceHeight,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outputWidth,
        outputHeight,
      );
      return canvas.toDataURL("image/png");
    }

    function renderTargetToDataUrl(
      renderer: THREE.WebGLRenderer,
      renderTarget: THREE.WebGLRenderTarget,
      width: number,
      height: number,
    ) {
      const pixels = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return undefined;

      const imageData = context.createImageData(width, height);
      const rowWidth = width * 4;
      for (let y = 0; y < height; y += 1) {
        const sourceStart = (height - y - 1) * rowWidth;
        const targetStart = y * rowWidth;
        imageData.data.set(
          pixels.subarray(sourceStart, sourceStart + rowWidth),
          targetStart,
        );
      }
      context.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/png");
    }

    function createPerspectiveFromDirectorCamera(
      directorCamera: DirectorCamera,
      aspect: number,
    ) {
      const fov = lensToVerticalFov(directorCamera.lens);
      const camera = new THREE.PerspectiveCamera(fov, aspect, 0.05, 100);
      camera.position.set(...directorCamera.position);
      camera.lookAt(new THREE.Vector3(...directorCamera.lookAt));
      camera.rotateZ(THREE.MathUtils.degToRad(directorCamera.roll));
      camera.updateProjectionMatrix();
      return camera;
    }

    function createPerspectiveFromEditorCamera(aspect: number) {
      const editorCamera = editorCameraRef.current;
      if (!editorCamera) return undefined;

      const camera = new THREE.PerspectiveCamera(
        editorCamera.fov,
        aspect,
        editorCamera.near,
        editorCamera.far,
      );
      camera.position.copy(editorCamera.position);
      camera.quaternion.copy(editorCamera.quaternion);
      camera.zoom = editorCamera.zoom;
      camera.focus = editorCamera.focus;
      camera.filmGauge = editorCamera.filmGauge;
      camera.filmOffset = editorCamera.filmOffset;
      camera.updateProjectionMatrix();
      return camera;
    }

    return (
      <div className="three-viewport" ref={hostRef}>
        <div className="viewport-labels" ref={labelOverlayRef} />
      </div>
    );
  },
);

function lensToVerticalFov(lensMm: number) {
  const sensorHeight = 24;
  return THREE.MathUtils.radToDeg(2 * Math.atan(sensorHeight / (2 * lensMm)));
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObjectTree(child);
  }
}

function disposeObjectTree(object: THREE.Object3D) {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        disposeMaterialTexture(entry);
        entry.dispose?.();
      });
    } else {
      disposeMaterialTexture(material);
      material?.dispose?.();
    }
  });
}

function disposeMaterialTexture(material: THREE.Material | undefined) {
  const mappedMaterial = material as (THREE.Material & { map?: THREE.Texture }) | undefined;
  mappedMaterial?.map?.dispose();
}

function getFileExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === fileName.length - 1) return "";
  return fileName.slice(lastDot + 1).toLowerCase();
}

function normalizeRadians(value: number) {
  const fullTurn = Math.PI * 2;
  return ((((value + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [
    Number(vector.x.toFixed(3)),
    Number(vector.y.toFixed(3)),
    Number(vector.z.toFixed(3)),
  ];
}

function getHorizontalSpan(size: THREE.Vector3) {
  return Math.hypot(size.x, size.z);
}

function getBoxCorners(box: THREE.Box3) {
  return [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
}

function getAdaptiveEntityScale(horizontalSpan: number) {
  if (!Number.isFinite(horizontalSpan) || horizontalSpan <= 0) return 1;

  return clamp(
    horizontalSpan / REFERENCE_SCENE_HORIZONTAL_SPAN,
    MIN_ADAPTIVE_ENTITY_SCALE,
    MAX_ADAPTIVE_ENTITY_SCALE,
  );
}

function isUsableBox(box: THREE.Box3) {
  return (
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z) &&
    !box.isEmpty()
  );
}

function getAxisSignCandidates(): Array<[number, number, number]> {
  return [
    [1, 1, 1],
    [-1, 1, 1],
    [1, -1, 1],
    [-1, -1, 1],
    [1, 1, -1],
    [-1, 1, -1],
    [1, -1, -1],
    [-1, -1, -1],
  ];
}

function axesMatch(a: [number, number, number], b: [number, number, number]) {
  return a.every((axis, index) => axis === b[index]);
}

function transformBox(box: THREE.Box3, matrix: THREE.Matrix4) {
  const transformedBox = box.clone();
  transformedBox.applyMatrix4(matrix);
  return transformedBox;
}

function getBestUniformScale(sourceBounds: THREE.Box3, targetBounds: THREE.Box3) {
  const sourceValues = [
    sourceBounds.min.x,
    sourceBounds.max.x,
    sourceBounds.min.y,
    sourceBounds.max.y,
    sourceBounds.min.z,
    sourceBounds.max.z,
  ];
  const targetValues = [
    targetBounds.min.x,
    targetBounds.max.x,
    targetBounds.min.y,
    targetBounds.max.y,
    targetBounds.min.z,
    targetBounds.max.z,
  ];
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < sourceValues.length; index += 1) {
    numerator += sourceValues[index] * targetValues[index];
    denominator += sourceValues[index] * sourceValues[index];
  }

  if (denominator <= 0) return 1;
  return Math.abs(numerator / denominator);
}

function scaleBoxFromOrigin(box: THREE.Box3, scale: number) {
  const points = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  const scaledBox = new THREE.Box3();

  for (const point of points) {
    scaledBox.expandByPoint(point.multiplyScalar(scale));
  }

  return scaledBox;
}

function getBoundsAlignmentScore(sourceBounds: THREE.Box3, targetBounds: THREE.Box3) {
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const targetCenter = targetBounds.getCenter(new THREE.Vector3());
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const targetSize = targetBounds.getSize(new THREE.Vector3());

  return sourceCenter.distanceTo(targetCenter) + sourceSize.distanceTo(targetSize) * 0.35;
}

function keepPointInsideBox(point: THREE.Vector3, box: THREE.Box3) {
  point.set(
    clamp(point.x, box.min.x, box.max.x),
    clamp(point.y, box.min.y, box.max.y),
    clamp(point.z, box.min.z, box.max.z),
  );
}

function createCollisionSamplePoints(box: THREE.Box3) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const fractions = [0, -0.16, 0.16, -0.32, 0.32, -0.46, 0.46];
  const samples: Array<{ x: number; z: number; distance: number }> = [];

  for (const xFraction of fractions) {
    for (const zFraction of fractions) {
      const marginX = Math.max(size.x * 0.08, 0.05);
      const marginZ = Math.max(size.z * 0.08, 0.05);
      samples.push({
        x: clamp(center.x + size.x * xFraction, box.min.x + marginX, box.max.x - marginX),
        z: clamp(center.z + size.z * zFraction, box.min.z + marginZ, box.max.z - marginZ),
        distance: Math.abs(xFraction) + Math.abs(zFraction),
      });
    }
  }

  return samples.sort((a, b) => a.distance - b.distance);
}

function createViewpointFromFloorPoint(
  floorPoint: THREE.Vector3,
  box: THREE.Box3,
): Viewpoint {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxHorizontal = Math.max(size.x, size.z, 0.001);
  const maxEyeY = Math.max(box.min.y + 0.3, box.max.y - 0.12);
  const eye = new THREE.Vector3(
    floorPoint.x,
    clamp(floorPoint.y + HUMAN_EYE_HEIGHT, box.min.y + 0.3, maxEyeY),
    floorPoint.z,
  );
  const direction = center.clone().sub(floorPoint);
  direction.y = 0;

  if (direction.lengthSq() < 0.01) {
    if (size.z >= size.x) {
      direction.set(0, 0, -1);
    } else {
      direction.set(1, 0, 0);
    }
  } else {
    direction.normalize();
  }

  const targetDistance = clamp(maxHorizontal * 0.18, 0.8, 3.5);
  const target = floorPoint
    .clone()
    .add(direction.multiplyScalar(targetDistance));
  target.y = eye.y;

  keepPointInsideBox(eye, box);
  keepPointInsideBox(target, box);

  if (eye.distanceToSquared(target) < 0.01) {
    target.z = clamp(eye.z - 0.75, box.min.z, box.max.z);
  }

  return { eye, target };
}

function getHorizontalEdgePenalty(point: THREE.Vector3, box: THREE.Box3) {
  const size = box.getSize(new THREE.Vector3());
  const xEdgeDistance = Math.min(point.x - box.min.x, box.max.x - point.x);
  const zEdgeDistance = Math.min(point.z - box.min.z, box.max.z - point.z);
  const xEdgeRatio = size.x > 0 ? xEdgeDistance / size.x : 1;
  const zEdgeRatio = size.z > 0 ? zEdgeDistance / size.z : 1;
  const edgeRatio = Math.min(xEdgeRatio, zEdgeRatio);

  return edgeRatio < 0.08 ? 0.35 : 0;
}

function viewpointVectorToTuple(vector: THREE.Vector3): EditorViewpoint["eye"] {
  return [
    roundViewpointNumber(vector.x),
    roundViewpointNumber(vector.y),
    roundViewpointNumber(vector.z),
  ];
}

function roundViewpointNumber(value: number) {
  const rounded = Number(value.toFixed(4));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function waitForFrame(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function normalizeBoneName(name: string) {
  return name
    .replace(/^.*[:|]/, "")
    .replace(/^mixamorig/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function formatObjectModelLoadError(object: BoardObject, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const unsupportedFbxVersion = message.match(
    /FBX version not supported,\s*FileVersion:\s*(\d+)/i,
  )?.[1];

  if (unsupportedFbxVersion) {
    const major = Number.parseInt(unsupportedFbxVersion, 10) / 1000;
    return `${object.name} uses unsupported FBX ${major}. Re-export it as FBX 7.x or GLB.`;
  }

  return `Could not load ${object.name} model; showing blockout fallback.`;
}

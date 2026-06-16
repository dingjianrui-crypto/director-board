import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  BoardObject,
  DirectorCamera,
  DirectorScene,
  EnvironmentTemplate,
  Selection,
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

export type ThreeViewportHandle = {
  capture: (
    cameraId: string,
    options?: {
      width?: number;
      height?: number;
    },
  ) => string | undefined;
};

type Props = {
  scene: DirectorScene;
  template: EnvironmentTemplate;
  selection: Selection;
  selectedCameraId?: string;
  showGrid: boolean;
  showLabels: boolean;
  onSelect: (selection: Selection) => void;
  onUpdateCamera: (cameraId: string, patch: Partial<DirectorCamera>) => void;
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

type EnvironmentFrameSource = "splat" | "collision" | "spawn";

type EnvironmentFrameClaim = {
  key: string;
  priority: number;
};

type Viewpoint = {
  eye: THREE.Vector3;
  target: THREE.Vector3;
};

const SCAN_ENVIRONMENT_SCALE = 3;
const SPARK_PHYSICS_SPAWN_EYE = new THREE.Vector3(0, 1.48, 0);
const SPARK_PHYSICS_SPAWN_TARGET = new THREE.Vector3(0, 1.48, 1);
const HUMAN_EYE_HEIGHT = 1.55;
const HUMAN_COLLISION_RADIUS = 0.18;
const HUMAN_MAX_STEP_HEIGHT = 0.35;
const HUMAN_MAX_GROUND_DROP = 1;
const HUMAN_GROUND_RAY_HEADROOM = 0.25;
const KEYBOARD_NAV_SPEED = 1.4;
const KEYBOARD_NAV_VERTICAL_LOOK_THRESHOLD = 0.18;

export const ThreeViewport = forwardRef<ThreeViewportHandle, Props>(
  function ThreeViewport(
    {
      scene,
      template,
      selection,
      selectedCameraId,
      showGrid,
      showLabels,
      onSelect,
      onUpdateCamera,
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
    const environmentRootRef = useRef<THREE.Group | null>(null);
    const objectRootRef = useRef<THREE.Group | null>(null);
    const cameraRootRef = useRef<THREE.Group | null>(null);
    const labelRootRef = useRef<THREE.Group | null>(null);
    const collisionMeshRef = useRef<THREE.Object3D | null>(null);
    const splatMeshRef = useRef<(THREE.Object3D & { dispose?: () => void }) | null>(null);
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
    const keyboardNavKeysRef = useRef(new Set<string>());
    const framedEnvironmentRef = useRef<{
      key: string;
      priority: number;
    } | null>(null);

    const latestRef = useRef({
      scene,
      template,
      selection,
      selectedCameraId,
      showGrid,
      showLabels,
      onSelect,
      onUpdateCamera,
      onStatus,
    });

    latestRef.current = {
      scene,
      template,
      selection,
      selectedCameraId,
      showGrid,
      showLabels,
      onSelect,
      onUpdateCamera,
      onStatus,
    };

    useImperativeHandle(ref, () => ({
      capture(cameraId: string, options?: { width?: number; height?: number }) {
        return captureCamera(cameraId, options);
      },
    }));

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

      const environmentRoot = new THREE.Group();
      environmentRoot.name = "EnvironmentRoot";
      threeScene.add(environmentRoot);
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
      environmentRootRef.current = environmentRoot;
      objectRootRef.current = objectRoot;
      cameraRootRef.current = cameraRoot;
      labelRootRef.current = labelRoot;

      const onResize = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        renderer.setSize(width, height);
        editorCamera.aspect = width / height;
        editorCamera.updateProjectionMatrix();
      };
      const updatePointer = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      };
      const onPointerDown = (event: PointerEvent) => {
        updatePointer(event);
        if (startCameraHandleDrag(event)) return;
        pickSelection();
      };
      const onPointerMove = (event: PointerEvent) => {
        updatePointer(event);
        if (dragStateRef.current) {
          dragCameraHandle();
          return;
        }
        updateHoveredCameraHandle();
      };
      const onPointerUp = (event: PointerEvent) => {
        stopCameraHandleDrag(event.pointerId);
      };
      const onPointerLeave = () => {
        if (!dragStateRef.current) {
          setHoveredCameraHandle(null);
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

      window.addEventListener("resize", onResize);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
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
        updateLabelFacing();
        updateCameraHandleFacing();
        void sparkRef.current?.update?.({ scene: threeScene, camera: editorCamera });
        renderer.render(threeScene, editorCamera);
      };
      renderLoop();

      return () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
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
    }, [showGrid, showLabels]);

    useEffect(() => {
      void rebuildEnvironment();
    }, [scene.environment, template.id]);

    useEffect(() => {
      alignGridToEnvironmentGround(environmentRootRef.current);
    }, [scene.environment.gridY, scene.environment.transform.position]);

    useEffect(() => {
      rebuildObjects();
      rebuildCameras();
      rebuildLabels();
    }, [scene.objects, scene.cameras, selection, showLabels]);

    async function rebuildEnvironment() {
      const root = environmentRootRef.current;
      if (!root) return;

      clearGroup(root);
      splatMeshRef.current?.dispose?.();
      splatMeshRef.current = null;
      collisionMeshRef.current = null;
      autoGridYRef.current = null;

      applyEnvironmentTransform(root);
      alignGridToEnvironmentGround(root);

      if (!scene.environment.visible) {
        return;
      }

      frameEditorCameraAtSparkPhysicsSpawn(root);

      if (template.splat) {
        await loadSplat(root);
      } else {
        buildProceduralKitchen(root);
      }

      if (template.collision) {
        await loadCollisionMesh(root);
      } else {
        const collision = buildProceduralCollision();
        root.add(collision);
        collisionMeshRef.current = collision;
      }
    }

    function applyEnvironmentTransform(root: THREE.Object3D) {
      const { position, rotation, scale } = latestRef.current.scene.environment.transform;
      root.position.set(position[0], position[1], position[2]);
      const effectiveRotation = getEffectiveEnvironmentRotation(rotation);
      root.rotation.set(
        effectiveRotation[0],
        effectiveRotation[1],
        effectiveRotation[2],
      );
      root.scale.setScalar(scale);
    }

    function getEffectiveEnvironmentRotation(
      rotation: [number, number, number],
    ): [number, number, number] {
      const hasLegacyRootFlip =
        latestRef.current.template.source === "upload" &&
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
        latestRef.current.onStatus("Spark could not be initialized; showing collision/blockout fallback.");
        return false;
      }
    }

    async function loadSplat(root: THREE.Group) {
      const ok = await ensureSpark();
      if (!ok || !template.splat) {
        buildProceduralKitchen(root);
        return;
      }

      try {
        const sparkModule = (await import("@sparkjsdev/spark")) as unknown as SparkModule;
        const mode = latestRef.current.scene.environment.renderMode;
        const splat = new sparkModule.SplatMesh({
          url: template.splat.objectUrl ?? template.splat.path,
          fileName: template.splat.path,
          fileType: template.splat.fileType,
          raycastable: false,
          lod: mode !== "quality",
          paged: template.splat.fileType === "rad",
          onProgress: (event: ProgressEvent) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              latestRef.current.onStatus(`Loading splat ${percent}%`);
            } else {
              latestRef.current.onStatus("Loading splat");
            }
          },
          onLoad: () => latestRef.current.onStatus("Environment splat ready"),
        });
        splat.opacity = latestRef.current.scene.environment.opacity;
        applySplatCoordinateFix(splat);
        root.add(splat);
        splatMeshRef.current = splat;
        await splat.initialized?.catch(() => undefined);
        void retryFrameEditorCameraInsideSplat(root, splat);
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
        if (environmentRootRef.current !== root || splatMeshRef.current !== splat) return;
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

    function frameEditorCameraInsideObject(
      object: THREE.Object3D,
      source: EnvironmentFrameSource,
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
      if (latestRef.current.template.source === "procedural" || !latestRef.current.template.splat) {
        return false;
      }

      root.updateWorldMatrix(true, false);
      const viewpoint = {
        eye: SPARK_PHYSICS_SPAWN_EYE.clone().applyMatrix4(root.matrixWorld),
        target: SPARK_PHYSICS_SPAWN_TARGET.clone().applyMatrix4(root.matrixWorld),
      };

      return frameEditorCameraAtViewpoint(viewpoint, null, "spawn");
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
        alignGridToEnvironmentGround(environmentRootRef.current);

        return createViewpointFromFloorPoint(best.point, bounds);
      } finally {
        meshes.forEach((mesh, index) => {
          mesh.visible = visibility[index];
        });
      }
    }

    function frameEditorCameraInsideBounds(
      bounds: THREE.Box3,
      source: EnvironmentFrameSource,
    ) {
      const editorCamera = editorCameraRef.current;
      const controls = controlsRef.current;
      if (!editorCamera || !controls) return false;

      const claim = claimEnvironmentFrame(source);
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
      framedEnvironmentRef.current = claim;
      return true;
    }

    function frameEditorCameraAtViewpoint(
      viewpoint: Viewpoint,
      bounds: THREE.Box3 | null,
      source: EnvironmentFrameSource,
    ) {
      const editorCamera = editorCameraRef.current;
      const controls = controlsRef.current;
      if (!editorCamera || !controls) return false;

      const claim = claimEnvironmentFrame(source);
      if (!claim) return false;

      const size = bounds?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(12, 4, 12);
      editorCamera.position.copy(viewpoint.eye);
      editorCamera.near = 0.02;
      editorCamera.far = Math.max(100, size.length() * 8);
      editorCamera.lookAt(viewpoint.target);
      editorCamera.updateProjectionMatrix();
      controls.target.copy(viewpoint.target);
      controls.update();
      framedEnvironmentRef.current = claim;
      return true;
    }

    function alignGridToEnvironmentGround(root: THREE.Object3D | null) {
      if (!gridRef.current) return;

      gridRef.current.position.y =
        latestRef.current.scene.environment.gridY ??
        autoGridYRef.current ??
        root?.position.y ??
        0;
    }

    function updateKeyboardNavigation(deltaTime: number) {
      const camera = editorCameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls || keyboardNavKeysRef.current.size === 0) return;

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

    function getKeyboardNavResolvedPosition(
      currentPosition: THREE.Vector3,
      nextPosition: THREE.Vector3,
      preserveVerticalLook: boolean,
    ) {
      if (!latestRef.current.template.splat || !collisionMeshRef.current) {
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

    function claimEnvironmentFrame(
      source: EnvironmentFrameSource,
    ): EnvironmentFrameClaim | null {
      const key = `${latestRef.current.scene.id}:${latestRef.current.template.id}`;
      const priority = getEnvironmentFramePriority(source);
      if (
        framedEnvironmentRef.current?.key === key &&
        framedEnvironmentRef.current.priority >= priority
      ) {
        return null;
      }

      return { key, priority };
    }

    function getEnvironmentFramePriority(source: EnvironmentFrameSource) {
      if (source === "spawn") return 3;
      return source === "collision" ? 2 : 1;
    }

    async function loadCollisionMesh(root: THREE.Group) {
      if (!template.collision) return;

      const loader = new GLTFLoader();
      const url = template.collision.objectUrl ?? template.collision.path;

      try {
        const gltf = await loader.loadAsync(url);
        const collision = gltf.scene;
        collision.name = "CollisionMesh";
        applyCollisionCoordinateFix(collision);
        collision.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.userData.collision = true;
          mesh.visible = latestRef.current.scene.environment.collision.visibleInEditor;
          mesh.material = createCollisionMaterial();
        });
        root.add(collision);
        collisionMeshRef.current = collision;
        frameEditorCameraInsideObject(collision, "collision");
      } catch (error) {
        latestRef.current.onStatus("Collision mesh load failed; placement falls back to floor plane.");
        const fallback = buildProceduralCollision();
        applyCollisionCoordinateFix(fallback);
        root.add(fallback);
        collisionMeshRef.current = fallback;
        frameEditorCameraInsideObject(fallback, "collision");
      }
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
      collision.visible = latestRef.current.scene.environment.collision.visibleInEditor;
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
          latestRef.current.scene.environment.collision.displayMode === "wireframe",
        depthWrite: false,
      });
    }

    function applySplatCoordinateFix(splat: THREE.Object3D) {
      if (!usesScanEnvironmentCoordinateFix()) return;

      applyScanEnvironmentCoordinateFix(splat);
    }

    function applyCollisionCoordinateFix(collision: THREE.Object3D) {
      if (!usesScanEnvironmentCoordinateFix()) return;

      applyScanEnvironmentCoordinateFix(collision);
    }

    function usesScanEnvironmentCoordinateFix() {
      return latestRef.current.template.source !== "procedural";
    }

    function applyScanEnvironmentCoordinateFix(object: THREE.Object3D) {
      object.scale.set(
        SCAN_ENVIRONMENT_SCALE,
        -SCAN_ENVIRONMENT_SCALE,
        SCAN_ENVIRONMENT_SCALE,
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

    function createObjectMesh(object: BoardObject) {
      const group = new THREE.Group();
      group.position.set(...object.position);
      group.rotation.y = object.rotationY;
      group.scale.setScalar(object.scale);
      group.name = object.name;

      const selected =
        latestRef.current.selection.type === "object" &&
        latestRef.current.selection.id === object.id;
      if (object.kind === "character") {
        buildCharacter(group, object, selected);
      } else {
        buildProp(group, object, selected);
      }

      if (selected) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.42, 0.015, 8, 36),
          new THREE.MeshBasicMaterial({ color: 0x4a9eff }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.035;
        group.add(ring);
      }

      return group;
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
      const frameAspect = 4 / 3;
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
      if (!root) return;
      clearGroup(root);
      for (const object of latestRef.current.scene.objects) {
        root.add(createLabel(object.name, object.position, 1.62));
      }
      for (const camera of latestRef.current.scene.cameras) {
        root.add(createLabel(camera.name, camera.position, 0.36));
      }
    }

    function createLabel(text: string, position: [number, number, number], yOffset: number) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.font = "600 26px Inter, Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 5;
      context.strokeStyle = "rgba(0,0,0,0.65)";
      context.strokeText(text, 128, 32);
      context.fillStyle = "#dfe8f5";
      context.fillText(text, 128, 32);
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true }),
      );
      sprite.position.set(position[0], position[1] + yOffset, position[2]);
      sprite.scale.set(0.9, 0.225, 1);
      return sprite;
    }

    function updateLabelFacing() {
      const editorCamera = editorCameraRef.current;
      const labelRoot = labelRootRef.current;
      if (!editorCamera || !labelRoot) return;
      for (const child of labelRoot.children) {
        child.quaternion.copy(editorCamera.quaternion);
      }
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

    function intersectDragPlane(plane: THREE.Plane) {
      const editorCamera = editorCameraRef.current;
      if (!editorCamera) return undefined;
      raycasterRef.current.setFromCamera(pointerRef.current, editorCamera);
      const hitPoint = new THREE.Vector3();
      return raycasterRef.current.ray.intersectPlane(plane, hitPoint) ?? undefined;
    }

    function updateHoveredCameraHandle() {
      setHoveredCameraHandle(getCameraHandleHit());
    }

    function setHoveredCameraHandle(handle: CameraHandle | null) {
      hoveredHandleRef.current = handle;
      const renderer = rendererRef.current;
      const cameraRoot = cameraRootRef.current;
      if (renderer && !dragStateRef.current) {
        renderer.domElement.style.cursor =
          handle?.kind === "axisPlane" ? "pointer" : "";
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

    function getCameraHandleHit() {
      const editorCamera = editorCameraRef.current;
      const cameraRoot = cameraRootRef.current;
      if (!editorCamera || !cameraRoot) return null;

      updateCameraHandleFacing();
      raycasterRef.current.setFromCamera(pointerRef.current, editorCamera);
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

    function cameraHandlesMatch(a: CameraHandle, b: CameraHandle) {
      return (
        a.cameraId === b.cameraId &&
        a.kind === b.kind &&
        a.axisPlane === b.axisPlane
      );
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

      raycasterRef.current.setFromCamera(pointerRef.current, editorCamera);
      const objectHits = raycasterRef.current.intersectObjects(
        objectRootRef.current?.children ?? [],
        true,
      );
      const objectHit = objectHits.find((item) => findSelection(item.object));
      const selected =
        objectHit
          ? findSelection(objectHit.object)
          : findFirstCameraSelectionHit();
      if (selected) {
        latestRef.current.onSelect(selected as Selection);
        return true;
      }

      return false;
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

    function captureCamera(
      cameraId: string,
      options: { width?: number; height?: number } = {},
    ) {
      const renderer = rendererRef.current;
      const threeScene = sceneRef.current;
      if (!renderer || !threeScene) return undefined;

      const directorCamera = latestRef.current.scene.cameras.find(
        (camera) => camera.id === cameraId,
      );
      if (!directorCamera) return undefined;

      const oldSize = new THREE.Vector2();
      renderer.getSize(oldSize);
      const width = options.width ?? 480;
      const height = options.height ?? 270;
      const camera = createPerspectiveFromDirectorCamera(directorCamera, width / height);

      const collisionVisible = collisionMeshRef.current?.visible ?? false;
      const cameraRootVisible = cameraRootRef.current?.visible ?? false;
      const labelRootVisible = labelRootRef.current?.visible ?? false;
      const gridVisible = gridRef.current?.visible ?? false;
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
      renderer.setSize(width, height, false);
      renderer.render(threeScene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/png");
      renderer.setSize(oldSize.x, oldSize.y, false);
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
      return dataUrl;
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

    return <div className="three-viewport" ref={hostRef} />;
  },
);

function lensToVerticalFov(lensMm: number) {
  const sensorHeight = 24;
  return THREE.MathUtils.radToDeg(2 * Math.atan(sensorHeight / (2 * lensMm)));
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose?.());
      } else {
        material?.dispose?.();
      }
    });
  }
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [
    Number(vector.x.toFixed(3)),
    Number(vector.y.toFixed(3)),
    Number(vector.z.toFixed(3)),
  ];
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function waitForFrame(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

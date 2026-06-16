# Design Document: Gaussian Splat Scene Environments

## Purpose

This document translates the aligned PRD into an implementation plan for adding Gaussian splat scene environments to DirectorBoard. It focuses on architecture, data ownership, rendering, asset import, collision placement, UI integration, persistence, and test strategy.

## Product Decisions

- DirectorBoard supports one environment template per scene for MVP.
- A project can store multiple environment templates.
- A scene is created from an environment template and cannot change templates afterward.
- Environment templates contain one Gaussian splat file and one collision mesh file.
- Built-in environments are indexed by a manifest file.
- Uploaded environments are selected as folders containing exactly two files: one splat and one collision mesh.
- Uploaded folders are validated before assets are copied into project storage.
- Each uploaded file has a configurable size limit, defaulting to 200 MB.
- Characters, props, cameras, shots, and board data are scene-owned.
- Environment transform and render settings are scene-instance settings copied from template defaults.
- Camera names follow `camera-n`; local storage camera bookmark keys use the camera name.
- Surface placement uses a global configurable slope threshold, defaulting to 35 degrees from horizontal.
- Collision mesh/debug overlays are editor-only and never appear in shot thumbnails or final output.
- MVP targets desktop web.

## Architecture Overview

The feature should be implemented as four coordinated layers:

1. Environment template library
   - Reads built-in manifest entries.
   - Stores uploaded template metadata in project storage.
   - Validates file type, count, and size.

2. Scene environment instance
   - Stores the selected template id on scene creation.
   - Stores scene-specific transform, visibility, opacity, render mode, and collision display mode.
   - Does not mutate the source template.

3. Runtime environment loader
   - Loads the Spark `SplatMesh`.
   - Loads the Three.js collision mesh.
   - Maintains loading, ready, error, and disposal states.

4. Editor integrations
   - Renders splat with existing Three.js content.
   - Uses collision mesh for placement raycasts and look-at picking.
   - Updates left scene hierarchy and right inspector.
   - Excludes collision debug mesh from shot capture and final export.

## Data Model

### Environment Template

```ts
type EnvironmentTemplateSource = "built-in" | "upload";

type EnvironmentTemplate = {
  id: string;
  name: string;
  source: EnvironmentTemplateSource;
  splat: {
    path: string;
    sizeBytes: number;
    fileType: "ply" | "spz" | "splat" | "ksplat" | "sog" | "zip" | "rad";
  };
  collision: {
    path: string;
    sizeBytes: number;
    fileType: "glb" | "gltf" | "obj";
  };
  defaults?: {
    transform?: EnvironmentTransform;
    renderMode?: EnvironmentRenderMode;
  };
};
```

### Built-In Manifest

The built-in manifest is a minimal list of environment templates packaged with the app:

```json
[
  {
    "id": "kitchen",
    "name": "Kitchen",
    "splat": {
      "path": "/assets/environments/kitchen/scene.spz",
      "sizeBytes": 123456789,
      "fileType": "spz"
    },
    "collision": {
      "path": "/assets/environments/kitchen/collision.glb",
      "sizeBytes": 12345678,
      "fileType": "glb"
    }
  }
]
```

The manifest does not need thumbnails for MVP.

### Scene Environment Instance

```ts
type EnvironmentRenderMode = "auto" | "quality" | "balanced" | "fast";
type CollisionDisplayMode = "hidden" | "wireframe" | "transparent" | "walkable";

type EnvironmentTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

type SceneEnvironmentInstance = {
  templateId: string;
  transform: EnvironmentTransform;
  visible: boolean;
  opacity: number;
  renderMode: EnvironmentRenderMode;
  collision: {
    visibleInEditor: boolean;
    displayMode: CollisionDisplayMode;
  };
};
```

### Scene Data Relationship

```ts
type Scene = {
  id: string;
  name: string;
  environment: SceneEnvironmentInstance;
  characters: Character[];
  props: Prop[];
  cameras: DirectorCamera[];
  shots: Shot[];
  board: BoardState;
};
```

The scene stores only the environment template id plus scene-instance settings. Characters, props, cameras, and shots are stored with the scene.

## Asset Storage

### Built-In Assets

Recommended layout:

```text
assets/
  environments/
    manifest.json
    kitchen/
      scene.spz
      collision.glb
    warehouse/
      scene.rad
      collision.glb
```

The manifest is the source of truth for built-in environment names and file paths.

### Uploaded Assets

Uploaded folders must contain exactly:

- One supported splat file.
- One supported collision mesh file.

No extra files are accepted in MVP. Validation happens before copying files into project storage.

Recommended project-storage layout:

```text
project-storage/
  environments/
    env_<id>/
      scene.spz
      collision.glb
      environment.json
```

`environment.json` should store the same metadata shape as `EnvironmentTemplate`, with `source: "upload"`.

### Validation Rules

- Reject folders with fewer or more than two files.
- Reject folders with zero or multiple supported splat files.
- Reject folders with zero or multiple supported mesh files.
- Reject unsupported file extensions.
- Reject any file over the configured size limit. Default: 200 MB per file.
- Validate before copying files into project storage.
- Show a clear, recoverable error message for each failure.

## Scene Creation Flow

1. User opens the environment template picker from:
   - `+ Environment`
   - `Import Environment...`
   - Left scene hierarchy shortcut
2. User chooses a built-in template or imports an uploaded folder.
3. App validates/imports the template if needed.
4. User creates a new scene from the template.
5. Scene stores `environment.templateId` and copied default scene-instance settings.
6. Scene owns all later characters, props, cameras, shots, and board data.

Existing scenes do not offer a template replacement action.

## Rendering Design

### Runtime Objects

At runtime, the environment loader creates:

- Spark `SplatMesh` for the visual environment.
- Three.js mesh for collision and editor debugging.
- Parent `Object3D` for shared scene-instance transform.

Recommended hierarchy:

```text
Scene
  EnvironmentRoot Object3D
    SplatMesh
    CollisionMesh
  Characters
  Props
  Cameras
  Helpers
  Labels
```

The environment root receives the scene-instance transform. The splat and collision mesh remain aligned beneath it.

### Spark Integration

- Initialize one Spark renderer for the existing Three.js renderer.
- Add the Spark renderer to the scene/render pipeline once.
- Add the environment `SplatMesh` under the environment root.
- Map render modes to Spark options:
  - `auto`: choose based on asset type/size/device.
  - `quality`: highest reasonable splat quality.
  - `balanced`: default quality/performance tradeoff.
  - `fast`: lower quality or more aggressive LoD.
- Prefer `.rad` assets with LoD/paging for large built-in environments.
- Dispose Spark resources when a scene closes or an unused template is removed.

### Render Ordering

The splat should render as the world/environment. Existing characters, props, helpers, camera frustums, labels, paths, and overlays must remain visible above it.

Collision mesh render rules:

- Hidden by default.
- Visible only in editor debug modes.
- Excluded from shot thumbnails.
- Excluded from final output.

## Collision And Placement

The collision mesh is the only raycast target for environment placement. Do not raycast against splats during normal placement interactions.

Placement flow:

1. Pointer ray is cast from the active editor camera.
2. Ray intersects the collision mesh.
3. Intersection normal is compared to world up.
4. Surface is accepted if slope is within global threshold.
5. Character/prop/camera target is placed at the intersection point.
6. If no valid hit exists, fall back to grid/plane behavior and show placement feedback.

Slope threshold:

```ts
const DEFAULT_PLACEMENT_MAX_SLOPE_DEGREES = 35;
```

Implementation note:

```ts
function isSurfacePlaceable(normal: THREE.Vector3, maxSlopeDegrees: number) {
  const up = new THREE.Vector3(0, 1, 0);
  const angleRadians = normal.clone().normalize().angleTo(up);
  return THREE.MathUtils.radToDeg(angleRadians) <= maxSlopeDegrees;
}
```

## UI Design

### Left Scene Hierarchy

Add an Environment section showing:

- Environment template name.
- Visual splat load status.
- Collision mesh load status.
- Splat visibility toggle.
- Collision debug visibility toggle.
- Grid visibility toggle.
- Shortcut to create a new scene from an environment template.

The hierarchy should communicate that the current scene uses this template, but cannot switch templates in place.

### Import Dialog

The import dialog supports:

- Built-in environment list from manifest.
- Upload folder picker.
- Validation state.
- Per-file size errors.
- Unsupported/missing/extra file errors.
- Create scene action after a valid template is selected.

### Right Inspector

When the environment is selected, show scene-instance settings:

- Name.
- Splat source.
- Collision source.
- Position.
- Rotation.
- Uniform scale.
- Visual opacity.
- Render mode.
- Collision display mode.
- Reload assets.

Do not show:

- Replace splat.
- Replace collision mesh.
- Switch environment template.
- Remove environment from scene.

Template management belongs to the project environment library/import flow.

## Camera Bookmarks

Camera names use:

```text
camera-n
```

For MVP, local storage keys for camera bookmarks can use the camera name directly.

Known tradeoff: different scenes can reuse names such as `camera-1`, so bookmarks can collide. This is accepted for MVP.

## Shot Capture And Export

Shot capture uses the same scene environment instance as the editor camera preview.

Before thumbnail or final export:

- Ensure splat load state is ready.
- Render the selected camera view.
- Force collision mesh/debug overlay visibility off.
- Preserve existing shot overlays that are already intended for capture.

If splat is not ready, capture should either wait for readiness or show a recoverable message.

## Error Handling

| Case | Behavior |
| --- | --- |
| Missing splat file | Reject folder before copy |
| Missing collision mesh | Reject folder before copy |
| Extra file in upload folder | Reject folder before copy |
| Unsupported splat format | Reject folder before copy |
| Unsupported mesh format | Reject folder before copy |
| File over 200 MB default limit | Reject file with size message |
| Splat runtime load failure | Keep scene data, show reload/relink action |
| Collision runtime load failure | Render splat, disable collision placement, warn user |
| Asset unavailable on reopen | Preserve scene, prompt relink/reload |
| GPU/WebGL failure | Show environment render failure and keep project data intact |

## Implementation Milestones

### Milestone 1: Environment Template Library

- Add manifest reader for built-in environments.
- Define environment template and scene instance types.
- Add upload-folder validation.
- Add project-storage copy-after-validation flow.
- Add configurable per-file size limit.

### Milestone 2: Scene Creation

- Add create-scene-from-template flow.
- Store `environment.templateId` on scene.
- Copy template defaults into scene-instance settings.
- Prevent template replacement on existing scenes.
- Add left hierarchy shortcut.

### Milestone 3: Runtime Loading And Rendering

- Add Spark renderer integration.
- Load `SplatMesh` under environment root.
- Load collision mesh under the same root.
- Add load/progress/error states.
- Add disposal path.
- Verify editor camera and planning cameras render splat correctly.

### Milestone 4: Placement And Debug Display

- Route placement raycasts to collision mesh.
- Add global slope threshold setting.
- Add collision display modes.
- Ensure editor-only collision visibility.
- Validate character, prop, camera, and look-at placement.

### Milestone 5: Shot Capture And Persistence

- Persist scene environment settings.
- Persist uploaded templates in project storage.
- Ensure thumbnails include splat.
- Ensure collision is hidden in thumbnails/final output.
- Add missing asset recovery behavior.

## Test Strategy

### Unit Tests

- Manifest parsing.
- Upload folder validation.
- File size limit validation.
- Scene creation from template.
- Scene immutability for environment template id.
- Slope threshold calculation.

### Integration Tests

- Built-in template appears in environment picker.
- Uploaded folder imports after validation.
- Uploaded folder with extra file fails.
- Scene opens with the correct environment template.
- Character/prop placement uses collision mesh hits.
- Collision mesh failure disables placement fallback cleanly.

### Rendering/Manual QA

- Splat visible in main editor viewport.
- Splat visible in camera preview.
- Splat visible in captured shot thumbnail.
- Collision debug visible in editor when enabled.
- Collision debug hidden in thumbnails and final output.
- Camera frustums, labels, guides, and overlays remain readable.
- Large scan remains interactive in balanced/fast mode.

## Risks And Mitigations

- Large splats may cause slow startup or GPU pressure.
  - Mitigation: enforce size limits, use `.rad`/LoD when possible, expose render modes.
- Splat and collision mesh may not align despite same source export.
  - Mitigation: keep scene-instance transform controls and debug collision display.
- Camera bookmark keys may collide across scenes.
  - Mitigation: accepted MVP tradeoff; future version can prefix by project/scene id.
- Spark integration may affect existing render order or overlays.
  - Mitigation: validate with camera preview, labels, helpers, paths, and shot capture before release.
- Strict two-file upload folders may frustrate users with generated sidecar files.
  - Mitigation: clear validation message explaining the required folder shape.

## References

- PRD: `docs/gaussian-splat-environment-prd.md`
- DirectorBoard reference app: https://shotblock.vercel.app/
- Spark GitHub: https://github.com/sparkjsdev/spark
- Spark docs: https://sparkjs.dev/docs/

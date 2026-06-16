# Product Requirements Document: Gaussian Splat Scene Environments

## Summary

DirectorBoard is a Three.js-based 3D storyboard and shot-planning application for filmmakers. Today, users block scenes by adding characters, props, set pieces, and multiple cameras into a stylized 3D environment. They can position cameras, adjust lens/focal length, set look-at targets, preview framing, and capture shots into a board.

This feature adds support for photorealistic scene environments loaded from Gaussian splat files, paired with a collision mesh used for placement, navigation, and spatial reasoning. The environment should render through `@sparkjsdev/spark` inside the existing Three.js scene while preserving the current blocking, camera, lens, and shot capture workflows.

## Problem

The current blockout environment is useful for spatial planning, but it does not capture the real texture, lighting, scale cues, and production design details of an actual location. Filmmakers who have scanned a location as a Gaussian splat need to plan shots directly inside that real environment while still using DirectorBoard's character, prop, and camera tools.

Gaussian splats are not traditional triangle meshes, so they are excellent for visual realism but insufficient on their own for reliable collision, snapping, floor detection, object placement, or camera movement constraints. The product therefore needs to load two linked assets:

- A Gaussian splat file for visual rendering.
- A mesh file for collision and interaction.

## Goals

- Allow users to import or select a Gaussian splat environment and see it rendered in the main 3D viewport.
- Use Spark to render splats alongside existing Three.js characters, props, cameras, labels, paths, and overlays.
- Allow users to pair the visual splat with a collision mesh that defines walkable floors, walls, surfaces, and blocked areas.
- Preserve existing shot-planning tools: camera creation, lens changes, look-at controls, camera preview, thumbnails, shot capture, and board timeline.
- Provide clear UI feedback for loading progress, missing assets, alignment issues, performance mode, and collision visibility.
- Persist environment asset references and transforms with the DirectorBoard scene/project.
- Support exactly one environment template per scene for MVP.

## Non-Goals

- Creating or training Gaussian splat files inside DirectorBoard.
- Editing individual splats, recoloring scans, deleting scan regions, or cleaning scans.
- Full physics simulation for props or characters.
- Replacing the existing blockout object library.
- Multiplayer review or cloud asset management, unless already supported elsewhere in the product.
- Mobile and tablet support for the MVP.

## MVP Decisions

- Environment assets can come from built-in local folders or from user upload.
- Each environment asset consists of one splat file and one collision mesh file.
- MVP supports exactly one environment template per scene, while the project may store multiple imported or built-in environments.
- The default maximum file size is 200 MB per individual file and must be configurable.
- The collision mesh and splat are exported from the same source asset, so they are expected to share origin, scale, and orientation.
- Characters and props are static for MVP; simple surface placement is sufficient.
- Final shot output always hides collision mesh/debug overlays, even if collision is visible in the editor.
- MVP targets desktop web only.
- Uploaded environment asset folders are persisted in project storage for MVP.
- Built-in local environments are indexed by a manifest file.
- Users can add/import new environment templates without changing existing scenes.
- Static placement uses a configurable slope threshold; recommended default is 35 degrees from horizontal.
- Environments act as scene templates. Characters, props, cameras, and shot data are stored with each scene created from an environment.
- Users create a scene from an environment template. After scene creation, the scene's environment template cannot be changed.
- Uploaded folders are validated before their assets are copied into project storage.
- The slope threshold is a global project/application setting.
- Camera names use the format `camera-n`. Local storage keys for camera bookmarks can use the camera name.
- Uploaded environment folders must contain only one splat file and one collision mesh file.
- MVP accepts the risk that camera bookmark local storage keys can collide if different scenes reuse names such as `camera-1`.

## Target Users

- Directors and cinematographers planning coverage in a real scanned location.
- Previsualization artists combining scanned environments with simple blocking characters and props.
- Production designers reviewing spatial fit of action, furniture, and camera positions.
- Location scouts preparing reference boards from scanned interiors or exteriors.

## Current UI Observations

The existing UI is organized around a professional planning workspace:

- Top bar: project/file actions, scene name, view modes, aspect ratio, overlays, and feedback.
- Left sidebar: add buttons, object library, scene object list, cameras list, and axis-of-action tools.
- Center: large 3D viewport with grid, set, props, character labels, camera frustums, move/rotate controls, paths, and guides.
- Right inspector: object/camera/shot properties, including camera name, lens presets, position, look-at, roll, framing tags, motion controls, duplicate, and delete.
- Bottom strip: shots, board, animatic, scene chat, and captured shot thumbnails.

The new feature should fit into this workspace rather than introduce a separate import experience that takes users away from shot planning.

## User Stories

- As a filmmaker, I want to load a scanned location so I can block action inside the real production space.
- As a cinematographer, I want cameras to see the Gaussian splat environment in the camera preview and captured shot thumbnails.
- As a previs artist, I want characters and props to sit on the collision mesh floor instead of floating inside the splat.
- As a director, I want to toggle between the photoreal splat, collision mesh, and simple blockout guides so I can understand both realism and geometry.
- As a user with a large scan, I want the app to show loading progress and use an optimized mode so the workspace remains responsive.
- As a project owner, I want imported environment settings saved with the scene so collaborators reopen the same scan alignment, visibility, and performance settings.

## Proposed UX

### Entry Points

1. Add a `+ Environment` action near the existing `+ Character` and `+ Camera` buttons in the left sidebar.
2. Add `Import Environment...` under the `File` menu for users who start from project setup rather than the object library.
3. Add an `Environment` section to the scene list, above characters and props, once a scene has been created from an environment.

### Import Dialog

The import flow should collect:

- Source: built-in environment folder or user upload.
- Built-in environment: selected from a manifest-backed environment list.
- Uploaded environment: selected as a folder containing one Gaussian splat file and one collision mesh file.
- Display name: defaulted from the splat filename.
- Unit scale: default `1 unit = 1 meter`, editable.
- Up axis/orientation preset: default auto-detect, with manual choices if needed.
- Initial placement: origin at world zero by default.
- Performance mode: Auto, Quality, Balanced, Fast.

Supported visual formats should follow Spark support where practical: `.ply`, `.spz`, `.splat`, `.ksplat`, `.sog`, `.zip`, and `.rad`. For collision mesh, MVP should support `.glb` or `.gltf`; `.obj` can be a follow-up if the app already has an OBJ loading path. The importer must enforce a configurable per-file size limit, defaulting to 200 MB for MVP.

Adding or importing a new environment stores the asset as a project environment template. Existing scenes are not affected because each scene keeps the environment template it was created from.

### Viewport Behavior

- The splat appears as the visual world in the central viewport.
- Existing characters, props, labels, camera rigs, frustums, paths, and shot overlays remain visible above the environment.
- Collision mesh is hidden by default but can be shown as:
  - Wireframe
  - Transparent surface
  - Walkable floor highlight
- Grid remains available but should be toggleable because it may visually compete with photoreal scans.
- Selecting the environment should show transform handles for moving, rotating, and scaling the environment as a single object.

### Left Sidebar

Add an `Environment` section to the scene hierarchy:

- Scene environment template name
- Visual splat status: loading, ready, failed
- Collision mesh status: loading, ready, missing, failed
- Visibility toggles:
  - Splat
  - Collision
  - Grid
- Create new scene from environment template shortcut

The left scene hierarchy shows the environment template used by the current scene. Users cannot change the environment template for an existing scene; they create a new scene from another environment instead. Characters, props, cameras, and shot data remain scene-owned.

The existing character, prop, and camera lists should continue to work unchanged.

### Right Inspector

When the environment is selected, the right inspector should show an `Environment` detail panel:

- Name
- Splat source
- Collision source
- Transform: position, rotation, uniform scale
- Visual opacity
- Render quality: Auto, Quality, Balanced, Fast
- Collision display: Hidden, Wireframe, Transparent, Walkable
- Reload assets

The scene inspector should not offer actions that change the underlying environment template, such as replacing the splat, replacing the collision mesh, or switching to a different environment. Template management belongs to the project environment library/import flow.

The current `Object`, `Camera`, and `Shot` inspector tabs should remain unchanged for their existing selections.

### Camera and Shot Workflow

- Camera previews must render the splat environment.
- Captured shot thumbnails must include the splat environment.
- Lens changes, camera roll, look-at target, and frame-size labels should behave as they do today.
- Existing overlays such as thirds, safe area, 180-degree line, paths, labels, and camera names should remain usable over the splat.
- The environment should not be accidentally selected while users are moving cameras, characters, or props unless the environment layer is explicitly selected.

## Functional Requirements

### Environment Import

- FR-1: Users can create a scene from one Gaussian splat environment template in MVP.
- FR-2: Users can choose an environment from built-in local assets.
- FR-3: Users can upload an environment folder consisting of one splat file and one collision mesh file.
- FR-4: The app validates visual and collision sources before final import.
- FR-5: The app shows progress while downloading, decoding, and initializing the splat.
- FR-6: Failed loads show a recoverable error with retry and replace actions.
- FR-7: Environment metadata is saved with the project/scene.
- FR-7a: The importer enforces a configurable maximum file size, defaulting to 200 MB per file for MVP.
- FR-7b: Uploaded environment folders are persisted in project storage.
- FR-7c: Built-in local environments are discovered from a manifest file containing at least id, name, splat path, collision mesh path, and file sizes.
- FR-7d: Adding/importing a new environment stores it in the project environment library without changing existing scenes.
- FR-7e: Uploaded folders are fully validated before files are copied into project storage.
- FR-7f: Optional camera bookmarks and other user-specific environment settings are stored in local storage rather than the built-in manifest.
- FR-7g: Uploaded folders must contain exactly one splat file and exactly one collision mesh file, with no additional files.
- FR-7h: Users create a scene based on an environment template. The scene's environment template is immutable after creation.
- FR-7i: The left scene hierarchy includes a shortcut to create a new scene from an environment template.

### Rendering

- FR-8: The app initializes a Spark renderer within the existing Three.js render pipeline.
- FR-9: The splat is represented as a Spark `SplatMesh` and added to the Three.js scene graph.
- FR-10: The splat renders correctly from all active planning cameras and the main editor camera.
- FR-11: Existing Three.js meshes, lights, helpers, labels, and camera frustums render together with the splat.
- FR-12: The environment supports visibility toggles without unloading asset data.
- FR-13: The app disposes Spark and splat resources when the scene is closed or when an unused environment template is removed from the project library.

### Collision and Placement

- FR-14: The collision mesh is loaded as a Three.js mesh separate from the splat.
- FR-15: The collision mesh uses the same transform as the splat by default.
- FR-16: Character and prop placement raycasts against the collision mesh, not against the splat.
- FR-17: Dragging characters and props across the environment should snap to the collision surface when surface snapping is enabled.
- FR-18: Camera placement and target placement can raycast against the collision mesh for accurate look-at picking.
- FR-19: The collision mesh can be shown for editor debugging without affecting shot thumbnails or final exports.
- FR-20: If collision mesh is missing, the environment can still render, but placement tools fall back to grid/plane behavior and show a warning.
- FR-20a: Because characters and props are static in MVP, placement only needs simple surface snapping and does not need dynamic physics.
- FR-20b: Static placement treats surfaces as valid when they are within the configured global slope threshold. Recommended default: 35 degrees from horizontal.

### Transform and Alignment

- FR-21: Users can move, rotate, and uniformly scale the environment.
- FR-22: Splat and collision mesh transforms remain linked unless an advanced alignment mode is added later.
- FR-23: Users can reset environment transform to import defaults.
- FR-24: The app stores transform values in project state.
- FR-25: Environment transform values are scene-instance settings created from the template defaults; changing them does not mutate the source environment template.
- FR-25a: Since the splat and collision mesh are exported from the same source asset, MVP assumes matching origin, scale, and orientation. Manual alignment controls remain useful as a recovery tool, not as the default workflow.

### Performance

- FR-26: The app offers Auto, Quality, Balanced, and Fast modes that map to Spark quality/LoD settings.
- FR-27: The app should prefer pre-built `.rad` LoD assets for large environments when available.
- FR-28: The app should support paged streaming for `.rad` environments when appropriate.
- FR-29: The app should avoid per-frame raycasting against the splat itself for placement.
- FR-30: The editor remains responsive while splat loading and LoD generation are in progress.

### Persistence and Export

- FR-31: Project save data includes environment asset references, transform, visibility, render mode, and collision settings.
- FR-32: Shot thumbnails and exports render the environment exactly as seen through the selected camera.
- FR-33: If an environment asset is unavailable on project load, the app preserves scene data and prompts the user to relink the missing asset.
- FR-34: Shot thumbnails and final exports always hide collision mesh/debug overlays.
- FR-35: Scene save data owns characters, props, cameras, camera bookmarks used by that scene, shots, and board data created from the environment template.
- FR-36: The environment manifest stores only built-in environment metadata and required asset references. User-specific camera bookmarks and other mutable settings are stored outside the manifest.
- FR-37: Camera bookmark local storage keys use the camera name. Camera names follow the format `camera-n`.

## Technical Requirements

### Spark Integration

Use `@sparkjsdev/spark` as the Gaussian splat rendering layer:

- Create one `SparkRenderer` for the main Three.js renderer and add it to the scene root.
- Load the environment visual as a `SplatMesh`.
- Use `SplatMesh` loading callbacks to drive progress and ready states.
- Use Spark LoD options for large scans.
- Avoid expensive splat raycasts in continuous interactions; rely on the collision mesh for frequent placement and picking.

Spark documentation notes that `SplatMesh` behaves as a Three.js `Object3D`, can be added to the scene hierarchy, supports common splat formats, and exposes loading/progress hooks. Spark also documents LoD and paged `.rad` loading for large splat assets.

### Collision Mesh

The collision mesh should be a regular Three.js mesh loaded from a geometry file:

- MVP format: `.glb` or `.gltf`.
- Material: invisible by default.
- Debug material: wireframe or transparent surface.
- Raycast target: enabled for placement, look-at target picking, and surface snapping.
- Render target: available in the editor only; always excluded from shot thumbnails and final output.

### Coordinate Alignment

Import should account for:

- Up axis differences between scan tools and Three.js.
- Unit scale differences.
- Large coordinate values that may cause precision issues.
- Splat orientation conventions, especially OpenCV/OpenGL differences.
- Collision mesh and splat authored from the same reconstruction pipeline but still requiring manual alignment fallback.

### Data Model Draft

```ts
type SceneEnvironment = {
  id: string;
  name: string;
  sourceKind: "built-in" | "upload";
  templateId: string;
  visual: {
    type: "gaussian-splat";
    source: string;
    sizeBytes?: number;
    fileType?: "ply" | "spz" | "splat" | "ksplat" | "sog" | "zip" | "rad";
    lod?: boolean;
    paged?: boolean;
  };
  collision: {
    type: "mesh";
    source: string;
    sizeBytes?: number;
    fileType?: "glb" | "gltf" | "obj";
    visible: boolean;
    displayMode: "hidden" | "wireframe" | "transparent" | "walkable";
  };
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
  };
  renderMode: "auto" | "quality" | "balanced" | "fast";
  visible: boolean;
  opacity: number;
};

type BuiltInEnvironmentManifestItem = {
  id: string;
  name: string;
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
};
```

## Acceptance Criteria

- AC-1: A user can import a splat and collision mesh, then see the splat in the main viewport.
- AC-2: The imported environment appears in the left scene hierarchy and can be selected.
- AC-3: Environment properties appear in the right inspector when selected.
- AC-4: The user can toggle splat visibility and collision mesh visibility independently.
- AC-5: Characters and props can be placed onto the collision mesh surface.
- AC-6: A camera preview includes the splat environment.
- AC-7: Capturing a shot creates a thumbnail that includes the splat environment.
- AC-8: Lens, look-at, roll, and camera motion controls continue to behave correctly.
- AC-9: Saving and reopening a project restores the environment settings.
- AC-10: Missing or failed assets show clear recovery actions.
- AC-11: Closing a scene or removing an unused environment template releases related GPU resources.
- AC-12: A large environment can be loaded in a performance mode without blocking the UI thread for the full load.
- AC-13: Attempting to import any file above the configured per-file size limit is blocked with a clear message.
- AC-14: Importing a new environment does not change any existing scene's environment.
- AC-15: Collision mesh/debug overlays never appear in shot thumbnails or final exports.
- AC-16: Users can create a new scene from a selected environment template.
- AC-17: Built-in environments appear from a manifest-backed list.
- AC-18: Uploaded folders are validated before assets are committed to project storage.
- AC-19: Creating a scene from an environment stores characters, props, cameras, and shots with the scene, not with the environment template.
- AC-20: Existing scenes do not offer an action to change their environment template.
- AC-21: Uploaded folders with extra files fail validation with a clear message.
- AC-22: Users can start creating a new scene from an environment template via the left scene hierarchy shortcut.

## Success Metrics

- At least 90% of test users can import a provided splat + collision mesh pair without support.
- Users can place a character on the scanned floor within 10 seconds after import completes.
- Camera preview and captured thumbnail match the editor view in visual environment placement.
- Editor interaction remains smooth enough for blocking work on target devices:
  - Desktop: target 30 fps or higher for common 1-5 million splat environments.
- Environment load failures provide actionable error messages in 100% of tested invalid-file cases.

## Edge Cases

- Splat loads but collision mesh fails.
- Collision mesh loads but splat fails.
- Splat and collision mesh have different origins or scales.
- Environment is very large or far from origin.
- User imports multiple files with ambiguous format extensions.
- User tries to place a prop on a vertical wall or non-walkable surface.
- Camera begins inside splat geometry or behind collision walls.
- Shot thumbnail render starts before splat initialization completes.
- Browser lacks required WebGL2 support or has insufficient GPU memory.
- User uploads files larger than the configured MVP asset-size limit.
- User imports a new environment while scenes already exist.
- Uploaded folder contains zero or multiple splat files, zero or multiple mesh files, multiple supported candidates, or any extra files.
- Local storage contains stale camera bookmarks or settings for an environment that has been removed or replaced.

## Milestones

### Milestone 1: Technical Spike

- Add Spark to a minimal Three.js scene.
- Load a representative splat file.
- Load a matching GLB collision mesh.
- Validate render order with existing meshes, labels, and cameras.
- Measure performance with small, medium, and large scans.

### Milestone 2: MVP Import and Render

- Add environment import dialog.
- Load one splat and one collision mesh.
- Show loading, ready, and error states.
- Persist environment metadata.
- Render splat in main viewport and camera preview.

### Milestone 3: Collision-Based Blocking

- Route object placement and surface snapping to the collision mesh.
- Add collision debug display modes.
- Add environment transform and reset controls.
- Validate camera look-at picking against collision mesh.

### Milestone 4: Shot Capture and Polish

- Ensure captured thumbnails and exports include splats.
- Add missing asset relink flow.
- Add performance modes.
- Add QA scenes and manual verification checklist.

## Open Questions

- None for MVP.

## Source Notes

- DirectorBoard app reference: https://shotblock.vercel.app/
- Spark GitHub: https://github.com/sparkjsdev/spark
- Spark docs: https://sparkjs.dev/docs/
- Spark `SplatMesh` docs: https://sparkjs.dev/docs/splat-mesh/
- Spark loading docs: https://sparkjs.dev/docs/loading-splats/
- Spark LoD docs: https://sparkjs.dev/docs/lod-getting-started/
- Spark performance docs: https://sparkjs.dev/docs/performance/

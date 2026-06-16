# Camera Axis Panel Reference

This document describes the currently working camera axis panel implementation in
`src/app/ThreeViewport.tsx`. It is intended as a reference when changing camera
selection, camera gizmos, splat-scene interaction, or overlay behavior.

## User Behavior

When a camera is selected, the viewport shows:

- A camera body at `camera.position`.
- A line from `camera.position` to `camera.lookAt`.
- A view-frame preview at the look target.
- A camera-facing axis gizmo on the camera body.
- Three colored square plane handles:
  - `xy`: yellow, moves the camera in the local X/Y plane.
  - `xz`: magenta, moves the camera in the local X/Z plane.
  - `yz`: cyan, moves the camera in the local Y/Z plane.

Hovering a square brightens that plane, shows its guide lines, and changes the
cursor to `pointer`. Dragging the square moves the selected camera position.

## Core Types

The camera drag model is represented by three small types:

```ts
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
```

The important distinction is that `axisPlane` handles always update camera
`position`, while the look-target handle updates `lookAt`.

## Camera Rig Construction

`rebuildCameras()` clears the camera root and rebuilds every camera through
`createCameraRig(camera)`.

`createCameraRig()` builds a nested structure:

```text
wrapper
  group at camera.position, oriented with group.lookAt(camera.lookAt)
    camera body mesh
    lens mesh
    selected-only camera-facing gizmo
    selected-only position handle
  line from position to lookAt
  selected-only look target
  selected-only camera view frame
```

Only the selected camera receives the axis gizmo. This keeps hit testing small
and avoids accidental movement of unselected cameras.

## Axis Gizmo Construction

`createCameraFacingGizmo(cameraId)` creates a group marked with:

```ts
gizmo.userData.cameraFacingGizmo = true;
```

It contains:

- `createCameraAxes()`: red X, green Y, blue Z arrows.
- `createCameraAxisPlaneHandles(cameraId)`: the three draggable square panels.
- `createCameraAxisPlaneGuides(cameraId)`: longer guide lines shown only on hover.

Each axis panel is created by `createCameraAxisPlaneHandle()`:

```text
CameraAxisPlaneHandle
  invisible CameraAxisPlaneHitArea
  visible CameraAxisPlaneFill
  visible CameraAxisPlaneOutline
```

The invisible hit area is the only object used for axis-panel raycast selection.
It is slightly larger than the visible fill:

```ts
const planeSize = 0.2;
new THREE.PlaneGeometry(planeSize * 1.08, planeSize * 1.08);
```

Each plane handle stores its semantic identity in `userData`:

```ts
handle.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };
hitArea.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };
fill.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };
outline.userData.cameraHandle = { cameraId, kind: "axisPlane", axisPlane };
```

The plane placement determines the local movement plane:

```ts
xy: position (offset, offset, 0)
xz: position (offset, 0, offset), rotation.x = PI / 2
yz: position (0, offset, offset), rotation.y = -PI / 2
```

## Facing The Editor Camera

The camera gizmo is not fixed in world space. Each frame,
`updateCameraHandleFacing()` rotates camera handles so they remain readable and
selectable from the editor camera.

Two categories are handled:

- `billboardHandle`: simple square handles that face the editor camera directly.
- `cameraFacingGizmo`: the axis gizmo, which uses a custom diagonal-facing
  quaternion.

The axis gizmo orientation comes from `getCameraFacingGizmoQuaternion()`:

```ts
const baseQuaternion = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(1, 1, 1).normalize(),
  new THREE.Vector3(0, 0, 1),
);
return editorCamera
  ? editorCamera.quaternion.clone().multiply(baseQuaternion)
  : baseQuaternion;
```

This makes the three plane panels visible together instead of having one plane
edge-on to the viewer.

Because handles are children of camera groups, the code converts the desired
world-facing quaternion into the child's local space:

```ts
child.parent.getWorldQuaternion(parentQuaternion);
child.quaternion.copy(parentQuaternion.invert().multiply(facingQuaternion));
```

## Pointer Events

The canvas listens for pointer events directly:

- `pointerdown`: update pointer, try `startCameraHandleDrag()`, otherwise pick.
- `pointermove`: update pointer, drag if active, otherwise update hover.
- `pointerup` / `pointercancel`: stop camera drag.
- `pointerleave`: clear hover when not dragging.

The pointer position is converted into normalized device coordinates:

```ts
pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
```

This is the coordinate space required by `THREE.Raycaster.setFromCamera()`.

## Hit Testing

`getCameraHandleHit()` gives axis panels first priority:

1. Update handle facing.
2. Raycast only `CameraAxisPlaneHitArea` objects.
3. If an axis-panel hit exists, return its `CameraHandle`.
4. Otherwise raycast all camera children.
5. Return non-axis camera handles such as position or lookAt handles.

This priority matters. It prevents the camera body, line, or other nearby camera
objects from stealing pointer input from the plane panels.

`findCameraHandle(object)` walks up the parent chain until it finds
`userData.cameraHandle`. This allows hits on nested meshes to resolve back to the
same logical camera handle.

## Hover State

`updateHoveredCameraHandle()` calls `getCameraHandleHit()` and passes the result
to `setHoveredCameraHandle()`.

For axis panels, hover state:

- Sets the canvas cursor to `pointer`.
- Shows matching `CameraAxisPlaneGuide` lines.
- Brightens the matching `CameraAxisPlaneFill`.
- Brightens the matching `CameraAxisPlaneOutline`.

Matching uses:

```ts
a.cameraId === b.cameraId &&
a.kind === b.kind &&
a.axisPlane === b.axisPlane
```

This prevents the `xy`, `xz`, and `yz` panels from highlighting together.

## Drag Start

`startCameraHandleDrag(event)` first resolves the hit handle. If there is no hit,
normal selection continues.

For axis panels:

```ts
const updateKey = "position";
const startPoint = new THREE.Vector3(...camera.position);
const normal = getCameraAxisPlaneNormal(handle.axisPlane);
const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, startPoint);
```

For non-axis handles, the drag plane faces the editor camera:

```ts
editorCamera.getWorldDirection(normal);
```

The initial ray-plane intersection is stored with an offset:

```ts
offset: startPoint.clone().sub(hitPoint)
```

That offset keeps the camera from snapping to the exact pointer intersection
when the user starts dragging.

While dragging, orbit controls are disabled and pointer capture is enabled:

```ts
renderer.domElement.setPointerCapture(event.pointerId);
controls.enabled = false;
```

## Drag Movement

`dragCameraHandle()` repeats the same ray-plane intersection against the stored
drag plane:

```ts
const hitPoint = intersectDragPlane(dragState.plane);
const nextPoint = hitPoint.add(dragState.offset);
onUpdateCamera(dragState.cameraId, {
  [dragState.updateKey]: vectorToTuple(nextPoint),
});
```

For axis panels, `updateKey` is `position`, so the camera body moves while the
`lookAt` target remains fixed.

The React scene state update triggers camera rebuilds, so the rendered rig,
label, preview line, axis gizmo, and inspector values stay in sync.

## Drag End

`stopCameraHandleDrag(pointerId)` only completes the drag for the active pointer.
It releases pointer capture, clears `dragStateRef`, re-enables orbit controls,
and recalculates hover.

This avoids leaving the viewport in a stuck dragging state after pointer cancel
or pointer up.

## Movement Plane Math

`getCameraAxisPlaneNormal(axisPlane)` maps each logical plane to a local normal:

```ts
xy -> (0, 0, 1)
xz -> (0, 1, 0)
yz -> (1, 0, 0)
```

Then it applies the current camera-facing gizmo quaternion:

```ts
return localNormal.applyQuaternion(getCameraFacingGizmoQuaternion()).normalize();
```

This is why the movement plane matches the currently displayed panel rather than
the unrotated world axes.

## Important Invariants

- Axis panels are selected through `CameraAxisPlaneHitArea`, not through the fill
  or outline.
- Axis-panel hit testing runs before general camera hit testing.
- Axis panels move `camera.position`, not `camera.lookAt`.
- The drag plane is created once on pointer down and reused for the whole drag.
- The pointer offset is preserved to avoid snapping.
- Orbit controls are disabled during camera-handle dragging.
- The selected camera is the only camera with active gizmo panels.
- Any HTML overlay above the canvas must not intercept pointer events unless it
  is intentionally interactive.

## Common Regression Points

- Adding a large invisible camera/body hit target can steal raycast priority from
  the axis panels if `getCameraHandleHit()` is changed.
- Changing axis fill or outline names does not affect selection, but changing
  `CameraAxisPlaneHitArea` does.
- Changing `cameraFacingGizmo` orientation must also keep
  `getCameraAxisPlaneNormal()` aligned with the displayed panel.
- Adding UI panels over the viewport can make a working 3D hit area feel broken
  because the canvas never receives pointer events.
- Rebuilding camera groups without preserving `userData.cameraHandle` breaks
  handle resolution.

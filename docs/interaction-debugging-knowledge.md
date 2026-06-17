# Interaction Debugging Knowledge

This file collects practical debugging notes from real issues in DirectorBoard.
Add new entries when a bug teaches us something reusable about scene interaction,
Gaussian splat environments, collision meshes, or editor controls.

## 2026-06-17: Character cannot be selected after walking

### Symptom

In the Kitchen splat scene, a newly added character could be selected and dragged
normally. After using WASD walking/navigation, the same character could no longer
be selected or moved from the 3D viewport. Adding another character made selection
appear to work again.

### Root Cause

The viewport reused one shared `THREE.Raycaster` for multiple jobs:

- keyboard walking collision checks
- ground collision checks
- object selection
- object handle picking
- drag-plane intersection

The walking collision code set `raycaster.far` to a short distance. Later,
selection code called `raycaster.setFromCamera(...)`, but `setFromCamera` does
not reset `near` or `far`. As a result, after walking, object selection rays
remained too short to hit the character.

Adding another character felt like it fixed the issue because selection was
coming from the UI action, not from a successful 3D viewport pick.

### Fix Pattern

Any raycaster shared between collision and pointer picking must reset its range
before screen-space picking:

```ts
function setPointerRaycasterFromCamera(editorCamera: THREE.Camera) {
  raycasterRef.current.near = 0;
  raycasterRef.current.far = Infinity;
  raycasterRef.current.setFromCamera(pointerRef.current, editorCamera);
}
```

Use that helper for:

- object selection
- camera selection
- object handle hit tests
- camera handle hit tests
- drag-plane intersection

Keep short `far` values local to collision/navigation raycasts, or restore the
pointer defaults before returning to editor interaction.

### Related Interaction Guards

Keyboard navigation state should not leak into pointer interaction:

- Clear WASD state when a pointer interaction starts.
- Clear WASD state on window blur or tab visibility loss.
- Pause keyboard navigation while object or camera handle drags are active.

Viewport overlays can also mask canvas clicks. If an overlay is informational
and not intended to receive interaction, use `pointer-events: none`; enable
`pointer-events: auto` only for controls that should remain clickable.

### Debug Checklist

When a 3D object is visible but cannot be selected after another tool or mode was
used, check:

- Did a shared raycaster keep a stale `near`, `far`, layer mask, or params value?
- Did a previous mode leave pointer capture, drag state, or keyboard state active?
- Is a DOM overlay covering the canvas and intercepting clicks?
- Is the object still in the expected Three.js root for picking?
- Does selection work from the side panel but not from the viewport? If yes,
  suspect viewport picking rather than scene data.

### Rule of Thumb

Treat raycasters as stateful objects. Either keep separate raycasters for
separate jobs, or reset every mutable field before each job.

## 2026-06-17: Character label appears flipped in Kitchen

### Symptom

In the Kitchen splat scene, a newly added character label appeared flipped or
visually wrong even though the Kitchen room itself was oriented correctly.

### Root Cause

Kitchen needs a mirrored splat transform to render the room correctly. The live
scale readout showed the splat using `[3.000, -3.000, 3.000]`, while the
collision mesh and editor objects remained in normal editor coordinates.

The initial suspicion was that adding `defaults.splatTransform.axes: [1, 1, 1]`
would fix the label, but that would flip the whole Kitchen room. The scene
transform was not the bug; the label rendering layer was.

The old labels were `THREE.Sprite` objects with canvas textures. Sprites are
part of the WebGL scene and can be affected by the scene/camera coordinate
quirks around mirrored scan assets. That made text readability depend on scan
alignment details, which is fragile for editor annotations.

### Fix Pattern

Keep the scan asset transform that makes the room correct. Move editor labels
out of the 3D render path:

- Project object and camera anchor positions through the editor camera each
  frame.
- Render the label text in a non-interactive DOM overlay above the canvas.
- Hide projected labels when they are outside the camera clip range.
- Scale character label height with the character scale instead of using one
  fixed world offset.

This keeps labels readable while preserving the Kitchen splat orientation.
Camera shot capture also stays clean because DOM labels are not part of the
WebGL render.

### Debug Checklist

When labels or annotations look flipped in scan scenes, check:

- Does the room itself require a negative-axis splat transform to look correct?
- Are labels rendered inside the WebGL scene, or as screen-space UI?
- Are object/collision/splat coordinate spaces intentionally different?
- Would changing `splatTransform` fix the label but break the room? If yes,
  fix the annotation layer instead.

### Rule of Thumb

Scene transforms belong to assets; readable editor annotations belong to the
screen. Do not make asset alignment worse to fix label readability.

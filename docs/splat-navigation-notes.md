# Splat Viewport Navigation Notes

This note explains how the current splat viewport is initialized, why walking can feel too tall or too easy to block, and what should change to make navigation feel like a human walking through the scanned kitchen.

## Current Viewport Startup

The main viewport is created in `src/app/ThreeViewport.tsx`.

At first mount, the editor camera starts as a normal Three.js perspective camera:

```ts
const editorCamera = new THREE.PerspectiveCamera(45, aspect, 0.05, 100);
editorCamera.position.set(5, 3.2, 5);
```

OrbitControls are attached to that camera, with a target around chest/head height:

```ts
controls.target.set(0, 0.85, 0);
```

When an environment is rebuilt, the code clears the old splat and collision mesh, applies the scene-level environment transform, then loads:

1. the visual splat through Spark `SplatMesh`
2. the collision mesh through `GLTFLoader`

For built-in and uploaded scan environments, both the splat and collision mesh currently receive the same coordinate fix:

```ts
scale: (3, -3, 3)
```

That keeps the splat and collision mesh aligned with each other, but it also means the authored scan is displayed at 3x the original asset coordinate scale.

## Initial Eye Position

For splat environments, the editor camera is moved to a hard-coded Spark spawn viewpoint:

```ts
eye:    (0, 1.48, 0)
target: (0, 1.48, 1)
```

This viewpoint is applied in environment-root space. It is not computed from the detected floor height. So if the scan floor is below or above world `y = 0`, the camera may not actually be `1.48m` above the floor.

There is a separate collision-based viewpoint finder that samples the collision mesh, finds low horizontal floor candidates, and creates an eye-level view:

```ts
eyeHeight = clamp(boundsHeight * 0.22, 1.35, 1.65)
eye.y = floorPoint.y + eyeHeight
```

However, scan scenes currently give the hard-coded spawn viewpoint higher priority than the collision-derived viewpoint. That is why the camera can start in a visually useful place but still feel physically wrong for walking.

## How W/A/S/D Works

Keyboard navigation runs every render frame when one of these keys is held:

- `W`: move forward
- `S`: move backward
- `A`: strafe left
- `D`: strafe right

The movement direction is based on the current camera view direction, flattened onto the horizontal plane:

```ts
camera.getWorldDirection(forward);
forward.y = 0;
```

Movement speed is currently:

```ts
KEYBOARD_NAV_SPEED = 2.4
```

That is roughly a walking speed in meters per second if one world unit is one meter. But because scan assets are currently scaled by `3`, the subjective speed and body size can feel off unless all other navigation constants are interpreted in the same scale.

## Current Collision Behavior

For splat scenes, movement is blocked by collision checks against the collision mesh.

The wall check casts three horizontal rays from the current camera position:

```ts
currentPosition
currentPosition + (0, -0.45, 0)
currentPosition + (0, -0.9, 0)
```

Any hit whose surface normal is not mostly vertical/horizontal floor-like can block movement:

```ts
Math.abs(normal.y) < 0.55
```

This approximates a person with rays at eye, chest, and lower body heights. It is not a true capsule collider.

The ground check casts downward from one unit above the camera:

```ts
origin = (camera.x, camera.y + 1, camera.z)
direction = down
far = 4
```

It accepts ground when the hit is not too far above the camera and the surface normal is floor-like:

```ts
hit.point.y <= camera.y + 0.25
Math.abs(normal.y) >= 0.55
```

## Why It Feels Too Tall Or Too Big

There are three main reasons.

First, the camera eye is not always tied to the actual floor. The hard-coded spawn is `y = 1.48`, but the real floor comes from the collision mesh. If the floor is not exactly at `y = 0`, the eye level can become too high or too low.

Second, the collision body is ray-based, not capsule-based. Three rays at fixed offsets can hit counters, desks, railings, or nearby wall detail very easily. That can feel like the viewer is wide or bulky even though there is no explicit body mesh.

Third, scan assets are currently scaled by `3`, while some navigation values are still human-sized constants:

```ts
collision radius: 0.22
ray offsets: 0.45 and 0.9
spawn eye: 1.48
speed: 2.4
```

These values need a clear unit convention. Either one app world unit should equal one meter after all transforms, or navigation constants should be scaled with the scan.

## What Human Walking Should Do

A human walking mode should use the collision mesh as the spatial authority and keep the camera as an eye-level point above detected floor.

Recommended behavior:

1. Detect the floor below or near the camera.
2. Keep eye height at a consistent value above that floor, for example `1.55m`.
3. Move horizontally with W/A/S/D.
4. After each move, raycast down and snap camera `y` to:

```ts
floorY + eyeHeight
```

5. Use a capsule-style body for collision instead of only three rays.
6. Ignore or soften collision against small furniture if the desired mode is free previs navigation rather than strict physical walking.

## Recommended Constants

A good first pass:

```ts
HUMAN_EYE_HEIGHT = 1.55
HUMAN_RADIUS = 0.18
HUMAN_HEIGHT = 1.75
WALK_SPEED = 1.4
FAST_WALK_SPEED = 2.4
MAX_STEP_HEIGHT = 0.35
MAX_GROUND_SNAP_DISTANCE = 1.0
```

If the scan remains scaled by `3`, decide whether these constants are in post-scale world units or source-scan units. The cleaner option is to make the final displayed world use meters and keep human constants unscaled.

## Suggested Implementation Plan

Short term:

1. Compute initial camera eye from detected collision floor:

```ts
camera.y = floorY + HUMAN_EYE_HEIGHT
controls.target.y = camera.y
```

2. During W/A/S/D movement, preserve eye height by snapping to the ground below the next position.
3. Replace the current hard-coded spawn `y = 1.48` with floor-relative eye height.
4. Add a lower collision radius, for example `0.16-0.18`, to reduce the feeling of being too bulky.

Medium term:

1. Replace the three wall rays with a capsule or swept-sphere test.
2. Add a mode switch:

   - `Free Fly`: no collision, useful for inspecting scans.
   - `Walk`: human eye height, floor snapping, wall collision.
   - `Dolly`: camera planning movement, can pass through some set geometry.

3. Add debug overlays for:

   - detected floor point
   - eye height
   - collision radius
   - blocked ray hits

## Mental Model

Right now, W/A/S/D is still an editor-camera movement system with collision checks bolted on. It is close enough for basic navigation, but it is not yet a real first-person character controller.

For a natural human walk through the splat, the camera should be treated as a person:

```text
feet: collision floor point
eyes: floor point + eye height
body: capsule with small radius
movement: horizontal intent, then ground snap
```

That will make the kitchen feel like a room you can walk through, instead of a giant editor camera bumping into dense scan geometry.

# Unused carriage plaque removal

Created with the built-in `image_gen` tool. Reference/edit target: `public/assets/images/car1/background.png`.

Saved asset: `public/assets/images/scenes/passenger-wall-repaired.png`.

Only the native rectangle `[492,505,140,80]` is composited over the original background in cars 2 and 3, with softly blended edges. The rest of the generated scene is never displayed. This preserves all original scene pixels outside that small wall area, actor layers, door coordinates, flashlight shading, and the real interactable car 1 notice. The material patch is prepared before the scene is revealed.

Final prompt:

```text
Use case: precise-object-edit. Edit target: supplied existing train carriage background, native 1403 by1121. Remove ONLY the small brass WARNING/notice plaque on the far wooden wall to the LEFT of the rear door (approximately source x505..625, y517..576). Completely remove plaque, text, screws and its cast shadow. Reconstruct that tiny area as a seamless continuation of the surrounding dark warm walnut paneling, matching the existing vertical wood grain, perspective, trim, amber lamp falloff, patina and shading. It must look like the sign was never installed. Keep the camera, native composition, image edges, rear door, lights, furniture, curtains and absolutely everything else unchanged; no new decorations, marks or writing. Do NOT remove the small framed artwork above the door. Keep every seat and door exactly aligned with the source. Deliver the same full scene, NOT a crop, with the same original framing and aspect ratio. Most of this image should be untouched.
```

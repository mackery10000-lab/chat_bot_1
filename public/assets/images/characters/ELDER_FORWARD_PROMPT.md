# Elder — forward-facing seating correction

Final saved asset: `public/assets/images/characters/elder-seated-v4.png` (1024 × 1536).

Generated with the built-in `image_gen` tool and `transparent_background: true`; no CLI generation was used. The user's supplied seated character drawing is the authority for identity, outfit, ink linework and pose. The game screenshot supplies the seat orientation and warm lighting. The generated PNG alpha is preserved; no brown backdrop is drawn into the game.

The figure now faces forward and slightly to screen right, with knees and shoes beneath the torso rather than projecting left across the aisle. Placement: `[780,495,380,570]` in the 1403 × 1121 carriage. The source keeps its native 2:3 ratio. The existing foreground-seat mask hides the nearer seat edge naturally; only the elder's contact shadows and silhouette registration are updated.

Scene background, cleaner, dialogue portraits and interaction logic are unchanged. The separately requested minimap cleanup removes its small heading/status/direction text while retaining carriage names, highlights, navigation, lock states and accessible state labels. Startup files were not changed.

Verification: 227 browser scene checks and 5 focused server checks passed. Opaque samples: 7,816; transparent/occluded samples: 7,050; missed or wrong interactions: zero. Other 12 scene registrations and all unrelated runtime hashes match the pre-edit snapshot. Restoring only the minimap's removed text reproduces the exact pre-edit JavaScript hash, confirming no other interaction code changed. [Scene results](../../../../.local/gameplay-ui-qa/1794151466360/result.json), [scope comparison](../../../../.local/elder-direction-update/scope-check.json), [applied desktop view](../../../../.local/gameplay-ui-qa/1794151627338/interface-explore-car_3-1440.png).

The existing interface suite also passed all 328 checks, including map folding/width, unchanged scene and HUD sizing, NPC conversation, inventory, both ending videos and restart. Total browser checks: 555. [Interface results](../../../../.local/gameplay-ui-qa/1794151627338/result.json).

Final generation prompt:

```text
Use case: identity-preserve.
Asset type: transparent full-body seated exploration NPC for the existing illustrated Korean train mystery game.
Input images: Image 1 is the current minimap (irrelevant to this asset); image 2 shows the exact carriage, seat perspective and WRONG existing left-facing seated sprite; image 3, the USER'S SEATED CHARACTER DRAWING, is the authoritative identity, outfit, drawing style AND pose reference.
Primary request: make ONE transparent seated elderly man closely based on image 3, adapted to sit properly in the near RIGHT bench in image 2. Fix the wrong lower-body direction. The chair faces toward the viewer with a slight turn to SCREEN RIGHT. His pelvis, both thighs, both kneecaps, shins and both shoe toes MUST face forward and slightly SCREEN RIGHT, following that seat. Use an almost FRONT-FACING seated lower body like image 3. BOTH knees remain below the shoulders and slightly to their SCREEN RIGHT; BOTH shoes remain below their respective knees and a little to SCREEN RIGHT of them. Do not put his knees or shoes to the LEFT of his pelvis. Do not use a left-facing side pose. This anatomical orientation is the most important constraint.
Copy the provided seated drawing's tired, bowed elderly Korean face, sparse messy grey hair, deliberate dark ink contours, matte flat painted brown shadow shapes, dark brown worn jacket, knitted dark waistcoat, checked shirt, loose charcoal trousers, wooden cane and old satchel. Preserve his particular drawn face and proportions. No photorealistic replacement face or smooth 3D textures. Slight hunch; both hands resting together naturally over the cane top, held between his knees, as in image 3. Keep hips actually supported at seat height, thighs foreshortened toward the viewer with a small rightward angle, feet planted on the same imaginary floor. Complete both rugged lace-up shoes and the cane tip.
Carriage matching: warm muted amber overhead light, dark cloth shadows, modest highlights, no bright rim glow. Use image 2 only for camera/light/orientation; absolutely do not reproduce its old leftward leg pose.
Composition: ONE complete seated person, portrait 2:3 canvas. Body centered, head near upper middle, hip/seat contact approximately 59 percent of canvas height, shoe soles at about 96 percent. Body and thighs centered under his head with a slight SCREEN-RIGHT progression toward the feet. Small transparent margin, no cropping. Only one sprite, true transparent alpha, transparent gaps around legs and cane.
Exclude: chair, bench, crate, seat, scenery, floor, vignette, background, contact sheet, labels, text, duplicate people, photo skin, 3D look. Keep the original reference's hand-inked illustration character. The desired leg direction is front and slightly SCREEN RIGHT, NEVER side-facing to screen left.
```

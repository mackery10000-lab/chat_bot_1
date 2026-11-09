# Elder — original character sheet refinement

Saved asset: `public/assets/images/characters/elder-seated-v3.png`.

Built with the built-in `image_gen` tool, using `transparent_background: true`. No CLI image generation or application API key was used. The output alpha is preserved. The user's attached multi-panel character sheet supplied the authoritative face, clothes and hand-inked drawing style. The existing carriage supplied lighting and perspective; the previous seated sprite supplied the placement envelope only.

Only the elder source PNG, its source reference in `config/scene_layout.json`, and its generated `car3-elder.png` layer/registration are updated. Position, tone, contact shadows and foreground mask are retained. Other characters, backgrounds, dialogue portraits, UI and gameplay code are unchanged.

Verification: 227 browser scene checks and 5 focused server checks passed. At 1440, 390 and 320 CSS pixels, 7,430 opaque samples and 7,603 transparent/occluded samples produced zero missed or wrong interactions. All other runtime files and the other 12 registrations match their pre-edit hashes/data. [Scope comparison](../../../../.local/elder-reference-update/scope-check.json), [browser results](../../../../.local/gameplay-ui-qa/1794150413117/result.json), [mobile scene](../../../../.local/gameplay-ui-qa/1794150413117/scene-car_3-390.png).

Final prompt:

```text
Use case: identity-preserve.
Asset type: final transparent exploration NPC sprite for an existing Korean hand-illustrated train mystery game.
Input images, in order: 1) the USER'S MULTI-PANEL CHARACTER DESIGN SHEET is the authoritative identity AND drawing style reference; 2) the earlier dark-background seated portrait is secondary identity reference only; 3) the empty amber-lit railway carriage is ONLY lighting, seating perspective and camera reference; 4) the last transparent side-seated sprite is ONLY the established in-game placement/pose envelope, NOT a style or face reference.
Primary request: redraw this ONE elderly Korean man from the supplied design sheet, seated naturally on the near RIGHT bench of that carriage. The previous sprite looked too photorealistic and generically AI-rendered. Closely match the sheet's deliberate dark hand-drawn ink contours, simplified matte painted shadow shapes, restrained sepia palette and character-design proportions. Preserve his narrow long weathered face, drooping tired eyelids, high bony cheekbones, sparse uneven grey hair, thin lips, long thin neck, worn dark brown jacket, dark knitted waistcoat, brown small-check shirt, loose charcoal trousers, old rugged lace-up shoes, wooden cane and modest battered crossbody satchel. Copy the particular man in the sheet; do NOT beautify, round his face, soften all wrinkles or replace him with a different realistic elderly man.
Pose: three-quarter seated view, pelvis resting at image-right on an invisible bench, thighs supported horizontally, knees projecting diagonally toward image-left into the aisle, feet naturally below knees, both shoes visible, cane tip touching the same invisible floor. Slight weary forward hunch and both hands resting naturally on top of the cane, like the seated inset in the user's sheet. Calm grave downward/slightly forward gaze. Keep the current sprite's practical narrow envelope: head in upper-right third, torso and seated hip to the right, knees and feet to the lower left, no outward-reaching arm or prop beyond the body.
Lighting: subdued warm amber light from overhead train lamps, matte low-saturation brown cloth and softly shaded lower legs, readable ink linework, no bright artificial outline or rim light. Match the carriage without painting any carriage into the asset.
Composition: ONE complete seated figure, portrait 3:4, full head, shoes, cane tip and satchel inside the canvas with a small transparent margin. Seat height about 58 percent from top and shoe soles near 96 percent. True transparent alpha outside the character, including gaps around the cane and legs.
Constraints: only the isolated character. No drawn bench, chair, floor, background, vignette, halo, backdrop, multiple poses, contact sheet, labels, letters or text. No photography, 3D rendering, shiny skin, glossy fabric, pore-by-pore texture or procedural noise. This is a carefully inked game character matching the USER'S ORIGINAL CHARACTER SHEET.
```

# Exploration character assets

Created with the built-in `image_gen` tool, using `transparent_background: true`.
Each call referenced the corresponding original portrait first, followed by
the matching scene for camera and lighting. Existing dialogue portraits were preserved. These are project assets, copied from the
tool output into the workspace without changing their alpha.

| Final workspace file | Identity reference | Size |
| --- | --- | --- |
| `public/assets/images/characters/explorer-seated.png` | `portrait_01.png` | 1024×1536 |
| `public/assets/images/characters/elder-seated.png` | `portrait_02.png` | 1024×1536 |
| `public/assets/images/characters/elder-seated-v2.png` (previous refinement) | `elder-seated.png` + `car1/background.png` | 1086×1448 |
| `public/assets/images/characters/elder-seated-v3.png` (previous refinement) | User's original character sheet; carriage lighting and previous placement | 1086×1448 |
| `public/assets/images/characters/elder-seated-v4.png` (current exploration asset) | User's seated original drawing; carriage seat direction and lighting | 1024×1536 |
| `public/assets/images/characters/cleaner-working.png` | `portrait_03.png` | 1024×1536 |
| `public/assets/images/characters/attendant-standing.png` | `portrait_04.png` + `scenes/crew-door.png` | 1024×1536 |
| `public/assets/images/characters/driver-at-controls.png` | `portrait_05.png` + `scenes/engine.png` | 1221×1289 |

The build script applies scene-specific placement, reflected-light tone, contact
shadows and foreground-seat occlusion to full-canvas exploration layers.
The generation inputs are independent of dialogue expressions and story state.

The attendant uses normal standing proportions at the door threshold. The driver
uses a rear three-quarter seated pose behind the existing chair, with his hand
raised to the real console lever. The complete initial and refinement prompts
for these two assets are in [staff-prompts.json](staff-prompts.json). Both were
created with the built-in tool and preserved as transparent project PNGs.

## Prompt set

For the first three assets, each final prompt was the shared prefix, the relevant subject paragraph, then the
shared suffix below. No CLI image generation or project API key was used.

Shared prefix:

> Use case: identity-preserve. Asset type: transparent exploration NPC sprite for an existing point-and-click mystery game. Input image 1 is the character identity and clothing reference; image 2 is ONLY the existing scene lighting/camera reference.

Explorer:

> One full-body seated young Korean male explorer, same distinctive youthful face, short tousled dark hair, olive field jacket, backpack straps, brown cargo trousers and worn hiking boots, subtly bandaged ankle. He sits naturally in the LEFT near seat, torso and head angled gently toward camera and aisle to image right, hips supported by an invisible chair, legs hanging down normally with feet on the floor rather than cross-legged on air. Hands relaxed on his thighs, one hand near his sore ankle; friendly curious expression. This is the same person as image 1. Complete figure, both boots visible, anatomically plausible seated silhouette. No chair, no seat, no interior, no floor plane, no vignette behind him. The train scene in image 2 supplies perspective and lighting ONLY: seen at camera seated eye height, slightly looking down at legs, overhead dim warm amber light, muted brown reflected light, deep soft shadows on lower clothing. Match its realistically textured, softly painterly game rendering with much subtler ink contours than the original portrait. Keep face and outfit identity. Tight full-body centered cutout with small transparent margin.

Elder:

> One full-body seated elderly Korean man, same recognizable thin deeply wrinkled face, untidy grey hair, brown weathered jacket over brown checked shirt, dark trousers, worn shoes and simple wooden cane. Same person as image 1. He sits naturally in the RIGHT near seat, shoulders slightly hunched, torso turned slightly left toward the aisle and camera, hands resting on cane between his knees, both feet planted below knees on an invisible floor. Head-to-hips-to-feet proportions anatomically plausible, no floating crouch or giant knees. Neutral thoughtful tired expression. No chair, no seat, no interior, no floor plane, no aura or vignette. Image 2 is perspective and lighting reference ONLY: camera at seated eye level, looking slightly down at feet, subdued warm amber overhead lamps, brown reflected light, lower legs in soft deep shade. Use realistically textured softly painterly game rendering with subtle outlines matching the train, preserve precise face and outfit identity. Centered complete seated figure including cane tip and both shoes with small transparent margin.

Cleaner:

> One full-body Korean middle-aged female train cleaner, identical recognizable kind face and dark loosely tied hair, blue-grey rolled-sleeve cleaning uniform, ID lanyard, utility belt with cloths, plain dark practical closed shoes. Same person as image 1. She is standing and leaning forward modestly, cleaning the narrow train aisle: both hands naturally hold a plain mop handle angled down, mop head on floor beside her feet. Head bowed slightly with a gentle glance toward camera, attentive to work, not a formal front-facing portrait or folded hands. Body turned three-quarter to camera, feet and full lower legs visible and physically plausible. No furniture, no interior, no floor plane, no vignette or halo. Image 2 is perspective and lighting reference ONLY: camera seated at eye height looking slightly up at upper body and down at feet; dim warm amber overhead train lamps, muted brown reflected light and dark lower clothing, realistic textile texture in a softly painterly game style with subtle contour work. Keep exact face, age, uniform and original character identity. Full complete silhouette including mop, centered with small transparent margin.

Shared suffix:

> Output exactly one isolated person on genuinely transparent background. Preserve alpha. Do not draw any background, typography, border, labels, pedestal or drop shadow plate. Do not copy the old brown portrait backdrop. No unrelated props.

## Elder seating refinement

Saved path: `public/assets/images/characters/elder-seated-v2.png`.

Created with the built-in `image_gen` tool and `transparent_background: true`; no CLI/API image generation was used. Input 1 (`elder-seated.png`) supplied the existing man's identity and clothes. Input 2 (`car1/background.png`) supplied the shared passenger carriage's camera, right-seat perspective and lighting. The full generated alpha is preserved.

Final prompt specification:

Use case: identity-preserve. Asset type: transparent exploration NPC sprite. Preserve the same elderly Korean man: deeply wrinkled face, untidy grey hair, worn brown jacket, checked shirt, dark trousers, shoes, wooden cane and bag. Rebuild his pose as a natural three-quarter side view, sitting on the train's RIGHT bench. Pelvis at the right, thighs resting horizontally on an invisible seat, knees directed diagonally left into the aisle, lower legs descending naturally, both soles on the same floor. Hands rest on the cane; bag lies outside the right hip. Use supported seated anatomy, no floating squat or oversized knees. Include the complete body, shoes and cane tip. Match the warm amber overhead lighting and softly painterly materials of the supplied carriage. Portrait 3:4 tight transparent cutout with a small margin. No chair, bench, background, floor plane, halo, old brown portrait backdrop, text or label.

The current layout rectangle is `[700,500,410,565]`. Shadows sit beneath the seat and both feet; the existing foreground right-seat mask is retained. `tools/build_scene_assets.ps1 -Keys car3.elder` rebuilds only its full-canvas layer and hit outline, preserving other registrations. Dialogue portraits remain the original assets.

The latest `elder-seated-v3.png` follows the user's original character sheet more closely: a narrow weathered face, tired eyelids, dark knitted waistcoat, deliberate ink lines and matte painted shadows. It retains the same placement and scene tone. Its exact built-in generation prompt and asset path are in [ELDER_REFERENCE_PROMPT.md](ELDER_REFERENCE_PROMPT.md).

The current `elder-seated-v4.png` corrects the lower-body direction to follow the right bench: almost front-facing, knees and shoes slightly to screen right, rather than a side pose pointing left into the aisle. Its rectangle is `[780,495,380,570]`, preserving the native 2:3 proportions. It uses the existing foreground seat mask and adjusted contact shadows. [Final prompt and integration notes](ELDER_FORWARD_PROMPT.md).

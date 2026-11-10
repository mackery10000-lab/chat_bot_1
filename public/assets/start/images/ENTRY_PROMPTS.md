# Entry artwork

Created with the built-in `image_gen` tool. Final image files are stored in `public/assets/start/images/`. Original generated files are retained under the Codex generated-images directory. Transparent alpha and native artwork are preserved; live form fields, labels, buttons and narration remain HTML. The existing title logo and page layout are retained. The two updated ticket values are also included in accessible labels.

The hanging frame's eyelet centers are measured from the delivered 2172 × 724 image (388.5,40) and (1782,40). `entry-motion.js` keeps both cords connected, starts the damped left-side drop after 500 ms, then stops frame updates when settled. `entry-art.css` synchronizes all middle-lamp light layers to a five-second contact flicker; left is off and right stays lit.

## entry-lamp.png

Saved path: `public/assets/start/images/entry-lamp.png`.

Reference: `public/assets/images/car1/background.png`.

Final prompt:

```text
Use case: ui-mockup. Production isolated bitmap game asset, actual transparent background. ONE straight-on vintage passenger-car ceiling lamp: shallow broad dark patinated bronze circular mount at top, short brass collar, one compact milky opal glass downward dome. UNLIT grey ivory glass; preserve visible subtle reflected warm tones and believable glass volume but NO internal light and NO outer glow. Fixture fills frame centered, no chain, wire, room, scenery, text or extra bulbs. Canvas landscape 4:3, full fixture uncropped. Match the existing game's warm sepia, hand-painted realistic illustrated antique train materials in the reference: worn walnut, oxidized brass, ivory pigments and subtle patina. Restrained believable wear, no vector-flat gradients, no glossy modern UI, no excessive filigree, no words or watermark.
```

## entry-sign.png

Saved path: `public/assets/start/images/entry-sign.png`.

Reference: `public/assets/images/ui/menu-card.png`.

Final prompt:

```text
Use case: ui-mockup. Production UI background only: one VERY WIDE horizontal 3:1 antique railway station signboard, front-on, perfectly level. Aged dark oxblood red enamel panel, narrow convincingly worn brass double border, inward-notched rounded corners, tiny tarnished metal eyelets at 16% and84% along top edge. Bottom 16 percent is a dark charcoal enamel ticker strip separated by thin brass trim. All interior panels completely BLANK for live HTML text and logo. No letters, words, logos, chain, cord, background, shadows outside silhouette. True transparent exterior, art fills canvas to edges with only minimal transparent corner notches. Match the existing game's warm sepia, hand-painted realistic illustrated antique train materials in the reference: worn walnut, oxidized brass, ivory pigments and subtle patina. Restrained believable wear, no vector-flat gradients, no glossy modern UI, no excessive filigree, no words or watermark.
```

## entry-sound.png

Saved path: `public/assets/start/images/entry-sound.png`.

Reference: `public/assets/images/ui/menu-card.png`.

Final prompt:

```text
Use case: ui-mockup. One isolated square antique railway control plaque used as a small sound toggle. Charcoal olive enamel square with gently clipped corners, thin worn ivory-brass double outline, two tiny antique rivets, central very legible warm ivory SPEAKER pictogram with two restrained sound waves. True transparent outer background. Front-on perfectly level, full square fills 95% of square canvas, no drop shadow outside it, NO text, no banners, no letters. Match supplied menu-card reference's material and ivory ink texture, but a compact square control. Match the existing game's warm sepia, hand-painted realistic illustrated antique train materials in the reference: worn walnut, oxidized brass, ivory pigments and subtle patina. Restrained believable wear, no vector-flat gradients, no glossy modern UI, no excessive filigree, no words or watermark.
```

## entry-settings.png

Saved path: `public/assets/start/images/entry-settings.png`.

Reference: `public/assets/images/ui/menu-card.png`.

Final prompt:

```text
Use case: ui-mockup. One isolated square antique railway control plaque used as a small settings button. Charcoal olive enamel square with gently clipped corners, thin worn ivory-brass double outline, two tiny antique rivets, central very legible warm ivory COGWHEEL pictogram with eight cogs and small center circle. True transparent outer background. Front-on perfectly level, full square fills95% of square canvas, no drop shadow outside it, NO text, no banners, no letters. Match supplied menu-card reference's material and ivory ink texture, but a compact square control. Match the existing game's warm sepia, hand-painted realistic illustrated antique train materials in the reference: worn walnut, oxidized brass, ivory pigments and subtle patina. Restrained believable wear, no vector-flat gradients, no glossy modern UI, no excessive filigree, no words or watermark.
```

## entry-ticket-machine.png

Saved path: `public/assets/start/images/entry-ticket-machine.png`.

Reference: `public/assets/images/ui/menu-card.png`.

Final prompt:

```text
Use case: ui-mockup. Production UI background for ticket printer. VERY WIDE shallow antique railway ticket issuing machine fascia, front-on, about7:1width toheight. A slightly curved heavy dark brass housing with rounded shoulders, aged hammered warm bronze, rubbed brass edge and delicate scratches, 2 small rivets near the left and right ends, ONE long deep horizontal paper exit slit across the bottom 10percent, a completely blank recessed dark rectangular nameplate centered upper half occupying about28% width. All surfaces restrained authentic tactile illustrated metal. No text, no letters, no paper ticket, no room, no extra switches or knobs. True transparent outer background; machine fills entire width with no extra margins. Match the existing game's warm sepia, hand-painted realistic illustrated antique train materials in the reference: worn walnut, oxidized brass, ivory pigments and subtle patina. Restrained believable wear, no vector-flat gradients, no glossy modern UI, no excessive filigree, no words or watermark.
```

## entry-ticket-paper.png

Saved path: `public/assets/start/images/entry-ticket-paper.png`.

Reference: `public/assets/images/ui/dialogue-paper.png`.

Final prompt:

```text
Use case: ui-mockup. Production game UI background, one blank antique cream railway ticket sheet, rectangle with very subtle rough cut edges and a thin faded brown double-rule frame inside all four edges. Fine tactile ivory cotton paper fibers, delicately aged edges and faint small warm stains, luminous quiet empty middle for live HTML form text, NO writing, NO logo, no printed lines dividing the middle, no icons, no objects, no folding or perspective. Perfect straight-on rectangular 4:3 landscape paper fills entire canvas edge toedge, no exterior shadow or background. Match the existing illustrated game's archival paper and realistic subdued warm ivory palette. Natural subtle texture, avoid very dark burn marks and avoid excessive aging.
```

## entry-boarding-ticket.png

Saved path: `public/assets/start/images/entry-boarding-ticket.png`.

Reference: `public/assets/start/images/ticket.webp`.

Final prompt:

```text
Use case: text-localization. EDIT TARGET is the existing train ticket image. Preserve ALL text, layout, train illustration, paper colors, border, ink stain, aspect ratio, geometry, margins and alpha exactly. Change ONLY two values in bottom row: underneath 객차 번호, replace 03호차 with 01호차. Underneath 좌석 번호, replace 13A with 08C. Keep the original serif printed ink style, sizes and alignment. No other changes. Exact replacement text: "01호차" and "08C".
```

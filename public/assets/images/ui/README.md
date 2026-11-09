# 13-Fri UI artwork

Generated raster assets for the image-based train game interface. All assets were created with the built-in `image_gen` tool using the user's supplied game UI references. Transparent PNG alpha is preserved. The application uses these local files directly.

| Files | Purpose |
| --- | --- |
| `menu-card.png`, `inventory-card.png`, `journal-card.png`, `hint-card.png` | Matching worn dark clipboard tool buttons with ivory pictograms and paper labels |
| `dialogue-paper.png` | Dialogue paper, empty burgundy speaker tab, metal paperclip, faded railway masthead |
| `note-paper.png` | Shared blank paper for requested hints and map labels |
| `choice-paper.png` | Flat narrow paper strips for the two contextual action choices; generation prompt in [CHOICE_PROMPT.md](CHOICE_PROMPT.md) |
| `hint-paper.png` | Burgundy premium paper with a fine antique gold rule for the single requested hint action; edit prompt in [HINT_PROMPT.md](HINT_PROMPT.md) |
| `archive-paper.png` | Shared archival paper for documents, notice and ending |
| `dossier-panel.png` | Generated paper and burgundy leather skin shared by conversation history, settings, journal, hints and confirmations |
| `ending-certificate.png` | Warm happy-ending railway certificate displayed at its native 3:2 ratio |
| `ending-certificate-sad.png` | Desaturated ash-grey sad-ending certificate with worn edges, transparent holes and live ivory text |
| `train-window-frame.png` | Walnut-and-green-curtain window frame with a transparent opening for the live exterior video; [final prompt](WINDOW_PROMPT.md) |
| `chat-input.png` | Distressed dark input frame with ivory paper send area and printed airplane |
| `train-route.png` | Seven connected cutaway train interiors: four passenger cars, crew room, exit vestibule, final engine control room |
| `ticket-item.png`, `flashlight-item.png`, `book-item.png` | Illustrated inventory objects |

The speaker, dialogue, input and location labels remain live HTML. Map locations retain their original game IDs, navigation actions and locked/current states.

HUD cards scale with the scene between 36 and 64 CSS pixels. The map retains its native 3:1 ratio and shares the scene frame's outer width in both folded and unfolded states. Desktop sizing measures only the fixed roller, never the unfolded sheet; the sheet takes its natural vertical space without shrinking the background, characters or HUD. The roller height depends on the viewport, avoiding a width/height measurement feedback loop. Stable scrollbar space prevents horizontal shifts when the sheet unfolds. The dialogue paper keeps its visible 2045:502 ratio. The input uses a sliced border image, keeping the paper send area and its pictogram at a fixed size while the blank center adapts to the available width. The original PNGs are unchanged.

The current location is shown as a five-second translucent overlay when entering a location; the permanent paper location/time plaque is removed.

The composer and its two contextual choices appear only during an active NPC conversation in every room. Exploration uses scene hotspots and inventory actions. A requested exploration hint opens in its own paper dialog; during conversation it replaces the ordinary choices. The hint action is authorized on the server only after an explicit hint request; evidence and final control input still require the player's own decisions. Sliced border images preserve the paper ends while live Korean labels wrap.

The minimap is the first visible element; the former title/save/settings header has been removed. Settings remain available from the in-scene MENU card. Desktop scene sizing reserves the same control space during exploration and conversation, preserving the full native background ratio and every HUD position. NPC selection preserves the player's map preference. The shared paper dialogs keep their edges fixed and scroll long content inside; they also frame the existing notice and lever artwork. The window video uses its own walnut frame, green curtains and transparent glass opening, with no paper dialog skin. The final mechanical control uses its original dark device window. Both ending videos retain their playback behavior and finish on separate native-ratio illustrated certificates, keeping the top locomotive seal undistorted.

Dialog titles and body text use the existing game font token (`--font`, RenaissanceText with the existing fallbacks). Decorative English subtitles have been removed from dialog headers, hint headings, ending headings and the minimap. Confirmation actions are live text buttons on the same light rectangular paper as settings actions; inventory object/action artwork is preserved. Confirmation handlers, busy guards, accessible labels and server tokens retain their original behavior.

The elder's spoken testimony emphasizes **바랜 종이** and **구멍** using live strong text. The printed testimony records use the bundled regular Nanum Gothic font with those exact phrases printed in bold. Only learned testimony is included, as before. Regenerate these pages with `powershell -NoProfile -ExecutionPolicy Bypass -File tools/print_inventory_records.ps1 -DocumentIds elder_testimony`.

The final built-in generation prompts and local paths for the new panel assets are recorded in [PANEL_PROMPTS.md](PANEL_PROMPTS.md).

The loading screen uses a full black viewport, a short live Korean lore sentence near the lower center, and a grey eye/gear indicator at the lower right. Its AI request is independent of scene loading, uses only public setting context, and cannot change game progress. Desktop, mobile, landscape, safe-area and reduced-motion layouts are covered. Latest changes and verification are in [PRESENTATION_UPDATE.md](../../../../docs/PRESENTATION_UPDATE.md).

UI verification: 186 offline Python tests passed during the initial update. After the map/font/confirmation refinement, browser suites passed 227 scene checks, 328 interface checks, 102 puzzle/playback checks and 58 minimap/hint/progression checks, with no browser exceptions or failed asset/API responses. Interface checks cover map/scene edge alignment, unchanged sizes through map folding in all six rooms, all five NPCs, unchanged scene/HUD geometry through conversation, restored conversations, exploration-only controls, common typography and Korean-only headings, settings, history, journal, hints, testimony emphasis, both complete ending videos and restart. Viewports include 1440×900, 1024×768, 390×844 and 320×568; scene checks also use 1440×1000. Run `node tools/check_gameplay_ui.mjs --interface-only --screenshots` for the focused UI regression suite. QA uses isolated saves and an offline model.

Character interactions draw on the authored dialogue: reasons for boarding, familiar scenery, the elder's recent memories, the cleaner's work, the attendant's concern and the driver's difficulty stopping. Asked topics move behind other questions for that character. This conversation history changes the available small talk without advancing quest flags, describing the lost ticket, selecting evidence or filling the final code.

## Generation prompts

All requests: production game artwork matching the supplied sepia night-train UI references; natural worn materials rather than flat vector shapes; no modern glossy styling. The following are the final prompt briefs. Full generation prompts are preserved in [PROMPTS.md](PROMPTS.md).

- Tool cards: isolated transparent worn black-olive clipboard with aged ivory edging and small metal top clip, printed ivory menu lines / briefcase / journal / light bulb, cream paper footer reading MENU / INVENTORY / JOURNAL / HINT. Each generated separately.
- Dialogue: long pale ivory archival paper with fine fibers and subtle stains, thin worn double ink border, folded bottom-left corner exposing burgundy backing, empty burgundy speaker tab, old metal paperclip upper right, faded 13-FRI / THE TRAIN THAT NEVER ARRIVES masthead at right; blank dialogue area.
- Note: blank pale ivory old paper with subtle fibers, light stains and irregular edges, landscape format.
- Archive: square blank aged ivory archival paper with faded border, small tears and folds.
- Input: long low charcoal input bar with fine distressed ivory double outline, chamfered left corners and blank dark interior; rightmost 12 percent pale paper with a dark printed paper airplane pointing upper right; transparent exterior; no baked placeholder.
- Route: old sepia parchment chart with seven connected, enclosed cutaway train sections; four passenger cars, crew room, exit vestibule, then the engine control room inside the final carriage; engraved circular medallions, amber interior lamps, worn dark metal and brass, continuous tracks; no baked location labels or selection highlights. The exit vestibule retains the existing disembark action and station description.
- Items: isolated transparent cutouts of an aged cream railway ticket with burgundy printing, antique brass handheld flashlight, and worn burgundy railway manual with ivory pages. Each generated separately.

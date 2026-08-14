# Design QA

- source visual truth path: `docs/reference-design.png`
- implementation screenshot path: `docs/implementation-final.png`
- browser evidence: `docs/browser-full-final.png`
- combined comparison: `docs/qa-comparison-final.png`
- viewport: 1400 × 1200 browser viewport; `[data-phone-screen]` measured 393 × 852 CSS px
- pixels and density: source 853 × 1844 normalized to 393 × 852; implementation 393 × 852; deviceScaleFactor 1
- state: iPhone, initial playable state, sound on, not paused

**Full-view comparison evidence**

The final side-by-side comparison preserves the selected direction's composition: warm orchard backdrop,
decorated wooden title, left score stack, right next-fruit panel, centered hanging fruit, dominant honey-wood
bin, danger line, dense character-fruit pile, and bottom release instruction. App-owned content is compared at
the same 393 × 852 size. Template-owned iPhone bezel, live status bar, Dynamic Island and home indicator are
expected runtime chrome and are excluded from fidelity findings.

**Focused region comparison evidence**

- `public/assets/source/reference-cutouts-contact.png`: title, controls, HUD and instruction cutout edges.
- `public/assets/source/fruits-contact-tight.png`: all eleven transparent fruit levels, alpha edge quality,
  consistent center anchors and scale progression.
- `public/assets/game/wooden-bin-frame.png`: transparent center, continuous rails and clean corners.

**Required fidelity surfaces**

- Fonts and typography: title and fixed Chinese labels remain in source-derived raster assets; live score uses
  a high-contrast serif fallback at the same visual weight. No wrapping or truncation.
- Spacing and layout rhythm: header, HUD, hanging fruit, bin and instruction preserve the reference order and
  dominant proportions. Tap controls remain clear of app content; device chrome overlap is runtime-owned.
- Colors and visual tokens: cream, apricot, honey wood, leaf green and orange-red danger accents match the
  reference. The bin interior uses a translucent cream surface to retain fruit contrast.
- Image quality and asset fidelity: all custom decorative surfaces are real PNG assets. Eleven fruits are
  individually cropped, chroma-keyed, despilled, alpha-validated and normalized to 256 × 256.
- Copy and content: `果果合成`, `得分`, `最高`, `下一个`, `松手落下` match the selected design; dynamic scores
  and next/current fruit state remain functional.
- Icons and controls: source-derived sound and pause assets are semantic buttons with visible focus states.
- Responsiveness: mobile runtime retains calibrated iPhone and Pixel shells; app content stays within its
  fixed game viewport and does not introduce scroll or clipping.

**Comparison history**

1. Pass 1 (`docs/qa-comparison-pass-1.png`): P1 — the bin reused the orchard background internally and the
   fruit pile collapsed below the intended visual density. Fixed with a cream bin surface, tight alpha crop,
   corrected visual/collision sizing, and a stable initial showcase layout.
2. Pass 2–4 (`docs/browser-full-pass-2.png` through `docs/browser-full-pass-4.png`): P2 — title overlapped
   runtime status chrome, fruit assets contained excessive transparent padding, and the bin was vertically
   undersized. Fixed by moving the header below the safe area, normalizing every fruit to a common anchor,
   moving the bin upward and increasing the playable height.
3. Final (`docs/qa-comparison-final.png`): no actionable P0/P1/P2 mismatch remains. Fruit arrangement differs
   at the object level because it is a playable physics state rather than a rasterized copy; art direction,
   density, scale hierarchy and composition remain faithful.

**Interactions tested**

- Pause button opens the in-game continue state and resumes physics.
- Sound button toggles its accessible state.
- Canvas pointer release creates the current fruit and advances current/next state.
- Browser console checked on a fresh tab: no errors or warnings.
- `npm run check:runtime`, `npm run build`, and `npm run test:sites` passed.

**Follow-up polish**

- P3: add merge particles and short original audio cues after the sound pack is authored.
- P3: tune level radii after several real-device play sessions to refine difficulty.

prior game-screen result: passed

## Career full-screen redesign QA

**Visual truth and evidence**

- Existing career implementation before redesign: `docs/career-before.png`.
- Orchard art direction reference: `docs/reference-design.png`.
- Final iPhone and Pixel captures: `docs/career-fullscreen-iphone.png` and
  `docs/career-fullscreen-pixel.png`.
- Combined before/after comparison: `docs/career-comparison.png`.
- Capture viewport: 1400 × 1200; device content viewport: 393 × 852 CSS pixels at DPR 1.
- State: career page open with a new-player profile, so locked and unlocked treatments remain comparable.

**Full-view comparison findings**

- The old career UI was constrained inside the wooden bin, which weakened hierarchy, reduced the usable
  achievement list height and visually competed with the live game underneath.
- The new implementation uses the full phone content area, keeps the status-bar safe area clear and gives
  score, records, progress and achievements a stable top-to-bottom reading order.
- The iPhone and Pixel captures preserve the same centered geometry without clipping, unintended scrolling
  or overlap with runtime chrome.

**Required fidelity surfaces**

- Typography and color continue the warm orchard visual system: dark walnut type, cream glass panels,
  apricot borders and leaf-green progress accents.
- Layout uses one responsive scale variable for padding, radii, icon sizes and gaps, avoiding per-device
  magic offsets.
- Record and achievement rows reuse the real fruit artwork rather than emoji or substitute icons.
- Copy, completion count, cumulative score, highest fruit, best combo, merge count and five achievement
  states all come from the versioned player-progress model.

**Interactions tested**

- Opening the career page pauses the physics scene; returning restores the prior running/paused state.
- The visible return control and Escape key both close the page.
- iPhone and Pixel device presets were exercised, and browser logs were checked after returning to play.
- `npm run check:runtime`, `npm run build`, `npm run test:gameplay` and `npm run test:sites` passed.

**Issue disposition**

- P1 resolved: career content is no longer a small scrollable dialog inside the playfield.
- No remaining actionable P0, P1 or P2 visual mismatch was found in the final comparison.

prior career-screen result: passed

## HUD shortcut spacing QA

**Evidence**

- Source issue capture: `docs/hud-spacing-before.png` (377 × 254 px).
- Browser-rendered implementation: `docs/hud-spacing-after.png` (1400 × 1200 px, DPR 1) with the
  iPhone content viewport verified at 393 × 852 CSS pixels.
- Combined focused comparison: `docs/hud-spacing-comparison.png`.
- State: new game, score 0, top HUD and current fruit visible.

**Findings and comparison history**

1. Before fix — P1: `.career-control` left only 2px above `.score-card`, while `.settings-control`
   overlapped `.next-card` by 9px. The shadows and label tabs visually merged.
2. Fix: moved both shortcut controls from responsive y=116 to y=98, keeping their existing horizontal
   anchors and artwork unchanged.
3. After fix: iPhone gaps measure 20px (career → score) and 9px (settings → next); Pixel gaps measure
   22px and 10px respectively. Horizontal clearance from the title sign remains at least 11px.

**Required fidelity surfaces**

- Typography, colors, assets and copy are unchanged from the selected orchard design.
- Layout rhythm now separates the shortcut buttons from the HUD cards without moving the score, next-fruit
  or playfield anchors.
- No image resampling or new substitute icon was introduced.
- iPhone and Pixel responsive states were visually inspected at the same game state.

**Interactions and regression coverage**

- Both shortcut buttons remain clickable and continue to open their full-screen panels.
- The browser console produced no new warning or error on a fresh load.
- Gameplay regression now asserts an 8px minimum shortcut-to-HUD gap for both device presets.

No actionable P0/P1/P2 mismatch remains in the focused comparison.

prior shortcut-to-HUD result: passed

## Right-side control-stack QA

**Evidence**

- Source issue capture: `docs/hud-control-overlap-before.png` (402 × 173 px).
- Browser-rendered implementation: `docs/hud-control-overlap-after.png` (1400 × 1200 px, DPR 1),
  with the iPhone content viewport verified at 393 × 852 CSS pixels.
- Combined focused comparison: `docs/hud-control-overlap-comparison.png` (1280 × 720 px).
- State: new game, score 0, sound and pause enabled, top HUD visible.

**Findings and comparison history**

1. Before fix — P1: moving `.settings-control` upward solved its collision with `.next-card`, but its
   rectangle then overlapped both `.sound-control` and `.pause-control`, creating ambiguous click targets.
2. Fix: retained the settings and HUD anchors, reduced the two round controls to 34 × 36px on iPhone and
   34 × 34px on Pixel, and placed them at each platform's safe top offset.
3. After fix: the sound/pause row now ends at y=90 and settings begins at y=98 on iPhone; Pixel keeps an
   8.4px gap. The settings-to-next gap remains at least 9px on both presets.

**Required fidelity surfaces**

- Typography, copy, palette, fruit imagery and source-derived control assets remain unchanged.
- The round controls preserve their original aspect and visual hierarchy while no longer competing with
  the text shortcut below.
- No generated placeholder, CSS icon or substituted asset was introduced.
- The full game composition and all playfield anchors remain unchanged.

**Interactions and regression coverage**

- Sound, pause and settings retain separate non-overlapping click rectangles.
- Settings continues to open its full-screen panel; sound and pause retain their original actions.
- The gameplay regression now enforces an 8px minimum round-control-to-settings gap on iPhone and Pixel.
- `npm run check:runtime`, production build and all gameplay tests passed after the fix.

No actionable P0/P1/P2 mismatch remains in the focused comparison.

final result: passed

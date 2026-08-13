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

final result: passed

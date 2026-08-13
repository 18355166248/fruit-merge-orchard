# Physics QA

## Root causes fixed

1. `setCircle()` was called before `setDisplaySize()`. Phaser scales the Matter body together with the
   image, so a nominal 12–108 px collision radius was scaled down a second time. The visible fruits were
   much larger than their collision bodies, causing penetration and incorrect stacking.
2. The initial visual showcase used overlapping static bodies. Releasing all of them on the first drop
   forced Matter to resolve many deep overlaps in one frame and emitted invalid-looking merge cascades.
3. Merge feedback animated `scale` from `0.15` to `1`. Matter synchronizes GameObject scale to its body,
   so the animation also inflated the new collision body far beyond the intended fruit radius.
4. The physical floor was lower than the wooden foreground rail, making settled fruit look half buried.

## Corrections

- Start with an empty, physically valid board.
- Size the fruit texture first, then create the circle body at 91% of the visible radius.
- Apply friction, density, restitution and slop to the final circle body, not the discarded default body.
- Animate merge feedback with alpha only; collision geometry never changes during the effect.
- Align the Matter floor with the top of the wooden bottom rail.
- Keep the per-body merge lock so a body can participate in only one merge per collision batch.

## Browser verification

- 10 consecutive center drops: stable vertical pile, valid same-level merges, score advanced from 0 to 36.
- 10 additional alternating left/center/right drops: stable distributed pile, score advanced to 89.
- Fruits settled on the visible floor without half-body burial, tunneling or explosive separation.
- Pause/resume and current/next fruit state remained functional.
- Fresh console check: no runtime errors or warnings.

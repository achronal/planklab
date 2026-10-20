# PlankLab — floor layout planner

A single self-contained browser app for planning flooring layouts.

**Live app: <https://achronal.github.io/planklab/>** — or open
`index.html` in any modern browser (double-click it — no server, no
build step, no network needed). Work autosaves to the browser's
local storage; use Export/Import JSON in the header to move a project
between machines.

Found a bug or have an idea? Please
[open an issue](https://github.com/achronal/planklab/issues).

## Workflow

1. **Room** — draw the closed outline (and holes/islands) by clicking
   vertices. Drag vertices (they snap level/plumb), type exact
   coordinates, click an edge to set its length exactly, use the
   Level/Plumb buttons to align adjacent vertices. The corner angle
   is drawn and read out while a vertex is selected. Lock the room
   when done: it becomes non-editable and click-through.
2. **Pattern & material** — Linear (1–5 lengths, one width, optional
   stock limit per length), Herringbone, Double Herringbone
   (length ≥ 2 × width), Chevron (width + tip-to-tip length, one
   mitre angle for the whole pattern). Units toggle between decimal
   inches and mm at any time.
3. **Fill** — offset X/Y and rotation update everything live, or hit
   **Optimize offsets to minimize waste** to search one plank-length
   span around the current offsets for the fewest planks to buy, then
   fine-tune by hand. Linear adds a layout rule (random lengths with
   seeded re-roll, random offset, brick ½, stagger ⅓) and a
   length-mix distribution.
4. **Results** — pieces needing a cut show orange cut edges; pieces
   under the configurable % threshold turn red. Every piece carries
   its source-plank number, centred on the visible part; pieces cut
   from one shared plank are numbered 12A, 12B, … "Cut from" counts
   already reuse offcuts optimally (see below). Click any cut piece
   for its cut guide: all pieces from that source plank drawn inside
   one fresh plank outline, with each cut numbered and given as
   miter-saw measurements from the datum end (distance along/across
   plus blade angle from square). For herringbone and chevron, left-
   and right-handed planks are usually sold in pairs, so by default
   the planner (and its offset optimizer) counts equal numbers of
   each hand; untick "sold in pairs" in Fill settings if your
   supplier sells them separately.

## How offcut reuse works

Every cut piece is computed as an exact polygon in its plank's own
coordinate frame, so the app knows which original edges (tongues and
grooves) each piece retains. The optimizer packs pieces back into
stock planks of the same shape **and hand** — a left herringbone or
chevron piece is never cut from right-handed stock, and a piece may
only sit in stock where its retained edges land on the matching
stock edges. A sacrificial saw kerf (default 3 mm, configurable) is
charged between pieces sharing a plank; re-trimming an already-cut
edge is free, so exactly one kerf is charged per separation. Results
show a proven lower bound next to the achieved count and say
"optimal" when they match.

## Architecture (inside `index.html`)

- **Data layer** — project state (all lengths stored in mm), unit
  formatting/parsing, local-storage autosave, JSON import/export.
- **Control layer** — geometry kernel (validation, triangulation with
  holes, convex clipping), the pattern registry, the fill engine
  (clipping in plank-local coordinates), and the cut optimizer.
- **UI layer** — SVG canvas with pan/zoom, vertex/edge editors,
  material/fill panels, results and cut-plan list. It computes
  nothing itself.

Adding a pattern = one new entry in `PATTERNS` (a `buildPools`
material definition plus a `generate` placement field); clipping,
counting, labelling, and cut optimization work unchanged.

Headless checks (geometry, fill counts, offset optimizer) run with
`node tests/check.js`. The optimizer's attempt cap and survivor count
are the `OPTIMIZER` constants near the top of the control layer —
easy to hand-tune, deliberately not shown in the UI.

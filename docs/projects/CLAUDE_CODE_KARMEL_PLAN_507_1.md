# BuildCheck Instruction Package — Project: כרמל (תכנית 507/1)

**Files in this project**
- תקנון: `תקנון_507-1.pdf` (תכנית מפורטת 507/1 — שינוי ל-507 ול-RJ-5, לישוב כרמל)
- בקשת היתר: `הערות_-_24_11__1_.dxf`

**Prepared by:** Analyst-read, hand-curated. No rule-extraction engine was used. Every requirement below was read directly from the תקנון by a human analyst. The app's only job is to take these instructions, hand them to the per-domain agents, and run them against the DXF.

**Important context about this specific DXF:**
This is **not a new-build** — the plan shows an addition/renovation to an existing structure. The DXF text contains labels like `הריסת חלון` (window demolition), `סגירת חלון` (window closure), `פתיחת דלת` (door opening), `קיר קיים להריסה` (existing wall for demolition), and `הגדלת חלון` (window enlargement). Some rules that apply to new construction (e.g. full built-area limits) must be interpreted as **delta from existing**, not absolute totals. Per תקנון פרק ד' §1.ו: existing buildings that were legal at plan approval and do not match the new rules are NOT considered חריגה — only NEW additions are checked against the new rule set.

---

## PART 1 — Project identification

### 1.1 Information the user must provide before analysis

Because this DXF does not embed lot/project metadata, the user must fill these fields in the project form:

| Field | Where it comes from | Example value for כרמל |
|---|---|---|
| תכנית חלה | User input | `507/1` |
| Lot number | User input (from title block or permit request form — NOT in DXF) | *(to be filled)* |
| Zoning | Derived from lot position in תקנון §2.7 table | likely `מגורים א'` (most of the residential allocation in this plan) |
| Expected lot area | Derived from zoning + user confirmation | **~500 m² average** (per תקנון פרק ד' §1.א: "שטח זה מיועד לבתים חד משפחתיים על מגרשי בנייה בשטח ממוצע של 500 מ"ר") |
| Build type | User input | `תוספת/שיפוץ למבנה קיים` (addition/renovation — NOT new build) |

### 1.2 Facts the analyst derived from the DXF

The app should display these as "detected" for the user to confirm before running analysis:

| Fact | Value | Source |
|---|---|---|
| DXF version | AC1009 / R12 | file header |
| Encoding | Hebrew as `\U+XXXX` native escapes (not SHX-Latin) | decode by regex on TEXT entities |
| Layer count | **2** (all geometry on layer "0") | `doc.layers` — **pair-by-layer-name will fail for this file** |
| Viewport blocks | 34 total, ~22 with meaningful text | enumerated VIEWPORT blocks |
| Absolute grade range | **612.18 – 618.47 m** (range 6.29 m) | scanned TEXT in VP6 / VP22 |
| Reference datum ±0.00 | approximately **613.68** (inferred from +/- offset against absolute) | common anchor where 0.00 maps to absolute |
| Building ridge height | **+6.79** (above ±0.00) | max relative elevation in VP20/VP22 |
| Plinth (מסד) height | **+1.48 / +1.49 / +1.50** | consistent tight cluster |
| Roof slab level | **+5.46 / +5.66 / +5.85 / +5.96** | concentrated near roof |
| Terrain drop across site | ~6.3 m from 612.18 to 618.47 | topographic survey |
| Has pitched roof | **Yes** (max +6.79 > roof slab +5.96 by ~0.8–1.3 m = ridge) | implied from relative elevation distribution |

### 1.3 Sheet map (derived from VIEWPORT34 index)

The index page explicitly lists these sheets. The app should use this map, not guess:

| # | Hebrew name | Scale | Most likely VP | Purpose |
|---|---|---|---|---|
| 1 | תרשים סביביה ללא קנ"מ | — | VP1/VP2 | Neighborhood schematic |
| 2 | מדידה | 1:250 | VP3 | Survey |
| 3 | תוכנית העמדה | 1:100 | VP4/VP6 | Site plan |
| 4 | תוכנית פיתוח | 1:100 | VP5 | Development plan |
| 5 | קומה א | 1:100 | VP20 (annotated) + geometry pair | Upper floor plan |
| 6 | קרקע | 1:100 | VP19 (annotated) + geometry pair | Ground floor |
| 7 | תוכנית גג | 1:100 | VP23 (annotated) + geometry pair | Roof plan |
| 8 | חישוב שטחים | 1:100 | VP7 or adjacent | Area calculation sheet |
| 9 | חזית צפונית | 1:100 | VP25 (annotated) | North facade |
| 10 | חזית דרומית | 1:100 | VP26 | South facade |
| 11 | חזית מזרחית | 1:100 | VP27 | East facade |
| 12 | חזית מערבית | 1:100 | VP28 | West facade |
| 13 | חתך 1-1 | 1:100 | VP21 (annotated) | Section 1-1 |
| 14 | חתך 2-2 | 1:100 | VP22 (annotated) | Section 2-2 |
| 15 | חתך 3-3 | 1:100 | VP29 or VP30 | Section 3-3 |
| 16 | חתך 4-4 | 1:100 | VP30 or VP31 | Section 4-4 |
| 17 | נספח חנייה | 1:50 | VP14/VP24 | Parking annex |
| 18 | חתך חנייה | 1:50 | VP15 | Parking section |
| 19 | גג חנייה | 1:100 | VP16 | Parking roof |

Note: for sheets 9–19 the viewport-pair discovery is best done visually. For compliance agents, what matters is whether the **content** (elevations, dimensions, setbacks, room labels) is accessible — which it is, across VP19/VP20/VP21/VP22/VP23/VP25.

---

## PART 2 — Master rule set for תכנית 507/1, אזור מגורים א'

All rules below are read directly from תקנון 507/1. Each is tagged with its section reference. This project is in **אזור מגורים א'** (residential zone A), so only those rules apply. Rules for מוסד, מרכז אזורי, מלאכה ותעשייה, מתקני ספורט, חורשה etc. are excluded.

### 2.1 Lot & zoning

- **RULE_LOT_AREA**
  Source: §פרק ד' §1.א כללי.
  Expected average lot area in this zone: **~500 m²**.
  Check: the measured closed boundary polygon in the site plan (VP4/VP6) must have an area within ±20% of 500 m² (i.e. 400–600 m²). Wider tolerance than בית יתיר because 507/1 states average, not exact-per-lot.
  Verdict: PASS if in range. WARNING if slightly outside (300–400 or 600–700). FAIL if far outside. CANNOT_CHECK if no closed boundary polygon found.
  Note: since this DXF has all geometry on layer "0", the boundary detection must rely on *closed polyline with largest area* rather than layer-name match.

### 2.2 Building footprint & coverage (Zone A)

- **RULE_COVERAGE_MAX**
  Source: §פרק ד' §1.4 שטח בנייה מותר.
  **Max built area: 35% of lot area, total ≤ 250 m² across both floors.**
  For a 500 m² lot: 500 × 0.35 = 175 m² coverage cap, overridden by the absolute 250 m² across 2 floors.
  Check: measure ground-floor footprint + second-floor footprint from floor plans (VP19 ground + VP20 upper).
  Verdict: PASS if ground footprint × coverage ≤ 35% of lot AND total ≤ 250 m². FAIL if either exceeded. CANNOT_CHECK if footprint cannot be measured as a closed polygon.
  **Existing-building carve-out:** the portion already legal at plan approval does not count as חריגה even if coverage is now exceeded. Agent should attempt to distinguish existing from new (layer labels `קיר קיים להריסה` → existing perimeter; rest → new).

- **RULE_MARTEF_AREA** (basement)
  Source: §פרק ד' §1.4.
  מרתף up to **80 m²** is allowed within the building lines and **does not count** toward the 250 m² total.
  Check: if a basement appears on sections (VP21/VP22) as a floor below ±0.00, measure its plan area.
  Verdict: PASS if ≤ 80 m². FAIL if > 80 m². NOT_APPLICABLE if no basement present.

### 2.3 Floors & height

- **RULE_FLOORS_MAX**
  Source: §פרק ד' §1.5 and §פרק ד' §1.7 קומת מסד/עמודים מפולשת.
  **Max 2 floors**, not counting: קומת מסד, קומת עמודים מפולשת, חלל גג רעפים, עליית גג, מרתף.
  Check: count distinct floor levels shown in sections (VP21/VP22). The DXF shows +0.00 and a second level around +2.55/+2.85/+3.00/+3.10 — this is 2 floors.
  Verdict: PASS if ≤ 2 above-grade floors. FAIL if ≥ 3.

- **RULE_HEIGHT_MAX_FLAT_ROOF**
  Source: §פרק ד' §1.5.
  **2 floors with flat roof + parapet: max 7.5 m** (measured from lowest natural grade at building perimeter to top of parapet).

- **RULE_HEIGHT_MAX_PITCHED_ROOF**
  Source: §פרק ד' §1.5.
  **2 floors with pitched roof: max 9.0 m** (from lowest grade to ridge). **Pitched-roof slope max 30°** (§1.5.1).
  This DXF shows a pitched roof (ridge at +6.79, roof slab around +5.85-5.96 — ridge is 0.8-1.0 m above slab, consistent with pitched). Apply **9.0 m** cap.
  Check: lowest grade at building perimeter from survey (VP6 terrain elevations 612.18–618.35). If ±0.00 = 613.68, then max allowed absolute elevation at ridge = lowest grade + 9.0 m. Measured absolute ridge elevation = 613.68 + 6.79 = **620.47 m**. Need to confirm against lowest perimeter grade.
  Verdict: PASS if (ridge_absolute_elevation − lowest_perimeter_grade) ≤ 9.0 m. FAIL if > 9.0 m.
  **Expected measurement flow:** find survey points on or within 1 m of the building footprint polygon, take the minimum; compute difference to ridge.

- **RULE_HEIGHT_ROOF_EXIT**
  Source: §פרק ד' §1.5.
  **Roof with roof-exit structure (מבנה יציאה לגג): max total 8.5 m.**
  Only apply if a separate roof-exit structure is drawn (small box on roof plan in VP23).

- **RULE_PARAPET_HEIGHT**
  Source: §פרק ד' §1.5 + §20 (הגדרות מעקה גג).
  Parapet with koofing: min **0.90 m**, max **1.40 m**. Standalone parapet from roof surface: max **1.05 m**.
  Check: compare the roof slab level (+5.85/+5.96) to top-of-parapet on the facade sheets.

- **RULE_PITCHED_ROOF_SLOPE**
  Source: §פרק ד' §1.5.1.
  Pitched roof slope **must not exceed 30°**.
  Not directly measurable from DXF 2D plans. Report as INFORMATIONAL unless explicit slope annotation is found.

### 2.4 Floor elevation vs natural grade

- **RULE_FLOOR_TO_GRADE**
  Source: §פרק ד' §1.6.
  Ground-floor slab elevation must be "matched to natural grade to the engineer's satisfaction." Hard numbers:
    - In the low portion of the lot: floor is **≤ 1.5 m above** lowest natural grade.
    - In the high portion: floor is **≤ 0.5 m above** highest natural grade.
  Check: ±0.00 ≈ 613.68. Lot grade range 612.18–618.47 (but only grades near the building matter). Report:
    - floor-to-lowest-near-building = 613.68 − {min grade under building} — must be ≤ 1.5 m (with ≤ 0 meaning floor is below grade, which would be unusual).
    - floor-to-highest-near-building = {max grade under building} − 613.68 — must be ≤ 0.5 m... wait, re-read: "בחלק הגבוה של המגרש לא יעלה על 0.5 מ' מהקרקע הטבעית הגבוהה בו."
    Correct reading: in the high part of the lot, the floor sits ≤ 0.5 m ABOVE the highest natural grade there.
  Verdict: PASS if both conditions hold. FAIL if either exceeded. CANNOT_CHECK if building footprint cannot be projected onto survey grades.

### 2.5 קומת מסד / עמודים מפולשת (pilotis / plinth floor)

- **RULE_MASD_HEIGHT**
  Source: §פרק ד' §1.7.
  If the slope-vs-floor difference in §1.6 creates a space between the underside of the ground-floor slab and the natural grade that cannot fit within §1.6: a קומת מסד is formed. Its **max height: 1.5 m** at the lowest point, increasing to 2.2 m max where a filling/supporting wall is built. If the height exceeds 2.2 m, the ceiling + wall must have openings/windows (pilotis).
  Check: the DXF's plinth level is consistently +1.48 / +1.49 / +1.50 — **exactly at the 1.5 m limit**, which is tight but not a violation.
  Verdict: PASS if מסד height ≤ 1.5 m at lowest point. WARNING if 1.5 ± 0.05. FAIL if > 1.5 m and the space is sealed (no pilotis).

### 2.6 קווי בניין (setbacks) — Zone A

- **RULE_SETBACK_FRONT**
  Source: §פרק ד' §1.1.
  **Front setback: 4.0 m minimum.**
  Check: measure from front lot boundary (road-facing side) to nearest wall of main building. The DXF labels `כניסה למגרש` and `רחוב` — use those to identify the front.
  Verdict: PASS if ≥ 4.0 m. FAIL if < 4.0 m.

- **RULE_SETBACK_SIDE**
  Source: §פרק ד' §1.1.
  **Side setback: 3.0 m.**
  Verdict: PASS if ≥ 3.0 m on both sides. FAIL if < 3.0 m on either.

- **RULE_SETBACK_REAR**
  Source: §פרק ד' §1.1.
  **Rear setback: 3.0 m.**
  Verdict: PASS if ≥ 3.0 m. FAIL if < 3.0 m.

### 2.7 מבני עזר (auxiliary buildings) — Zone A

- **RULE_AUX_TOTAL_AREA**
  Source: §פרק ד' §1.3.
  Auxiliary structure: **max 40 m² total** on the lot, combining parking slots + storage (מחסן) into one unit.
  Check: identify aux structures in the plan (labeled `חנייה מקורה`, `מחסן`, `פרגולה מאלומיניום`, etc.) and sum their footprints.
  Verdict: PASS if total aux ≤ 40 m². FAIL if > 40 m².

- **RULE_AUX_SETBACKS**
  Source: §פרק ד' §1.3.
  Aux building setbacks: **side and rear = 0.0 m** allowed (can be on the boundary). **Front = 0.0 m normally, or 1.0 m if the committee grants relief**. Roof drainage + aux openings must NOT face the neighbor's lot.
  Verdict: PASS if aux sits within these relaxed limits. FAIL only if aux crosses the boundary outright.

### 2.8 Parking

- **RULE_PARKING_COUNT_ZONE_A**
  Source: §פרק ט' §3 חניות.
  **Zone A: 2 parking spots inside the lot per dwelling unit.**
  Check: count parking bays inside the lot boundary. The DXF explicitly labels `חנייה מקורה` (covered parking) in VP19/VP22 — so at least one covered spot exists. Look for a second bay (may be uncovered).
  Verdict: PASS if ≥ 2 on-lot bays. FAIL if < 2.

- **RULE_PARKING_IN_LOT**
  Source: §פרק ט' §3.
  Parking must be **inside the lot**. The spot near `כניסה למגרש` (entrance to lot) must still be within the lot boundary.

### 2.9 Facade finish

- **RULE_FACADE_FINISH**
  Source: §פרק ד' §1.8.1.
  Acceptable finishes: **plaster (טיח) — rough-cast (שליכט) or smooth (התזה), natural stone, quarry-sawn stone, fired brick, or silicate brick.** Wood allowed for timber buildings only.
  The DXF labels `בגמר שליכט צבעוני` and `גמר שליכט צבעוני` in VP25 — this is colored rough-cast plaster. **PASS** per §1.8.1.
  Verdict: PASS if the labeled finish matches the allowed list. FAIL if an unlisted finish is labeled (e.g. drywall, vinyl, metal panel).

- **RULE_FACADE_UNIFORMITY**
  Source: §פרק ד' §1.8.2.
  All facades of the building must share the same finish, roof shape, and landscape treatment, across neighbors per committee decision.
  Verdict: PASS if all four facade sheets (VP25/26/27/28) label the same finish. FAIL if different finishes on different facades.

- **RULE_ROOF_APPEARANCE**
  Source: §פרק ד' §1.8.3.
  Roof must not be visually disruptive when viewed from higher neighbors. Covering must be **stone, tile, river-stone, concrete ribbon** — not asphalt, and not "unspecified material."
  For pitched roof (§1.9.1): **solar water heater + collectors must be placed within the slope of the roof**, attached to the ridge, with committee approval for each installation.
  Information-level check — depends on visual inspection of VP23 (roof plan).

- **RULE_AUX_FINISH**
  Source: §פרק ד' §1.8.4.
  Aux structures must have **the same finish as the main building**, no exception without committee approval.
  The aux roof material also matches the main building, and its height ≤ **2.5 m**.

### 2.10 Solar & laundry

- **RULE_SOLAR_HEATER**
  Source: §פרק ד' §1.9.
  Solar water heater must use an architect-designed concealment (hider). Hidden in roof cavity on pitched roof. Solar array must not extend past the roof plane.

- **RULE_LAUNDRY_DRYING**
  Source: §פרק ד' §1.10.1.
  Laundry drying must be inside the building with a light screen, or in an enclosed element approved by the committee. **No standalone laundry structure may be built** (§1.10.2).
  The DXF labels `כביסה` as an interior room in the floor plans — compliant.

### 2.11 Fences (גדרות)

- **RULE_FENCE_HEIGHT**
  Source: §פרק ו' §1.5.
  Natural stone fence: max **0.90 m** above natural grade at its highest point. Above it: transparent/metal grill is allowed.
  Check: if a fence/גדר is drawn in the DXF plan, extract height from the relevant section sheet.

- **RULE_RETAINING_WALL**
  Source: §פרק ו' §1.2.
  Retaining wall: **max 0.90 m from natural grade on any single face**, **max 2.5 m total** at any single point (when combined with terrain). Above 2.5 m requires step-back walls ≥ 1 m between levels.
  Check: measure retaining walls in sections (VP21/VP22).

- **RULE_FENCE_ENTRY**
  Source: §פרק ו' §1.6.
  Entry gate material = fence material (measured width).

### 2.12 Water / drainage / sewage

- **RULE_DRAINAGE_PLAN_PRESENT**
  Source: §פרק ז' §1 & §3.
  Committee will **require a detailed cleaning / drainage / runoff / sewage solution** before issuing a building permit. Each lot's water, sewage, and runoff must not damage neighboring lots.
  Check: VP5 (תוכנית פיתוח) must contain entities/labels for ניקוז / ביוב / מים / תיעול.
  Verdict: PASS if such entities are present. CANNOT_CHECK otherwise.

- **RULE_SEWAGE_CONNECTED**
  Source: §פרק ז' §4.
  All buildings must be connected to an approved sewage system.

- **RULE_PERMEABLE_SURFACE**
  Source: §פרק ז' §9.
  **30%–10% of lot area must remain permeable** (stone, dolomite, pavers with joints). 100% paving not allowed.
  Check: compute impermeable surface from the site plan and divide by lot area.
  Verdict: PASS if 10% ≤ (permeable area / lot area) ≤ 100%. FAIL if fully paved.
  Note: §פרק ז' §9 tolerance: 30%-10% range is the guidance band; the hard minimum is 10%.

### 2.13 Electrical, telecom

- **RULE_UTILITIES_UNDERGROUND**
  Source: §פרק ז' §7.
  All electrical & telecom infrastructure **must be underground**, except high-voltage transmission lines.
  Check: look for overhead-line labels. If any are present in VP5, flag.

- **RULE_ELECTRIC_CLEARANCES**
  Source: §פרק ט' §1.
  Distance from electric lines (required clearances):

  | Line type | Edge-of-building distance | Line centerline distance |
  |---|---|---|
  | Low voltage (≤400V) | 2.00 m | 2.25 m |
  | Medium voltage (≤33kV) — built area | 5.00 m | 6.50 m |
  | Medium voltage (≤33kV) — open area | 12.00 m | 8.75 m |
  | High voltage (110-150kV) — built area | 9.00 m | 12.50 m |
  | High voltage (110-150kV) — open area | 12.00 m | 18.50 m |
  | Up to 400kV | 14.00 m | 22.50 m |

  Not auto-checkable unless power lines are drawn in the DXF. Report only if an electric-line marker is present.

- **RULE_SINGLE_ANTENNA**
  Source: §פרק ז' §8.
  Only **one TV/radio antenna** per building.

### 2.14 Safety & gas

- **RULE_FIRE_APPROVAL**
  Source: §פרק ה' §1.4.
  Permit requires coordination with Fire Services for the specific application.
  For a single-family residential addition: the fire agent typically returns "coordination required but not a hard measurable rule — defer to fire services."

- **RULE_GAS_INSTALLATION**
  Source: §פרק ט' §7.
  All gas installations must comply with Israeli gas safety standards.
  Not auto-checkable from DXF.

### 2.15 Demolitions (specific to this file)

- **RULE_DEMOLITION_DECLARED**
  Source: §פרק ד' §16 מבנים להריסה.
  Buildings marked for demolition in the תשריט (yellow border) **must actually be demolished before/during the permit process**.
  This DXF has multiple `הריסה` labels — agent should list them and note "declared demolitions present; permit approval is conditional on their execution."

### 2.16 Defined vs. undefined uses

- **RULE_USE_NOT_LISTED**
  Source: §פרק ד' §כללי §א.
  Any use NOT listed in the use table is automatically **forbidden** unless the committee rules otherwise.
  For a residential permit this is usually not an issue, but if the plan shows any commercial/office use, flag it.

---

## PART 3 — Per-agent instruction bundles

### 3.1 Agent: structure / core-compliance

Rules to check:
- RULE_LOT_AREA
- RULE_COVERAGE_MAX
- RULE_MARTEF_AREA
- RULE_FLOORS_MAX
- RULE_HEIGHT_MAX_FLAT_ROOF (skip — this project has pitched roof)
- RULE_HEIGHT_MAX_PITCHED_ROOF
- RULE_HEIGHT_ROOF_EXIT
- RULE_PARAPET_HEIGHT
- RULE_PITCHED_ROOF_SLOPE
- RULE_FLOOR_TO_GRADE
- RULE_MASD_HEIGHT
- RULE_SETBACK_FRONT
- RULE_SETBACK_SIDE
- RULE_SETBACK_REAR
- RULE_AUX_TOTAL_AREA
- RULE_AUX_SETBACKS
- RULE_RETAINING_WALL
- RULE_DEMOLITION_DECLARED

Primary sheets: VP3 (survey), VP5/VP6 (site), VP19+VP20 (floor plans), VP21+VP22 (sections), VP23 (roof), VP25–28 (facades).

### 3.2 Agent: parking

Rules to check:
- RULE_PARKING_COUNT_ZONE_A
- RULE_PARKING_IN_LOT

Primary sheets: VP14 + VP15 + VP16 (parking annex/section/roof), VP19 (ground plan showing bays).

### 3.3 Agent: accessibility

Rules to check: *(תקנון 507/1 does not specify accessibility standards for residential. It defers to general תקן 1918 / חוק התכנון והבנייה.)*
Return: `status="NOT_IN_SCOPE"`, reason="תקנון 507/1 defers accessibility to תקן 1918 for public buildings only; residential single-family accessibility not regulated in this document."

### 3.4 Agent: fire

Rules to check:
- RULE_FIRE_APPROVAL

For a 2-floor single-family residence with addition: return "coordination with Fire Services required per §פרק ה' §1.4. Specific measurable checks: none in this תקנון." Do NOT return CANNOT_CHECK — return INFORMATIONAL with the above note.

### 3.5 Agent: water / drainage / sewage

Rules to check:
- RULE_DRAINAGE_PLAN_PRESENT
- RULE_SEWAGE_CONNECTED
- RULE_PERMEABLE_SURFACE

Primary sheets: VP5 (development plan).

### 3.6 Agent: electricity

Rules to check:
- RULE_UTILITIES_UNDERGROUND
- RULE_ELECTRIC_CLEARANCES
- RULE_SINGLE_ANTENNA

Primary sheets: VP5.

### 3.7 Agent: facade / finishes / roof

Rules to check:
- RULE_FACADE_FINISH
- RULE_FACADE_UNIFORMITY
- RULE_ROOF_APPEARANCE
- RULE_AUX_FINISH
- RULE_SOLAR_HEATER
- RULE_LAUNDRY_DRYING
- RULE_FENCE_HEIGHT
- RULE_FENCE_ENTRY

Primary sheets: VP23 (roof), VP25–28 (facades), VP19/VP20 (for laundry-room labels).

### 3.8 Agent: environmental / landscape

Rules to check:
- RULE_PERMEABLE_SURFACE
- Landscape reference to §פרק ו' §1.7 (מסלעות with plant covering) if present.

Return informational for this zone — most environmental rules in 507/1 are for industrial/commercial areas, not residential.

### 3.9 Agent: use-compliance

Rules to check:
- RULE_USE_NOT_LISTED

If all rooms in VP19/VP20 are labeled with residential uses (דיור, הורים, שינה, מטבח, אוכל, אמבטיה, כביסה, עבודה, ממד) → PASS.
If any room is labeled for commercial use (משרד, חנות, מסחר) → FAIL and flag for specific committee approval.

---

## PART 4 — Verdict schema

Identical to בית יתיר package. Every rule returns:

```json
{
  "rule_id": "RULE_SETBACK_FRONT",
  "section_ref": "§פרק ד' §1.1",
  "check_description": "Front setback ≥ 4.0 m from lot boundary to building line",
  "measured_value": 4.35,
  "measured_unit": "m",
  "expected": "≥ 4.0",
  "verdict": "PASS",
  "source_sheet": "VP19 + VP4",
  "source_viewport_entities": ["closed polyline largest-area in VP4; nearest wall in VP19"],
  "notes": "Front identified by כניסה למגרש label pointing to the north edge."
}
```

Allowed verdicts: `PASS`, `FAIL`, `WARNING`, `CANNOT_CHECK`, `NOT_APPLICABLE`, `NOT_IN_SCOPE`, `INFORMATIONAL`.

---

## PART 5 — Differences vs. the בית יתיר package

The agents and app code stay the same. The rule contents differ:

| Rule area | בית יתיר (506/1) | כרמל (507/1) |
|---|---|---|
| Avg lot area | 481 m² (exact from table) | ~500 m² (average, wider tolerance) |
| Coverage | 250 m² absolute (single fam) | **35% OR 250 m²** (whichever lower) |
| Front setback | 5.0 m | **4.0 m** |
| Side/rear | 3.0 m | 3.0 m |
| Flat roof max | 8.0 m | **7.5 m** |
| Pitched roof max | 9.5 m | **9.0 m** |
| Pitched slope cap | not specified | **max 30°** |
| Floor-to-grade | soft (engineer approval) | **hard: ≤1.5 m low / ≤0.5 m high** |
| Aux building area | 30 m² (cover) + 8 m² (storage) | **combined 40 m² total** |
| Aux setbacks | 0.0 side/rear, standard front | **0.0 all sides with relaxed front** |
| Parking | 2 on-lot + 0.3 on-road | **2 on-lot only** |
| Permeable surface | not specified | **10–30% mandatory** |
| Facade finish | stone-focused | **plaster allowed by default (שליכט)** |

These differences are **why** you can't have one generic ruleset. Each project needs this kind of hand-curated file.

---

## PART 6 — Wiring notes

Same as the בית יתיר package — the app is a thin executor. Paste this entire markdown into the project's `ruleInstructions` field (or upload as `instructions.md` if the app supports file-attached instructions).

**Two new handling notes specific to this DXF:**

1. **Hebrew encoding is `\U+XXXX` native escapes, NOT SHX-Latin.** The DXF extractor must decode `\U+05D7\U+05EA\U+05DA` → `חתך` using the regex `\\U\+([0-9A-Fa-f]{4})` on every TEXT/MTEXT value. If it's already doing this: great. If not: decoding fails silently and all the agents will see garbage.
2. **Layer-based heuristics WILL NOT WORK on this file.** All 2 layers are `0` (defpoints and everything else). The boundary detector must use `largest-closed-polygon` fallback, not `polyline on layer containing gvul|boundary|mag`. Add a safety net: if no layer-name match succeeds and exactly one closed polygon has area > 200 m² and aspect ratio < 5:1, accept it as the lot boundary.

---

## PART 7 — Pre-run checklist for כרמל

- [ ] Both files (תקנון 507/1 + DXF) uploaded to the project.
- [ ] This instruction file pasted into the project's `ruleInstructions` field.
- [ ] User has entered the lot number manually (**not in the DXF**).
- [ ] Zoning confirmed as `מגורים א'`.
- [ ] Build type set to `תוספת/שיפוץ למבנה קיים` (so existing-building carve-out rule applies).
- [ ] DXF encoding confirmed as Unicode-escape Hebrew (`\U+XXXX`) — extractor must decode.
- [ ] Boundary-detection fallback enabled (since layer-name matching fails).
- [ ] Agents to run: structure, parking, water, electricity, facade, use-compliance. Skip accessibility (NOT_IN_SCOPE) and fire (INFORMATIONAL only).

Expected verdicts on a clean submission:
- Lot area, coverage, setbacks, floors, pitched-roof height, plinth, permeable surface: measurable → PASS/FAIL.
- Facade finish, roof appearance, laundry drying: label-match → likely PASS (this file declares `שליכט צבעוני` and internal `כביסה` which both comply).
- Fire, environmental, gas: INFORMATIONAL — requires external coordination.
- Demolition rule: FLAG — multiple `הריסה` labels present, inform user the permit is conditional on their execution.

---

*End of instruction package — כרמל / תכנית 507/1.*

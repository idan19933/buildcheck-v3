# BuildCheck AI — Project Setup Instructions: בית יתיר (לוט 177)

**Project codename:** `beit-yatir-lot-177`
**Statutory plan:** 506/1 — מצדות יהודה (בית יתיר), amending RJ-5 / 506
**Scope of this document:** How to set up **this specific project** inside BuildCheck AI before running an analysis. No app changes, no pipeline changes. This is a pre-analysis configuration guide that the operator (or Claude Code) follows per-project.

---

## 1. Project metadata (what to fill in when creating the analysis)

| Field | Value |
|---|---|
| Project name | בית יתיר — מגרש 177 |
| Plan number | 506/1 |
| Parent plan | שינוי לתכנית מתאר אזורית RJ-5 / שינוי לתכנית מתאר מפורטת 506 |
| Locality | מצדות יהודה (בית יתיר) |
| מרחב תכנון | הוועדה המיוחדת לתכנון ולבנייה הר חברון |
| Gush | פיסקאלי 1, 2, 4 (partial — project sits in גוש פיסקאלי 2) |
| Plot area | 487 sqm (from תקנון table 2.7, lot 177) |
| Zoning | אזור מגורים א' (Residential A, yellow on תשריט) |
| Plan-approved date | 08.01.2019 |
| Total plan area | 396 dunam |
| Total permitted units in plan | 258 dwelling units |

---

## 2. Agent selection for this project

Before clicking "Analyze," enable **exactly these agents**. The rest are not applicable to a מגורים א' single-lot permit under plan 506/1.

### Enable
- [x] **Structure (קונסטרוקציה)** — heights, floors, roof, parapet rules
- [x] **Parking (חניה)** — based on plan §13 + טבלת חניות §1
- [x] **Accessibility (נגישות)** — תקן 1918 (referenced in §4.2)
- [x] **Drainage (ניקוז וביוב)** — §פרק ז', ניקוז and ביוב
- [x] **Water supply (מים)** — §פרק ז', אספקת מים; §בנייה משמרת מים
- [x] **Electricity (חשמל)** — §1.7 חברת החשמל + §8 איסור בנייה בקרבת מתקני חשמל
- [x] **Fire safety (בטיחות אש)** — §1.6 שירותי כבאות (only required for >4 floors or >24 units — **does not apply to single villa** but keep on for the cooking-gas / עירוני checks)

### Disable
- [ ] HVAC — not addressed in plan 506/1 beyond standard pקמ"ז (general codes); no project-specific rules
- [ ] Don't create any "auxiliary" agents. All domains above are sufficient.

**Estimated analysis cost with these 7 agents:** ~$0.75 (parallel execution)

---

## 3. Per-agent instructions

Each agent gets a scoped instruction block derived directly from תקנון 506/1. Copy these verbatim into the agent's "project-specific rules" field during setup. These are the rules the agent will check against — no external regulation fetching, no RAG.

---

### 3.1 Structure agent — עיקרי קונסטרוקציה

**Zone context:** Lot 177 falls in אזור מגורים א' (§2 of תקנון).

**Rules to check against the DXF:**

1. **Lot area:** Target lot per table 2.7 = **487 sqm**. The DXF must show a boundary polygon with area between 470 and 505 sqm (±4% tolerance for survey drift).
2. **Unit count:** §2.2 — max 1 יח"ד on בית חד-משפחתי, max 2 יח"ד on בית דו-משפחתי. Check DXF for number of distinct dwelling-unit envelopes.
3. **Main area cap:** §2.2.א — בית חד-משפחתי: up to 250 sqm (עיקרי). **DXF target: 125.05 sqm — well under.**
4. **Service area cap:** §2.2.א — up to 180 sqm שירות across ground + 80 sqm roof-level. **DXF target: 13.05 sqm (after ממ"ד deduction) — well under.**
5. **Max floor count (floors above grade):** §2.3 — max 2 floors, **not counting** מרתף, חלל גג/עליית גג רעפים, or roof-exit structure. **DXF target: 2 floors (±0.00 and +2.85) — compliant.**
6. **Max building height:** §2.4 —
   - Flat roof with parapet: max **8.0 m** (including parapet).
   - Pitched-tile roof (גג רעפים): max building-at-roof-face **9.5 m**.
   - **DXF target: +4.60 m relative (parapet) → compliant for flat roof.**
7. **Roof-exit structure (יציאה לגג):** §2.4 — height from roof floor: max 2.5 m (ברוטו), footprint: max 15 sqm. Does not count toward floor count or main area.
8. **מרתף (basement):** §12 definition — up to 2.50 m above terrain; see §2.2 for quantity. **Check DXF cross-sections for any underground level.**
9. **Setbacks (קווי בניין):** §2.5 main-building — must match:
   - **Front (קדמי) = 5.0 m**
   - **Rear (אחורי) = 3.0 m**
   - **Side (צדדי) = 3.0 m**
   - **DXF task: measure from each face of the building envelope to the corresponding lot edge. Cite the viewport the measurement came from.**
10. **Coverage (תכסית) cap:** Implicit in plan geometry (not explicitly stated for זון מגורים א' beyond main/service areas). Verify built footprint ≤ (250 main + 180 service)/lot_area.
11. **Architectural projections (הבלטות):** §2.5.ג — up to 75 cm beyond line, cantilevers, balconies, etc. Flag anything exceeding.
12. **Parapet (מעקה גג):** §14 definition — 1.05–1.40 m height from roof slab. Engineer can allow up to 1.80 m in special cases.
13. **פרגולות:** §5.6 — allowed over 40% of setback only, not in front setback, solid covering ≤ 20 sqm, height ≤ 3.0 m.

**What to flag:**
- Any dimension that violates one of the above numbers.
- Any unit/floor/height count mismatch.
- Any setback < the required minimum.

**What to skip (not in this plan's scope):**
- Structural-load calculations (out of scope of תקנון).
- Foundation details (checked by engineer on site, not by permit review).

---

### 3.2 Parking agent — חניה

**Applicable section:** §13 ("חניון") + טבלת חניות §1 in פרק ט.

**Rules to check against the DXF:**

1. **Parking ratio:** §1.א table —
   - **מגורים א' = 2 spaces within lot + 0.3 along public road (אורך חניונים).**
   - **Special residential (מגורים מיוחד) = 1.5 + 0.3.**
   - **מגורים ב' = 1.5 + 0.3.**
   - **For this single-family home on lot 177 (מגורים א'): target = 2 parking spaces on the lot.**
2. **Parking must be on-lot (§13.2):** not on public road, not on שצ"פ.
3. **Covered parking (חניה מקורה — §2.6 "מבני עזר"):**
   - Max 30 sqm per unit.
   - Height: max 2.20 m (gutter / low edge) and 2.50 m to roof peak.
   - Must include slope drainage back toward the lot, not toward the road.
   - Setback: front/side = **0.0 m** permitted (can hug front lot line), rear/side = **0.0 m** permitted (can hug rear lot line) *only* if designated on תשריט — otherwise standard setbacks apply.
4. **מחסן (storage) structure §2.6.ב:** up to 8 sqm per unit, separate structure, meeting same covered-parking setback rules. Count as auxiliary structure (מבנה עזר), not as parking.
5. **Parking access direction:** §13.5 — location to be coordinated with traffic inspector (פיקוח על התעבורה). Agent to flag if DXF shows access onto a road not shown as access-permitted on תשריט.

**What to flag:**
- Fewer than 2 on-lot spaces.
- Any covered parking exceeding 30 sqm, 2.20 m edge, or 2.50 m peak.
- Access directly to ring road without coordination note.

**Inputs from DXF to look for:**
- "חניה" or "חניון" Hebrew labels (in SHX Latin: `jbhv` / `jbhui`).
- Rectangle(s) typically 2.5 × 5.0 m or 2.75 × 5.5 m on the lot.
- Any block with a covered roof drawn over a parking rectangle.

---

### 3.3 Accessibility agent — נגישות

**Applicable section:** §4.2 יועץ נגישות (which defers to תקן 1918 and הוראות מת"ש).

**Rules to check:**

1. **Public / common areas (שטחים ציבוריים) accessibility:** not applicable to a single בית חד-משפחתי unless it's in a shared-access cluster. For lot 177 (single-family): **skip most public-accessibility rules**, but verify:
   - Access path from street to main entrance has max 5% slope (accessibility-friendly).
   - Any step up to main entrance ≤ 2 cm rise per step, or provide ramp.
2. **Entrance clear width:** verify entrance door is ≥ 0.80 m clear opening.
3. **Internal circulation:** not mandatory for single-family under תקנון, but good practice to flag any corridor < 1.10 m in the floor plan.

**What to flag:**
- Main entrance height differences from grade > 20 cm without visible ramp or stairs with compliant risers.
- Entrance door narrower than 0.80 m.
- Any public-building accessibility rule — **not applicable to this project, report as N/A, do not dilute score with "cannot check."**

---

### 3.4 Drainage agent — ניקוז וביוב

**Applicable sections:** §פרק ז' (1–6).

**Rules to check:**

1. **§3 ניקוז (drainage):** Project must include a drainage plan submitted with the permit application. The DXF cross-section should show:
   - Rainwater collection from roof (downspouts / מרזבים).
   - Drainage direction clearly oriented toward the front of the lot (toward road drainage), NOT toward adjacent lots.
2. **§4 ביוב וסילוק שפכים (sewage):** Must connect to local authority sewage system. Agent should verify DXF shows a sewage outlet on the lot.
3. **§9 בנייה משמרת מים (water-conserving construction):**
   - At least **30% of the lot area must be permeable surface** (gravel, grass, permeable paving) when surface materials are considered.
   - Relaxed to **10%** if surface is non-permeable (concrete/asphalt) provided water is channeled to seepage pits.
   - **DXF task:** compute ratio of built footprint + impermeable paving vs. lot area.
4. **Roof drainage** — flat roofs must have defined slope + at least 2 drainage points visible on roof plan.

**What to flag:**
- Impermeable coverage > 70% of lot (likely violates §9.a).
- No drainage route visible on cross-section.
- Drainage directed toward neighboring lots.

---

### 3.5 Water supply agent — אספקת מים

**Applicable sections:** §פרק ז' §1, §9 (with drainage) + §3.5 pipe diameters if detail sheets present.

**Rules to check:**

1. **Connection to local water authority:** agent to verify the permit package (DXF + supporting docs) shows a water-meter connection point.
2. **Water-conserving construction:** same §9 (see drainage agent 3.4).
3. **Pipe diameters:** if a plumbing detail sheet is present in the DXF — verify ≥ 3/4" for private connection, per standard detail sheets.

**What to flag:**
- No water meter / connection point shown.
- No permeable-surface ratio on the landscape plan.

**Note:** This agent overlaps with drainage §9 — split the permeable check into drainage; water agent focuses only on supply side.

---

### 3.6 Electricity agent — חשמל

**Applicable sections:** §1.7 חברת החשמל + §8 איסור בנייה בקרבת מתקני חשמל.

**Rules to check:**

1. **§1.7:** Coordination with Israel Electric Company required before building permit. Agent checks if DXF shows any existing overhead lines or ground-mounted poles — if yes, flag coordination requirement.
2. **§8 איסור בנייה בקרבת מתקני חשמל — distance table:**
   - **Low-voltage line, bare conductor:** 3.0 m from building
   - **Low-voltage line, insulated conductor attached to pole:** 2.0 m; attached to building: 0.3 m
   - **Medium-voltage (up to 33 kV), bare:** 5.0 m
   - **Medium-voltage (up to 33 kV), insulated air cable / כאי"מ:** 2.0 m
   - **High-voltage 110–161 kV:** 20.0 m (vertical clearance)
   - **High-voltage 400 kV:** 35.0 m
   - **Underground cables:**
     - LV underground cable (כבל מתח נמוך): 0.5 m
     - MV cable: 3.0 m
     - HV cable: coordination with electric company
     - Cabinet (ארון רשת): 1.0 m
     - שנאי על עמוד (pole-mounted transformer): 3.0 m

**What to flag:**
- Any building edge that falls within these distances from an electrical element visible on the תשריט.
- Missing electric-company coordination stamp (if DXF includes stamp area).

---

### 3.7 Fire safety agent — בטיחות אש

**Applicable sections:** §1.6 שירותי כבאות + §6 בטיחות אש וגז in פרק ט'.

**Rules to check:**

1. **Consultation obligation trigger (§1.6):**
   - Required for buildings with **4+ floors and/or 20+ dwelling units.**
   - **This project (lot 177, single-family, 2 floors, 1 unit): NOT required.**
   - Also required for buildings with total footprint > 100 sqm when hazardous materials are stored.
   - **This project: footprint ≈ 167 sqm gross but no hazardous materials — NOT required.**
2. **Cooking gas system (§6):** Agent should verify any gas meter / piping meets Israeli standards. If DXF has no gas details, note as "requires separate gas-installer approval" — do NOT mark as fail.
3. **Fire-safety gas shutoff (§10.11 / §9.א / radon):** In designated areas, a radon-gas sealing plan may be required. Plan 506/1 does not mandate this for every lot — flag as "verify with engineer" only if DXF mentions radon.

**What to flag for lot 177:**
- Nothing, in practice. Mark all fire-related requirements as "לא רלוונטי — תת-סף" (below threshold — not applicable).
- Do NOT reduce the overall compliance score because of N/A items.

---

## 4. What the per-file analysis should extract (using the hardcoded inspector)

When you run the per-file DXF inspection on this file (`תוכנית לפני הערות - 10.11.25.dxf`), the hardcoded inspector should report the following values. Treat these as the **ground-truth benchmark** — if the inspector's output differs materially, the inspector has a bug, not this project.

### Expected inspector output for lot 177

| Field | Expected value | Source (DXF) |
|---|---|---|
| Total viewports | 18 | Block enumeration |
| Lot area | 487 sqm | תקנון table 2.7 |
| Lot polygon area (DXF-measured) | 470–505 sqm | DXF boundary polygon |
| Gross built area | 167.90 sqm | VIEWPORT2 text: `13.20 x 12.72 = 167.90` |
| Main area (עיקרי) | 125.05 sqm | VIEWPORT2 text: `167.90 - 42.85 = 125.05` |
| Service area (שירות) | 13.32 sqm | VIEWPORT2 text: `5. 3.70 x 3.60 = 13.32` |
| Service area after ממ"ד deduction | 13.05 sqm (≈ 1.32 − 12 = negative, so the 12 sqm ממ"ד deduction wasn't applied here; effective service ≈ 13 sqm) | §5.3 of תקנון |
| Ground-floor datum (±0.00) | 843.10 m absolute | VIEWPORT4: `0.0=843.10` |
| First-floor slab height | +2.20 m | Common height marker |
| Second-floor slab height | +2.85 m | Common height marker |
| Roof / parapet top | +4.60 m | Highest recurring height in elevation viewports |
| Terrain elevation range | 836.0 – 854.18 m | All 150 absolute elevations sampled |
| Natural terrain drop across site | ~18 m | Range across plan area (this is the plan area, not just lot 177) |
| Parking spaces drawn | Expected: 2 | Based on מגורים א' requirement |
| Number of dwelling units | 1 | בית חד-משפחתי |
| Floors (above grade) | 2 | ±0.00 and +2.85 |
| Max building height | 4.60 m (parapet) | Well under 8.0 m cap |

### Classification expected from per-file analysis

- **VIEWPORT1** — Title sheet / index / approvals block (`עמוד שער`, signatures, architect credits).
- **VIEWPORT2** — Area calculation sheet (`חישוב שטחים קומת קרקע`). Contains the 167.90 / 42.85 / 125.05 / 13.32 math.
- **VIEWPORT3** — Neighborhood plan / תרשים סביבה at 1:250. Lot number `177`, plan `506/1`.
- **VIEWPORT4** — Site plan (תכנית העמדה). 118,946 entities — largest by far. Contains datum `0.0=843.10`, terrain slopes 3% and 1.5%, all 150 absolute elevations, parking bays, boundary.
- **VIEWPORT5** — Ground-floor plan (קומת קרקע). Contains interior labels: מטבח, חדר שינה, ממ"ד, פינת אוכל, מקלחת, שירותים, מסתור כביסה, שרוול מייבש 08=H, etc.
- **VIEWPORT6** — Roof plan or utility-layout sheet. Shows heights +3.05/+3.10/+4.30/+4.60, cooking-gas pipes (PEX ∅32mm / ∅25mm), 2% slope, גג בטון שטוח markings, fire-safety notes.
- **VIEWPORT7** — First elevation (likely front/קדמית). Heights ±0.00 through +4.60, external finishes (חיפוי טיח, חיפוי אבן טליאני, אבן לבנה, עבצוד מוסמם, סורגל אלומיניום), absolute 843.10 reference.
- **VIEWPORT8, 9, 10** — Other three elevations (rear, side A, side B). Same height references, similar finishes, with specific items per face.
- **VIEWPORT11** — Probably a section or detail.
- **VIEWPORT12–15** — Additional sections, enlargement of stair/door details, or parking/covered-parking detail.
- **VIEWPORT16–18** — If present, usually parking cover plan, gardening/pathway plan, or signature/stamps page.

---

## 5. Known data quirks in this specific DXF

These are peculiarities of this file the operator should be aware of so they don't get mistaken for bugs:

1. **Hebrew is encoded in SHX stroke fonts**, not Unicode. Text reads as Latin gibberish (`sdo ahyv` = "אדם שיטה"). This is normal for this architect's DXFs. The inspector should NOT try to decode these as Hebrew — instead rely on viewport-level visual classification and numeric extraction. The numbers are all in clean Latin digits.
2. **Layer names are encoded similarly** — all 321 layers use SHX-Latin names starting with `MIG_165_M...` or underscored prefixes. Boundary/lot detection by layer-name regex will fail. **Use geometry-based boundary detection** (closed polylines with area in 400–600 sqm range sitting on the site-plan viewport).
3. **Encoding reported as `cp1252`** even though content is Hebrew-SHX. Don't trust the encoding header.
4. **Drawing version is AC1009 (R12 legacy).** Some modern ezdxf features behave differently — expect viewport pairing to be less reliable on this file.
5. **VIEWPORT4 has 118,946 entities** — almost all survey point markers for the terrain. Extraction for this viewport should cap TEXT sampling at the first ~500 texts to avoid performance issues.
6. **Absolute elevations are in the 836–854 range** because the site sits at ~840 m elevation in the Hebron Hills. Any classifier that assumes elevations start at 0 or 100 will misclassify the survey viewport.

---

## 6. What to tell the operator before they click "Analyze"

Show this summary card on screen:

> **Project:** בית יתיר — מגרש 177
> **Plan:** 506/1 (שינוי ל-RJ-5 / 506)
> **Zone:** מגורים א'
> **Lot area:** 487 sqm
> **Agents enabled:** Structure · Parking · Accessibility · Drainage · Water · Electricity · Fire-safety
> **Estimated cost:** ~$0.75
> **Estimated runtime:** ~2 minutes (parallel)
> **Rules loaded:** from תקנון 506/1 (30+ specific rules across 7 agents)
>
> Click **ניתוח** to run.

---

## 7. After the analysis — what a good compliance report should look like

For this project, a well-working pipeline should produce roughly:

- **Total relevant requirements checked:** ~30
- **Expected verdict distribution:**
  - PASS: ~22 (height, floors, setbacks, coverage, main/service areas, parking count, permeability, electric distance if no overhead lines, drainage direction)
  - WARNING: ~3 (e.g. parapet near upper limit, service area near cap, pergola area near 40%)
  - CANNOT_CHECK: ~3 (items genuinely missing from the DXF — e.g. radon-gas sealing if required, sewage connection point if not drawn)
  - N/A: ~2 (fire-safety consultation — below threshold, accessibility public-area rules — single-family)
  - FAIL: ideally 0

If the actual report has >5 CANNOT_CHECK results on this project, it's a sign the classifier mis-labeled a sheet and the agent didn't get the data it needed. Use the data-derived classifier reconciliation (the Tier-1 fix we discussed earlier) to troubleshoot.

---

## 8. What NOT to do for this project

- **Don't** try to fetch תב"ע / תקנון from the internet. It's already uploaded (`506-1_תקנון_חתום.pdf`).
- **Don't** auto-select agents. The operator must consciously confirm the 7 relevant ones.
- **Don't** run the DWG conversion path. This file is already a DXF.
- **Don't** try to OCR the Hebrew text inside the DXF — it's SHX stroke-rendered, not image text. Use numeric extraction + viewport-level vision classification instead.
- **Don't** count fire-safety N/A and public-accessibility N/A against the compliance score.
- **Don't** surface the 150 individual survey points as "cannot-check" items — aggregate them into one terrain-elevation-range finding.

---

_End of project setup instructions — בית יתיר / מגרש 177 / plan 506/1_

/**
 * setback-evidence.ts
 * ===================
 *
 * Honest schema for setback measurements emitted by the AI-generated
 * extractor. Replaces the previous raw-number shape that conflated
 * label-to-label distances with real geometric setbacks.
 *
 * Background
 * ----------
 * Sandbox runs of the composed pipeline showed Opus generating extractors
 * that "computed setbacks" by measuring distance between building_line
 * annotations and plot_boundary annotations on the same viewport. Those
 * values (40m, 50m) are NOT setbacks — actual setbacks require extracting
 * the LINE/POLYLINE geometry that the annotations point to and measuring
 * perpendicular distance.
 *
 * 16 confident-looking-but-wrong numbers were going to mislead the
 * compliance agent. This schema makes the limitation visible.
 */

/** Discriminator for what the extractor was actually able to measure. */
export type SetbackStatus =
  | 'annotation_pair_found'
  | 'geometry_extracted'
  | 'geometry_extraction_failed';

export interface SetbackEvidence {
  viewport: string;

  building_line_position: { x: number; y: number };
  plot_boundary_position: { x: number; y: number };

  /**
   * Distance between the TWO LABEL POSITIONS, not between geometry.
   * Always populated; useful as an upper-bound sanity check but never
   * a compliance measurement on its own.
   */
  annotation_label_distance_meters: number;

  /**
   * The real setback in meters. NULL until geometric extraction is
   * implemented and a line pair was successfully found.
   */
  geometric_setback_meters: number | null;

  status: SetbackStatus;
  notes: string;
}

/**
 * Canonical notes string for the most common case: we have annotations
 * but no geometric extraction yet. Use verbatim — the compliance agent's
 * prompt is calibrated against this exact phrasing.
 */
export function annotationOnlyNote(distance_m: number): string {
  return (
    'Building line and plot boundary annotations exist on the same viewport. ' +
    `Label-to-label distance is ${distance_m.toFixed(2)}m. ` +
    'Actual setback requires geometric extraction of the corresponding line ' +
    'entities, which is not yet implemented. ' +
    'Do NOT use the label distance as a compliance measurement.'
  );
}

/**
 * The prompt fragment the compliance agent uses to interpret SetbackEvidence
 * entries. Spliced into core-compliance-agent.ts when the cd.setbacks shape
 * looks like SetbackEvidence (vs the legacy bare-number shape).
 */
export const SETBACK_INTERPRETATION_INSTRUCTIONS = `
## הוראות לפענוח שדה "setbacks" (חדש — סכמת SetbackEvidence)

The "setbacks" array uses an honest schema with a "status" field per entry:

- **status: "annotation_pair_found"** — annotations exist on the viewport but
  the actual perpendicular distance between line geometries was NOT measured.
  The "annotation_label_distance_meters" is just label-to-label distance and
  is NOT a setback. For setback compliance requirements, you MUST return
  WARNING with details: "Setback evidence present (annotations on
  VIEWPORT_X) but geometric measurement not yet available — extraction
  pipeline limitation, not a missing-data issue." Do NOT return PASS or
  FAIL based on the label distance. Do NOT return CANNOT_CHECK either —
  CANNOT_CHECK implies "no evidence", which is wrong here.

- **status: "geometry_extracted"** — "geometric_setback_meters" contains the
  real measurement. Use it normally for PASS/FAIL.

- **status: "geometry_extraction_failed"** — return CANNOT_CHECK with the
  notes string explaining what the extractor tried.

Legacy entries (bare numbers without a "status" field) come from older
extractor outputs. Treat them with skepticism: include in your details
"based on legacy unverified extraction" and prefer WARNING over PASS.
`;

/** Type guard — is this a new-shape entry or legacy bare-number entry? */
export function isSetbackEvidence(x: unknown): x is SetbackEvidence {
  return (
    typeof x === 'object' && x !== null &&
    'status' in x && 'viewport' in x &&
    'annotation_label_distance_meters' in x
  );
}

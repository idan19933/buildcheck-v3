"""
Pipeline-structured decoder for Hebrew text in DXF files.

Stages run in order. Each stage is an independent transform that knows
how to detect whether it applies. A string may be transformed by multiple
stages in sequence (e.g. first ``\\U+XXXX`` expansion, then CP1255 remap).

Adding a new encoding variant = adding a new stage file and appending
it to ``build_default_pipeline``. Existing stages are not touched.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass
class StageResult:
    """Result of a single stage applied to a string."""
    stage_name: str
    applied: bool
    input: str
    output: str

    @property
    def changed(self) -> bool:
        return self.applied and self.input != self.output


@dataclass
class DecodeResult:
    """Result of the full pipeline applied to a string."""
    raw: str
    decoded: str
    stages_applied: list[str] = field(default_factory=list)
    stage_trace: list[StageResult] = field(default_factory=list)

    @property
    def was_transformed(self) -> bool:
        return self.raw != self.decoded


@dataclass
class DecoderStage:
    """One transform in the decoder pipeline."""
    name: str
    detect: Callable[[str], bool]
    transform: Callable[[str], str]
    description: str = ""


class DecoderPipeline:
    """Orders and applies decoder stages."""

    def __init__(self, stages: list[DecoderStage]):
        self.stages = stages
        # Names must be unique so metrics aggregation is unambiguous.
        seen: set[str] = set()
        for s in stages:
            if s.name in seen:
                raise ValueError(f"Duplicate stage name: {s.name}")
            seen.add(s.name)

    def decode(self, raw: str) -> DecodeResult:
        """Walk every stage; apply any that detects as applicable.

        A stage that raises during detect or transform is treated as
        non-applicable for that input — never as a pipeline failure.
        """
        if raw is None:
            return DecodeResult(raw="", decoded="")

        current = raw
        result = DecodeResult(raw=raw, decoded=raw)

        for stage in self.stages:
            try:
                applies = stage.detect(current)
            except Exception:
                applies = False

            if not applies:
                result.stage_trace.append(StageResult(
                    stage_name=stage.name, applied=False,
                    input=current, output=current,
                ))
                continue

            try:
                transformed = stage.transform(current)
            except Exception:
                # A stage failing must not break the pipeline.
                result.stage_trace.append(StageResult(
                    stage_name=stage.name, applied=False,
                    input=current, output=current,
                ))
                continue

            result.stage_trace.append(StageResult(
                stage_name=stage.name, applied=True,
                input=current, output=transformed,
            ))
            if transformed != current:
                result.stages_applied.append(stage.name)
                current = transformed

        result.decoded = current
        return result

    def stage_names(self) -> list[str]:
        return [s.name for s in self.stages]


def build_default_pipeline() -> DecoderPipeline:
    """Assemble the canonical decoder pipeline in the right order.

    Stage order matters:
      1. ``uplus_escape``  — turn ``\\U+XXXX`` into raw codepoints
      2. ``cp862_remap``   — most specific detector (only fires on the
                              C1 Hebrew band 0x80–0x9A, the legacy DOS
                              AutoCAD encoding)
      3. ``cp1255_remap``  — broader 0x80–0xFE detector, suppressed if
                              cp862_remap already produced Hebrew

    Why ``hebrew_unreverse`` is NOT registered here
    ----------------------------------------------
    The reversal stage exists in ``stage_hebrew_unreverse.py`` and has
    full test coverage, but the bucket-distribution diagnostic on the
    יתיר file (2026-04-25) showed it'd unlock at most 16/350 candidate
    strings — 94.9% of post-CP862 Hebrew strings don't match the
    vocabulary regardless of order. Vocabulary expansion is the bigger
    lever; reversal is parked until either:
      (a) a metadata-gated activation strategy proves safe, or
      (b) a future file's diagnostic shows reversal-shaped wins
          dominating bucket B.
    See docs/vocabulary_gaps_2026_04.md for the full reasoning.
    """
    from .stage_uplus_escape import stage as uplus_stage
    from .stage_cp862_remap import stage as cp862_stage
    from .stage_cp1255_remap import stage as cp1255_stage
    return DecoderPipeline(stages=[uplus_stage, cp862_stage, cp1255_stage])

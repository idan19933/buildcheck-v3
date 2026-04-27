"""Unit tests for the decoder pipeline scaffolding."""
from __future__ import annotations

import sys
from pathlib import Path

# Make `from semantic.decoders... import ...` resolvable when running pytest
# from this folder directly: walk four parents up to land on server/python.
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import pytest  # noqa: E402

from semantic.decoders.pipeline import (  # noqa: E402
    DecoderPipeline,
    DecoderStage,
    build_default_pipeline,
)


def test_empty_input_handled():
    p = build_default_pipeline()
    result = p.decode("")
    assert result.decoded == ""
    assert result.stages_applied == []


def test_none_input_handled():
    p = build_default_pipeline()
    result = p.decode(None)  # type: ignore[arg-type]
    assert result.decoded == ""
    assert result.stages_applied == []


def test_ascii_passes_through_unchanged():
    p = build_default_pipeline()
    result = p.decode("VIEWPORT19")
    assert result.decoded == "VIEWPORT19"
    assert result.stages_applied == []


def test_stages_run_in_order_uplus_then_cp1255():
    """\\U+00E7 → ç (U+00E7); CP1255 then remaps 0xE7 to ח (het)."""
    p = build_default_pipeline()
    result = p.decode(r"\U+00E7\U+00E7")
    assert result.stages_applied == ["uplus_escape", "cp1255_remap"]
    assert result.decoded == "חח"


def test_stage_that_does_not_apply_is_not_recorded_as_applied():
    p = build_default_pipeline()
    result = p.decode("hello world")
    assert "cp1255_remap" not in result.stages_applied
    assert "uplus_escape" not in result.stages_applied
    # But every stage should still appear in the trace as not-applied
    names_in_trace = [s.stage_name for s in result.stage_trace]
    assert "uplus_escape" in names_in_trace
    assert "cp1255_remap" in names_in_trace


def test_stage_failure_does_not_break_pipeline():
    def bad_detect(s: str) -> bool:
        return True

    def bad_transform(s: str) -> str:
        raise ValueError("boom")

    broken = DecoderStage(name="broken", detect=bad_detect, transform=bad_transform)
    p = DecoderPipeline(stages=[broken])
    result = p.decode("hello")
    assert result.decoded == "hello"
    assert "broken" not in result.stages_applied


def test_detect_exception_treated_as_not_applicable():
    def crash_detect(s: str) -> bool:
        raise RuntimeError("crash")

    def never_called(s: str) -> str:
        raise AssertionError("should never be called")

    crashy = DecoderStage(name="crashy", detect=crash_detect, transform=never_called)
    p = DecoderPipeline(stages=[crashy])
    result = p.decode("hello")
    assert result.decoded == "hello"
    assert "crashy" not in result.stages_applied


def test_duplicate_stage_names_rejected():
    s1 = DecoderStage(name="x", detect=lambda s: False, transform=lambda s: s)
    s2 = DecoderStage(name="x", detect=lambda s: False, transform=lambda s: s)
    with pytest.raises(ValueError):
        DecoderPipeline(stages=[s1, s2])


def test_was_transformed_property():
    p = build_default_pipeline()
    untouched = p.decode("VIEWPORT19")
    assert untouched.was_transformed is False
    transformed = p.decode(r"\U+05E7\U+05D5")
    assert transformed.was_transformed is True


def test_default_pipeline_stage_names():
    """Default pipeline is uplus + cp862 + cp1255. hebrew_unreverse exists
    as a registered stage file but is intentionally not in the default —
    see docs/vocabulary_gaps_2026_04.md for the rationale."""
    p = build_default_pipeline()
    assert p.stage_names() == ["uplus_escape", "cp862_remap", "cp1255_remap"]


def test_uplus_then_cp862_path():
    """\\U+0097\\U+0085 expands to U+0097 U+0085, then cp862 → קו."""
    p = build_default_pipeline()
    result = p.decode(r"\U+0097\U+0085")
    assert result.stages_applied == ["uplus_escape", "cp862_remap"]
    assert result.decoded == "קו"


def test_cp862_suppresses_cp1255_when_hebrew_already_present():
    """Once cp862 produces real Hebrew, cp1255's detector must skip."""
    p = build_default_pipeline()
    result = p.decode(r"\U+0097\U+0085")
    assert "cp862_remap" in result.stages_applied
    assert "cp1255_remap" not in result.stages_applied


def test_hebrew_unreverse_file_remains_importable():
    """Reversal stage is parked, not deleted — its file must still load."""
    from semantic.decoders.stage_hebrew_unreverse import stage as r
    assert r.name == "hebrew_unreverse"

import importlib
import json
import os
import sys
import types
from pathlib import Path

import pytest
from lxml import html

ELEMENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ELEMENT_DIR))

sys.modules["chevron"] = types.SimpleNamespace(
    render=lambda _template, params: json.dumps(params)
)


def _add_files_format_error(data: dict, error: str) -> None:
    errors = data.setdefault("format_errors", {})
    if isinstance(errors, dict):
        errors.setdefault("_files", []).append(error)
    else:
        errors.append(error)


pl_stub = types.SimpleNamespace(
    QuestionData=dict,
    get_string_attrib=lambda element, name, default=None: element.get(name, default),
    get_boolean_attrib=lambda element, name, default=None: (
        element.get(name, str(default)).lower() in {"true", "1", "yes"}
        if element.get(name) is not None
        else default
    ),
    check_attribs=lambda _element, _required, _optional: None,
    check_answers_names=lambda _data, *_names: None,
    add_files_format_error=_add_files_format_error,
    get_uuid=lambda: "test-uuid",
)
sys.modules["prairielearn"] = pl_stub

pl_image_annotate = importlib.import_module("pl-image-annotate")


def _render(element_html: str, data: dict) -> dict | str:
    old_cwd = os.getcwd()
    try:
        os.chdir(ELEMENT_DIR)
        rendered = pl_image_annotate.render(element_html, data)
    finally:
        os.chdir(old_cwd)
    return json.loads(rendered) if rendered else ""


def test_extract_rectangle_annotations_normalizes_readme_options() -> None:
    element = html.fragment_fromstring(
        '<pl-image-annotate answer-name="img">'
        '<pl-rectangle-annotate key="box" label="Important &amp; visible" '
        'color="purple" label-position="diagonal" label-bg-opacity="2" '
        'label-auto-boundary="no"></pl-rectangle-annotate>'
        "</pl-image-annotate>"
    )

    annotations = pl_image_annotate.extract_rectangle_annotations(element)

    assert annotations == [
        {
            "type": "box",
            "color": "#800080",
            "width": "100",
            "height": "100",
            "resizable": "true",
            "required": "false",
            "label": "Important & visible",
            "label_position": "top",
            "label_bg_opacity": 1.0,
            "label_auto_boundary": False,
            "key": "box",
            "annotation_name": "box",
            "font_size": "14",
            "border_width": "2",
        }
    ]


def test_prepare_rejects_duplicate_annotation_keys() -> None:
    data = {"params": {}}

    with pytest.raises(Exception, match="Duplicate key"):
        pl_image_annotate.prepare(
            '<pl-image-annotate answer-name="img">'
            '<pl-rectangle-annotate key="box" label="A"></pl-rectangle-annotate>'
            '<pl-rectangle-annotate key="box" label="B"></pl-rectangle-annotate>'
            "</pl-image-annotate>",
            data,
        )


def test_render_returns_empty_string_outside_question_and_submission_panels() -> None:
    data = {"panel": "answer"}

    assert (
        pl_image_annotate.render('<pl-image-annotate answer-name="img" />', data) == ""
    )


def test_question_render_includes_annotation_metadata() -> None:
    data = {"panel": "question", "submitted_answers": {}, "editable": True}
    rendered = _render(
        '<pl-image-annotate answer-name="img" width="640" height="480">'
        '<pl-rectangle-annotate key="box" label="Box"></pl-rectangle-annotate>'
        "</pl-image-annotate>",
        data,
    )

    assert rendered["name"] == "img"
    assert rendered["width"] == "640"
    assert rendered["height"] == "480"
    assert json.loads(rendered["rectangle_annotations_json"])[0]["key"] == "box"


def test_question_render_restores_saved_annotation_state() -> None:
    data = {
        "panel": "question",
        "submitted_answers": {
            "img": json.dumps(
                {"savedState": {"annotations": [{"type": "box", "x": 10, "y": 20}]}}
            )
        },
    }

    rendered = _render(
        '<pl-image-annotate answer-name="img">'
        '<pl-rectangle-annotate key="box" label="Box"></pl-rectangle-annotate>'
        "</pl-image-annotate>",
        data,
    )
    annotations = json.loads(rendered["rectangle_annotations_json"])

    assert annotations["config"][0]["key"] == "box"
    assert annotations["savedState"]["annotations"][0]["x"] == 10


def test_parse_extracts_canvas_rectangles_and_required_annotations() -> None:
    data = {
        "submitted_answers": {
            "img": json.dumps(
                {
                    "canvas": "data:image/png;base64,CANVAS",
                    "savedState": {"annotations": [{"type": "box"}]},
                    "rectangles": {"box": "data:image/png;base64,BOX"},
                }
            )
        },
        "format_errors": {},
    }

    pl_image_annotate.parse(
        '<pl-image-annotate answer-name="img">'
        '<pl-rectangle-annotate key="box" label="Box" required="true"></pl-rectangle-annotate>'
        "</pl-image-annotate>",
        data,
    )

    assert json.loads(data["submitted_answers"]["img"]) == {
        "canvas": "CANVAS",
        "savedState": {"annotations": [{"type": "box"}]},
        "annotations": {"box": "BOX"},
    }
    assert data["format_errors"] == {}


def test_parse_reports_missing_required_annotations() -> None:
    data = {
        "submitted_answers": {
            "img": json.dumps(
                {
                    "canvas": "data:image/png;base64,CANVAS",
                    "savedState": {"annotations": []},
                    "rectangles": {},
                }
            )
        },
        "format_errors": {},
    }

    pl_image_annotate.parse(
        '<pl-image-annotate answer-name="img">'
        '<pl-rectangle-annotate key="tumor" label="Tumor" required="true"></pl-rectangle-annotate>'
        "</pl-image-annotate>",
        data,
    )

    assert data["format_errors"]["img"] == "Missing required annotations: Tumor"


def test_submission_render_reports_missing_and_invalid_json_answers() -> None:
    data = {"panel": "submission", "submitted_answers": {}, "format_errors": {}}

    assert (
        _render('<pl-image-annotate answer-name="img"></pl-image-annotate>', data) == ""
    )
    assert data["format_errors"] == {"_files": ["No submitted answer for file upload."]}

    data = {
        "panel": "submission",
        "submitted_answers": {"img": "not json"},
        "format_errors": {},
    }

    assert (
        _render('<pl-image-annotate answer-name="img"></pl-image-annotate>', data) == ""
    )
    assert data["format_errors"] == {
        "_files": ["Submitted files are not in valid JSON format."]
    }


def test_submission_render_embeds_submitted_canvas_url() -> None:
    data = {
        "panel": "submission",
        "submitted_answers": {"img": json.dumps({"canvas": "CANVAS"})},
        "format_errors": {},
    }

    rendered = _render(
        '<pl-image-annotate answer-name="img" width="640"></pl-image-annotate>',
        data,
    )

    assert rendered["submission"] is True
    assert rendered["submitted_file_url"] == "data:image/png;base64,CANVAS"
    assert rendered["width"] == "640"

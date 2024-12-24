import json
import html
import chevron
import lxml.html
import prairielearn as pl

# Define a mapping from color names to hex codes
COLOR_NAME_TO_HEX = {
    'black': '#000000',
    'red': '#FF0000',
    'blue': '#0000FF',
    'green': '#00FF00',
    'orange': '#FFA500',
    'purple': '#800080',
    'yellow': '#FFFF00',
    'pink': '#FFC0CB',
    'gray': '#808080',
    # Add more colors as needed
}
MUSTACHE_FILE = "pl-image-annotate.mustache"
SHOW_HELP_TEXT_DEFAULT = True

def add_format_error(data: pl.QuestionData, error_string: str) -> None:
    pl.add_files_format_error(data, error_string)

def extract_rectangle_annotations(element) -> list[dict]:
    """
    Extracts all pl-rectangle-annotate elements nested within pl-image-annotate.

    Returns:
        List of dictionaries with rectangle annotation properties.
    """
    annotations = []
    for rect in element.findall('pl-rectangle-annotate'):
        # Retrieve the label and key attributes
        key = rect.get('key', '')
        key = html.unescape(key)
        label = rect.get('label', key)
        label = html.unescape(label)

        # Derive type and answer_name from label
        annotation_name = key  # Use the same identifier for answer_name

        # Retrieve the color attribute
        color_attr = rect.get('color', 'red')  # Default to red if not specified

        # If color is a name, convert it to hex; otherwise, keep as is
        if color_attr.lower() in COLOR_NAME_TO_HEX:
            color = COLOR_NAME_TO_HEX[color_attr.lower()]
        else:
            color = color_attr  # Assume it's a valid hex code

        annotation = {
            'type': key,
            'color': color,
            'width': rect.get('width', '100'),
            'height': rect.get('height', '100'),
            'resizable': rect.get('resizable', 'true'),
            'required': rect.get('required', 'false'),
            'label': label,
            'key': key,
            'annotation_name': annotation_name,
            'font_size': rect.get('font_size', '14'),
            'border_width': rect.get('border_width', '2'),
        }
        annotations.append(annotation)
    return annotations

def prepare(element_html: str, data: pl.QuestionData) -> None:
    element = lxml.html.fragment_fromstring(element_html)
    required_attribs = ["answer-name"]
    optional_attribs = ["width", "height"]
    pl.check_attribs(element, required_attribs, optional_attribs)

    answer_name = pl.get_string_attrib(element, "answer-name")
    pl.check_answers_names(data, answer_name)

    # Check subelements
    subelement_required_attribs = ["label", "key"]
    subelement_optional_attribs = ["color", "width", "height", "resizable", "font_size", "border_width", "required"]

    keys = set()
    for subelement in element.findall("pl-rectangle-annotate"):
        pl.check_attribs(subelement, subelement_required_attribs, subelement_optional_attribs)

        key = html.unescape(subelement.get('key', ''))
        if key in keys:
            raise Exception(f"Duplicate key found: {key}")
        keys.add(key)


def render(element_html: str, data: pl.QuestionData) -> str:
    if data["panel"] not in ["question", "submission"]:
        return ""
    
    with open(MUSTACHE_FILE, "r", encoding="utf-8") as f:
        template = f.read()
    
    element = lxml.html.fragment_fromstring(element_html)
    uuid = pl.get_uuid()

    answer_name = pl.get_string_attrib(element, "answer-name", "")

    # Extract the 'width' attribute, defaulting to 500if not provided
    width = pl.get_string_attrib(element, "width", "500")
    height = pl.get_string_attrib(element, "height", "100")

    # Extract rectangle annotations
    rectangle_annotations = extract_rectangle_annotations(element)
    rectangle_annotations_json = json.dumps(rectangle_annotations, ensure_ascii=False)

    if data["panel"] == "question":

        # Define accepted file types
        accepted_file_types = ['.jpg', '.jpeg', '.png', '.gif']
        accepted_file_types_json = json.dumps(accepted_file_types, allow_nan=False)

        # Define selectable colors (name to hex mapping)
        selectable_colors = [
            {'name': name.capitalize(), 'hex': hex_code}
            for name, hex_code in COLOR_NAME_TO_HEX.items()
        ]
        selectable_colors_json = json.dumps(selectable_colors, allow_nan=False)

        # Only send the file names to the client. We don't include the contents
        # to avoid bloating the HTML. The client will fetch any submitted files
        # asynchronously once the page loads.
        #
        # We filter out any files that weren't specified in the file names for this element.

        # Get saved state from submitted answers if it exists
        saved_state = {}
        submitted_answers = data["submitted_answers"].get(answer_name, None)

        hint = "You need to upload a file before you can annotate it, then click the annotation button to start annotating on canvas."
        info_params = {"format": True, "hint": hint}
        info = chevron.render(template, info_params).strip()

        show_help_text = pl.get_boolean_attrib(
            element, "show-help-text", SHOW_HELP_TEXT_DEFAULT
        )

        if submitted_answers:
            try:
                saved_data = json.loads(submitted_answers)
                saved_state = saved_data.get("savedState", {})
                # Add saved state to rectangle_annotations for restoration
                rectangle_annotations = {
                    "config": rectangle_annotations,
                    "savedState": saved_state
                }
                rectangle_annotations_json = json.dumps(rectangle_annotations, ensure_ascii=False)
            except json.JSONDecodeError:
                pass

        html_params = {
            "name": answer_name,
            "uuid": uuid,
            "width": width,  
            "height": height,
            "rectangle_annotations_json": rectangle_annotations_json,  # Pass rectangle annotations with saved state
            "accepted_file_types_json": accepted_file_types_json,  # Pass accepted file types
            "selectable_colors_json": selectable_colors_json,  # Pass selectable colors
            "question": True,
            "info": info,
            "show_info": show_help_text
        }
        return chevron.render(template, html_params).strip()
    
    elif data["panel"] == "submission":
        submitted_answers = data["submitted_answers"].get(answer_name, None)

        parse_error = data["format_errors"].get(answer_name, None)
        if parse_error:
            html_params = {
                "parse_error": parse_error,
            }
            return chevron.render(template, html_params).strip()

        if not submitted_answers:
            add_format_error(data, "No submitted answer for file upload.")
            return ""
        
        try:
            submitted_answers = json.loads(submitted_answers)
        except json.JSONDecodeError:
            add_format_error(data, "Submitted files are not in valid JSON format.")
            return ""

        # Initialize the single URL
        submitted_file_url = None

        # Check if submitted_answers is a list or a dict
        if isinstance(submitted_answers, list):
            if len(submitted_answers) > 0 and isinstance(submitted_answers[0], dict):
                submitted_file_url = submitted_answers[0].get("canvas", None)
        elif isinstance(submitted_answers, dict):
            submitted_file_url = submitted_answers.get("canvas", None)

        # Populate html_params with the correct key
        html_params = {
            "submitted_file_url": "data:image/png;base64," + submitted_file_url,
            "width": width,
            "submission": True,
        }

        return chevron.render(template, html_params).strip()

def parse(element_html: str, data: pl.QuestionData) -> None:
    element = lxml.html.fragment_fromstring(element_html)
    answer_name = pl.get_string_attrib(element, "answer-name", "")


    # Get submitted answer or return parse_error if it does not exist
    submitted_answers = data["submitted_answers"].get(answer_name, None)
    if not submitted_answers:
        add_format_error(data, "No submitted answer for file upload.")
        return
    
    required_key = set()
    type_to_label = {}
    
    for subelement in element.findall("pl-rectangle-annotate"):
        required = pl.get_boolean_attrib(subelement, "required", False)
        if required:
            key = subelement.get("key", "")
            required_key.add(key)
            type_to_label[key] = subelement.get("label", "")
    
    saved_data = json.loads(submitted_answers)
    canvas = saved_data.get("canvas", {})
    saved_state = saved_data.get("savedState", {})
    annotations = saved_state.get("annotations", {})
    rectangles = saved_data.get("rectangles", {})
    
    processed_rectangles = {
        key: value.split(",")[1] for key, value in rectangles.items()
    }

    data["submitted_answers"][answer_name] = json.dumps({
        "canvas": canvas.split(",")[1],
        "savedState": saved_state,
        "annotations": processed_rectangles,
    })

    # Collect keys from annotations
    annotation_keys = {ann.get("type", "") for ann in annotations}

    # Check if all required keys are present
    missing_keys = required_key - annotation_keys
    if missing_keys:
        missing_labels = [type_to_label[key] for key in missing_keys]
        data["format_errors"][answer_name] = "Missing required annotations: " + ", ".join(missing_labels)

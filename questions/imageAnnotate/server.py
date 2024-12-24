import json

def parse(data):
    # Because the data is json object, we need to parse it first
    process_data = json.loads(data["submitted_answers"]["test"])
    canvas = process_data["canvas"]
    destination_mac = process_data["annotations"]["Destination_MAC"]
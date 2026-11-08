"""장소·시야·대화 상태로 배경·표정·화면 내 조사점을 고른다."""

import json
from pathlib import Path


REGISTRATIONS = json.loads(
    (Path(__file__).resolve().parents[1]
     / "public/assets/images/scenes/registration.json").read_text(encoding="utf-8")
)
LAYOUT = json.loads(
    (Path(__file__).resolve().parents[1] / "config/scene_layout.json").read_text(encoding="utf-8")
)
OBJECTS = {entry["key"]: entry for entry in LAYOUT["objects"]}

# Door outlines use the same full-canvas coordinates as their source backgrounds.
# The engine view faces the controls and has no visible doorway to register.
DOOR_OUTLINES = {
    location: {"polygon": [[round(x * 100 / spec["size"][0], 6), round(y * 100 / spec["size"][1], 6)]
                            for x, y in spec["door"]["polygon"]]}
    for location, spec in LAYOUT["scenes"].items() if "door" in spec
}


class DemoImageSelector:
    def select(self, reply: str, character: dict) -> str | None:
        return character.get("_runtime", {}).get("scene_image")

    def scene(self, state: dict, config: dict, *, allowed_moves=()) -> dict:
        location, flags = state["location"], state["flags"]
        backgrounds = {key: spec["background"] for key, spec in LAYOUT["scenes"].items()}
        sizes = {key: spec["size"] for key, spec in LAYOUT["scenes"].items()}
        dark = location == "car_3" and not flags.get("light_on")
        people = []
        if not dark and state["status"] == "playing" and not flags.get("route_open"):
            for npc_id, npc in config["npcs"].items():
                if npc["location"] != location:
                    continue
                active = state["npc"] == npc_id
                expression = state.get("expression", "neutral") if active else ("guarded" if npc_id == "attendant" and not flags.get("door_open") else "relieved" if npc_id == "elder" and flags.get("ticket_returned") else "neutral")
                filename = npc.get("expressions", {}).get(expression, npc["image"])
                key = next(obj["key"] for obj in LAYOUT["objects"] if obj["kind"] == "person" and obj["id"] == npc_id)
                person = {"id": npc_id, "name": npc["name"], "image": "/assets/images/" + filename,
                          "active": active, "expression": expression, "registration": REGISTRATIONS[key],
                          "bounds": REGISTRATIONS[key]["bounds"]}
                people.append(person)
        points = []

        def point(key, label, bounds, kind, target="", **extra):
            points.append({"id": key, "label": label, "bounds": bounds, "kind": kind, "target": target, **extra})

        def registered(art):
            definition = OBJECTS[art]
            registration = REGISTRATIONS[art]
            point(definition["id"], definition["label"], registration["bounds"],
                  definition["kind"], definition.get("target", ""),
                  image=registration["image"], registration=registration)

        if state["status"] == "playing" and not state["npc"]:
            door_target = LAYOUT["scenes"][location].get("door", {}).get("target")
            door_available = not dark and door_target in allowed_moves
            if location == "car_1":
                registered("car1.notice")
                registered("car1.window")
            elif location == "car_4" and flags.get("mission_accepted") and not door_available:
                registered("crew-door.crew_door")
                registered("crew-door.inspection_cover")
                registered("crew-door.door_handle")
            elif location == "crew":
                registered("crew.report")
            elif location == "engine":
                registered("engine.control")
                registered("engine.engine-lever")
            if door_available:
                polygon = DOOR_OUTLINES[location]["polygon"]
                xs, ys = zip(*polygon)
                bounds = [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]
                destination = {"car_2": "2호차", "car_3": "3호차", "car_4": "4호차",
                               "crew": "승무원실", "engine": "기관실"}[door_target]
                point("door_to_" + door_target, destination + "로 이동", bounds,
                      "move", door_target, polygon=polygon,
                      background=backgrounds[location])
        width, height = sizes[location]
        return {"background": backgrounds[location], "aspect_ratio": f"{width} / {height}", "dark": dark, "light_mode": "dark" if dark else "flashlight" if location == "car_3" else "normal", "people": people, "hotspots": points, "arrived": bool(flags.get("route_open")), "ending": state["status"]}

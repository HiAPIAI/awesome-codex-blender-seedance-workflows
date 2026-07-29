import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy


def parse_args():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--render", action="store_true")
    return parser.parse_args(arguments)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def make_material(name, color):
    material = bpy.data.materials.new(name=f"mat-{name}")
    material.diffuse_color = (*color, 1.0)
    return material


def create_primitive(item):
    primitive = item["primitive"]
    if primitive == "cube":
        bpy.ops.mesh.primitive_cube_add()
    elif primitive == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12)
    elif primitive == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=24)
    elif primitive == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=24)
    else:
        raise ValueError(f"Unsupported primitive: {primitive}")
    obj = bpy.context.object
    obj.name = item["id"]
    obj.dimensions = item["dimensions"]
    obj.color = (*item["color"], 1.0)
    obj.data.materials.append(make_material(item["id"], item["color"]))
    bpy.context.view_layer.update()
    for keyframe in item["keyframes"]:
        obj.location = keyframe["location"]
        obj.rotation_euler = [math.radians(value) for value in keyframe.get("rotation", [0, 0, 0])]
        obj.keyframe_insert(data_path="location", frame=keyframe["frame"])
        obj.keyframe_insert(data_path="rotation_euler", frame=keyframe["frame"])
    return obj


def create_ground(world):
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, -0.1))
    ground = bpy.context.object
    ground.name = "ground"
    ground.dimensions = (world["groundSize"][0], world["groundSize"][1], 0.2)
    ground.color = (*world["groundColor"], 1.0)
    ground.data.materials.append(make_material("ground", world["groundColor"]))
    bpy.context.view_layer.update()


def create_camera(camera_spec):
    camera_data = bpy.data.cameras.new("previs-camera")
    camera_data.sensor_width = camera_spec["sensorWidthMm"]
    camera = bpy.data.objects.new("previs-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    target = bpy.data.objects.new("camera-target", None)
    bpy.context.collection.objects.link(target)
    constraint = camera.constraints.new(type="TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"
    for keyframe in camera_spec["keyframes"]:
        camera.location = keyframe["location"]
        camera_data.lens = keyframe["lensMm"]
        target.location = keyframe["target"]
        camera.keyframe_insert(data_path="location", frame=keyframe["frame"])
        camera_data.keyframe_insert(data_path="lens", frame=keyframe["frame"])
        target.keyframe_insert(data_path="location", frame=keyframe["frame"])
    bpy.context.scene.camera = camera


def make_linear():
    for action in bpy.data.actions:
        if hasattr(action, "fcurves"):
            curves = action.fcurves
            set_curves_linear(curves)
            continue
        for layer in action.layers:
            for strip in layer.strips:
                for channel_bag in strip.channelbags:
                    set_curves_linear(channel_bag.fcurves)


def set_curves_linear(curves):
    for curve in curves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"


def configure_scene(spec, output):
    scene = bpy.context.scene
    timeline = spec["timeline"]
    scene.frame_start = timeline["frameStart"]
    scene.frame_end = timeline["frameEnd"]
    scene.render.fps = timeline["fps"]
    scene.render.resolution_x = spec["resolution"]["width"]
    scene.render.resolution_y = spec["resolution"]["height"]
    scene.render.resolution_percentage = 100
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "WORLD"
    scene.world.color = spec["world"]["background"]
    frames = output / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(frames / "frame_")
    scene.render.use_file_extension = True


def main():
    options = parse_args()
    spec_file = Path(options.spec).resolve()
    output = Path(options.out_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with spec_file.open("r", encoding="utf-8") as handle:
        spec = json.load(handle)
    clear_scene()
    configure_scene(spec, output)
    create_ground(spec["world"])
    for item in spec["objects"]:
        create_primitive(item)
    create_camera(spec["camera"])
    make_linear()
    blend_file = output / "previs.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_file))
    if options.render:
        bpy.ops.render.render(animation=True)
    report = {
        "version": 1,
        "shotId": spec["id"],
        "blenderVersion": bpy.app.version_string,
        "frames": spec["timeline"]["frameEnd"],
        "fps": spec["timeline"]["fps"],
        "renderedFrames": options.render,
        "encoded": False,
        "files": ["previs.blend"] + (["frames/"] if options.render else []),
    }
    with (output / "render-report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()

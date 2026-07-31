import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


def parse_args():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--camera-track", default=None)
    parser.add_argument("--render", action="store_true")
    return parser.parse_args(arguments)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def set_node_input(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def make_material(name, color, preset="matte"):
    material = bpy.data.materials.new(name=f"mat-{name}")
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    set_node_input(bsdf, ["Base Color"], (*color, 1.0))
    settings = {
        "matte": (0.0, 0.68),
        "painted-metal": (0.35, 0.3),
        "brushed-metal": (0.92, 0.24),
        "rubber": (0.0, 0.88),
        "fabric": (0.0, 0.78),
        "skin": (0.0, 0.52),
        "hazmat": (0.05, 0.4),
        "desert": (0.0, 0.95),
        "dust": (0.0, 0.9),
        "liquid": (0.0, 0.12),
        "glass": (0.0, 0.08),
        "emissive": (0.0, 0.3),
    }
    metallic, roughness = settings.get(preset, settings["matte"])
    set_node_input(bsdf, ["Metallic"], metallic)
    set_node_input(bsdf, ["Roughness"], roughness)
    if preset == "glass":
        set_node_input(bsdf, ["Transmission Weight", "Transmission"], 1.0)
        set_node_input(bsdf, ["IOR"], 1.46)
    elif preset == "liquid":
        set_node_input(bsdf, ["Transmission Weight", "Transmission"], 0.45)
        set_node_input(bsdf, ["IOR"], 1.36)
    elif preset == "hazmat":
        set_node_input(bsdf, ["Coat Weight", "Coat"], 0.35)
        set_node_input(bsdf, ["Coat Roughness"], 0.25)
    elif preset == "emissive":
        set_node_input(bsdf, ["Emission Color", "Emission"], (*color, 1.0))
        set_node_input(bsdf, ["Emission Strength"], 8.0)
    elif preset == "dust":
        set_node_input(bsdf, ["Emission Color", "Emission"], (*color, 1.0))
        set_node_input(bsdf, ["Emission Strength"], 0.3)
    texture_settings = {
        "painted-metal": (11.0, 0.14, 0.055),
        "brushed-metal": (65.0, 0.1, 0.025),
        "rubber": (28.0, 0.12, 0.03),
        "fabric": (48.0, 0.16, 0.025),
        "hazmat": (18.0, 0.1, 0.025),
        "desert": (3.2, 0.32, 0.12),
    }
    if preset in texture_settings:
        scale, strength, distance = texture_settings[preset]
        noise = nodes.new(type="ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = scale
        noise.inputs["Detail"].default_value = 3.0
        noise.inputs["Roughness"].default_value = 0.65
        bump = nodes.new(type="ShaderNodeBump")
        bump.inputs["Strength"].default_value = strength
        bump.inputs["Distance"].default_value = distance
        material.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        material.node_tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def build_mesh(item, name):
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
    obj.name = name
    obj.dimensions = item["dimensions"]
    obj.color = (*item["color"], 1.0)
    obj.data.materials.append(make_material(name, item["color"], item.get("materialPreset", "matte")))
    if item.get("smooth"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    bevel_width = item.get("bevel", 0)
    if bevel_width > 0:
        modifier = obj.modifiers.new(name="cinematic-bevel", type="BEVEL")
        modifier.width = min(bevel_width, min(item["dimensions"]) * 0.24)
        modifier.segments = 3
    bpy.context.view_layer.update()
    return obj


def animate_object(obj, keyframes):
    for keyframe in keyframes:
        obj.location = keyframe["location"]
        obj.rotation_euler = [math.radians(value) for value in keyframe.get("rotation", [0, 0, 0])]
        obj.keyframe_insert(data_path="location", frame=keyframe["frame"])
        obj.keyframe_insert(data_path="rotation_euler", frame=keyframe["frame"])


def animate_object_track(obj, track):
    # Replay a JS-baked per-frame track: one key per frame, LINEAR between them, so any
    # authored easing (already baked into the samples) reproduces byte-for-byte.
    for sample in track:
        obj.location = sample["location"]
        obj.rotation_euler = [math.radians(value) for value in sample.get("rotation", [0, 0, 0])]
        obj.keyframe_insert(data_path="location", frame=sample["frame"])
        obj.keyframe_insert(data_path="rotation_euler", frame=sample["frame"])


def set_local_parent(child, parent):
    # Identity parent-inverse makes the child's authored transform local to the parent,
    # so children follow correctly when the parent animates (no baked world offset).
    child.parent = parent
    child.matrix_parent_inverse = Matrix.Identity(4)


def create_primitive(item):
    obj = build_mesh(item, item["id"])
    # Prefer the JS-baked per-frame track (rig-aware, eased); fall back to legacy
    # sparse keyframes for compiled output produced before tracks existed.
    if item.get("track"):
        animate_object_track(obj, item["track"])
    else:
        animate_object(obj, item["keyframes"])
    return obj


def create_part(part, owner_id, target_collection=None):
    obj = build_mesh(part, f"{owner_id}--{part['id']}")
    obj.location = part.get("location", [0, 0, 0])
    obj.rotation_euler = [math.radians(value) for value in part.get("rotation", [0, 0, 0])]
    if target_collection is not None:
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        target_collection.objects.link(obj)
    return obj


def create_anchors(anchors, prefix, parent_obj, target_collection=None):
    # Phase 1 semantic anchors are visualised as parented marker empties; no physics is solved.
    for anchor in anchors or []:
        marker = bpy.data.objects.new(f"anchor-{prefix}-{anchor['id']}", None)
        marker.empty_display_type = "SPHERE"
        marker.empty_display_size = 0.12
        if target_collection is not None:
            target_collection.objects.link(marker)
        else:
            bpy.context.collection.objects.link(marker)
        if parent_obj is not None:
            set_local_parent(marker, parent_obj)
        marker.location = anchor["position"]
        direction = anchor.get("direction")
        if direction and any(direction):
            vector = Vector(direction)
            if vector.length > 0:
                marker.rotation_euler = vector.to_track_quat("Z", "Y").to_euler()


def link_part_hierarchy(part_objs, root):
    for part_id, (obj, part) in part_objs.items():
        parent_part = part.get("parentPart")
        if parent_part and parent_part in part_objs:
            set_local_parent(obj, part_objs[parent_part][0])
        elif root is not None:
            set_local_parent(obj, root)


def create_compound(compound):
    root = bpy.data.objects.new(compound["id"], None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.3
    bpy.context.collection.objects.link(root)
    part_objs = {}
    for part in compound["parts"]:
        part_objs[part["id"]] = (create_part(part, compound["id"]), part)
    link_part_hierarchy(part_objs, root)
    animate_object(root, compound["keyframes"])
    create_anchors(compound.get("anchors"), compound["id"], root)
    for part_id, (obj, part) in part_objs.items():
        create_anchors(part.get("anchors"), f"{compound['id']}-{part_id}", obj)
    return root


def build_template_collection(template):
    # A template is defined once in its own (unrendered) collection; instances reference it,
    # so shared geometry is never duplicated into the scene.
    collection = bpy.data.collections.new(f"template-{template['id']}")
    part_objs = {}
    for part in template["parts"]:
        part_objs[part["id"]] = (create_part(part, template["id"], collection), part)
    link_part_hierarchy(part_objs, None)
    create_anchors(template.get("anchors"), template["id"], None, collection)
    for part_id, (obj, part) in part_objs.items():
        create_anchors(part.get("anchors"), f"{template['id']}-{part_id}", obj, collection)
    return collection


def create_instance(instance, template_collections):
    collection = template_collections[instance["template"]]
    empty = bpy.data.objects.new(instance["id"], None)
    empty.instance_type = "COLLECTION"
    empty.instance_collection = collection
    empty.empty_display_type = "ARROWS"
    empty.empty_display_size = 0.25
    bpy.context.collection.objects.link(empty)
    animate_object(empty, instance["keyframes"])
    return empty


def create_ground(world):
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, -0.1))
    ground = bpy.context.object
    ground.name = "ground"
    ground.dimensions = (world["groundSize"][0], world["groundSize"][1], 0.2)
    ground.color = (*world["groundColor"], 1.0)
    ground.data.materials.append(make_material("ground", world["groundColor"], "desert"))
    bpy.context.view_layer.update()


def create_lights(world):
    for item in world.get("lights", []):
        light_data = bpy.data.lights.new(item["id"], type=item["type"].upper())
        light_data.color = item["color"]
        light_data.energy = item["energy"]
        if item["type"] == "area":
            light_data.shape = "DISK"
            light_data.size = item.get("size", 3.0)
        elif item["type"] == "sun":
            light_data.angle = math.radians(item.get("size", 4.0))
        elif item["type"] in ("point", "spot"):
            light_data.shadow_soft_size = item.get("size", 0.5)
        if item["type"] == "spot":
            light_data.spot_size = math.radians(item.get("spotSize", 45))
            light_data.spot_blend = 0.45
        light = bpy.data.objects.new(item["id"], light_data)
        light.location = item["location"]
        light.rotation_euler = [math.radians(value) for value in item["rotation"]]
        bpy.context.collection.objects.link(light)


def configure_world(world_spec):
    world = bpy.context.scene.world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    background = nodes.new(type="ShaderNodeBackground")
    background.inputs["Color"].default_value = (*world_spec["background"], 1.0)
    background.inputs["Strength"].default_value = 0.12
    output = nodes.new(type="ShaderNodeOutputWorld")
    links.new(background.outputs["Background"], output.inputs["Surface"])
    density = world_spec.get("render", {}).get("volumeDensity", 0)
    if density > 0:
        volume = nodes.new(type="ShaderNodeVolumeScatter")
        volume.inputs["Color"].default_value = (0.62, 0.38, 0.18, 1.0)
        volume.inputs["Density"].default_value = density
        volume.inputs["Anisotropy"].default_value = 0.35
        links.new(volume.outputs["Volume"], output.inputs["Volume"])


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
    if camera_spec.get("fStop") is not None:
        camera_data.dof.use_dof = True
        camera_data.dof.focus_object = target
        camera_data.dof.aperture_fstop = camera_spec["fStop"]
    for keyframe in camera_spec["keyframes"]:
        camera.location = keyframe["location"]
        camera_data.lens = keyframe["lensMm"]
        target.location = keyframe["target"]
        camera.keyframe_insert(data_path="location", frame=keyframe["frame"])
        camera_data.keyframe_insert(data_path="lens", frame=keyframe["frame"])
        target.keyframe_insert(data_path="location", frame=keyframe["frame"])
    bpy.context.scene.camera = camera
    return camera, target


def camera_look_at_matrix(location, aim, roll_degrees):
    # Reproduce the telemetry pass's orientation basis exactly: forward = aim - location,
    # right = forward x worldUp, up = right x forward, then roll around forward. The Blender
    # camera looks down local -Z with +Y up, so its basis columns are (right, up, -forward).
    location = Vector(location)
    forward = Vector(aim) - location
    if forward.length < 1e-9:
        forward = Vector((0.0, 1.0, 0.0))
    forward.normalize()
    right = forward.cross(Vector((0.0, 0.0, 1.0)))
    if right.length < 1e-6:
        right = Vector((1.0, 0.0, 0.0))
    right.normalize()
    up = right.cross(forward)
    if roll_degrees:
        roll = Quaternion(forward, math.radians(roll_degrees))
        right.rotate(roll)
        up.rotate(roll)
    basis = Matrix((
        (right.x, up.x, -forward.x),
        (right.y, up.y, -forward.y),
        (right.z, up.z, -forward.z),
    )).to_4x4()
    basis.translation = location
    return basis


def create_camera_from_spec_track(camera_spec):
    # Replay the JS-baked camera track. The look direction, roll, lens, and focus are baked
    # per frame, so we key the full world matrix (no TRACK_TO constraint) to honour roll and
    # match telemetry's framing, then interpolate LINEARLY between frames.
    track = camera_spec["track"]
    camera_data = bpy.data.cameras.new("previs-camera")
    camera_data.sensor_width = camera_spec["sensorWidthMm"]
    camera = bpy.data.objects.new("previs-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.view_layer.update()
    use_dof = camera_spec.get("fStop") is not None
    if use_dof:
        camera_data.dof.use_dof = True
        camera_data.dof.aperture_fstop = camera_spec["fStop"]
    for sample in track:
        frame = sample["frame"]
        camera.matrix_world = camera_look_at_matrix(sample["location"], sample["aim"], sample.get("roll", 0.0))
        camera_data.lens = sample["lensMm"]
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
        camera_data.keyframe_insert(data_path="lens", frame=frame)
        if use_dof and sample.get("focusDistance"):
            camera_data.dof.focus_distance = sample["focusDistance"]
            camera_data.dof.keyframe_insert(data_path="focus_distance", frame=frame)
    bpy.context.scene.camera = camera
    return camera, None


def create_camera_from_track(track):
    # Import a recorded track: bake the evaluated per-frame world matrix, lens and DOF
    # straight onto an unparented camera so the imported render reproduces the trajectory.
    frames = track["frames"]
    camera_data = bpy.data.cameras.new("previs-camera")
    camera = bpy.data.objects.new("previs-camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.view_layer.update()
    use_dof = any(frame.get("fStop") for frame in frames)
    if use_dof:
        camera_data.dof.use_dof = True
    for frame in frames:
        values = frame["matrix"]
        camera.matrix_world = Matrix((values[0:4], values[4:8], values[8:12], values[12:16]))
        camera_data.lens = frame["lensMm"]
        camera_data.sensor_width = frame["sensorWidthMm"]
        camera_data.shift_x = frame.get("sensorShiftX", 0.0)
        camera_data.shift_y = frame.get("sensorShiftY", 0.0)
        index = frame["frame"]
        camera.keyframe_insert(data_path="location", frame=index)
        camera.keyframe_insert(data_path="rotation_euler", frame=index)
        camera_data.keyframe_insert(data_path="lens", frame=index)
        if use_dof and frame.get("fStop"):
            camera_data.dof.aperture_fstop = frame["fStop"]
            camera_data.dof.keyframe_insert(data_path="dof.aperture_fstop", frame=index)
            if frame.get("focusDistance"):
                camera_data.dof.focus_distance = frame["focusDistance"]
                camera_data.dof.keyframe_insert(data_path="dof.focus_distance", frame=index)
    bpy.context.scene.camera = camera
    return camera, None


def set_action_curves_linear(action):
    # Baked per-frame tracks (and legacy keyframes) must interpolate LINEARLY between
    # samples: authored easing is already baked into the JS track sample-by-sample, so
    # Blender only has to connect adjacent frames straight to reproduce it exactly
    # (including under sub-frame motion blur). Handles both classic and 4.4+ slotted actions.
    if hasattr(action, "fcurves") and len(action.fcurves):
        set_curves_linear(action.fcurves)
        return
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for channel_bag in strip.channelbags:
                set_curves_linear(channel_bag.fcurves)


def linearize(objects):
    # Scoped replacement for a global fcurve sweep: only the objects and cameras we
    # animated here are flattened to LINEAR, leaving any other action untouched.
    for obj in objects:
        if obj is None:
            continue
        for holder in (obj, getattr(obj, "data", None)):
            anim = getattr(holder, "animation_data", None)
            if anim is not None and anim.action is not None:
                set_action_curves_linear(anim.action)


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
    render_spec = spec["world"].get("render", {"engine": "workbench", "samples": 1})
    if render_spec["engine"] == "cycles":
        scene.render.engine = "CYCLES"
        scene.cycles.samples = render_spec["samples"]
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 6
        scene.cycles.diffuse_bounces = 3
        scene.cycles.glossy_bounces = 3
        scene.cycles.transmission_bounces = 4
        scene.render.use_motion_blur = True
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
        configure_world(spec["world"])
    else:
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
    camera_track = None
    if options.camera_track:
        with Path(options.camera_track).resolve().open("r", encoding="utf-8") as handle:
            camera_track = json.load(handle)
    clear_scene()
    configure_scene(spec, output)
    create_ground(spec["world"])
    # Phase 1: create every placed body so parent references resolve regardless of declaration order.
    object_map = {}
    for item in spec["objects"]:
        object_map[item["id"]] = create_primitive(item)
    # Phase 2: wire parent relationships and local-space anchors once all objects exist.
    for item in spec["objects"]:
        parent_id = item.get("parentId")
        if parent_id and parent_id in object_map:
            set_local_parent(object_map[item["id"]], object_map[parent_id])
    for item in spec["objects"]:
        create_anchors(item.get("anchors"), item["id"], object_map[item["id"]])
    # Track every object and camera we animate so their curves — and only theirs — are
    # flattened to LINEAR afterwards, replacing the previous global fcurve sweep.
    animated = list(object_map.values())
    for compound in spec.get("compounds", []):
        animated.append(create_compound(compound))
    template_collections = {}
    for template in spec.get("templates", []):
        template_collections[template["id"]] = build_template_collection(template)
    for instance in spec.get("instances", []):
        animated.append(create_instance(instance, template_collections))
    create_lights(spec["world"])
    if camera_track is not None:
        camera_obj, _ = create_camera_from_track(camera_track)
        camera_source = "camera-track"
    elif spec["camera"].get("track"):
        camera_obj, _ = create_camera_from_spec_track(spec["camera"])
        camera_source = "spec-track"
    else:
        camera_obj, _ = create_camera(spec["camera"])
        camera_source = "spec"
    animated.append(camera_obj)
    linearize(animated)
    blend_file = output / "previs.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_file))
    timeline = spec["timeline"]
    expected_frame_count = timeline["frameEnd"] - timeline["frameStart"] + 1
    if options.render:
        bpy.ops.render.render(animation=True)
    rendered_files = sorted((output / "frames").glob("frame_*.png")) if options.render else []
    expected_names = {
        f"frame_{frame:04d}.png"
        for frame in range(timeline["frameStart"], timeline["frameEnd"] + 1)
    }
    valid_expected_files = [
        file for file in rendered_files
        if file.name in expected_names and file.stat().st_size > 0
    ]
    unexpected_files = [file for file in rendered_files if file.name not in expected_names]
    empty_files = [file for file in rendered_files if file.name in expected_names and file.stat().st_size == 0]
    rendered_frame_count = len(valid_expected_files)
    render_completed = (
        options.render
        and rendered_frame_count == expected_frame_count
        and not unexpected_files
        and not empty_files
    )
    report = {
        "version": 1,
        "shotId": spec["id"],
        "blenderVersion": bpy.app.version_string,
        "status": "frames-complete" if render_completed else "scene-only-complete" if not options.render else "frames-incomplete",
        "frameStart": timeline["frameStart"],
        "frameEnd": timeline["frameEnd"],
        "expectedFrameCount": expected_frame_count,
        "renderRequested": options.render,
        "renderCompleted": render_completed,
        "renderedFrameCount": rendered_frame_count,
        "unexpectedFrameCount": len(unexpected_files),
        "emptyFrameCount": len(empty_files),
        "fps": timeline["fps"],
        "resolution": spec["resolution"],
        "objectCount": len(spec["objects"]),
        "compoundCount": len(spec.get("compounds", [])),
        "templateCount": len(spec.get("templates", [])),
        "instanceCount": len(spec.get("instances", [])),
        "cameraSource": camera_source,
        "sceneSaved": blend_file.exists() and blend_file.stat().st_size > 0,
        "encoded": False,
        "files": ["previs.blend"] + (["frames/"] if options.render else []),
    }
    with (output / "render-report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print(json.dumps(report))
    if options.render and not render_completed:
        raise RuntimeError(
            f"Blender produced {rendered_frame_count} of {expected_frame_count} expected frames"
        )


if __name__ == "__main__":
    main()

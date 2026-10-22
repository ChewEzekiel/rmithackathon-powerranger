"""Treaty Room 3D hero shots, built procedurally and rendered headless with EEVEE.

  blender -b --factory-startup -P shots.py -- <shot> [--still F] [--res 1920x1080] [--samples 24]

shot: vault_unseal | ork_ring | sealed_deposit
--still F renders one frame to test_<shot>_F.png; otherwise renders frames/<shot>/ and encodes <shot>.mp4.
"""
import bmesh, bpy, math, os, random, subprocess, sys, time
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.path.normpath(os.path.join(HERE, "..", "bin", "ffmpeg.exe"))
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["vault_unseal"]
SHOT = args[0]
opt = dict(zip(args[1::2], args[2::2]))
RES = tuple(int(v) for v in opt.get("--res", "1920x1080").split("x"))
SAMPLES = int(opt.get("--samples", 16))


def lin(c):  # sRGB 0-255 -> linear
    return tuple(((v / 255 + 0.055) / 1.055) ** 2.4 for v in c)


# palette shared with make_video.py
INDIGO, VIOLET, SKY = lin((129, 140, 248)), lin((167, 139, 250)), lin((56, 189, 248))
TEAL, AMBER, RED, WHITE = lin((52, 211, 153)), lin((251, 191, 36)), lin((248, 113, 113)), lin((248, 250, 252))
BG_TOP, BG_BOTTOM = lin((9, 10, 28)), lin((28, 24, 72))
R90 = math.radians(90)
COL = None  # scene collection


# ---------------------------------------------------------------- helpers
def link(o):
    COL.objects.link(o)
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    o = link(bpy.data.objects.new(name, None))
    o.location, o.parent = loc, parent
    return o


def prim(kind, name, mat=None, parent=None, bevel=0.0, **kw):
    getattr(bpy.ops.mesh, f"primitive_{kind}_add")(**kw)
    o = bpy.context.active_object
    o.name = name
    if mat:
        o.data.materials.append(mat)
    if bevel:
        m = o.modifiers.new("bev", "BEVEL")
        m.width, m.segments, m.limit_method = bevel, 2, "ANGLE"
    o.parent = parent  # identity parent-inverse: location is in parent space
    return o


def mesh_obj(name, bm, mat=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = link(bpy.data.objects.new(name, me))
    if mat:
        me.materials.append(mat)
    o.parent = parent
    return o


def cut(o, keep):
    """Delete vertices of o's mesh where keep(co) is False (used to split tori into arcs)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    return o


def new_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    return m


def emit(name, color, strength):
    m = new_mat(name)
    nt = m.node_tree
    nt.nodes.clear()
    e, out = nt.nodes.new("ShaderNodeEmission"), nt.nodes.new("ShaderNodeOutputMaterial")
    e.name = "E"
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


def metal(name, base=(0.035, 0.04, 0.075), rough=0.32, met=0.85):
    m = new_mat(name)
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*base, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = met
    return m


def kemit(m, f, color=None, strength=None):
    e = m.node_tree.nodes["E"]
    if color is not None:
        e.inputs["Color"].default_value = (*color, 1)
        e.inputs["Color"].keyframe_insert("default_value", frame=f)
    if strength is not None:
        e.inputs["Strength"].default_value = strength
        e.inputs["Strength"].keyframe_insert("default_value", frame=f)


def key(o, f, **props):
    for k, v in props.items():
        setattr(o, k, v)
        o.keyframe_insert(k, frame=f)


def beam(name, p0, p1, r, mat, parent=None):
    """Thin cylinder with its origin at p0 pointing at p1, so scale.z grows it from p0."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=r, radius2=r, depth=L)
    for v in bm.verts:
        v.co.z += L / 2
    o = mesh_obj(name, bm, mat, parent)
    o.location = p0
    o.rotation_euler = (p1 - p0).to_track_quat("Z", "Y").to_euler()
    return o


# ---------------------------------------------------------------- scene setup
def setup(frames):
    global COL
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    sc = bpy.context.scene
    COL = sc.collection
    sc.frame_start, sc.frame_end = 1, frames
    r = sc.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_x, r.resolution_y, r.resolution_percentage = *RES, 100
    r.fps = 30
    r.use_motion_blur, r.motion_blur_shutter = True, 0.5
    sc.eevee.taa_render_samples = SAMPLES
    if hasattr(r, "compositor_device"):
        r.compositor_device = "GPU"
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    sc.view_settings.view_transform = "AgX"
    for look in ("AgX - Punchy", "Punchy"):
        try:
            sc.view_settings.look = look
            break
        except TypeError:
            pass

    # world: vertical indigo gradient matching the 2D background (dark top, lighter bottom)
    w = bpy.data.worlds.new("W")
    sc.world = w
    try:
        w.use_nodes = True
    except AttributeError:
        pass
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc, sep, mr, ramp = (nt.nodes.new(t) for t in ("ShaderNodeTexCoord", "ShaderNodeSeparateXYZ",
                                                    "ShaderNodeMapRange", "ShaderNodeValToRGB"))
    mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = -0.35, 0.35
    ramp.color_ramp.elements[0].color = (*BG_BOTTOM, 1)
    ramp.color_ramp.elements[1].color = (*BG_TOP, 1)
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])

    # compositor: bloom + a hair of chromatic dispersion (Blender 5 node-group compositor)
    ng = bpy.data.node_groups.new("comp", "CompositorNodeTree")
    sc.compositing_node_group = ng
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl, gl, ld, out = (ng.nodes.new(t) for t in ("CompositorNodeRLayers", "CompositorNodeGlare",
                                                 "CompositorNodeLensdist", "NodeGroupOutput"))
    gl.inputs["Type"].default_value = "Bloom"
    gl.inputs["Quality"].default_value = "High"
    gl.inputs["Threshold"].default_value = 0.45
    gl.inputs["Strength"].default_value = 0.75
    gl.inputs["Size"].default_value = 0.8
    ld.inputs["Dispersion"].default_value = 0.012
    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ng.links.new(gl.outputs["Image"], ld.inputs["Image"])
    ng.links.new(ld.outputs["Image"], out.inputs[0])

    # three-point rig: cool key, violet rim, faint teal under-fill
    for name, loc, energy, color, size in (("key", (-6, -7, 7), 900, (0.75, 0.8, 1.0), 6),
                                            ("rim", (5, 7, 4), 1400, VIOLET, 5),
                                            ("fill", (4, -5, -4), 250, TEAL, 4)):
        d = bpy.data.lights.new(name, "AREA")
        d.energy, d.color, d.size = energy, color, size
        o = link(bpy.data.objects.new(name, d))
        o.location = loc
        o.rotation_euler = (-Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return sc


def dust(n=80, seed=7, box=((-9, 9), (-6, 14), (-4, 7))):
    """Tiny emissive specks; DoF turns them into soft bokeh."""
    rnd = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
    proto = bpy.context.active_object
    me = proto.data
    bpy.data.objects.remove(proto)
    mats = [emit("dustA", INDIGO, 5), emit("dustB", VIOLET, 4), emit("dustC", SKY, 3)]
    me.materials.append(mats[0])
    for i in range(n):
        o = link(bpy.data.objects.new(f"dust{i}", me))
        o.location = [rnd.uniform(*b) for b in box]
        o.scale = [rnd.uniform(0.015, 0.04)] * 3
        o.material_slots[0].link = "OBJECT"
        o.material_slots[0].material = mats[i % 3]


def camera(frames, loc0, loc1, aim0, aim1, foc, lens=35, fstop=2.8, parent=None):
    """Camera tracking an aim empty; foc = [(frame, (x,y,z)), ...] keys for the focus empty."""
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    cd.dof.use_dof, cd.dof.aperture_fstop = True, fstop
    cam = link(bpy.data.objects.new("cam", cd))
    cam.parent = parent
    aim, focus = empty("aim"), empty("focus")
    cd.dof.focus_object = focus
    c = cam.constraints.new("TRACK_TO")
    c.target, c.track_axis, c.up_axis = aim, "TRACK_NEGATIVE_Z", "UP_Y"
    key(cam, 1, location=loc0)
    key(cam, frames, location=loc1)
    key(aim, 1, location=aim0)
    key(aim, frames, location=aim1)
    for f, p in foc:
        key(focus, f, location=p)
    bpy.context.scene.camera = cam
    return cam


# ---------------------------------------------------------------- shared props
def build_vault(lock_color):
    """Round vault: fixed frame + tunnel, door on a hinge, two-piece glowing ring lock.
    Built facing -Y at the origin; returns handles for animation."""
    V = {}
    root = V["root"] = empty("vault")
    steel, dark = metal("steel"), metal("steelDark", base=(0.02, 0.022, 0.045), rough=0.45)
    V["rimglow"] = rimglow = emit("rimGlow", INDIGO, 3)
    prim("torus", "frame", steel, root, major_radius=2.08, minor_radius=0.2, major_segments=64,
         minor_segments=12, rotation=(R90, 0, 0))
    prim("torus", "frameGlow", rimglow, root, major_radius=2.4, minor_radius=0.018, major_segments=96,
         minor_segments=6, rotation=(R90, 0, 0))
    for i in range(16):  # mechanical teeth around the frame
        a = i / 16 * math.tau
        prim("cube", f"tooth{i}", dark, root, bevel=0.01, size=1, location=(2.22 * math.cos(a), 0.05, 2.22 * math.sin(a)),
             rotation=(0, -a, 0), scale=(0.22, 0.32, 0.09))
    # tunnel behind the door (seen only when open) + back glow + light
    t = prim("cylinder", "tunnel", dark, root, vertices=48, radius=1.95, depth=2.4, end_fill_type="NOTHING",
             location=(0, 1.2, 0), rotation=(R90, 0, 0))
    V["ribs"] = ribs = emit("ribs", INDIGO, 0)
    for i, y in enumerate((0.6, 1.2, 1.8)):
        prim("torus", f"rib{i}", ribs, root, major_radius=1.9, minor_radius=0.02, major_segments=64, minor_segments=6,
             location=(0, y, 0), rotation=(R90, 0, 0))
    V["core"] = emit("core", (0.55, 1.0, 0.85), 0)
    prim("cylinder", "backGlow", V["core"], root, vertices=48, radius=1.92, depth=0.02, location=(0, 2.35, 0),
         rotation=(R90, 0, 0))
    ld = bpy.data.lights.new("vaultLight", "POINT")
    ld.color, ld.energy = TEAL, 0
    V["light"] = ld
    link(bpy.data.objects.new("vaultLight", ld)).parent = root
    COL.objects["vaultLight"].location = (0, 0.9, 0)

    # door on hinge
    hinge = V["hinge"] = empty("hinge", (-1.9, -0.05, 0), root)
    door = V["door"] = empty("doorRoot", (1.9, 0.05, 0), hinge)  # back at vault origin: children use vault coords
    prim("cylinder", "door", steel, door, bevel=0.04, vertices=64, radius=1.88, depth=0.32, location=(0, -0.12, 0),
         rotation=(R90, 0, 0))
    deco = emit("doorDeco", INDIGO, 1.4)
    for i, rr in enumerate((1.55, 1.12)):
        prim("torus", f"groove{i}", deco, door, major_radius=rr, minor_radius=0.02, major_segments=96,
             minor_segments=6, location=(0, -0.28, 0), rotation=(R90, 0, 0))
    V["bolt"] = bolt = emit("bolt", INDIGO, 3)
    for i in range(8):
        a = i / 8 * math.tau + math.pi / 8
        prim("cylinder", f"bolt{i}", bolt, door, vertices=12, radius=0.07, depth=0.06,
             location=(1.73 * math.cos(a), -0.29, 1.73 * math.sin(a)), rotation=(R90, 0, 0))
    for i in range(6):  # spokes
        a = i / 6 * math.tau
        prim("cube", f"spoke{i}", dark, door, bevel=0.01, size=1, location=(1.33 * math.cos(a), -0.3, 1.33 * math.sin(a)),
             rotation=(0, -a, 0), scale=(0.34, 0.05, 0.07))
    prim("cylinder", "hub", dark, door, bevel=0.02, vertices=32, radius=0.5, depth=0.12, location=(0, -0.32, 0),
         rotation=(R90, 0, 0))
    V["lock"] = lock = emit("lock", lock_color, 6)
    prim("cylinder", "hubCore", lock, door, vertices=6, radius=0.2, depth=0.05, location=(0, -0.39, 0),
         rotation=(R90, 0, 0))
    piv = V["lockPivot"] = empty("lockPivot", (0, -0.3, 0), door)
    V["halves"] = []
    for side in (1, -1):
        h = prim("torus", f"lockHalf{side}", lock, piv, major_radius=0.74, minor_radius=0.075, major_segments=48,
                 minor_segments=10, rotation=(R90, 0, 0))
        cut(h, lambda co, s=side: co.x * s >= -1e-4)
        V["halves"].append(h)
    return V


def slab(name, mat_body, mat_lines, parent=None):
    """Document slab (1.1 x 1.5) facing -Y with glowing text lines; returns a holder empty (animate this)."""
    o = empty(name, parent=parent)
    prim("cube", f"{name}Body", mat_body, o, bevel=0.025, size=1, scale=(1.1, 0.08, 1.5))
    for i, (w, z) in enumerate(((0.7, 0.5), (0.85, 0.3), (0.85, 0.15), (0.6, 0.0), (0.85, -0.25), (0.5, -0.4))):
        prim("cube", f"{name}L{i}", mat_lines, o, size=1, scale=(w, 0.03, 0.035), location=(-(0.85 - w) / 2, -0.045, z))
    return o


def slab_mats(tag):
    body = new_mat(f"slabBody{tag}")
    p = body.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.03, 0.035, 0.09, 1)
    p.inputs["Roughness"].default_value = 0.25
    p.inputs["Metallic"].default_value = 0.3
    p.inputs["Emission Color"].default_value = (*INDIGO, 1)
    p.inputs["Emission Strength"].default_value = 0.6
    return body, emit(f"slabLines{tag}", (0.75, 0.95, 1.0), 6)


def shield_mesh(w=0.5, top=0.62, mid=0.12, bot=-0.7):
    pts = [(w, top), (w, mid)]
    c = (w * 0.95, (mid + bot) * 0.62)
    for i in range(1, 8):
        t = i / 7
        pts.append(((1 - t) ** 2 * w + 2 * (1 - t) * t * c[0], (1 - t) ** 2 * mid + 2 * (1 - t) * t * c[1] + t * t * bot))
    pts += [(-x, y) for x, y in reversed(pts[:-1])]
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, y, 0)) for x, y in pts])
    f.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
    inner = bmesh.ops.inset_region(bm, faces=[f], thickness=0.07, depth=-0.025)
    f.material_index = 1
    return bm


def shield(name, letter, face_mat, parent=None):
    o = mesh_obj(name, shield_mesh(), metal(f"{name}Steel"), parent)
    o.data.materials.append(face_mat)
    s = o.modifiers.new("sol", "SOLIDIFY")
    s.thickness, s.offset = 0.12, -1
    b = o.modifiers.new("bev", "BEVEL")
    b.width, b.segments, b.limit_method = 0.012, 2, "ANGLE"
    cu = bpy.data.curves.new(f"{name}T", "FONT")
    cu.body, cu.size, cu.extrude, cu.align_x, cu.align_y = letter, 0.62, 0.012, "CENTER", "CENTER"
    t = link(bpy.data.objects.new(f"{name}T", cu))
    t.data.materials.append(metal(f"{name}Ink", base=(0.01, 0.01, 0.02), rough=0.5, met=0.2))
    t.parent, t.location = o, (0, -0.02, 0.0)
    return o


# ---------------------------------------------------------------- shots
def shot_vault_unseal():
    F = 180
    sc = setup(F)
    dust()
    V = build_vault(AMBER)
    camera(F, (0.9, -13.2, 1.8), (-0.5, -11.4, 1.3), (0, 0, 0.75), (0, -1.0, 0.65),
           [(1, (0, -0.3, 0.6)), (110, (0, -0.3, 0.6)), (160, (0, -2.4, 0.1))], lens=35, fstop=3.2)

    # institution shields hovering above the vault (N, H, A); N and H co-sign 0.8 s apart
    sign = {"N": 30, "H": 54}
    for i, (ltr, col, x, z) in enumerate((("N", INDIGO, -1.75, 2.8), ("H", VIOLET, 0, 3.0), ("A", SKY, 1.75, 2.8))):
        face = emit(f"face{ltr}", col, 2.2)
        sh = shield(f"shield{ltr}", ltr, face)
        sh.rotation_euler = (R90, 0, 0)
        base = Vector((x, -0.5, z))
        for f in range(1, F + 1, 15):  # slow hover bob + sway
            ph = f / 30 * 1.3 + i * 2.1
            key(sh, f, location=base + Vector((0, 0, 0.07 * math.sin(ph))),
                rotation_euler=(R90, 0, math.radians(7 * math.sin(ph * 0.7))))
        s0 = 0.78
        key(sh, 1, scale=(s0,) * 3)
        if ltr in sign:
            f0 = sign[ltr]
            kemit(face, f0 - 1, col, 2.2)
            kemit(face, f0 + 3, TEAL, 22)
            kemit(face, f0 + 14, TEAL, 7)
            key(sh, f0 - 1, scale=(s0,) * 3)
            key(sh, f0 + 3, scale=(s0 * 1.14,) * 3)
            key(sh, f0 + 11, scale=(s0,) * 3)
            # pulse ring
            pm = emit(f"pulse{ltr}", TEAL, 0)
            pr = prim("torus", f"pulse{ltr}", pm, major_radius=0.85, minor_radius=0.02, major_segments=64,
                      minor_segments=6, location=base, rotation=(R90, 0, 0))
            key(pr, f0 - 1, scale=(0.001,) * 3)
            key(pr, f0, scale=(0.5,) * 3)
            kemit(pm, f0, strength=0)
            kemit(pm, f0 + 2, strength=16)
            key(pr, f0 + 22, scale=(2.1,) * 3)
            kemit(pm, f0 + 22, strength=0)
            key(pr, f0 + 23, scale=(0.001,) * 3)  # zero-strength emission renders black: hide it
            # signature beam down to the lock
            bm_ = emit(f"beam{ltr}", TEAL, 0)
            b = beam(f"beam{ltr}", base + Vector((0, 0, -0.5)), (0, -0.35, 0.05), 0.016, bm_)
            key(b, f0 + 2, scale=(1, 1, 0.001))
            kemit(bm_, f0 + 2, strength=12)
            key(b, f0 + 10, scale=(1, 1, 1))
            kemit(bm_, f0 + 16, strength=4)
            kemit(bm_, 100, strength=4)
            kemit(bm_, 112, strength=0)
            key(b, 112, scale=(1, 1, 1))
            key(b, 113, scale=(1, 1, 0.001))

    # quorum reached: lock turns teal, rotates, splits; door swings open
    lock, piv = V["lock"], V["lockPivot"]
    kemit(lock, 58, AMBER, 6)
    kemit(lock, 64, TEAL, 16)
    kemit(lock, 76, TEAL, 8)
    key(piv, 62, rotation_euler=(0, 0, 0))
    key(piv, 92, rotation_euler=(0, math.pi, 0))
    for h, s in zip(V["halves"], (1, -1)):
        key(h, 92, location=(0, 0, 0))
        key(h, 104, location=(0.5 * s, 0, 0))
    kemit(V["bolt"], 92, INDIGO, 3)
    kemit(V["bolt"], 102, TEAL, 8)
    key(V["hinge"], 104, rotation_euler=(0, 0, 0))
    key(V["hinge"], 144, rotation_euler=(0, 0, math.radians(-110)))
    kemit(V["core"], 102, strength=0)
    kemit(V["core"], 130, strength=2.5)
    kemit(V["ribs"], 102, strength=0)
    kemit(V["ribs"], 125, strength=3)
    V["light"].energy = 0
    V["light"].keyframe_insert("energy", frame=102)
    V["light"].energy = 500
    V["light"].keyframe_insert("energy", frame=130)

    # three document slabs glide out side by side
    body, lines = slab_mats("")
    for i, (x1, yaw, f0) in enumerate(((-1.45, 12, 120), (0, 0, 114), (1.45, -12, 120))):
        s = slab(f"slab{i}", body, lines)
        key(s, f0, location=(x1 * 0.3, 1.7, 0), scale=(0.6, 0.6, 0.6), rotation_euler=(0, 0, 0))
        key(s, f0 + 48, location=(x1, -2.4, 0.05), scale=(1, 1, 1),
            rotation_euler=(math.radians(-4), 0, math.radians(yaw)))
        key(s, F, location=(x1, -2.55, 0.1))
    kemit(lines, 112, strength=0)
    kemit(lines, 140, strength=7)
    return sc


def shot_ork_ring():
    F = 180
    sc = setup(F)
    dust(seed=11, box=((-10, 10), (-10, 10), (-3, 6)))
    rig = empty("camRig")
    key(rig, 1, rotation_euler=(0, 0, 0))
    key(rig, F, rotation_euler=(0, 0, math.radians(40)))
    camera(F, (0, -10.5, 4.3), (0, -10.0, 3.9), (0, 0, 0.55), (0, 0, 0.6),
           [(1, (0, 0, 0.6))], lens=35, fstop=2.4, parent=rig)

    N, R = 14, 3.5
    ring = emit("ring", INDIGO, 1.6)
    prim("torus", "ring", ring, major_radius=R, minor_radius=0.014, major_segments=128, minor_segments=6)
    prim("torus", "ring2", emit("ring2", VIOLET, 0.8), major_radius=R + 0.45, minor_radius=0.008,
         major_segments=128, minor_segments=4)
    pad = metal("pad")
    for i in range(N):
        a = i / N * math.tau - math.pi / 2
        p = Vector((R * math.cos(a), R * math.sin(a), 0))
        f0 = 18 + i * 6
        m = emit(f"node{i}", INDIGO, 3)
        prim("ico_sphere", f"node{i}", m, subdivisions=1, radius=0.17, location=p)
        prim("cylinder", f"pad{i}", pad, bevel=0.01, vertices=6, radius=0.26, depth=0.06, location=p - Vector((0, 0, 0.24)))
        kemit(m, f0 - 1, INDIGO, 3)
        kemit(m, f0 + 2, TEAL, 30)
        kemit(m, f0 + 12, TEAL, 9)
        bmat = emit(f"beam{i}", TEAL, 0)
        b = beam(f"beam{i}", p, Vector((0, 0, 0.6)) + (p - Vector((0, 0, 0))).normalized() * 0.95, 0.012, bmat)
        key(b, f0, scale=(1, 1, 0.001))
        kemit(bmat, f0, strength=0)
        key(b, f0 + 6, scale=(1, 1, 1))
        kemit(bmat, f0 + 6, strength=14)
        kemit(bmat, f0 + 16, strength=3)
        kemit(bmat, 104, strength=3)
        kemit(bmat, 116, strength=10)
        kemit(bmat, 140, strength=3)

    # the key, built as separate fragments around a pivot; it never sits whole in one place
    piv = empty("keyPivot", (0, 0, 0.6))
    key(piv, 1, rotation_euler=(0, 0, 0))
    key(piv, F, rotation_euler=(0, 0, math.radians(-50)))
    km = emit("keyFrag", VIOLET, 5)
    frags = []
    for side in (1, -1):  # bow split top/bottom
        o = prim("torus", f"bow{side}", km, piv, major_radius=0.36, minor_radius=0.09, major_segments=32,
                 minor_segments=8, location=(-0.72, 0, 0), rotation=(R90, 0, 0))
        cut(o, lambda co, s=side: co.y * s >= -1e-4)
        frags.append((o, Vector((-0.32, 0, 0.32 * side))))
    sa = prim("cylinder", "shaftA", km, piv, vertices=8, radius=0.075, depth=0.62, location=(-0.05, 0, 0),
              rotation=(0, R90, 0))
    sb = prim("cylinder", "shaftB", km, piv, vertices=8, radius=0.075, depth=0.66, location=(0.62, 0, 0),
              rotation=(0, R90, 0))
    t1 = prim("cube", "teethA", km, piv, size=1, location=(0.58, 0, -0.17), scale=(0.12, 0.1, 0.22))
    t2 = prim("cube", "teethB", km, piv, size=1, location=(0.82, 0, -0.13), scale=(0.12, 0.1, 0.14))
    frags += [(sa, Vector((0.0, 0, 0.36))), (sb, Vector((0.38, 0, 0.18))), (t1, Vector((0.05, 0, -0.42))),
              (t2, Vector((0.42, 0, -0.34)))]
    rnd = random.Random(3)
    for o, off in frags:
        base, rot0 = o.location.copy(), o.rotation_euler.copy()
        tumble = Vector([rnd.uniform(-0.35, 0.35) for _ in range(3)])
        for f, k, tb in ((1, 1.0, 1), (60, 1.1, -0.6), (100, 1.0, 0.8), (116, 0.1, 0), (128, 0.1, 0),
                         (150, 1.0, 0.9), (F, 1.15, -0.4)):
            key(o, f, location=base + off * k, rotation_euler=Vector(rot0) + tumble * tb)
    kemit(km, 100, VIOLET, 5)
    kemit(km, 116, (0.7, 1.0, 0.95), 16)
    kemit(km, 128, (0.7, 1.0, 0.95), 16)
    kemit(km, 146, VIOLET, 5)
    halo = emit("halo", TEAL, 0)
    h = prim("torus", "halo", halo, major_radius=1.25, minor_radius=0.012, major_segments=96, minor_segments=4,
             location=(0, 0, 0.6))
    kemit(halo, 104, strength=0)
    kemit(halo, 118, strength=8)
    kemit(halo, 140, strength=0)
    key(h, 104, scale=(0.6,) * 3)
    key(h, 140, scale=(1.6,) * 3)
    return sc


def shot_sealed_deposit():
    F = 150
    sc = setup(F)
    dust(seed=5)
    V = build_vault(AMBER)
    root = V["root"]
    root.location, root.rotation_euler, root.scale = (2.0, 0.6, 0.0), (0, 0, math.radians(-25)), (0.85,) * 3
    bpy.context.view_layer.update()
    camera(F, (-1.2, -10.5, 1.7), (0.3, -9.6, 1.15), (-1.0, 0, 0.35), (0.9, 0, 0.25),
           [(1, (-2.4, -0.4, 0.25)), (55, (-2.4, -0.4, 0.25)), (95, (2.0, 0.3, 0.1))], lens=35, fstop=2.2)

    # incoming document slab
    body, lines = slab_mats("D")
    s = slab("deposit", body, lines)
    sl_loc, sl_rot = Vector((-2.4, -0.4, 0.25)), (0, 0, math.radians(14))
    key(s, 1, location=(-6.8, 0.8, 0.7), rotation_euler=(0, 0, math.radians(-25)))
    key(s, 34, location=sl_loc, rotation_euler=sl_rot)
    kemit(lines, 30, strength=6)
    kemit(lines, 37, strength=20)
    key(s, 37, hide_render=False)
    key(s, 38, hide_render=True)
    for c in s.children:
        key(c, 37, hide_render=False)
        key(c, 38, hide_render=True)

    # ciphertext cubes: same footprint as the slab, then peel off into the vault lock
    door_mw = root.matrix_world
    target = door_mw @ Vector((0, -0.35, 0))
    mw = Matrix.LocRotScale(sl_loc, Euler(sl_rot), Vector((1, 1, 1)))
    cm = new_mat("cipher")
    nt = cm.node_tree
    nt.nodes.clear()
    oi, e, out = nt.nodes.new("ShaderNodeObjectInfo"), nt.nodes.new("ShaderNodeEmission"), nt.nodes.new("ShaderNodeOutputMaterial")
    e.inputs["Strength"].default_value = 3.5
    nt.links.new(oi.outputs["Color"], e.inputs["Color"])
    nt.links.new(e.outputs[0], out.inputs[0])
    bpy.ops.mesh.primitive_cube_add(size=1)
    proto = bpy.context.active_object
    cme = proto.data
    bpy.data.objects.remove(proto)
    cme.materials.append(cm)
    rnd = random.Random(9)
    cells = [(ix, iz) for ix in range(8) for iz in range(11)]
    cells.sort(key=lambda c: -c[0] + rnd.uniform(-1.5, 1.5))
    sz = 0.125
    for n, (ix, iz) in enumerate(cells):
        o = link(bpy.data.objects.new(f"cube{n}", cme))
        p0 = mw @ Vector(((ix - 3.5) * 0.137, 0, (iz - 5) * 0.137))
        t0 = 38 + int(n / len(cells) * 46)
        lift = p0 + Vector((rnd.uniform(-0.1, 0.3), rnd.uniform(-0.6, -0.2), rnd.uniform(-0.1, 0.35)))
        mid = p0.lerp(target, 0.55) + Vector((0, rnd.uniform(-0.8, 0.2), rnd.uniform(0.3, 1.1)))
        spin = Vector([rnd.uniform(-3, 3) for _ in range(3)])
        cipher = INDIGO if rnd.random() < 0.6 else VIOLET
        key(o, 1, hide_render=True)
        key(o, 38, hide_render=False)
        key(o, 1, location=p0, scale=(sz,) * 3, rotation_euler=sl_rot, color=(0.8, 0.95, 1.0, 1))
        key(o, t0, location=p0, scale=(sz,) * 3, rotation_euler=sl_rot, color=(0.8, 0.95, 1.0, 1))
        key(o, t0 + 7, location=lift, color=(*cipher, 1))
        key(o, t0 + 15, location=mid, scale=(sz * 0.8,) * 3, rotation_euler=Vector(sl_rot) + spin)
        key(o, t0 + 24, location=target, scale=(0.001,) * 3, rotation_euler=Vector(sl_rot) + spin * 1.6)

    # lock glows a touch brighter as it swallows the stream
    kemit(V["lock"], 40, strength=6)
    kemit(V["lock"], 100, strength=12)

    # seal disc stamps onto the vault face
    sp = empty("sealPivot", (0, -0.33, 0), root)
    sm = emit("sealGlow", TEAL, 0)
    prim("cylinder", "sealDisc", metal("sealSteel", base=(0.05, 0.055, 0.1)), sp, bevel=0.025, vertices=48, radius=0.62,
         depth=0.12, location=(0, -0.06, 0), rotation=(R90, 0, 0))
    prim("torus", "sealRing", sm, sp, major_radius=0.52, minor_radius=0.03, major_segments=64, minor_segments=6,
         location=(0, -0.125, 0), rotation=(R90, 0, 0))
    prim("cylinder", "sealMark", sm, sp, vertices=6, radius=0.22, depth=0.03, location=(0, -0.125, 0),
         rotation=(R90, 0, 0))
    key(sp, 1, location=(0, -3.0, 5.5), scale=(1.3,) * 3, rotation_euler=(0, math.radians(120), 0), hide_render=True)
    key(sp, 96, location=(0, -3.0, 5.5), scale=(1.3,) * 3, rotation_euler=(0, math.radians(120), 0), hide_render=False)
    for c in sp.children:  # swoops in from above frame; hidden until then
        key(c, 1, hide_render=True)
        key(c, 96, hide_render=False)
    key(sp, 109, location=(0, -0.7, 0), scale=(1.05,) * 3, rotation_euler=(0, 0, 0))
    key(sp, 111, location=(0, -0.33, 0), scale=(1.0,) * 3)
    key(sp, 112, scale=(1.1, 0.55, 1.1))
    key(sp, 116, location=(0, -0.46, 0), scale=(0.97, 1.08, 0.97))
    key(sp, 121, location=(0, -0.33, 0), scale=(1.0,) * 3)
    kemit(sm, 98, strength=1.5)
    kemit(sm, 111, strength=2)
    kemit(sm, 113, strength=24)
    kemit(sm, 130, strength=7)
    rm = emit("ripple", TEAL, 0)
    rp = prim("torus", "ripple", rm, root, major_radius=0.8, minor_radius=0.02, major_segments=96, minor_segments=6,
              location=(0, -0.33, 0), rotation=(R90, 0, 0))
    key(rp, 111, scale=(1,) * 3)
    kemit(rm, 111, strength=0)
    kemit(rm, 113, strength=16)
    key(rp, 134, scale=(2.6,) * 3)
    kemit(rm, 134, strength=0)
    kemit(V["bolt"], 111, INDIGO, 3)
    kemit(V["bolt"], 115, AMBER, 9)
    kemit(V["bolt"], 132, AMBER, 4)
    return sc


# ---------------------------------------------------------------- main
sc = {"vault_unseal": shot_vault_unseal, "ork_ring": shot_ork_ring, "sealed_deposit": shot_sealed_deposit}[SHOT]()
t = time.time()
if "--still" in opt:
    f = int(opt["--still"])
    sc.frame_set(f)
    sc.render.filepath = os.path.join(HERE, f"test_{SHOT}_{f}.png")
    bpy.ops.render.render(write_still=True)
    print(f"STILL {SHOT} f{f} {time.time() - t:.1f}s")
else:
    fdir = os.path.join(HERE, "frames", SHOT)
    os.makedirs(fdir, exist_ok=True)
    sc.render.filepath = os.path.join(fdir, "f_")
    bpy.ops.render.render(animation=True)
    rt = time.time() - t
    mp4 = os.path.join(HERE, f"{SHOT}.mp4")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", "30", "-i", os.path.join(fdir, "f_%04d.png"),
                    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                    mp4], check=True)
    print(f"DONE {SHOT} {sc.frame_end} frames render {rt:.0f}s -> {mp4}")

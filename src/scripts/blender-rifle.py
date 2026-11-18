"""Build the UNKNW rifle prototype in Blender 5.3 and export a keyed GLB.

Run: blender --background --factory-startup --python src/scripts/blender-rifle.py
Coordinates below are game coordinates: X muzzle, Y up, Z across the gun.
"""
import bpy
from math import pi
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'models' / 'weapons'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def point(x, y, z):
    return (x, -z, y)  # Blender Z-up -> glTF Y-up

def material(name, color, metallic=0, roughness=.65):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

cerakote = material('Charcoal ceramic coating', (.115, .133, .151), .42, .58)
steel = material('Phosphate steel', (.045, .052, .058), .72, .38)
edge = material('Machined edges', (.29, .32, .34), .64, .42)
polymer = material('Textured black polymer', (.048, .055, .063), .08, .87)
glass = material('Optic glass', (.027, .085, .103), .26, .14)

def cube(name, size, pos, mat, parent=None, bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=point(*pos))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new('Machined radius', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        modifier.affect = 'EDGES'
        obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj

def cyl(name, radius, length, pos, mat, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=length,
                                        location=point(*pos), rotation=(0, pi/2, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    return obj

cube('Upper receiver', (.5,.15,.15), (.005,.015,0), cerakote)
cube('Lower receiver', (.31,.11,.13), (-.07,-.095,0), cerakote)
cube('Magazine well', (.15,.085,.15), (.09,-.1,0), steel)
cube('Ejection port inset', (.15,.045,.005), (.08,.045,-.077), steel, bevel=.003)
cube('Ejection port rim', (.17,.009,.008), (.08,.073,-.08), edge, bevel=.002)
cube('Handguard', (.38,.125,.16), (.39,-.01,0), cerakote)
for z in (-.083, .083):
    cube('Handguard polymer panel', (.30,.065,.012), (.40,-.015,z), polymer)
    for i in range(5):
        cube('Vent slot', (.019,.04,.004), (.275+i*.06,.013,z*1.09), steel, bevel=.002)
cube('Top rail', (.68,.025,.074), (.24,.093,0), steel)
for i in range(14):
    cube('Rail lug', (.025,.018,.082), (-.08+i*.048,.115,0), edge, bevel=.003)
cyl('Free floated barrel', .029, .64, (.68,.025,0), steel)
cyl('Muzzle brake', .041, .093, (.95,.025,0), edge)
for x in (.928,.953):
    cube('Brake port', (.012,.017,.086), (x,.056,0), steel, bevel=.002)
cube('Front sight base', (.042,.05,.05), (.76,.071,0), steel)
cube('Front sight post', (.012,.055,.015), (.76,.121,0), edge)
cube('Grip', (.095,.29,.11), (-.15,-.245,0), polymer, bevel=.016)
for i in range(4):
    cube('Grip texture', (.006,.014,.115), (-.165,-.18-i*.035,0), edge, bevel=.001)
cube('Trigger guard', (.16,.018,.014), (-.06,-.17,-.06), steel)
cube('Trigger', (.013,.065,.014), (-.025,-.14,0), edge)
cube('Stock tube', (.37,.055,.08), (-.45,.002,0), steel)
cube('Stock cheek', (.25,.085,.12), (-.54,.055,0), polymer)
cube('Stock pad', (.048,.19,.13), (-.69,-.055,0), polymer)
cube('Optic mount', (.115,.058,.065), (.065,.155,0), steel)
cyl('Optic housing', .049, .21, (.065,.212,0), steel)
cyl('Front lens', .039, .004, (.171,.212,0), glass)
cyl('Rear lens', .039, .004, (-.041,.212,0), glass)

# Empty pivots carry animation tracks. Child mesh transforms stay in Blender
# space so all stamped details move with their mechanical part.
mag = bpy.data.objects.new('ReloadMagazine', None)
bpy.context.collection.objects.link(mag)
mag.location = point(.09,-.22,0)
cube('Magazine shell', (.10,.27,.09), (.09,-.22,0), steel, mag)
cube('Magazine base plate', (.12,.03,.105), (.09,-.36,0), polymer, mag)
for i in range(4):
    cube('Magazine grip rib', (.007,.19,.094), (.056+i*.023,-.22,0), edge, mag, bevel=.002)
bolt = bpy.data.objects.new('ChargingHandle', None)
bpy.context.collection.objects.link(bolt)
bolt.location = point(-.11,.09,-.084)
cube('Charging handle', (.07,.03,.06), (-.11,.09,-.084), steel, bolt)
cube('Charging handle latch', (.025,.038,.09), (-.145,.09,-.084), edge, bolt)

bpy.context.scene.render.fps = 60
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 100

def key(obj, frame, x, y, z):
    obj.location = point(x,y,z)
    obj.keyframe_insert(data_path='location', frame=frame, group='Reload')

for f,x,y,z in [(1,.09,-.22,0),(15,.09,-.22,0),(39,-.01,-.64,.10),
                (50,-.05,-.69,.16),(58,-.05,-.69,.16),
                (80,.09,-.22,0),(100,.09,-.22,0)]:
    key(mag,f,x,y,z)
for f,x in [(1,-.11),(75,-.11),(84,-.27),(93,-.11),(100,-.11)]:
    key(bolt,f,x,.09,-.084)

bpy.context.scene.frame_set(1)
for obj in bpy.data.objects:
    obj.select_set(obj.type == 'MESH' or obj in (mag, bolt))
bpy.context.view_layer.objects.active = mag
bpy.ops.export_scene.gltf(filepath=str(OUT/'rifle-reload.glb'), export_format='GLB',
                          use_selection=True, export_animations=True, export_apply=True)
print('Exported', OUT/'rifle-reload.glb')

# Repeatable proof frames; the animation lab can inspect the GLB in game when
# its local server is available. These renders show mechanical clearance here.
from mathutils import Vector
PREVIEW = ROOT / 'test-artifacts' / 'rifle-prototype'
PREVIEW.mkdir(parents=True, exist_ok=True)
bpy.ops.object.camera_add(location=(2.5, -3.0, 1.75))
camera = bpy.context.object
direction = Vector((0, 0, 0)) - camera.location
camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2.45
bpy.context.scene.camera = camera
bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
bpy.context.scene.display.shading.color_type = 'MATERIAL'
bpy.context.scene.render.resolution_x = 960
bpy.context.scene.render.resolution_y = 540
bpy.context.scene.render.resolution_percentage = 100
for frame, label in [(1, 'idle'), (50, 'magazine-out'), (80, 'magazine-seated')]:
    bpy.context.scene.frame_set(frame)
    bpy.context.scene.render.filepath = str(PREVIEW / f'rifle-{label}.png')
    bpy.ops.render.render(write_still=True)

# Save the editable file framed on the gun, with the reload action active and
# the timeline at its first frame. Space plays the 100-frame reload in Blender.
bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
mag.select_set(True)
bpy.context.view_layer.objects.active = mag
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_location = (0, 0, 0)
            area.spaces.active.region_3d.view_distance = 2.6
            area.spaces.active.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'rifle-reload.blend'))

"""Build the eight non-rifle UNKNW weapons as editable Blender scenes and GLBs.

Run with Blender 5.3: blender --background --factory-startup --python src/scripts/blender-arsenal.py
The rifle remains authored by blender-rifle.py. X points to the muzzle, Y up.
"""
import bpy
from math import pi
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / 'assets' / 'models' / 'weapons'
OUT.mkdir(parents=True, exist_ok=True)

def xyz(x, y, z):
    return x, -z, y  # Blender Z-up to glTF Y-up

def mat(name, color, metal, rough):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Roughness'].default_value = rough
    return m

def begin(kind):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.render.fps = 60
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 100
    palettes = {
        'pistol': (.15,.17,.19), 'smg': (.11,.14,.16), 'lmg': (.17,.18,.18),
        'dmr': (.16,.17,.16), 'akimbo': (.12,.14,.16), 'flak': (.18,.17,.15),
        'shotgun': (.14,.16,.17), 'sniper': (.15,.16,.17),
    }
    return (mat('Ceramic finished receiver', palettes[kind], .42, .59),
            mat('Black phosphate steel', (.037,.043,.048), .72, .41),
            mat('Milled steel edge', (.29,.32,.33), .66, .39),
            mat('Knurled polymer', (.056,.064,.068), .08, .84),
            mat('Optic glass', (.021,.073,.091), .25, .15))

def box(name, size, pos, material, parent=None, bevel=.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(*pos))
    o = bpy.context.object
    o.name = name
    o.dimensions = (size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material)
    if bevel:
        b = o.modifiers.new('Machined bevel','BEVEL')
        b.width = bevel
        b.segments = 2
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    if parent:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o

def cylinder(name, radius, length, pos, material, parent=None, axis='x', verts=16):
    rotations = {'x': (0,pi/2,0), 'y': (0,0,0), 'z': (pi/2,0,0)}
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=radius,depth=length,
                                        location=xyz(*pos),rotation=rotations[axis])
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    if parent:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o

def pivot(name, position):
    o = bpy.data.objects.new(name,None)
    bpy.context.collection.objects.link(o)
    o.location = xyz(*position)
    return o

def key(o, frame, position, scale=None):
    o.location = xyz(*position)
    o.keyframe_insert(data_path='location',frame=frame,group='Reload')
    if scale is not None:
        o.scale = (scale,)*3
        o.keyframe_insert(data_path='scale',frame=frame,group='Reload')

def rail(a,b,material,back,front,y=.11):
    box('Machined upper rail',(front-back,.022,.075),((front+back)/2,y,0),b)
    count = max(3,int((front-back)/.046))
    for i in range(count):
        box('Rail tooth',(.021,.015,.085),(back+.025+i*(front-back-.05)/max(count-1,1),y+.018,0),material,None,.002)

def optic(body,metal,glass,x,y=.18,length=.15,r=.034):
    box('Optic foot',(.10,.045,.055),(x,y-.044,0),metal)
    cylinder('Optic housing',r,length,(x,y,0),body)
    cylinder('Front lens',r*.77,.005,(x+length/2,y,0),glass)
    cylinder('Rear lens',r*.77,.005,(x-length/2,y,0),glass)

def magazine(base,material,polymer,edge,width=.09,height=.25,drum=False,axis='y'):
    m=pivot('ReloadMagazine',base)
    if drum:
        cylinder('Ribbed drum',width,height,base,material,m,'z',20)
        for side in (-1,1):
            cylinder('Drum cover',width*.77,.005,(base[0],base[1],base[2]+side*height*.52),polymer,m,'z',20)
        box('Drum locking neck',(.085,.075,.075),(base[0],base[1]+width*.92,base[2]),edge,m)
    else:
        size=(width,height,.075) if axis=='y' else (height,.075,width)
        box('Detachable magazine shell',size,base,material,m,.009)
        if axis=='y':
            box('Impact resistant base plate',(width+.02,.026,.09),(base[0],base[1]-height*.52,base[2]),polymer,m)
            for i in range(3):
                box('Magazine grip rib',(.008,height*.68,.079),(base[0]-width*.3+i*width*.3,base[1],base[2]),edge,m,.002)
        else:
            box('Top magazine end cap',(.028,.09,width+.01),(base[0]-height*.52,base[1],base[2]),polymer,m)
    return m

def motion(m,base,style):
    x,y,z=base
    if style=='top':
        poses=[(1,x,y,z),(16,x,y,z),(39,x-.06,y+.24,z+.08),(53,x-.12,y+.32,z+.14),
               (59,x-.12,y+.32,z+.14),(80,x,y,z),(100,x,y,z)]
    elif style=='side':
        poses=[(1,x,y,z),(13,x,y,z),(39,x-.08,y-.12,z+.23),(51,x-.13,y-.18,z+.31),
               (58,x-.13,y-.18,z+.31),(80,x,y,z),(100,x,y,z)]
    else:
        poses=[(1,x,y,z),(15,x,y,z),(39,x-.08,y-.32,z+.10),(51,x-.12,y-.39,z+.16),
               (59,x-.12,y-.39,z+.16),(80,x,y,z),(100,x,y,z)]
    for f,px,py,pz in poses:key(m,f,(px,py,pz))

def action(name,base,travel,first=74,peak=84,last=94):
    o=pivot(name,base)
    for f,delta in [(1,0),(first,0),(peak,travel),(last,0),(100,0)]:
        key(o,f,(base[0]+delta,base[1],base[2]))
    return o

def finish(kind):
    bpy.context.scene.frame_set(1)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{kind}-reload.glb'),export_format='GLB',
                              use_selection=True,export_animations=True,export_apply=True)
    bpy.ops.object.select_all(action='DESELECT')
    m=bpy.data.objects.get('ReloadMagazine')
    if m:
        m.select_set(True)
        bpy.context.view_layer.objects.active=m
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_location=(0,0,0)
                area.spaces.active.region_3d.view_distance=2.8
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'{kind}-reload.blend'))
    from mathutils import Vector
    previews = Path(__file__).resolve().parents[2] / 'test-artifacts' / 'arsenal-preview'
    previews.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.camera_add(location=(2.3,-3.0,1.65))
    cam=bpy.context.object
    cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO'
    cam.data.ortho_scale=2.6 if kind not in ('sniper','lmg') else 3.1
    scene=bpy.context.scene
    scene.camera=cam
    scene.render.engine='BLENDER_WORKBENCH'
    scene.display.shading.color_type='MATERIAL'
    scene.render.resolution_x=480
    scene.render.resolution_y=300
    scene.render.resolution_percentage=100
    for frame,label in [(1,'idle'),(50,'out'),(90,'seated')]:
        scene.frame_set(frame)
        scene.render.filepath=str(previews/f'{kind}-{label}.png')
        bpy.ops.render.render(write_still=True)
    print('Exported',kind)

def finishing_details(kind, body, metal, edge, poly):
    # Raised side furniture and controls remain readable in the game's
    # shoulder camera without relying on large texture files.
    layouts = {
        'pistol': (0.0,.065,.058,.26), 'smg': (.035,.055,.087,.34),
        'akimbo': (.04,.04,.19,.29), 'shotgun': (-.07,.045,.105,.42),
        'sniper': (-.12,.045,.079,.50), 'dmr': (-.10,.045,.087,.43),
        'lmg': (-.10,.045,.112,.57), 'flak': (-.17,.045,.118,.51),
    }
    x,y,z,length=layouts[kind]
    sides=(-1,1) if kind=='akimbo' else (1,)
    for side in sides:
        depth=z*side
        box('Inset receiver side panel',(length*.69,.055,.008),(x,y,depth),poly,None,.005)
        box('Machined receiver seam',(length*.82,.009,.011),(x,y+.047,depth+side*.008),edge,None,.002)
        box('Ejection port',(.087,.032,.012),(x+length*.15,y+.045,depth+side*.016),metal,None,.002)
        box('Safety selector',(.035,.011,.019),(x-length*.20,y-.027,depth+side*.017),edge,None,.003)
        for delta in (-length*.29,length*.28):
            cylinder('Panel fastener',.008,.006,(x+delta,y+.015,depth+side*.016),edge,None,'z',10)
        box('Receiver accent stripe',(length*.31,.011,.008),(x-length*.13,y-.047,depth+side*.017),edge,None,.002)
    if kind in ('smg','shotgun','sniper','dmr','lmg','flak'):
        for i in range(4):
            box('Textured grip ridge',(.009,.007,.104),(-.17+i*.014,-.25,-.057),edge,None,.002)

def build(kind):
    body,metal,edge,poly,glass=begin(kind)
    if kind=='pistol':
        box('Compact frame',(.33,.105,.105),(.015,.01,0),body)
        slide=action('ChargingHandle',(-.01,.075,0),-.075,65,72,81)
        box('Machined reciprocating slide',(.31,.052,.111),(-.01,.075,0),metal,slide)
        for i in range(5):box('Rear slide serration',(.008,.053,.116),(-.13+i*.018,.08,0),edge,slide,.001)
        box('Beavertail',(.09,.035,.10),(-.19,.035,0),body)
        box('Polymer grip',(.092,.25,.09),(-.1,-.19,0),poly,None,.015)
        cylinder('Barrel',.023,.13,(.22,.035,0),metal)
        box('Front sight',(.018,.037,.033),(.145,.12,0),edge)
        box('Rear sight',(.022,.035,.065),(-.12,.13,0),edge)
        m=magazine((-.09,-.25,0),metal,poly,edge,.074,.23)
        motion(m,(-.09,-.25,0),'down')
    elif kind=='smg':
        box('Compact receiver',(.46,.18,.16),(.04,.02,0),body)
        box('Polymer upper shell',(.38,.045,.17),(.01,.13,0),poly)
        box('Integrated front grip',(.08,.18,.11),(.25,-.13,0),poly)
        box('Rear stock',(.24,.095,.13),(-.31,.04,0),poly)
        box('Grip',(.085,.27,.10),(-.12,-.22,0),poly)
        cylinder('Short shrouded barrel',.047,.26,(.38,.015,0),metal)
        cylinder('Muzzle cap',.055,.05,(.54,.015,0),edge)
        rail(body,metal,edge,-.17,.28,.17)
        optic(body,metal,glass,.02,.23,.10,.034)
        m=magazine((.03,-.22,0),metal,poly,edge,.105,.29)
        motion(m,(.03,-.22,0),'down')
        handle=action('ChargingHandle',(-.12,.14,-.09),-.11)
        box('Charging tab',(.06,.035,.065),(-.12,.14,-.09),edge,handle)
    elif kind=='akimbo':
        # Paired compact receivers under one rig anchor, matching the existing
        # dual-barrel gameplay with independent magazine pivots.
        for side in (-1,1):
            z=side*.125
            box('Paired machine pistol frame',(.37,.14,.115),(.035,.01,z),body)
            box('Pistol slide',(.34,.043,.12),(.055,.095,z),metal)
            box('Extended grip',(.08,.27,.09),(-.055,-.20,z),poly)
            cylinder('Compensator',.032,.09,(.31,.04,z),edge)
            m=magazine((-.06,-.28,z),metal,poly,edge,.068,.29)
            # Both are animated; the second action is staggered slightly.
            for f,p in [(1,0),(12,0),(40,-.30),(52,-.36),(62,-.36),(85,0),(100,0)]:
                key(m,f,(-.06-.06*abs(p),-.28+p,z+side*.08*abs(p)))
        box('Connecting hand bridge',(.18,.055,.33),(-.10,-.07,0),poly)
        handle=action('ChargingHandle',(.02,.12,-.125),-.06)
        box('Slide catch',(.06,.025,.04),(.02,.12,-.125),edge,handle)
    elif kind=='shotgun':
        box('Pump shotgun receiver',(.56,.18,.19),(-.03,.02,0),body)
        box('Stock spine',(.43,.085,.14),(-.48,.035,0),poly)
        box('Recoil pad',(.045,.19,.15),(-.69,-.01,0),poly)
        box('Pistol grip',(.105,.24,.13),(-.13,-.20,0),poly)
        for z in (-.055,.055):cylinder('Twin barrel',.041,.65,(.57,.035,z),metal)
        cylinder('Underbarrel tube',.051,.53,(.45,-.065,0),edge)
        pump=action('ChargingHandle',(.37,-.07,0),-.18,67,77,87)
        box('Grooved pump',(.27,.105,.19),(.37,-.07,0),poly,pump)
        for i in range(4):box('Pump groove',(.012,.108,.195),(.275+i*.055,-.07,0),edge,pump,.002)
        box('Shell loading gate',(.16,.012,.095),(-.005,-.078,0),metal)
        # Three shell inserts share the reload interval and disappear into
        # the receiver one at a time. No detachable box magazine on this gun.
        shell=pivot('ReloadMagazine',(-.14,-.28,.16))
        cylinder('Brass shotgun shell',.023,.09,(-.14,-.28,.16),edge,shell,'x',12)
        for f,p,s in [(1,(-.14,-.28,.16),.01),(16,(-.14,-.28,.16),1),
                      (30,(-.005,-.09,.04),1),(36,(-.005,-.09,.04),.01),
                      (40,(-.14,-.28,.16),1),(52,(-.005,-.09,.04),1),
                      (58,(-.005,-.09,.04),.01),(62,(-.14,-.28,.16),1),
                      (74,(-.005,-.09,.04),1),(80,(-.005,-.09,.04),.01),(100,(-.14,-.28,.16),.01)]:key(shell,f,p,s)
    elif kind=='sniper':
        box('Precision receiver',(.69,.16,.14),(-.08,.02,0),body)
        box('Extended precision stock',(.46,.11,.13),(-.58,.025,0),poly)
        box('Cheek rest',(.25,.07,.13),(-.56,.12,0),body)
        box('Shoulder pad',(.05,.2,.14),(-.83,-.01,0),poly)
        box('Grip',(.09,.25,.10),(-.19,-.21,0),poly)
        cylinder('Long free floated barrel',.031,.96,(.69,.035,0),metal)
        cylinder('Suppressor',.053,.27,(1.15,.035,0),metal)
        box('Floating handguard',(.43,.12,.14),(.39,.005,0),poly)
        for i in range(6):box('Handguard vent',(.025,.042,.006),(.22+i*.06,.025,-.075),metal,None,.002)
        rail(body,metal,edge,-.34,.43,.13)
        optic(body,metal,glass,.08,.235,.32,.051)
        m=magazine((.045,-.22,0),metal,poly,edge,.10,.22)
        motion(m,(.045,-.22,0),'top')
        bolt=action('ChargingHandle',(-.17,.11,-.08),-.27,72,82,94)
        box('Bolt handle',(.12,.035,.08),(-.17,.11,-.08),edge,bolt)
        cylinder('Bolt knob',.028,.045,(-.21,.12,-.13),poly,bolt,'y',12)
    elif kind=='dmr':
        box('Marksman receiver',(.58,.165,.155),(-.07,.025,0),body)
        box('Stock',(.39,.09,.13),(-.50,.03,0),poly)
        box('Butt pad',(.055,.19,.14),(-.69,-.02,0),poly)
        box('Contoured grip',(.09,.25,.10),(-.21,-.20,0),poly)
        box('Slotted handguard',(.44,.135,.15),(.38,.005,0),body)
        for i in range(6):box('Handguard slot',(.035,.05,.006),(.19+i*.064,.01,-.079),metal,None,.002)
        cylinder('Match barrel',.029,.65,(.72,.025,0),metal)
        cylinder('Ported brake',.046,.095,(1.04,.025,0),edge)
        rail(body,metal,edge,-.28,.54,.12)
        optic(body,metal,glass,.07,.22,.23,.041)
        m=magazine((.04,-.21,0),metal,poly,edge,.09,.24)
        motion(m,(.04,-.21,0),'down')
        bolt=action('ChargingHandle',(-.13,.095,-.085),-.17)
        box('Side bolt',(.085,.035,.06),(-.13,.095,-.085),edge,bolt)
    elif kind=='lmg':
        box('Heavy receiver',(.75,.22,.20),(-.07,.025,0),body)
        box('Riveted stock',(.41,.13,.16),(-.56,.025,0),poly)
        box('Shoulder plate',(.055,.20,.17),(-.79,-.02,0),poly)
        box('Forward heat shroud',(.53,.15,.19),(.43,.035,0),metal)
        for i in range(6):box('Cooling vent',(.03,.047,.008),(.22+i*.07,.035,-.10),edge,None,.002)
        cylinder('Heavy barrel',.045,.81,(.77,.045,0),metal)
        cylinder('Flash hider',.065,.12,(1.18,.045,0),edge)
        box('Carry handle',(.35,.025,.08),(-.05,.23,0),poly)
        for x in (-.19,.09):box('Handle post',(.03,.15,.07),(x,.17,0),edge)
        box('Vertical grip',(.10,.27,.12),(-.23,-.22,0),poly)
        rail(body,metal,edge,-.30,.58,.16)
        m=magazine((.02,-.20,0),metal,poly,edge,.16,.10,True)
        motion(m,(.02,-.20,0),'side')
        handle=action('ChargingHandle',(-.16,.13,-.11),-.15)
        box('Charging handle',(.10,.045,.07),(-.16,.13,-.11),edge,handle)
    elif kind=='flak':
        box('Bullpup scattergun receiver',(.72,.22,.21),(-.12,.02,0),body)
        box('Armoured butt pad',(.09,.21,.20),(-.55,.0,0),poly)
        box('Forward grip',(.105,.25,.13),(.20,-.21,0),poly)
        box('Perforated heat shield',(.46,.17,.20),(.41,.04,0),metal)
        for i in range(5):box('Top vent',(.035,.009,.15),(.23+i*.08,.132,0),edge,None,.002)
        cylinder('Large bore barrel',.052,.63,(.69,.035,0),metal)
        cylinder('Muzzle bell',.083,.10,(1.02,.035,0),edge)
        box('Compact optic',(.13,.09,.09),(-.03,.21,0),metal)
        cylinder('Sight glass',.038,.01,(.045,.21,0),glass)
        m=magazine((-.13,-.19,0),metal,poly,edge,.145,.11,True)
        motion(m,(-.13,-.19,0),'side')
        slide=action('ChargingHandle',(.10,.10,-.12),-.13)
        box('Action lever',(.10,.035,.08),(.10,.10,-.12),edge,slide)
    finishing_details(kind,body,metal,edge,poly)
    finish(kind)

for weapon in ('pistol','smg','akimbo','shotgun','sniper','dmr','lmg','flak'):
    build(weapon)

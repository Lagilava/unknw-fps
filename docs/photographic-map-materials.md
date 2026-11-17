# Photographic map materials

The map uses eight local PBR material sets: asphalt, moss-jointed paving, brick,
cast concrete, timber, slab concrete, metal, and concrete masonry. Masonry derives
from the concrete scan with the existing 400 × 250 mm block courses reconstructed
in the colour and OpenGL normal maps. Road paint adds a separate small wear map.

The scans come from ambientCG under CC0. Exact source links and licensing are in
`assets/textures/photoreal/LICENSE.txt`; dimensions and byte totals are in
`assets/textures/photoreal/manifest.json`.

## Compression and rendering

- 1024 × 1024 colour WebP, encoded at quality 84, sampled as sRGB.
- 512 × 512 lossless OpenGL normals and packed linear AO/roughness/metalness.
- 23.03 MiB of unique source colour/normal/roughness maps becomes 5.72 MiB of
  runtime maps, including the derived masonry set and worn paint.
- Repeat variants share texture image sources. Anisotropy is capped at 4.
- Materials retain physical tiling scales. World-space damp and colour variation
  soften obvious repetition without extra lights, geometry, or decal draws.
- Concrete and timber roughness has a dry lower bound; damp asphalt retains its
  separate sheen. Window reflections, car paint, and metal
  fixtures have been refined as part of the material pass.
- The newer cinematic pipeline on main, player brightness, and explicit developer
  overrides are retained rather than replaced by the older checkout's defaults.

The package is compressed for transfer. WebP does **not** provide GPU block
compression; decoded dimensions and mipmaps still determine GPU memory use.

## Rebuilding

Download and extract the ambientCG 1K-JPG archives for Asphalt012, PavingStones036,
Bricks026, Concrete023, and Wood049 into one source directory. Keep their original
archive folder names. Also extract Concrete034 and Metal063 into that directory. The builder uses existing
source maps when available and falls back to these archives when main has removed
unused original JPG files.

```powershell
npm run textures:map -- E:/workspace/unknw-texture-sources
npm run photos:map
npm run photos:map -- --game
```

`src/map_photo.html` renders the actual map builders and HDR illumination without
combat or the game's postprocessing, for material inspection. The photography
script can serve browser requests from disk, so it needs no localhost server.
`--game` boots the real game and captures its camera and postprocessing with HUD
and overlay elements hidden. Captures live in `docs/screenshots/photoreal/`.

## Verification

The material preview rendered 190 draw calls and 291,758 triangles, with 35 live
textures. Every photographic material decoded successfully; colour maps were
sRGB, data maps linear, and packed textures shared AO/roughness inputs. No browser
JavaScript or shader errors were recorded. These are scene diagnostics, not an FPS
benchmark. Game-mode photography also reached gameplay and captured three views.

The underlying building, tree, and car geometry remains stylised. This pass improves
surface realism; it does not turn the entire scene into a photogrammetry environment.

Publication note: materials were merged onto current main without replacing its newer
world-space surfacing, map layout, animation work, GLB optimisations, or cinematic pipeline.

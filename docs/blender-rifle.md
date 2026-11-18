# Blender rifle prototype

The first rifle replacement is authored in `src/scripts/blender-rifle.py`. Blender
5.3 exports `assets/models/weapons/rifle-reload.glb` and the editable
`rifle-reload.blend` from the same script. The GLB contains two keyed actions:
`ReloadMagazineAction` and `ChargingHandleAction`. The game seeks both actions
using the rifle's existing reload timer. If the asset fails to load, the
previous procedural rifle remains visible.

Regenerate from Command Prompt in the project root:

```cmd
"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --factory-startup --python src/scripts/blender-rifle.py
```

The script also writes three proof renders to `test-artifacts/rifle-prototype`.
Run `npm run build`, then
`npx playwright test --config playwright.offline.config.cjs src/tests/weapons/rifle-offline-lab.spec.cjs`
to capture the in-game third-person reload from ten camera positions without
opening a local test port. The contact sheet is saved as
`test-artifacts/rifle-prototype/rifle-in-game-angles.png`. The reload audio and
ammunition timing remain controlled by the existing game state.

# Weapon switching

During active play with the cursor locked, scroll down for the next owned weapon and up for the previous one. Locked guns are skipped and the list wraps. A new run begins with one owned gun, so cycling becomes useful after acquiring another weapon. Number keys retain their existing slot assignments.

Wheel deltas are normalized for pixel, line and page devices. A large event advances one slot, with a short cooldown to prevent trackpad bursts from skipping the inventory. Menus and Ctrl+wheel are left alone.

Switching lowers the outgoing weapon, swaps at the end of the holster, then draws the incoming weapon using its equip time. Reloading is cancelled when holstering starts; firing and new reloads are blocked during the holster. Rapid requests update the destination. Returning to the current gun cancels the pending swap and raises it again. Restart clears the transition.

Motion reference: [Dev_Unallocated: Procedural Weapon Animations](https://www.devunallocated.com/projects/project-killhouse/procedural-weapon-animations-condensed). This implementation uses original procedural transforms on the game's existing weapon rigs; no external animation asset was imported.

Validation: `npm run typecheck`, `npm run build`, `npx playwright test .tools/weapon-switch.spec.cjs`.

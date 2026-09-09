# Encounter variety implementation plan

## Problem and scope
The existing game has varied weapons and enemies but repeats a kill quota in one arena. This change delivers an initial encounter-design pass, not a replacement campaign or a claim of Halo-equivalent depth.

## Implemented
- Every third solo wave becomes a relay upload. Reach the cyan zone and accumulate 18 uncontested seconds within 3.5 metres. Living enemies within 5 metres block progress. Leaving preserves progress. Completing the upload advances even with survivors; killing everyone does not bypass the upload.
- Place relays by traversing open map cells from the player, rejecting collision-blocked cells. Small/custom maps without a target retain elimination.
- Show relay distance, upload progress, and contest status in the HUD, a cyan ground marker, and an R marker on radar.
- Preserve player position and facing across wave transitions, including co-op guests.
- Replace independent weighted enemy rolls with squad sequences: early ranged support, then pressure plus support, then denial. Zombie-unavailable configurations use Blink Seraphs.
- Keep the opening cinematic roster but reduce wave-one HP to 32% and wave-two HP to 65% of their scaled values. A base 820 HP opening drone now has roughly 263 HP, about six 52-damage pistol body shots before modifiers.
- Solo radar shows contacts within 22 metres; the last two hostiles remain visible to prevent tedious cleanup.
- Co-op retains synchronized elimination objectives and radar behavior. Squad and HP changes are host-authoritative.

## Validation
Run `npm run typecheck`, `npm run build`, and `npx playwright test .tools/relay-objective.spec.cjs`.
Browser coverage checks objective gating, presence, wave transition and position continuity. Manually play waves 1-6 to judge opening pace, enemy pressure, beacon readability and whether capturing under fire is preferable to clearing first.

## Next development milestones
1. Author three connected encounter sectors with purposeful cover and two approach lanes each. Validate player collision, AI routes and sightlines before enabling the dormant interior prop generator (it was built for a different layout).
2. Add a second objective with its own behavior: retrieve a battery and carry it to one of two extraction points. Route choice should affect enemy pressure and reward.
3. Add explicit weapon counters and an ammo economy together. Avoid removing kill ammo before testing soft-lock recovery with every loadout.
4. Add a six-encounter run with a branching resource stop and a miniboss finale. Persist mastery challenges only after the short run is enjoyable.
5. Extend relay state, contest participation and completion authority to co-op snapshots, then test reconnect and host migration.

## Playtest acceptance
Compare first-kill time, wave-three completion time, routes used, weapons switched and quit rate against the old build. Ask players which decision changed their approach. The implementation makes room for decisions; automated checks cannot establish whether it is fun.

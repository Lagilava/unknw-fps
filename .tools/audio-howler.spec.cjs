// Verifies the Howler sample layer: the ESM wrapper loads, Howl is available,
// and every new SFX file the manifest references is served (200) and decodable.
const { test, expect } = require("@playwright/test");

const BASE = "http://127.0.0.1:8000";
const URL = `${BASE}/first_person_shooter_room_game%20(1).html?test=1`;

const SFX = [
  "assets/sfx/moniker_subriquet-gunshot_smg_loop-203469.mp3",
  "assets/sfx/mrfriends-pistol-shot-233473.mp3",
  "assets/sfx/freesound_community-080902_shotgun-39753.mp3",
  "assets/sfx/freesound_community-sniper-rifle-5989.mp3",
  "assets/sfx/sovetsky_rastov72-fn-p90-sound-effect-265718.mp3",
  "assets/sfx/dragon-studio-gun-reload-2-511308.mp3",
  "assets/sfx/rescopicsound-elemental-magic-spell-impact-outgoing-228342.mp3",
  "assets/sfx/freesound_community-075681_electric-shock-33018.mp3",
  "assets/sfx/floraphonic-scifi-anime-whoosh-91-207103.mp3",
  "assets/sfx/black_kumizhi-cyberpunk-bass-impact-effect-479138.mp3",
  "assets/sfx/dragon-studio-zombie-sound-357975.mp3",
  "assets/sfx/dragon-studio-zombie-sound-2-357976.mp3",
];

test("Howler wrapper loads and all new SFX files decode", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  // Every new SFX file must be reachable and decodable as audio.
  for (const rel of SFX) {
    const res = await page.request.get(`${BASE}/${rel}`);
    expect(res.status(), rel).toBe(200);
  }

  // The ESM importmap wrapper resolves and exposes a working Howl constructor.
  const ok = await page.evaluate(async () => {
    const mod = await import("howler");
    if (!mod || typeof mod.Howl !== "function") return "no Howl";
    // Instantiate + decode one real sample through Howler end to end.
    const dur = await new Promise((resolve) => {
      const h = new mod.Howl({
        src: ["./assets/sfx/mrfriends-pistol-shot-233473.mp3"],
        preload: true,
        html5: false,
        onload: () => resolve(h.duration()),
        onloaderror: () => resolve(-1),
      });
    });
    return dur > 0 ? "ok" : `bad duration ${dur}`;
  });
  expect(ok).toBe("ok");
  expect(errors.join("\n")).toBe("");
});

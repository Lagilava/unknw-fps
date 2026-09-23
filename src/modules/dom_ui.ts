export function getHudElements(doc = document) {
  return {
    hpVal: doc.getElementById("hp-val"),
    hpBar: doc.getElementById("hp-bar"),
    ammoVal: doc.getElementById("ammo-val"),
    ammoMag: doc.getElementById("ammo-mag"),
    ammoReserve: doc.getElementById("ammo-reserve"),
    killsVal: doc.getElementById("kills-val"),
    reloadWrap: doc.getElementById("reload-bar-wrap"),
    reloadBar: doc.getElementById("reload-bar"),
    objective: doc.getElementById("objective"),
    hitMarker: doc.getElementById("hit-marker"),
    damageVig: doc.getElementById("damage-vignette"),
    adsVig: doc.getElementById("ads-vignette"),
    killFeed: doc.getElementById("kill-feed"),
    sprintInd: doc.getElementById("sprint-ind"),
    staminaWrap: doc.getElementById("stamina-bar-wrap"),
    staminaBar: doc.getElementById("stamina-bar"),
    waveVal: doc.getElementById("wave-val"),
    weaponVal: doc.getElementById("weapon-val"),
    xpVal: doc.getElementById("xp-val"),
    packVal: doc.getElementById("pack-val"),
    packPrompt: doc.getElementById("pack-prompt"),
    streakVal: doc.getElementById("streak-val"),
    streakBlock: doc.getElementById("streak-block"),
    scoreVal: doc.getElementById("score-val"),
    bestScoreVal: doc.getElementById("best-score-val"),
    sensSlider: doc.getElementById("sens-slider"),
    sensVal: doc.getElementById("sens-val"),
    cinematicToggle: doc.getElementById("cinematic-toggle"),
    cinematicVal: doc.getElementById("cinematic-val"),
  };
}

export function getMenuElements(doc = document) {
  return {
    overlay: doc.getElementById("overlay"),
    stateOverlay: doc.getElementById("state-overlay"),
    stateTitle: doc.getElementById("state-title"),
    stateSub: doc.getElementById("state-sub"),
    statsPanel: doc.getElementById("stats-panel"),
    stateActions: doc.getElementById("state-actions"),
    stateRestartBtn: doc.getElementById("stateRestartBtn"),
    stateQuitBtn: doc.getElementById("stateQuitBtn"),
    startBtn: doc.getElementById("startBtn"),
    resumeBtn: doc.getElementById("resumeBtn"),
    restartBtn: doc.getElementById("restartBtn"),
    loadoutBtn: doc.getElementById("loadoutBtn"),
    briefingBtn: doc.getElementById("briefingBtn"),
    settingsBtn: doc.getElementById("settingsBtn"),
    intelBtn: doc.getElementById("intelBtn"),
    multiplayerBtn: doc.getElementById("multiplayerBtn"),
    modelEditorBtn: doc.getElementById("modelEditorBtn"),
    quitBtn: doc.getElementById("quitBtn"),
    briefingPanel: doc.getElementById("briefingPanel"),
    loadoutPanel: doc.getElementById("loadoutPanel"),
    intelPanel: doc.getElementById("intelPanel"),
    quitPanel: doc.getElementById("quitPanel"),
    menuPanels: Array.from(doc.querySelectorAll("[data-menu-panel]")),
    loadoutCards: Array.from(doc.querySelectorAll("[data-loadout]")),
    selectedLoadoutVal: doc.getElementById("selected-loadout-val"),
    launchLoadoutBtn: doc.getElementById("launchLoadoutBtn"),
    quitConfirmBtn: doc.getElementById("quitConfirmBtn"),
    quitCancelBtn: doc.getElementById("quitCancelBtn"),
    quitStatus: doc.getElementById("quit-status"),
    menuTitle: doc.getElementById("menu-title"),
    menuTagline: doc.getElementById("menu-tagline"),
    menuCopy: doc.getElementById("menu-copy"),
  };
}

export function createLoadingController(doc = document) {
  const screen = doc.getElementById("loading-screen");
  const fill = doc.getElementById("loading-fill");
  const status = doc.getElementById("loading-status");
  const detail = doc.getElementById("loading-detail");
  const phase = doc.getElementById("loading-phase");
  const pct = doc.getElementById("loading-pct");
  // Stage segments (SYS / ENV / AI / AUDIO / READY) light up as progress crosses thresholds.
  const segs = Array.from(doc.querySelectorAll(".ls-seg"));
  const segThresholds = [0.0, 0.25, 0.55, 0.8, 0.98];
  const phaseNames = ["SYSTEM", "WORLD", "COMBAT", "AUDIO", "READY"];
  const phaseDetails = [
    "Choosing a renderer and preparing the first frame.",
    "Caching mission assets and decoding character rigs.",
    "Building the playable spaces and warming scene geometry.",
    "Compiling combat shaders and priming audio so the first shot lands cleanly.",
    "Final checks complete. Handing control to the player.",
  ];
  let progressValue = 0;

  function getPhaseIndex(progress) {
    if (progress >= 0.98) return 4;
    if (progress >= 0.8) return 3;
    if (progress >= 0.55) return 2;
    if (progress >= 0.25) return 1;
    return 0;
  }

  function getDetailForLabel(label, progress) {
    const normalized = String(label || "").toLowerCase();
    if (normalized.includes("renderer")) return "Choosing a renderer and preparing the first frame.";
    if (normalized.includes("cache")) return "Caching mission assets so models and textures resolve faster.";
    if (normalized.includes("player rig")) return "Downloading the player rig and animation clips.";
    if (normalized.includes("zombie rig")) return "Loading fallback enemy assets and character data.";
    if (normalized.includes("texture")) return "Decoding textures before they are uploaded to the GPU.";
    if (normalized.includes("breach room")) return "Building the playable interior and collision layout.";
    if (normalized.includes("exterior zone")) return "Streaming the exterior scene and its collision boundaries.";
    if (normalized.includes("exterior scene")) return "Warming distant city geometry and environment assets.";
    if (normalized.includes("weapon effects")) return "Compiling weapon materials and viewmodel effects.";
    if (normalized.includes("combat effects")) return "Compiling scene materials and effect shaders.";
    if (normalized.includes("lightning effects")) return "Warming particle and lightning systems.";
    if (normalized.includes("drone pools") || normalized.includes("enemy pools")) return "Pre-allocating enemy instances and AI pools.";
    if (normalized.includes("enemy waves")) return "Priming the first wave so combat can begin without a hitch.";
    if (normalized.includes("audio")) return "Priming the audio graph so the first shots and VO cues do not stutter.";
    if (normalized.includes("ready")) return "Final checks complete. Handing control to the player.";
    return phaseDetails[getPhaseIndex(progress)] || phaseDetails[0];
  }

  function setProgress(label, progress) {
    // Monotonic: never let the bar jump backwards on out-of-order calls.
    progressValue = Math.max(progressValue, Math.max(0, Math.min(1, progress)));
    const done = progressValue >= 0.999;
    if (status && typeof label === "string") status.textContent = done ? "Ready" : label;
    if (detail) detail.textContent = getDetailForLabel(label, progressValue);
    if (phase) {
      const phaseIndex = getPhaseIndex(progressValue);
      phase.innerHTML = `${phaseNames[phaseIndex]} <strong>${phaseIndex + 1}/5</strong>`;
    }
    if (pct) pct.textContent = Math.round(progressValue * 100) + "%";
    if (fill) fill.style.width = (progressValue * 100).toFixed(1) + "%";
    for (let i = 0; i < segs.length; i++) {
      segs[i].classList.toggle("active", progressValue >= segThresholds[i]);
    }
  }

  function hide() {
    if (screen) screen.dataset.ready = "true";
    if (pct) pct.textContent = "100%";
    if (status) status.textContent = "Ready";
    if (detail) detail.textContent = phaseDetails[4];
    if (phase) phase.innerHTML = `READY <strong>5/5</strong>`;
    if (fill) fill.style.width = "100%";
    for (const s of segs) s.classList.add("active");
    screen?.classList.add("hidden");
  }

  return {
    screen,
    fill,
    status,
    pct,
    setProgress,
    hide,
  };
}

export function setTextIfChanged(el, value) {
  if (el && el.textContent !== String(value)) el.textContent = value;
}

export function setClassIfChanged(el, value) {
  if (el && el.className !== value) el.className = value;
}

export function setStyleIfChanged(style, prop, value) {
  if (style && style[prop] !== value) style[prop] = value;
}

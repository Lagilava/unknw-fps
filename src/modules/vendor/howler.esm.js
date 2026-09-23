// ESM wrapper around Howler's UMD build for the legacy importmap entry.
//
// Howler ships UMD only (no ES module). Vite (index.html) imports the npm
// package directly; the legacy importmap points the bare "howler" specifier at
// this file. Importing the UMD build as a module executes its IIFE, which (in a
// browser module context where `self === window`) assigns Howl/Howler onto the
// global — we then re-export those. Kept local under /node_modules so it works
// offline, consistent with the rapier/miniplex importmap entries.
import "/node_modules/howler/dist/howler.min.js";
export const Howl = window.Howl;
export const Howler = window.Howler;
export default { Howl, Howler };

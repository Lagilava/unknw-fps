// Local browser build for the standalone import-map entry. Vite uses npm directly.
// Mirrors howler.esm.js: execute the bundled browser IIFE and export its namespace.
import "/node_modules/peerjs/dist/peerjs.min.js";
export const Peer = window.peerjs.Peer;
export default Peer;

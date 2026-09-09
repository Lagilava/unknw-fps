/** One decision per session; dismissing is the same as keeping shadows. */
export function showShadowPerformancePrompt(onDecision: (disable: boolean) => void, doc = document) {
  const dialog = doc.createElement('dialog');
  dialog.id = 'shadow-performance-prompt';
  dialog.setAttribute('aria-labelledby', 'shadow-performance-title');
  dialog.setAttribute('aria-describedby', 'shadow-performance-description');
  dialog.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(440px,calc(100vw - 32px));padding:28px;background:#101820;color:#edf5fa;border:1px solid #688391;border-radius:10px;font:16px/1.5 system-ui;box-shadow:0 24px 90px #000b';
  const style = doc.createElement('style');
  style.textContent = '#shadow-performance-prompt::backdrop{background:#02060bb3}#shadow-performance-prompt button{padding:12px 16px;border:1px solid #718d9c;border-radius:5px;background:#203340;color:#fff;font:600 14px system-ui;cursor:pointer}#shadow-performance-prompt button:focus-visible{outline:3px solid #83e5e0;outline-offset:3px}';
  dialog.innerHTML = '<h2 id="shadow-performance-title" style="font-size:22px;margin:0 0 12px">Improve frame rate?</h2><p id="shadow-performance-description" style="margin:0 0 22px;color:#bccdd6">The game has been running below 48 FPS. Disabling shadows can reduce GPU load and make combat smoother, but objects will stop casting shadows. Keep them on, or disable them for this session?</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-choice="keep" autofocus>Keep shadows</button><button type="button" data-choice="disable">Disable shadows</button></div>';
  doc.head.append(style);
  doc.body.append(dialog);
  let done = false;
  const finish = (disable: boolean) => {
    if (done) return;
    done = true;
    dialog.close(); dialog.remove(); style.remove();
    onDecision(disable);
  };
  dialog.querySelector('[data-choice="keep"]')!.addEventListener('click', () => finish(false));
  dialog.querySelector('[data-choice="disable"]')!.addEventListener('click', () => finish(true));
  dialog.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
  // Prevent game keybinds (including Escape-to-resume) while the choice is open.
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('keyup', e => e.stopPropagation());
  dialog.showModal();
  (dialog.querySelector('[data-choice="keep"]') as HTMLButtonElement).focus();
}

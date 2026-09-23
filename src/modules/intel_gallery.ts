const evidence: Record<string, [string, string]> = {
  minutes: ['blackout', 'FIELD CAPTURE / The blackout cycle'],
  room: ['room', 'SITE SURVEY / Breach-site approach'],
  city: ['city', 'PERIMETER SURVEY / City district'],
  echo: ['echo', 'CONTEXT / Insertion site; the signal itself is not visible'],
  drones: ['drone', 'HOSTILE IDENTIFICATION / Siege Drone'],
  ghosts: ['ghost', 'HOSTILE IDENTIFICATION / Cloned Ghost'],
  returned: ['returned', 'HOSTILE IDENTIFICATION / The Returned'],
  choir: ['choir', 'HOSTILE IDENTIFICATION / Blackout enforcers'],
};

export function installIntelGallery(records: HTMLElement[]) {
  for (const record of records) {
    const item = evidence[record.dataset.record || ''];
    if (!item || record.querySelector('.intel-evidence')) continue;
    const figure = document.createElement('figure'); figure.className = 'intel-evidence';
    const picture = document.createElement('img');
    picture.src = `../assets/intel/${item[0]}.webp`;
    picture.alt = item[1].split(' / ')[1]; picture.loading = record.classList.contains('is-active') ? 'eager' : 'lazy'; picture.decoding = 'async';
    picture.width = 960; picture.height = 540;
    const caption = document.createElement('figcaption'); caption.textContent = item[1];
    figure.append(picture, caption);
    record.querySelector('.intel-doc-title')?.after(figure);
  }
}

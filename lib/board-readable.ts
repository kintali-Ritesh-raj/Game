import type { AssetState, GroupData, SpaceData, TokenState } from './board-3d';

type ReadableSpace = SpaceData & { caption?: string };
type ReadableToken = TokenState & { name: string };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const house = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 11 12 2l10 9M5 10v12h14V10M10 22v-8h4v8"/></svg>';
const tower = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V2h14v20M2 22h20M9 6h2m2 0h2M9 10h2m2 0h2M9 14h2m2 0h2M10 22v-4h4v4"/></svg>';

/** Real text at a readable size. Reflow spaces instead of shrinking a canvas. */
export function createReadableBoard(container: HTMLElement, board: ReadableSpace[], groups: Record<string, GroupData>, onSelect: (id:number)=>void) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const cards = new Map<number, HTMLButtonElement>();
  const assetKeys = new Map<number, string>();
  const tokenKeys = new Map<number, string>();
  const abort = new AbortController();
  const names = ['Launch to Prison', 'Prison to Free Market', 'Free Market to Price War', 'Price War to Launch'];
  container.replaceChildren();
  for (let edge = 0; edge < 4; edge++) {
    const section = document.createElement('section');
    section.className = 'readable-district';
    section.setAttribute('aria-label', names[edge]);
    section.innerHTML = '<div class="route-heading"><h3>' + names[edge] + '</h3><span>Spaces ' + String(edge * 10).padStart(2,'0') + '–' + (edge * 10 + 9) + '</span></div>';
    const path = document.createElement('div'); path.className = 'readable-path';
    for (const space of board.slice(edge * 10, edge * 10 + 10)) {
      const card = document.createElement('button'); card.type = 'button';
      card.className = 'readable-space' + (!space.price ? ' city-space' : '');
      card.dataset.space = String(space.id); card.id = 'readable-space-' + space.id;
      card.style.setProperty('--district-color', groups[space.group || '']?.color || '#bce3ed');
      card.innerHTML = '<span class="space-topline"><span class="space-number">' + String(space.id).padStart(2,'0') + '</span><span class="space-direction" aria-hidden="true">→</span></span>' +
        '<span class="space-group">' + escape(groups[space.group || '']?.name || 'City space') + '</span>' +
        '<strong class="space-name">' + escape(space.name) + '</strong>' +
        '<span class="space-price">' + (space.price ? '$' + space.price : '<span class="space-symbol" aria-hidden="true">' + escape(space.symbol || '◇') + '</span>' + escape(space.caption || '')) + '</span>' +
        '<span class="space-ownership"></span><span class="space-buildings"></span><span class="space-visitors"></span>';
      card.addEventListener('click', () => onSelect(space.id), {signal: abort.signal});
      path.append(card); cards.set(space.id, card);
    }
    section.append(path); container.append(section);
  }
  const end = document.createElement('p'); end.className = 'route-return';
  end.textContent = '↩ Continue to 00 · Launch. Collect $200 when passing or landing while moving forward.';
  container.append(end);

  function update(assets: Record<number, AssetState>, tokens: ReadableToken[], selected: number) {
    for (const space of board) {
      const card = cards.get(space.id)!;
      card.classList.toggle('is-selected', space.id === selected);
      const asset = assets[space.id];
      if (asset) {
        const key = JSON.stringify(asset), oldKey = assetKeys.get(space.id);
        if (oldKey !== key) {
          const previous = oldKey ? JSON.parse(oldKey) as AssetState : null;
          assetKeys.set(space.id, key);
          card.style.setProperty('--owner-color', asset.ownerColor || '#536265');
          const ownership = card.querySelector<HTMLElement>('.space-ownership')!;
          ownership.innerHTML = asset.owner === null ? '<span class="space-bank">Available</span>' : '<span class="readable-owner-icon" aria-hidden="true">' + escape(asset.ownerSymbol || '●') + '</span><span>Owned by <b>' + escape(asset.ownerName || 'Player') + '</b></span>';
          const buildings = card.querySelector<HTMLElement>('.space-buildings')!;
          buildings.dataset.buildings = String(asset.buildings);
          buildings.innerHTML = space.type === 'property' ? '<span class="readable-houses" aria-hidden="true">' + (asset.buildings === 5 ? tower : house.repeat(asset.buildings)) + '</span><span>' + (asset.buildings === 5 ? '1 tower · level 5' : asset.buildings + (asset.buildings === 1 ? ' house' : ' houses')) + '</span>' : '<span>No buildings</span>';
          if (asset.mortgaged) ownership.insertAdjacentHTML('beforeend', '<b class="readable-mortgage">Mortgaged</b>');
          if (previous && !motion.matches && (asset.owner !== previous.owner || asset.buildings !== previous.buildings)) {
            (asset.owner !== previous.owner ? ownership : buildings).animate([{transform:'translateY(-8px)',opacity:.25},{transform:'translateY(0)',opacity:1}], {duration:450,easing:'ease-out'});
          }
        }
      }
      const visitors = tokens.filter(token => !token.bankrupt && token.position === space.id);
      const key = JSON.stringify(visitors.map(token => [token.id,token.active,token.name,token.symbol,token.color]));
      if (tokenKeys.get(space.id) !== key) {
        const wasRendered = tokenKeys.has(space.id); tokenKeys.set(space.id, key);
        const target = card.querySelector<HTMLElement>('.space-visitors')!;
        target.innerHTML = visitors.map(token => '<span class="readable-token' + (token.active ? ' current-token' : '') + '" style="--token-color:' + token.color + '" data-player="' + token.id + '"><span aria-hidden="true">' + escape(token.symbol || '●') + '</span><span>' + escape(token.name) + '</span></span>').join('');
        card.classList.toggle('has-current-player', visitors.some(token => token.active));
        if (visitors.length && wasRendered && !motion.matches) target.animate([{transform:'translateY(-12px)',opacity:0},{transform:'translateY(0)',opacity:1}], {duration:180,easing:'ease-out'});
      }
    }
  }
  function locate(id:number) {
    const card = cards.get(id);
    card?.scrollIntoView({block:'center',behavior:motion.matches ? 'instant' : 'smooth'});
    card?.focus({preventScroll:true});
  }
  return {update, locate, destroy(){abort.abort();container.replaceChildren();}};
}

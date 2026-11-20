// Shell-only drawer composition. Page actions are supplied by app.ts.
import * as router from './router.ts';
import { store } from './services.ts';
import { focusDialogStart, interceptLinkClick } from './dom.ts';

export function initializeNavigation(openGuide: () => void): void {
  const drawer = document.getElementById('app-navigation') as HTMLDialogElement;
  const menu = document.getElementById('menu-btn')!;
  const partyLink = document.getElementById('drawer-party') as HTMLAnchorElement;
  const guide = document.getElementById('drawer-guide') as HTMLButtonElement;
  const context = document.getElementById('drawer-context')!;
  let pendingGuide = false;
  function sync(): void {
    const party = store.activeParty;
    const route = router.currentRoute();
    partyLink.hidden = !party;
    partyLink.href = router.partyPath(party?.slug);
    partyLink.textContent = party?.name ?? 'Current party';
    guide.disabled = !party;
    context.textContent = party ? `Game: ${party.baseGame || 'Not selected'}` : 'Choose or create a party to browse its game’s Pokémon.';
    for (const item of drawer.querySelectorAll<HTMLElement>('[data-destination]')) {
      const destination = item.dataset.destination;
      const active = destination === 'settings' ? ['settings', 'cache'].includes(route.page ?? '')
        : destination === 'transfer' ? ['transfer', 'transfer-export', 'import'].includes(route.page ?? '')
        : destination === 'party' ? !!route.partySlug && !route.page
        : !route.partySlug && !route.page;
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
  }
  menu.addEventListener('click', () => {
    sync();
    drawer.showModal();
    menu.setAttribute('aria-expanded', 'true');
    focusDialogStart(drawer);
  });
  drawer.addEventListener('click', event => {
    if (event.target === drawer) {
      const box = drawer.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) drawer.close();
    }
  });
  drawer.addEventListener('close', () => menu.setAttribute('aria-expanded', 'false'));
  const navigate = (action: () => void) => { drawer.close(); action(); };
  interceptLinkClick(drawer.querySelector('[data-destination="parties"]')!, () => navigate(router.navigateHome));
  interceptLinkClick(partyLink, () => navigate(() => router.navigateToParty(store.activeParty?.slug)));
  drawer.querySelector('#settings-btn')!.addEventListener('click', () => navigate(router.navigateToSettings));
  drawer.querySelector('#drawer-transfer')!.addEventListener('click', () => navigate(router.navigateToTransfer));
  guide.addEventListener('click', () => {
    if (!store.activeParty) return;
    pendingGuide = true;
    navigate(() => router.navigateToParty(store.activeParty!.slug));
  });
  // Registered after app.ts's renderer, so the target view is visible first.
  router.onRouteChange(() => {
    if (drawer.open) drawer.close();
    sync();
    if (pendingGuide) {
      pendingGuide = false;
      const slug = store.activeParty?.slug;
      // Let all native hashchange listeners finish their page cleanup first.
      setTimeout(() => {
        const target = router.currentRoute();
        if (target.partySlug === slug && !target.pokemonUid && !target.page) openGuide();
      }, 0);
    }
  });
  store.addEventListener('change', sync);
  const radios = [...drawer.querySelectorAll<HTMLElement>('[data-theme-choice]')];
  drawer.querySelector('[role="radiogroup"]')!.addEventListener('keydown', event => {
    const key = (event as KeyboardEvent).key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    const step = ['ArrowLeft', 'ArrowUp'].includes(key) ? -1 : 1;
    radios[(radios.indexOf(document.activeElement as HTMLElement) + step + radios.length) % radios.length].click();
  });
  const header = document.querySelector<HTMLElement>('.app-header')!;
  new ResizeObserver(() => document.documentElement.style.setProperty('--app-header-height', `${header.getBoundingClientRect().height}px`)).observe(header);
  sync();
}

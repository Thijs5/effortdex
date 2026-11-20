import { NATURES } from './constants.ts';
import { smogon } from './services.ts';
import { toShowdownId } from './smogon-client.ts';

/** Collect published alternatives across formats, ignoring unknown nature names. */
export function recommendedNatures(sets: Record<string, unknown>, species: string): string[] {
  const formats = Object.entries(sets).find(([name]) => toShowdownId(name) === toShowdownId(species))?.[1];
  if (!formats || typeof formats !== 'object') return [];
  const found = new Set<string>();
  for (const format of Object.values(formats)) {
    if (!format || typeof format !== 'object') continue;
    for (const set of Object.values(format)) {
      if (!set || typeof set !== 'object') continue;
      const nature = (set as { nature?: unknown }).nature;
      for (const value of Array.isArray(nature) ? nature : [nature]) {
        if (typeof value === 'string') found.add(value.toLowerCase());
      }
    }
  }
  return NATURES.filter(n => found.has(n.id)).map(n => n.id).sort();
}

const requests = new WeakMap<HTMLSelectElement, object>();
const badgeRequests = new WeakMap<HTMLElement, object>();

/** Mark a recorded nature using the same generation-specific picks as the selector. */
export async function updateNatureRecommendationBadge(
  element: HTMLElement, species: string, nature: string | null, gen: number,
): Promise<void> {
  const request = {};
  badgeRequests.set(element, request);
  element.querySelector('.nature-recommendation-star')?.remove();
  if (!nature) return;
  try {
    const sets = await smogon.getSets(gen);
    if (badgeRequests.get(element) !== request || !element.isConnected) return;
    if (!recommendedNatures(sets, species).includes(nature)) return;
    const star = document.createElement('span');
    star.className = 'nature-recommendation-star';
    star.textContent = ' ⭐';
    star.setAttribute('role', 'img');
    star.setAttribute('aria-label', `Recommended nature (Smogon, Gen ${gen})`);
    star.title = `Recommended nature in Smogon Gen ${gen} sets. Best depends on moves and role.`;
    element.append(star);
  } catch {
    // Missing competitive data never interferes with the Pokémon card.
  }
}

/** Refresh stars without replacing options or overwriting a user's selection. */
export async function updateNatureRecommendations(
  select: HTMLSelectElement, hint: HTMLElement, species: string | null, gen: number,
): Promise<void> {
  const request = {};
  requests.set(select, request);
  for (const option of select.options) option.textContent = option.textContent?.replace(/^⭐ /, '') ?? '';
  hint.hidden = !species;
  hint.textContent = species ? 'Looking up recommended natures…' : '';
  if (!species) return;
  try {
    const sets = await smogon.getSets(gen);
    if (requests.get(select) !== request) return;
    const ids = recommendedNatures(sets, species);
    for (const option of select.options) {
      if (ids.includes(option.value)) option.textContent = `⭐ ${option.textContent}`;
    }
    const labels = ids.map(id => NATURES.find(n => n.id === id)!.label);
    hint.textContent = labels.length
      ? `⭐ Smogon picks (Gen ${gen}): ${labels.join(', ')}. Best depends on moves and role.`
      : `No published nature recommendations for this Pokémon in Gen ${gen}.`;
  } catch {
    if (requests.get(select) === request) hint.textContent = 'Could not load nature recommendations. You can still choose any nature.';
  }
}

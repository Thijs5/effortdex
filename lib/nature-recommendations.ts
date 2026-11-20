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

/** A conservative inference: reverse the stat tradeoff of a published pick.
 * Exclude natures recommended by another set, and neutral natures. */
export function poorFitNatures(recommended: string[]): string[] {
  const picks = NATURES.filter(n => recommended.includes(n.id) && n.boost && n.hinder);
  return NATURES.filter(n => !recommended.includes(n.id) && picks.some(pick =>
    n.boost === pick.hinder && n.hinder === pick.boost)).map(n => n.id).sort();
}

const requests = new WeakMap<HTMLSelectElement, object>();
const badgeRequests = new WeakMap<HTMLElement, object>();

/** Mark recommended picks and inferred poor fits consistently with the selector. */
export async function updateNatureRecommendationBadge(
  element: HTMLElement, species: string, nature: string | null, gen: number,
): Promise<void> {
  const request = {};
  badgeRequests.set(element, request);
  element.querySelectorAll('.nature-recommendation-star, .nature-poor-fit-warning').forEach(marker => marker.remove());
  if (!nature) return;
  try {
    const sets = await smogon.getSets(gen);
    if (badgeRequests.get(element) !== request || !element.isConnected) return;
    const picks = recommendedNatures(sets, species);
    const recommended = picks.includes(nature);
    if (!recommended && !poorFitNatures(picks).includes(nature)) return;
    const marker = document.createElement('span');
    marker.className = recommended ? 'nature-recommendation-star' : 'nature-poor-fit-warning';
    marker.textContent = recommended ? ' ⭐' : ' ⚠';
    marker.setAttribute('role', 'img');
    marker.setAttribute('aria-label', `${recommended ? 'Recommended nature' : 'Poor fit for recommended sets'} (Smogon, Gen ${gen})`);
    marker.title = recommended
      ? `Recommended nature in Smogon Gen ${gen} sets. Best depends on moves and role.`
      : `Reverses the stat effects of a recommended Gen ${gen} nature. Can still suit a different build.`;
    element.append(marker);
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
  for (const option of select.options) option.textContent = option.textContent?.replace(/^(?:⭐|⚠) /, '') ?? '';
  hint.hidden = !species;
  hint.textContent = species ? 'Looking up recommended natures…' : '';
  if (!species) return;
  try {
    const sets = await smogon.getSets(gen);
    if (requests.get(select) !== request) return;
    const ids = recommendedNatures(sets, species);
    const poorFits = poorFitNatures(ids);
    for (const option of select.options) {
      if (ids.includes(option.value)) option.textContent = `⭐ ${option.textContent}`;
      else if (poorFits.includes(option.value)) option.textContent = `⚠ ${option.textContent}`;
    }
    const labels = ids.map(id => NATURES.find(n => n.id === id)!.label);
    hint.textContent = labels.length
      ? `⭐ Smogon picks (Gen ${gen}): ${labels.join(', ')}. Best depends on moves and role.`
      : `No published nature recommendations for this Pokémon in Gen ${gen}.`;
    if (poorFits.length) {
      const poorLabels = poorFits.map(id => NATURES.find(n => n.id === id)!.label);
      hint.textContent += ` ⚠ Poor fits: ${poorLabels.join(', ')}. These reverse the stat effects of the starred picks; a different build may suit them.`;
    }
  } catch {
    if (requests.get(select) === request) hint.textContent = 'Could not load nature recommendations. You can still choose any nature.';
  }
}

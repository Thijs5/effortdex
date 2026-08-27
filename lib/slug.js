// @ts-check
// URL-slug helpers, kept separate from the general-purpose utils because
// they encode one specific policy: how a party name becomes a path segment.

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

/** @param {string} text @returns {string} */
export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '') // é -> e, etc.
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Path segments the router treats as special one level under
// "#/parties/" (see lib/router.js) — a party can never claim one.
// "settings"/"transfer" no longer need reserving: parties live fully
// under "#/parties/<slug>" now, a separate namespace from those two
// top-level routes, so a party could be named "Settings" with no
// collision. "edit" doesn't need reserving either — it's a suffix
// segment ("#/parties/<slug>/edit"), not a slug a party could collide
// with directly.
const RESERVED_SLUGS = new Set(['create']);

/** Slugifies `name`, disambiguating against `existingSlugs` (a Set).
 * @param {string} name @param {Set<string>} existingSlugs @returns {string} */
export function uniqueSlug(name, existingSlugs) {
  const base = slugify(name) || 'party';
  let slug = base;
  let n = 2;
  while (existingSlugs.has(slug) || RESERVED_SLUGS.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

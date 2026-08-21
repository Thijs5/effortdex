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

// Path segments the router treats as app pages rather than party slugs
// (see lib/router.js) — a party can never claim one.
const RESERVED_SLUGS = new Set(['settings', 'transfer', 'import']);

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

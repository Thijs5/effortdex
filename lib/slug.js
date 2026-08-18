// URL-slug helpers, kept separate from the general-purpose utils because
// they encode one specific policy: how a party name becomes a path segment.

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '') // é -> e, etc.
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Slugifies `name`, disambiguating against `existingSlugs` (a Set). */
export function uniqueSlug(name, existingSlugs) {
  const base = slugify(name) || 'party';
  let slug = base;
  let n = 2;
  while (existingSlugs.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

/**
 * Slug generation for catalog entries.
 *
 * The slug is the kebab-cased, ASCII-only representation of the article
 * title. Slugs are frozen at publish time and must remain stable across
 * server restarts and re-publishes.
 */

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Unicode block: Combining Diacritical Marks (U+0300..U+036F). NFKD splits
// accented letters into base char + combining mark; we strip the marks here.
const COMBINING_MARKS_REGEX = /[̀-ͯ]/g;

/**
 * Build a kebab-case slug from a free-form title, ensuring uniqueness against
 * an existing set.
 *
 * Algorithm:
 *  1. lower-case
 *  2. NFKD-normalise and drop combining marks (strips diacritics)
 *  3. replace any character outside `[a-z0-9 -]` with a space
 *  4. collapse runs of whitespace and hyphens into a single `-`
 *  5. trim leading/trailing `-`
 *  6. if empty → throw
 *  7. if base slug is taken, append `-2`, `-3`, ... until free
 *  8. final regex assertion against `/^[a-z0-9]+(-[a-z0-9]+)*$/`
 */
export function slugify(title: string, taken: ReadonlySet<string>): string {
  const lowered = title.toLowerCase();
  const normalised = lowered.normalize('NFKD');
  const stripped = normalised.replace(COMBINING_MARKS_REGEX, '');
  // Replace any disallowed char with a space.
  const cleaned = stripped.replace(/[^a-z0-9 \-]/g, ' ');
  // Collapse any run of whitespace and hyphens into a single hyphen.
  const collapsed = cleaned.replace(/[\s-]+/g, '-');
  // Trim hyphens from both ends.
  const base = collapsed.replace(/^-+|-+$/g, '');

  if (base.length === 0) {
    throw new Error(`Cannot derive slug from title: ${title}`);
  }

  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  if (!SLUG_REGEX.test(candidate)) {
    throw new Error(
      `Internal error: generated slug "${candidate}" does not match required pattern`,
    );
  }

  return candidate;
}

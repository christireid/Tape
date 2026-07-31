// Normalise a malformed browser locale before anything reads it.
//
// Some environments report a POSIX-style locale through `navigator.language` —
// a headless Chromium started on a machine with LANG=en_US@posix reports
// "en-US@posix", which is not a valid BCP-47 tag. Any library that does
// `new Intl.NumberFormat(navigator.language)` then throws RangeError: Invalid
// language tag, and if it does so at module scope the application never paints.
// AG Grid does exactly this, so on such a machine the whole app white-screened
// while working perfectly everywhere else.
//
// The fix is narrow on purpose: if the reported tag is already valid, nothing
// happens. If it is not, it is replaced by the tag it plainly means — the part
// before the POSIX "@modifier" — and only if that is itself valid. This is a
// correction, not a preference: no user-visible behaviour changes, and the app
// stops dying because of how a machine's shell environment was configured.
//
// Imported first in main.tsx so it runs before any vendor module evaluates.

function isValidTag(tag: string): boolean {
  try {
    Intl.getCanonicalLocales(tag);
    return true;
  } catch {
    return false;
  }
}

/** Strip a POSIX "@modifier" (and any codeset suffix) from a locale tag. */
function normalise(tag: string): string | null {
  const base = tag.split('@')[0]?.split('.')[0]?.replace(/_/g, '-');
  return base && isValidTag(base) ? base : null;
}

export function installLocaleGuard(nav: Navigator = navigator): void {
  const reported = nav.language;
  if (!reported || isValidTag(reported)) return;

  const fixed = normalise(reported) ?? 'en-US';
  const languages = Array.from(nav.languages ?? [])
    .map((t) => (isValidTag(t) ? t : normalise(t)))
    .filter((t): t is string => t !== null);

  Object.defineProperty(nav, 'language', {
    configurable: true,
    get: () => fixed,
  });
  Object.defineProperty(nav, 'languages', {
    configurable: true,
    get: () => (languages.length > 0 ? languages : [fixed]),
  });
}

installLocaleGuard();

import { describe, expect, it } from 'vitest';
import { installLocaleGuard } from './locale-guard.ts';

function fakeNav(language: string, languages: string[]): Navigator {
  return { language, languages } as unknown as Navigator;
}

describe('locale guard', () => {
  it('rewrites a POSIX-modified tag to the valid tag it means', () => {
    // The exact value a headless Chromium reports on a LANG=en_US@posix host,
    // which made a vendor `new Intl.NumberFormat(navigator.language)` throw
    // RangeError at module scope and left the app blank.
    const nav = fakeNav('en-US@posix', ['en-US@posix']);
    installLocaleGuard(nav);
    expect(nav.language).toBe('en-US');
    expect(Array.from(nav.languages)).toEqual(['en-US']);
    expect(() => new Intl.NumberFormat(nav.language)).not.toThrow();
  });

  it('normalises underscore and codeset forms', () => {
    const nav = fakeNav('en_GB.UTF-8', ['en_GB.UTF-8']);
    installLocaleGuard(nav);
    expect(nav.language).toBe('en-GB');
  });

  it('falls back to en-US when nothing salvageable remains', () => {
    const nav = fakeNav('@@@', ['@@@']);
    installLocaleGuard(nav);
    expect(() => new Intl.NumberFormat(nav.language)).not.toThrow();
    expect(nav.language).toBe('en-US');
  });

  it('leaves a valid tag completely untouched', () => {
    const nav = fakeNav('fr-CA', ['fr-CA', 'en-US']);
    installLocaleGuard(nav);
    expect(nav.language).toBe('fr-CA');
    expect(Array.from(nav.languages)).toEqual(['fr-CA', 'en-US']);
  });
});

/** Turns what was typed into the address bar into a URL: an address, or a Google search. */
export function resolveInput(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || /^(about|data|mailto|file|view-source):/i.test(input)) {
    return input;
  }
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(input)) return `http://${input}`;
  if (input.includes('.') && !/\s/.test(input)) return `https://${input}`;
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** The host as the address bar shows it while not editing: no "www.". */
export function displayHost(url: string): string {
  return hostOf(url)?.replace(/^www\./, '') ?? url;
}

import { clipboard, Menu, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';
import type { Tab } from './tab';

export interface ContextMenuActions {
  openTab(url: string, background: boolean): void;
}

/** The right-click menu for a page, with only what fits what was clicked. */
export function showPageContextMenu(tab: Tab, params: ContextMenuParams, actions: ContextMenuActions): void {
  const wc = tab.webContents;
  if (!wc) return;
  const items: MenuItemConstructorOptions[] = [];
  const section = (...entries: MenuItemConstructorOptions[]) => {
    if (items.length) items.push({ type: 'separator' });
    items.push(...entries);
  };

  if (params.linkURL) {
    const isMail = params.linkURL.startsWith('mailto:');
    section(
      { label: 'Open Link in New Tab', click: () => actions.openTab(params.linkURL, true) },
      isMail
        ? { label: 'Copy Email Address', click: () => clipboard.writeText(params.linkURL.slice('mailto:'.length)) }
        : { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
    );
  }

  if (params.mediaType === 'image' && params.srcURL) {
    section(
      { label: 'Open Image in New Tab', click: () => actions.openTab(params.srcURL, true) },
      { label: 'Save Image', click: () => wc.downloadURL(params.srcURL) },
      { label: 'Copy Image', click: () => wc.copyImageAt(params.x, params.y) },
    );
  }

  if (params.isEditable) {
    if (params.misspelledWord && params.dictionarySuggestions.length) {
      section(
        ...params.dictionarySuggestions.map((word) => ({ label: word, click: () => wc.replaceMisspelling(word) })),
      );
    }
    section(
      { label: 'Cut', enabled: params.editFlags.canCut, click: () => wc.cut() },
      { label: 'Copy', enabled: params.editFlags.canCopy, click: () => wc.copy() },
      { label: 'Paste', enabled: params.editFlags.canPaste, click: () => wc.paste() },
      { label: 'Select All', click: () => wc.selectAll() },
    );
  } else if (params.selectionText.trim()) {
    const text = params.selectionText.trim();
    const preview = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    section(
      { label: 'Copy', click: () => wc.copy() },
      {
        label: `Search Google for “${preview}”`,
        click: () => actions.openTab(`https://www.google.com/search?q=${encodeURIComponent(text)}`, false),
      },
    );
  }

  if (!items.length) {
    section(
      { label: 'Back', enabled: tab.canGoBack, click: () => tab.goBack() },
      { label: 'Forward', enabled: tab.canGoForward, click: () => tab.goForward() },
      { label: 'Reload', click: () => tab.reload() },
    );
  }

  section({ label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) });
  Menu.buildFromTemplate(items).popup();
}

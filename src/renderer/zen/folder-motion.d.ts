export function animateFolderRow(item: HTMLElement, targetState: Record<string, string | number | (string | number)[]>, options?: { duration?: number; ease?: string }): Promise<boolean>;
export function cancelFolderRow(item: HTMLElement): void;

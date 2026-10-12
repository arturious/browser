const icons = import.meta.glob('../assets/zen/selectable/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export function WorkspaceIcon({ value, size = 16 }: { value: string; size?: number }) {
  const url = value.startsWith('zen:') ? icons[`../assets/zen/selectable/${value.slice(4)}`] : undefined;
  return url ? <span className="icon zen-workspace-icon" style={{ width: size, height: size, maskImage: `url("${url}")` }} /> : <span className="workspace-emoji">{value}</span>;
}

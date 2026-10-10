import { api, useAppState } from './state';

export function Settings() {
  const state = useAppState();
  return (
    <form className="settings" onSubmit={(e) => e.preventDefault()}>
      <label className="settings-row">
        <input
          type="checkbox"
          checked={state.adBlockEnabled}
          onChange={(e) => api.setAdBlockEnabled(e.target.checked)}
        />
        Block ads and trackers
      </label>
    </form>
  );
}

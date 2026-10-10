import type { AppState, DownloadState } from '../shared/types';
import { Icon } from './components/Icon';
import { api, useAppState } from './state';

/**
 * Lives in a transparent view above the page. Main sizes that view to the
 * whole window while a popover is open (so a click outside closes it), or to
 * just the tooltip, which then draws at the view's top-left corner.
 */
export function Overlay() {
  const state = useAppState();
  const { popover, popoverAnchor, hoveredTab } = state.ui;

  if (popover && popoverAnchor) {
    const style = { left: popoverAnchor.x + popoverAnchor.width - 280, top: popoverAnchor.y + popoverAnchor.height + 6 };
    return (
      <div className="overlay-backdrop" onMouseDown={(e) => e.target === e.currentTarget && api.setPopover(null)}>
        <div className="popover" style={style} key={popover}>
          {popover === 'downloads' ? <DownloadsList state={state} /> : <HistoryList />}
        </div>
      </div>
    );
  }

  if (hoveredTab) {
    return (
      <div className="tab-tooltip">
        <div className="tooltip-line">{hoveredTab.title}</div>
        {hoveredTab.isPlayingMedia && <div className="tooltip-line secondary">Playing audio</div>}
      </div>
    );
  }

  return null;
}

function DownloadsList({ state }: { state: AppState }) {
  return (
    <>
      <div className="popover-title">Downloads</div>
      {state.downloads.length === 0 ? (
        <div className="popover-empty">No downloads</div>
      ) : (
        state.downloads.map((item, index) => (
          <div key={item.id}>
            {index > 0 && <div className="divider" />}
            <DownloadRow item={item} />
          </div>
        ))
      )}
    </>
  );
}

function DownloadRow({ item }: { item: DownloadState }) {
  const status = item.failed ? 'failed' : item.isFinished ? 'finished' : 'active';
  const icon = item.failed ? 'xmark.circle' : item.isFinished ? 'checkmark.circle' : 'arrow.down.circle';
  return (
    <div
      className="download-row"
      onClick={() => item.isFinished && !item.failed && api.openDownload(item.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        api.showDownloadMenu(item.id);
      }}
    >
      <div className="download-line">
        <Icon name={icon} size={13} className={`download-status ${status}`} />
        <span className="download-name">{item.filename}</span>
      </div>
      {!item.isFinished && (
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${item.progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}

function HistoryList() {
  return (
    <>
      <div className="popover-title">History</div>
      <div className="popover-empty">No history yet</div>
    </>
  );
}

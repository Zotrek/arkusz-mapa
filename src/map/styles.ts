/** Style mapy. */

import { harmonogramDaysPickerCss } from '../harmonogramDays.js';

export function mapBaseCss(): string {
  return `    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, "Segoe UI", sans-serif;
      --map-accent: #0d9488;
      --map-accent-deep: #0f766e;
      --map-accent-soft: rgba(13, 148, 136, 0.12);
      --map-ink: #0f172a;
      --map-muted: #64748b;
      --map-line: rgba(148, 163, 184, 0.35);
      --map-surface: rgba(255, 255, 255, 0.92);
      --map-shadow: 0 10px 30px rgba(15, 23, 42, 0.12), 0 1px 3px rgba(15, 23, 42, 0.06);
    }
    #map { width: 100%; height: 100vh; }
    .leaflet-popup-content-wrapper {
      border-radius: 14px;
      background: var(--map-surface);
      color: var(--map-ink);
      box-shadow: var(--map-shadow);
    }
    .leaflet-popup-tip { background: var(--map-surface); }
    .leaflet-popup-content { margin: 12px 16px; min-width: 220px; }
    .popup-address { font-weight: 600; margin-bottom: 6px; color: var(--map-ink); }
    .popup-podmiot { font-size: 0.92em; color: #334155; margin-bottom: 6px; }
    .popup-count { color: var(--map-accent-deep); font-size: 1.05em; font-weight: 600; }
    .popup-count-detail { font-size: 0.88em; color: var(--map-muted); margin-top: 4px; }
    .popup-woj { font-size: 0.85em; color: var(--map-muted); margin-top: 4px; }
    .popup-zbiorka { font-size: 0.85em; color: var(--map-accent-deep); margin-top: 4px; }
    .popup-harmonogram { font-size: 0.85em; color: var(--map-accent-deep); margin-top: 4px; }
    .popup-confidence { font-size: 0.85em; color: #b02a37; margin-top: 4px; font-weight: 600; }
    .pin-woj { background: none !important; border: none !important; }
    .dm-cluster { background: none !important; border: none !important; }
    .dm-cluster-inner {
      width: 100%; height: 100%; border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      font-weight: 700; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    .dm-cluster-sm .dm-cluster-inner { font-size: 13px; }
    .dm-cluster-md .dm-cluster-inner { font-size: 14px; }
    .dm-cluster-lg .dm-cluster-inner { font-size: 15px; }
    .map-generated-at, .map-legend {
      background: var(--map-surface);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 14px;
      box-shadow: var(--map-shadow);
      color: var(--map-ink);
      font-family: system-ui, "Segoe UI", sans-serif;
    }
    .map-generated-at { padding: 8px 12px; font-size: 12px; font-weight: 600; line-height: 1.4; color: var(--map-muted); white-space: nowrap; }
    .leaflet-bottom .map-generated-at.leaflet-control { margin-bottom: 8px; }
    .map-legend { padding: 12px 14px; font-size: 12px; line-height: 1.5; }
    .map-legend h3 {
      margin: 0 0 8px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--map-muted);
    }
    .map-legend ul { margin: 0; padding: 0; list-style: none; }
    .map-legend li { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .map-legend li:last-child { margin-bottom: 0; }
    .map-legend .legend-swatch { width: 14px; height: 14px; border-radius: 50%; border: 1px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.2); flex-shrink: 0; }
    .map-legend .legend-section { margin-bottom: 10px; }
    .map-legend .legend-section:last-child { margin-bottom: 0; }
    .map-search-panel {
      background: rgba(255, 255, 255, 0.84);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      padding: 10px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.7);
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12), 0 1px 3px rgba(15, 23, 42, 0.06);
      min-width: 200px;
      max-width: min(340px, calc(100vw - 48px));
      font-family: system-ui, "Segoe UI", sans-serif;
      color: var(--map-ink);
    }
    .map-search-panel-head {
      display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px;
    }
    .map-search-panel-head .map-search-label { margin-bottom: 0; flex: 1; min-width: 0; }
    .map-search-collapse {
      flex-shrink: 0; width: 26px; height: 26px; padding: 0;
      border: 1px solid rgba(148, 163, 184, 0.55); border-radius: 8px;
      background: rgba(255, 255, 255, 0.92); color: #334155; cursor: pointer;
      font-size: 14px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    }
    .map-search-collapse:hover { background: var(--map-accent-soft); color: var(--map-accent-deep); border-color: var(--map-accent); }
    .map-search-panel.is-collapsed { min-width: 0; width: auto; padding: 6px; }
    .map-search-panel.is-collapsed .map-search-body,
    .map-search-panel.is-collapsed .map-search-label { display: none; }
    .map-search-panel.is-collapsed .map-search-panel-head { margin-bottom: 0; }
    .map-search-label,
    .map-zbiorka-filter-title,
    .map-harmonogram-filter-title,
    .map-wojewodztwo-filter-title {
      display: block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; margin-bottom: 6px; color: var(--map-muted);
    }
    .map-search-input-row { display: flex; align-items: center; gap: 6px; }
    .map-search-input {
      flex: 1; min-width: 0; padding: 6px 9px; font-size: 12px; color: var(--map-ink);
      border: 1px solid rgba(148, 163, 184, 0.55); border-radius: 8px;
      background: rgba(255, 255, 255, 0.92); box-sizing: border-box; outline: none;
    }
    .map-search-input:focus { border-color: var(--map-accent); box-shadow: 0 0 0 3px var(--map-accent-soft); }
    .map-search-input::placeholder { color: #94a3b8; }
    .map-zoom-inline {
      display: flex; flex-direction: row; flex-shrink: 0;
      border: 1px solid rgba(148, 163, 184, 0.55); border-radius: 8px; overflow: hidden;
      background: rgba(255, 255, 255, 0.92);
    }
    .map-zoom-inline button {
      width: 28px; height: 28px; padding: 0; border: none; background: transparent;
      cursor: pointer; font-size: 15px; line-height: 1; color: #334155;
      display: flex; align-items: center; justify-content: center;
    }
    .map-zoom-inline button:hover { background: var(--map-accent-soft); color: var(--map-accent-deep); }
    .map-zoom-inline button:first-child { border-right: 1px solid rgba(148, 163, 184, 0.45); }
    .map-zoom-inline button:last-child { border-radius: 0; }
    .map-search-status { margin-top: 4px; font-size: 10px; color: var(--map-muted); min-height: 1.2em; }
    .map-zbiorka-filter,
    .map-harmonogram-filter,
    .map-wojewodztwo-filter,
    .map-cluster-filter { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--map-line); }
    .map-zbiorka-filter-options { display: flex; flex-direction: column; gap: 1px; }
    .map-zbiorka-filter-options label {
      display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500;
      color: #334155; cursor: pointer; margin: 0; padding: 5px 6px; border-radius: 6px;
    }
    .map-zbiorka-filter-options label:hover { background: rgba(148, 163, 184, 0.12); }
    .map-zbiorka-filter-options label:has(input:checked) {
      background: var(--map-accent-soft); color: var(--map-accent-deep); font-weight: 600;
    }
    .map-zbiorka-filter-options input { margin: 0; flex-shrink: 0; accent-color: var(--map-accent); }
    .map-harmonogram-filter-options {
      display: flex; flex-direction: row; gap: 0;
      padding: 2px; border-radius: 8px;
      background: rgba(148, 163, 184, 0.16);
      border: 1px solid rgba(148, 163, 184, 0.25);
    }
    .map-harmonogram-filter-options label {
      flex: 1; display: flex; align-items: center; justify-content: center;
      gap: 0; font-size: 11px; font-weight: 600; color: #475569; cursor: pointer;
      margin: 0; padding: 5px 4px; border-radius: 6px; position: relative; user-select: none;
    }
    .map-harmonogram-filter-options input {
      position: absolute; opacity: 0; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);
    }
    .map-harmonogram-filter-options label:has(input:checked) {
      background: var(--map-accent); color: #fff;
      box-shadow: 0 1px 3px rgba(15, 118, 110, 0.35);
    }
    .map-wojewodztwo-dropdown { position: relative; }
    .map-wojewodztwo-toggle {
      width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between;
      gap: 6px; padding: 6px 9px; font-size: 12px;
      border: 1px solid rgba(148, 163, 184, 0.55); border-radius: 8px;
      background: rgba(255, 255, 255, 0.92); color: var(--map-ink); cursor: pointer; text-align: left;
    }
    .map-wojewodztwo-toggle:hover { background: #f8fafc; border-color: var(--map-accent); }
    .map-wojewodztwo-toggle-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .map-wojewodztwo-toggle-caret { flex-shrink: 0; color: var(--map-muted); font-size: 10px; line-height: 1; }
    .map-wojewodztwo-menu {
      display: none; position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20;
      max-height: 160px; overflow-y: auto; padding: 6px;
      background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(148, 163, 184, 0.45); border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
    }
    .map-wojewodztwo-dropdown.is-open .map-wojewodztwo-menu { display: block; }
    .map-wojewodztwo-clear {
      display: block; width: 100%; box-sizing: border-box; margin: 0 0 4px; padding: 5px 6px;
      font-size: 11px; font-weight: 600; border: 1px solid rgba(148, 163, 184, 0.45); border-radius: 6px;
      background: #f8fafc; color: #334155; cursor: pointer; text-align: center;
    }
    .map-wojewodztwo-clear:hover { background: var(--map-accent-soft); color: var(--map-accent-deep); border-color: rgba(13, 148, 136, 0.35); }
    .map-wojewodztwo-menu label {
      display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500;
      color: #334155; cursor: pointer; margin: 0; padding: 4px 3px; border-radius: 5px;
    }
    .map-wojewodztwo-menu label:hover { background: rgba(148, 163, 184, 0.12); }
    .map-wojewodztwo-menu input { margin: 0; flex-shrink: 0; accent-color: var(--map-accent); }
    .map-cluster-filter label {
      display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500;
      color: #334155; cursor: pointer; margin: 0; padding: 1px 0;
    }
    .map-cluster-filter input { margin: 0; flex-shrink: 0; accent-color: var(--map-accent); width: 14px; height: 14px; }
    .map-clear-all-filters {
      display: block; width: 100%; box-sizing: border-box; margin-top: 8px; padding: 5px 6px;
      font-size: 11px; font-weight: 600; border: none; border-radius: 6px;
      background: transparent; color: var(--map-accent-deep); cursor: pointer; text-align: center;
      text-decoration: underline; text-underline-offset: 2px;
    }
    .map-clear-all-filters:hover { background: var(--map-accent-soft); text-decoration: none; }
    .map-filter-count {
      display: inline-flex; align-items: center; margin-top: 8px; padding: 4px 9px;
      border-radius: 999px; border: 1px solid rgba(13, 148, 136, 0.22);
      background: var(--map-accent-soft); font-size: 11px; font-weight: 700; color: var(--map-accent-deep);
    }
    /* map-error-template */
    .map-error-stack {
      position: fixed; z-index: 27000; top: 12px; left: 50%; transform: translateX(-50%);
      width: min(440px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto;
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    }
    .map-error-stack[hidden] { display: none !important; }
    .map-error-card {
      pointer-events: auto; padding: 14px 16px; border-radius: 12px;
      background: rgba(255,255,255,0.97); border: 1px solid rgba(176,42,55,0.4);
      box-shadow: 0 10px 28px rgba(15,23,42,0.18); color: var(--map-ink); text-align: left;
    }
    .map-error-card-title { margin: 0 0 6px; font-size: 14px; font-weight: 700; line-height: 1.35; color: #b02a37; }
    .map-error-card-effect { margin: 0 0 6px; font-size: 13.5px; font-weight: 500; line-height: 1.45; color: var(--map-ink); }
    .map-error-card-continue { margin: 0 0 10px; font-size: 13.5px; font-weight: 600; line-height: 1.45; color: var(--map-ink); }
    .map-error-card-label { display: block; margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--map-muted); }
    .map-error-card-report {
      width: 100%; box-sizing: border-box; margin: 0 0 10px; padding: 8px 10px; min-height: 7.2em;
      border-radius: 8px; border: 1px solid rgba(148,163,184,0.55); background: #f8fafc; color: #334155;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical;
    }
    .map-error-card-actions { display: flex; justify-content: space-between; gap: 8px; }
    .map-error-card-actions button {
      margin: 0; padding: 6px 12px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .map-error-card-copy { border: 1px solid rgba(15,118,110,0.45); background: #fff; color: #0f766e; }
    .map-error-card-dismiss { border: 1px solid rgba(176,42,55,0.35); background: #fff; color: #b02a37; }
    /* /map-error-template */
`;
}

export function transportCss(): string {
  return `    .map-transport-loader { position: fixed; z-index: 25000; left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: none; }
    .map-transport-loader[hidden] { display: none !important; }
    .map-transport-loader-panel { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 22px; background: var(--map-surface); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-radius: 14px; box-shadow: var(--map-shadow); font-size: 13px; font-weight: 600; color: var(--map-muted); border: 1px solid rgba(255,255,255,0.7); text-align: center; }
    .map-transport-loader-logo { width: 64px; height: 64px; flex-shrink: 0; animation: map-logo-pulse 1.2s ease-in-out infinite; }
    @keyframes map-logo-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: 0.55; } }
    .map-app-notice {
      position: fixed; z-index: 26000; left: 50%; bottom: 28px; transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: stretch; gap: 10px;
      max-width: min(420px, calc(100vw - 24px)); padding: 14px 18px; border-radius: 12px;
      background: rgba(255,255,255,0.97); border: 1px solid rgba(13,148,136,0.35);
      box-shadow: 0 10px 28px rgba(15,23,42,0.18); font-size: 13px; font-weight: 600;
      color: var(--map-ink); line-height: 1.45; text-align: left;
    }
    .map-app-notice.is-persist {
      top: 16px; bottom: auto; max-width: min(480px, calc(100vw - 24px));
    }
    .map-app-notice[hidden] { display: none !important; }
    .map-app-notice.is-ok { border-color: rgba(15,118,110,0.45); color: #0f766e; }
    .map-app-notice.is-error { border-color: rgba(176,42,55,0.4); color: #b02a37; }
    .map-app-notice-text { margin: 0; white-space: pre-line; }
    .map-app-notice-close {
      align-self: flex-end; margin: 0; padding: 6px 12px; border-radius: 8px;
      border: 1px solid rgba(176,42,55,0.35); background: #fff; color: #b02a37;
      font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .map-app-notice-close[hidden] { display: none !important; }
`;
}

export function docCss(): string {
  return `    .btn-gen-doc { margin-top: 8px; padding: 8px 12px; cursor: pointer; border-radius: 10px; border: 1px solid var(--map-accent-deep); background: var(--map-accent); color: #fff; font-size: 12.5px; font-weight: 600; width: 100%; box-shadow: 0 1px 3px rgba(15, 118, 110, 0.28); }
    .btn-gen-doc:hover { background: var(--map-accent-deep); filter: none; }
    .btn-gen-doc:disabled { opacity: 0.45; cursor: not-allowed; filter: none; background: #94a3b8; border-color: #94a3b8; box-shadow: none; }
    .btn-gen-doc:disabled:hover { filter: none; background: #94a3b8; }
    .doc-modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 20000; align-items: center; justify-content: center; }
    .doc-modal-panel { background: rgba(255,255,255,0.96); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); padding: 20px 22px; border-radius: 14px; max-width: 420px; width: 90%; max-height: calc(100vh - 32px); overflow-y: auto; border: 1px solid rgba(255,255,255,0.7); box-shadow: var(--map-shadow); color: var(--map-ink); font-family: system-ui, "Segoe UI", sans-serif; }
    .doc-modal-panel h3 { margin: 0 0 6px 0; font-size: 15px; font-weight: 700; color: var(--map-ink); }
    .doc-modal-hint { margin: 0 0 14px; font-size: 12.5px; line-height: 1.45; font-weight: 500; color: var(--map-muted); }
    .doc-modal-panel label { display: block; font-size: 12.5px; font-weight: 600; margin: 10px 0 4px; color: var(--map-ink); }
    .doc-field-hint { font-weight: normal; color: var(--map-muted); font-size: 12px; }
    .doc-checkbox-row { display: flex !important; align-items: center; gap: 8px; margin: 12px 0 4px !important; cursor: pointer; user-select: none; }
    .doc-checkbox-row input { margin: 0; flex-shrink: 0; accent-color: var(--map-accent); }
    #doc-route-fields[hidden] { display: none !important; }
    .doc-route-continue-hint { margin: 6px 0 0; line-height: 1.4; }
    .doc-route-continue-hint[hidden] { display: none !important; }
    #doc-btn-nowa-trasa { margin-top: 8px; width: 100%; padding: 8px 12px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 600; border: 1px solid var(--map-accent-deep); background: rgba(255,255,255,0.92); color: var(--map-accent-deep); }
    #doc-btn-nowa-trasa:hover { background: var(--map-accent-soft); }
    #doc-btn-nowa-trasa[hidden] { display: none !important; }
    .doc-modal-panel input[type="date"], .doc-modal-panel input[type="text"], .doc-modal-panel .doc-combobox-input, .doc-modal-panel select, .doc-modal-panel textarea { width: 100%; padding: 9px 11px; font-size: 13px; color: var(--map-ink); border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.55); background: rgba(255,255,255,0.92); box-sizing: border-box; outline: none; }
    .doc-modal-panel input:focus, .doc-modal-panel select:focus, .doc-modal-panel textarea:focus, .doc-modal-panel .doc-combobox-input:focus { border-color: var(--map-accent); box-shadow: 0 0 0 3px var(--map-accent-soft); }
    .doc-modal-panel input.is-invalid, .doc-modal-panel input.is-invalid:focus { border-color: #b02a37; box-shadow: 0 0 0 3px rgba(176, 42, 55, 0.18); background: rgba(176, 42, 55, 0.06); }
    .doc-combobox-wrap { position: relative; }
    .doc-combobox-list { position: absolute; left: 0; right: 0; top: calc(100% + 2px); max-height: 220px; overflow-y: auto; z-index: 10; margin: 0; padding: 0; list-style: none; background: #fff; border: 1px solid rgba(148, 163, 184, 0.45); border-radius: 10px; box-shadow: var(--map-shadow); }
    .doc-combobox-list li { padding: 8px 10px; cursor: pointer; font-size: 13px; }
    .doc-combobox-list li:hover, .doc-combobox-list li.doc-combobox-active { background: var(--map-accent-soft); color: var(--map-accent-deep); }
    .doc-combobox-list li.doc-combobox-empty { color: var(--map-muted); cursor: default; }
    .doc-combobox-list li.doc-combobox-empty:hover { background: transparent; color: var(--map-muted); }
    .doc-modal-actions { margin-top: 16px; display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
    .doc-modal-actions button { padding: 8px 14px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 600; border: 1px solid rgba(148, 163, 184, 0.55); background: rgba(255,255,255,0.92); color: #334155; }
    .doc-modal-actions button:hover { background: var(--map-accent-soft); color: var(--map-accent-deep); border-color: rgba(13, 148, 136, 0.35); }
    .doc-filter-info { font-size: 12px; color: var(--map-muted); margin: 8px 0 0; min-height: 1.2em; }
    .doc-bulk-points-wrap { margin-top: 8px; max-height: 160px; overflow-y: auto; border: 1px solid var(--map-line); border-radius: 10px; padding: 8px 10px; background: rgba(248, 250, 252, 0.9); }
    .doc-bulk-points-title { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 6px; color: var(--map-muted); }
    .doc-bulk-points-list { margin: 0; padding: 0 0 0 16px; font-size: 12px; color: #334155; line-height: 1.45; }
    .bulk-rates-target { margin: 12px 0 4px; }
    .bulk-rates-target-title { display: block; font-size: 12.5px; font-weight: 600; margin: 0 0 6px; color: var(--map-ink); }
    .bulk-rates-target-options { display: flex; flex-wrap: wrap; gap: 8px 14px; }
    .bulk-rates-target-options label { display: flex !important; align-items: center; gap: 6px; margin: 0 !important; font-size: 12.5px; font-weight: 500; cursor: pointer; }
    .bulk-rates-target-options input { margin: 0; }
    .doc-bulk-numer-info { font-size: 12px; color: var(--map-accent-deep); margin: 8px 0 0; min-height: 1.2em; }
    #bolecin-aw-modal { z-index: 21000; }
    #bolecin-aw-add { background: var(--map-accent); color: #fff; border-color: var(--map-accent-deep); }
    #bolecin-aw-add:hover { background: var(--map-accent-deep); color: #fff; }
    #bolecin-aw-add:disabled { opacity: 0.45; cursor: not-allowed; background: #94a3b8; border-color: #94a3b8; color: #fff; }
    #bolecin-aw-add:disabled:hover { background: #94a3b8; border-color: #94a3b8; color: #fff; }
    .bolecin-aw-summary { margin-top: 4px; max-height: 180px; overflow-y: auto; font-size: 12px; line-height: 1.45; color: #334155; }
    .bolecin-aw-summary p { margin: 2px 0; }
    .popup-bulk-select { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 8px; cursor: pointer; color: #334155; }
    .popup-bulk-select input { margin: 0; flex-shrink: 0; accent-color: var(--map-accent); }
    .map-bulk-panel { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--map-line); display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .map-bulk-panel[hidden] { display: none !important; }
    .map-bulk-stats { flex: 1; min-width: 120px; display: flex; flex-direction: column; gap: 2px; }
    .map-bulk-count { font-size: 12px; color: #334155; }
    .map-bulk-bags { font-size: 12px; color: var(--map-accent-deep); font-weight: 600; }
    .map-bulk-generate { padding: 8px 12px; font-size: 12.5px; font-weight: 600; border-radius: 10px; border: 1px solid var(--map-accent-deep); background: var(--map-accent); color: #fff; cursor: pointer; box-shadow: 0 1px 3px rgba(15, 118, 110, 0.28); }
    .map-bulk-generate:hover { background: var(--map-accent-deep); filter: none; }
    .map-bulk-clear { padding: 8px 12px; font-size: 12.5px; font-weight: 600; border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.55); background: rgba(255,255,255,0.92); color: #334155; cursor: pointer; }
    .map-bulk-clear:hover { background: var(--map-accent-soft); color: var(--map-accent-deep); }
    .map-bulk-rates { padding: 8px 12px; font-size: 12.5px; font-weight: 600; border-radius: 10px; border: 1px solid rgba(111, 66, 193, 0.55); background: rgba(255,255,255,0.92); color: #5b2d9e; cursor: pointer; }
    .map-bulk-rates:hover { background: rgba(111, 66, 193, 0.08); border-color: #6f42c1; }
    .map-auto-bulk-btn {
      width: 100%; box-sizing: border-box; margin-top: 10px; padding: 10px 12px;
      font-size: 12.5px; font-weight: 600; border-radius: 10px;
      border: 1px solid rgba(111, 66, 193, 0.55); background: rgba(255,255,255,0.92);
      color: #5b2d9e; cursor: pointer; box-shadow: 0 1px 3px rgba(111, 66, 193, 0.12);
    }
    .map-auto-bulk-btn:hover { background: rgba(111, 66, 193, 0.08); border-color: #6f42c1; }
    .map-auto-bulk-btn.is-active {
      background: #6f42c1; border-color: #5a32a3; color: #fff;
      box-shadow: 0 1px 3px rgba(111, 66, 193, 0.35);
    }
    .map-auto-bulk-btn.is-active:hover { background: #5a32a3; border-color: #5a32a3; color: #fff; }
    #doc-btn-ok { background: var(--map-accent); border-color: var(--map-accent-deep); color: #fff; box-shadow: 0 1px 3px rgba(15, 118, 110, 0.28); }
    #doc-btn-ok:hover { background: var(--map-accent-deep); color: #fff; }
    #doc-btn-ok:disabled { opacity: 0.45; cursor: not-allowed; background: #94a3b8; border-color: #94a3b8; box-shadow: none; color: #fff; }
    #doc-btn-ok:disabled:hover { background: #94a3b8; border-color: #94a3b8; color: #fff; }
    #bulk-rates-btn-ok { background: #6f42c1; border-color: #5a32a3; color: #fff; box-shadow: 0 1px 3px rgba(111, 66, 193, 0.28); }
    #bulk-rates-btn-ok:hover { background: #5a32a3; color: #fff; }
    #bulk-rates-btn-ok:disabled { opacity: 0.75; cursor: wait; }
${harmonogramDaysPickerCss()}
`;
}

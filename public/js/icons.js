// Inline SVG icon set. Single stroke style, 16px default, inherits currentColor.
// No emoji, no external font. Add new entries to PATHS as needed.
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.4.4 4.2 2.1 5 4.9"/>',
  pulse: '<path d="M2.5 12h4l2.5-7 4.5 14 2.5-7h5.5"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 1 2.5 6"/><path d="M3.5 12H7M3.5 12V8.5"/><path d="M12 7.5V12l3 2"/>',
  leave: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3.5h6v4H9z"/><path d="M9 12l2 2 4-4.5"/>',
  overtime: '<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 1.5"/><path d="M9.5 2.5h5"/>',
  org: '<rect x="3" y="3.5" width="18" height="6" rx="1.5"/><rect x="3" y="14.5" width="8" height="6" rx="1.5"/><rect x="13" y="14.5" width="8" height="6" rx="1.5"/><path d="M12 9.5v5M7 14.5v-2.2M17 14.5v-2.2"/>',
  announce: '<path d="M4 10v5l3 .5V9.5z"/><path d="M7 9.5L18 5v9.5l-11-1.5"/><path d="M18 15a2.5 2.5 0 1 1 0 .01"/>',
  report: '<path d="M6 2.5h8L19 8v13.5H6z"/><path d="M13.5 2.5V8H19"/><path d="M9 12.5h6M9 16h6"/>',
  shield: '<path d="M12 2.5l7.5 3v6c0 5-3.2 8.3-7.5 10-4.3-1.7-7.5-5-7.5-10v-6z"/><path d="M9 12l2 2 4-4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/>',
  bell: '<path d="M6 9.5a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5"/><path d="M4 20.5h16"/>',
  upload: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M4 20.5h16"/>',
  chevLeft: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chevRight: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
};

function icon(name, size = 16) {
  const paths = ICON_PATHS[name] || ICON_PATHS.dot;
  return `<svg class="ic-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

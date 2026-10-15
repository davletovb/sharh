// Small inline icon set. Icons are decorative; callers label the control they sit in.
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  // Eight-point star: Sharh's mark.
  star: ['M12 2 14.2 7.6 19.8 5.4 17.6 10 22 12 17.6 14 19.8 18.6 14.2 16.4 12 22 9.8 16.4 4.2 18.6 6.4 14 2 12 6.4 10 4.2 5.4 9.8 7.6Z'],
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'],
  chevron: ['m6 9 6 6 6-6'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  plug: ['M9 2v6', 'M15 2v6', 'M6 8h12v4a6 6 0 0 1-12 0V8Z', 'M12 18v4'],
  model: ['M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4Z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z'],
  book: ['M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z', 'M4 21.5A2.5 2.5 0 0 1 6.5 19H20'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z'],
  palette: ['M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.6-2.1-.4-1 .3-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5Z', 'M7.5 11h.01', 'M10 7.5h.01', 'M14.5 7.5h.01'],
  data: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  external: ['M14 4h6v6', 'M20 4 10 14', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  library: ['M4 4v16', 'M9 4v16', 'M14 5l4 .8-2.8 14.4-4-.8Z'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z', 'M14 3v5h5'],
  send: ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4Z'],
  stop: ['M7 7h10v10H7Z'],
  open: ['M4 4h7', 'M4 4v7', 'M4 4l7 7', 'M20 20h-7', 'M20 20v-7', 'M20 20l-7-7']
};
export function icon(name, {size = 18, className = ''} = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', name === 'star' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'star' ? '0' : name === 'more' ? '3.4' : '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (className) svg.setAttribute('class', className);
  for (const d of PATHS[name] ?? []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
export function brand({href = null} = {}) {
  const node = document.createElement(href ? 'a' : 'span');
  node.className = 'brand';
  if (href) node.href = href;
  const word = document.createElement('span');
  word.textContent = 'Sharh';
  node.append(icon('star', {size: 22}), word);
  return node;
}
// Icon-only button with an accessible name.
export function iconButton(name, label, action, className = '') {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = ('icon ' + className).trim();
  node.setAttribute('aria-label', label);
  node.title = label;
  node.append(icon(name));
  if (action) node.addEventListener('click', action);
  return node;
}

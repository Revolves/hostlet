import path from 'node:path';

function installBrand(home) {
  const host = document.createElement('div');
  host.setAttribute('data-hostlet-brand', '');
  host.style.cssText = 'all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;display:block!important;width:32px!important;height:32px!important';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box}
      .brand{position:relative;font:500 14px/1.5 system-ui,sans-serif;color:#fff}
      a{color:#fff;text-decoration:none}
      .mark{display:grid;place-items:center;width:32px;height:32px;background:#22211f;border:1px solid #ffffff40;border-radius:8px;box-shadow:0 2px 12px #0002}
      .mark svg{width:16px;height:16px;fill:currentColor}
      nav{position:absolute;right:0;bottom:32px;padding-bottom:8px;visibility:hidden;opacity:0;transform:translateY(4px);transition:opacity 200ms cubic-bezier(.22,1,.36,1),transform 200ms cubic-bezier(.22,1,.36,1)}
      .links{display:flex;gap:16px;align-items:center;white-space:nowrap;padding:12px 16px;background:#22211f;border:1px solid #ffffff40;border-radius:12px;box-shadow:0 4px 20px #0003}
      .links a{display:flex;align-items:center;gap:6px;min-height:24px}
      .links svg{width:16px;height:16px;fill:currentColor}
      .links a:hover{text-decoration:underline}
      a:focus-visible{outline:2px solid #ef8b74;outline-offset:3px}
      .brand[data-open] nav{visibility:visible;opacity:1;transform:none}
      .brand:has(a:focus-visible) nav{visibility:visible;opacity:1;transform:none}
      @media(hover:hover){.brand:hover nav,.brand:focus-within nav{visibility:visible;opacity:1;transform:none}}
      @media(hover:none){.links a{min-height:32px}}
      @media(prefers-reduced-motion:reduce){nav{transition:none;transform:none}}
    </style>
    <div class="brand">
      <a class="mark" target="_blank" rel="noopener noreferrer" aria-label="Hostlet 官网与平台链接">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h4v7h8V3h4v18h-4v-7H8v7H4z"/></svg>
      </a>
      <nav aria-label="平台链接"><div class="links">
        <a class="home" target="_blank" rel="noopener noreferrer">Hostlet ↗</a>
        <a href="https://github.com/Revolves/hostlet" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.6v-2.2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.7 2.6 1.2 3.3.9.1-.7.4-1.2.7-1.5-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17.2 4.9 18.2 5.2 18.2 5.2c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.1v3.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .7z"/></svg>
          GitHub ↗
        </a>
      </div></nav>
    </div>`;
  const brand = root.querySelector('.brand');
  const mark = root.querySelector('.mark');
  mark.href = home;
  root.querySelector('.home').href = home;
  mark.addEventListener('click', event => {
    if (window.matchMedia('(hover: none)').matches) {
      event.preventDefault();
      brand.toggleAttribute('data-open');
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!event.composedPath().includes(host)) brand.removeAttribute('data-open');
  });
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      brand.removeAttribute('data-open');
      if (root.activeElement) root.activeElement.blur();
    }
  });
  document.documentElement.appendChild(host);
}

export function hostingBrandSuffix(filename, managementOrigin) {
  if (!['.html', '.htm'].includes(path.extname(filename).toLowerCase())) return '';
  const origin = new URL(managementOrigin);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new TypeError('Invalid brand origin');
  const home = JSON.stringify(origin.origin + '/').replaceAll('<', '\\u003c');
  return `\n<script data-hostlet-brand>(${installBrand.toString()})(${home});</script>`;
}

export function pipeHostedFile(stream, res, suffix) {
  if (!suffix) return stream.pipe(res);
  stream.once('end', () => res.end(suffix));
  return stream.pipe(res, { end: false });
}

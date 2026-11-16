import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hostingBrandSuffix } from '../server/hosting-brand.js';

test('HTML branding isolates a compact icon, links and touch expansion', () => {
  const suffix = hostingBrandSuffix('index.HTML', 'https://manage.example.test');
  const handlers = {};
  const host = { setAttribute() {}, addEventListener(name, handler) { handlers[name] = handler; }, style: {}, attachShadow(options) {
    assert.equal(options.mode, 'closed');
    return root;
  } };
  const link = { addEventListener(name, handler) { handlers.click = handler; } };
  let open = false;
  const brand = { toggleAttribute() { open = !open; }, removeAttribute() { open = false; } };
  const homeLink = {};
  const root = { innerHTML: '', querySelector: selector => selector === '.brand' ? brand : selector === '.mark' ? link : homeLink };
  let appended;
  vm.runInNewContext(suffix.slice(suffix.indexOf('>') + 1, suffix.lastIndexOf('</script>')), {
    document: { createElement: () => host, addEventListener(name, handler) { handlers[name] = handler; }, documentElement: { appendChild: element => { appended = element; } } },
    window: { matchMedia: () => ({ matches: true }) },
  });
  assert.equal(appended, host);
  assert.equal(link.href, 'https://manage.example.test/');
  assert.equal(homeLink.href, link.href);
  assert.match(root.innerHTML, /width:32px;height:32px/);
  let prevented = false;
  handlers.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(open, true);
  handlers.pointerdown({ composedPath: () => [host] });
  assert.equal(open, true);
  handlers.pointerdown({ composedPath: () => [] });
  assert.equal(open, false);
  handlers.click({ preventDefault() {} });
  handlers.keydown({ key: 'Escape' });
  assert.equal(open, false);
  assert.match(root.innerHTML, /https:\/\/github.com\/Revolves\/hostlet/);
  assert.match(root.innerHTML, /noopener noreferrer/);
  assert.match(host.style.cssText, /position:fixed/);
  for (const filename of ['app.js', 'photo.svg', 'style.css', 'README.md']) {
    assert.equal(hostingBrandSuffix(filename, 'https://manage.example.test'), '');
  }
  assert.throws(() => hostingBrandSuffix('index.html', 'javascript:alert(1)'), /origin/);
});

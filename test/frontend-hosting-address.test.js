import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostingConfig, applicationUrl, reportPageId } from '../admin/src/hosting-address.js';

const id = `w-${'a'.repeat(32)}`;

test('IP hosting generates application and exchange paths and recognizes report URLs', () => {
  const config = hostingConfig({ ipHostingOrigin: 'https://192.0.2.1:30007', hostingDomain: 'apps.example.com' });
  assert.equal(applicationUrl(config, id), `https://192.0.2.1:30007/p/${id}/`);
  assert.equal(new URL('__host/exchange', applicationUrl(config, id)).href, `https://192.0.2.1:30007/p/${id}/__host/exchange`);
  assert.equal(reportPageId(config, `https://192.0.2.1:30007/p/${id}/asset.js`), id);
  assert.equal(reportPageId(config, `https://192.0.2.1:30008/p/${id}/`), null);
  assert.equal(reportPageId(config, `https://user@192.0.2.1:30007/p/${id}/`), null);
  assert.equal(reportPageId(config, `https://192.0.2.1:30007/p/${id}evil/`), null);
});

test('domain mode preserves validation and report support', () => {
  const config = hostingConfig({ hostingDomain: 'apps.example.com:444' });
  assert.equal(applicationUrl(config, id), `https://${id}.apps.example.com:444/`);
  assert.equal(reportPageId(config, `https://${id}.apps.example.com:444/a`), id);
  assert.equal(reportPageId(config, `http://${id}.apps.example.com:444/`), null);
  assert.equal(reportPageId(config, `https://evil.${id}.apps.example.com:444/`), null);
});

test('invalid IP configuration fails closed and identifiers remain validated', () => {
  for (const ipHostingOrigin of ['http://192.0.2.1', 'https://user@192.0.2.1', 'https://192.0.2.1/path', 'https://192.0.2.1/?a=1', 'https://evil.test/#x']) {
    assert.equal(hostingConfig({ ipHostingOrigin, hostingDomain: 'apps.example.com' }), null);
  }
  assert.equal(applicationUrl(hostingConfig({ ipHostingOrigin: 'https://192.0.2.1' }), '../bad'), null);
});

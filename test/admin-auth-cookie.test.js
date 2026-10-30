import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../server/auth.js';

test('admin authentication rejects duplicate cookie names regardless of parsed cookie order', () => {
  const auth=createAuth({config:{secureCookies:true},sessions:{find: token => token === 'valid' ? {id:'session'} : null}});
  for (const raw of ['hostlet_admin=valid; hostlet_admin=attacker','hostlet_admin=attacker; hostlet_admin=valid']) {
    const req={headers:{cookie:raw},cookies:{hostlet_admin:'valid'}};
    let status, body, nextCalled=false;
    const res={status(value){status=value;return this;},json(value){body=value;return this;}};
    auth.requireAdmin(req,res,()=>{nextCalled=true;});
    assert.equal(nextCalled,false); assert.equal(status,401);
    auth.me(req,res); assert.equal(body.authenticated,false);
  }
});

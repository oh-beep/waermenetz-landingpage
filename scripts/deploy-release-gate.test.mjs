import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
test('deploy requires explicit exact release before secrets and checks checkout',()=>{
  const events=workflow.slice(workflow.indexOf('on:'),workflow.indexOf('jobs:'));
  assert.match(events,/workflow_dispatch:/);assert.doesNotMatch(events,/^  (push|pull_request|schedule):/m);
  assert.ok(workflow.indexOf('Validate release gate')<workflow.indexOf('uses: actions/checkout'));
  assert.match(workflow,/ref: \$\{\{ inputs.release_sha \}\}/);
  assert.ok(workflow.indexOf('Verify checked out SHA')<workflow.indexOf('secrets.'));
  assert.match(workflow,/git rev-parse HEAD/);
});
test('actual gate shell rejects malformed SHA and missing or altered approval',()=>{
  const gate=workflow.match(/Validate release gate[^]*?        run: \|\n((?:          .*\n)+)/)[1].replace(/^          /gm,'');
  const sha='a'.repeat(40), ok='LIVE-DEPLOY-FREIGEGEBEN';
  for(const [release,approval,pass] of [[sha,ok,true],['',ok,false],['a'.repeat(39),ok,false],['A'.repeat(40),ok,false],[sha+'\n',ok,false],[sha,'',false],[sha,ok+' ',false],['$(exit 0)',ok,false]]) {
    const r=spawnSync('bash',['-c',gate],{env:{PATH:process.env.PATH,RELEASE_SHA:release,CONFIRM_LIVE:approval},encoding:'utf8'});
    assert.equal(r.status===0,pass,JSON.stringify([release,approval]));
  }
});

test('deployment uses the installed least-privilege nginx verification helper',()=>{
  assert.match(workflow,/sudo -n \/usr\/local\/sbin\/kz-nginx-verify-reload/);
  assert.doesNotMatch(workflow,/sudo (?:nginx|systemctl)/);
});

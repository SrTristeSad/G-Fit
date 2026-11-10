import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeUpdateState,readJson,updateLocations,recoverInterruptedUpdate,
} from '../update-core.mjs';

async function fixture(callback){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'gfit-update-recovery-'));
  const root=path.join(base,'root'),privateDir=path.join(base,'private');
  await fs.mkdir(root);await fs.mkdir(privateDir,{mode:0o700});
  try{await callback(root,privateDir,updateLocations(privateDir));}
  finally{await fs.rm(base,{recursive:true,force:true});}
}
test('interrupted preparation becomes retryable without losing pending ZIP',async()=>{
  await fixture(async(root,privateDir,loc)=>{
    await writeUpdateState(privateDir,{
      id:'9d650086-2031-4d0f-9d81-1a8624fa3ad5',
      status:'preparing',version:'0.1.1',phase:'build',
      sha256:'a'.repeat(64),
    });
    await fs.writeFile(loc.pending,'synthetic ZIP');
    assert.equal(await recoverInterruptedUpdate(privateDir,root),true);
    const state=await readJson(loc.state,null);
    assert.equal(state.status,'failed_prepare');
    assert.ok(state.error.includes('Tente novamente'));
    assert.equal(await fs.readFile(loc.pending,'utf8'),'synthetic ZIP');
    assert.equal(await recoverInterruptedUpdate(privateDir,root),false);
  });
});
test('interrupted activation restores old code and retains database backup',async()=>{
  await fixture(async(root,privateDir,loc)=>{
    const id='e704e172-8d70-4e9a-a6e0-5aa7f0198487';
    const codeDir=path.join(loc.snapshots,id,'code');
    await fs.mkdir(path.join(root,'api/src'),{recursive:true});
    await fs.writeFile(path.join(root,'api/src','new.js'),'new version');
    await fs.mkdir(path.join(codeDir,'api/src'),{recursive:true});
    await fs.writeFile(path.join(codeDir,'api/src','old.js'),'old version');
    const available=['package.json','api/package.json','api/src','web/package.json',
      'web/src','web/dist','aapanel'];
    for(const name of available){
      if(name==='api/src')continue;
      const target=path.join(codeDir,name);
      if(path.extname(name)){
        await fs.mkdir(path.dirname(target),{recursive:true});
        await fs.writeFile(target,name+' snapshot');
      }else{
        await fs.mkdir(target,{recursive:true});
        await fs.writeFile(path.join(target,'original.js'),'snapshot');
      }
    }
    await fs.writeFile(path.join(codeDir,'contents.json'),JSON.stringify({available}));
    await fs.writeFile(path.join(loc.snapshots,id,'database.gfitbak'),'synthetic encrypted db snapshot');
    await writeUpdateState(privateDir,{
      id,status:'applying',version:'0.1.1',sha256:'b'.repeat(64),progress:50,
    });
    assert.equal(await recoverInterruptedUpdate(privateDir,root),true);
    assert.equal(await fs.readFile(path.join(root,'api/src','old.js'),'utf8'),'old version');
    await assert.rejects(fs.stat(path.join(root,'api/src','new.js')),{code:'ENOENT'});
    const after=await readJson(loc.state,null);
    assert.equal(after.status,'failed');
    assert.equal(await fs.readFile(path.join(loc.snapshots,id,'database.gfitbak'),'utf8'),
      'synthetic encrypted db snapshot');
    const history=await readJson(loc.history,[]);
    assert.equal(history.length,1);
    assert.equal(history[0].status,'failed');
  });
});
test('activation completed before crash remains completed after restart',async()=>{
  await fixture(async(root,privateDir,loc)=>{
    await fs.mkdir(path.dirname(loc.current),{recursive:true});
    await fs.writeFile(loc.current,JSON.stringify({version:'0.1.1',sha256:'c'.repeat(64)}));
    await writeUpdateState(privateDir,{
      id:'9800c2b6-9bba-4115-a95c-7bb8974d1117',
      status:'applying',version:'0.1.1',sha256:'c'.repeat(64),
    });
    assert.equal(await recoverInterruptedUpdate(privateDir,root),true);
    const status=await readJson(loc.state,null);
    assert.equal(status.status,'applied');
    assert.equal(status.restartRequired,false);
  });
});

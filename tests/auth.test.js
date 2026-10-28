import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

async function freePort(){
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  await new Promise(resolve=>server.close(resolve));
  return port;
}

test('local accounts sign in and keep task histories isolated',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worklog-auth-'));
  const port=await freePort();
  const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),stdio:'ignore',env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',WORKLOG_DATA_DIR:dir,OLLAMA_URL:'http://127.0.0.1:1'}});
  const base=`http://127.0.0.1:${port}`;
  const request=async(route,{cookie,...options}={})=>fetch(base+route,{...options,headers:{...(options?.headers||{}),...(cookie?{cookie}:{})}});
  try{
    let ready=false;
    for(let i=0;i<80&&!ready;i++){
      if(child.exitCode!==null)throw new Error('Test server exited before it became ready');
      try{ready=(await fetch(base+'/api/auth/me')).status===401}catch{}
      if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(ready,true,'test server should start');

    const signup=async(email,display_name)=>{
      const response=await request('/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,display_name,password:'correct horse battery staple'})});
      assert.equal(response.status,201);
      const setCookie=response.headers.get('set-cookie');
      assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
      return {account:await response.json(),cookie:setCookie.split(';')[0]};
    };
    const alice=await signup('alice@example.test','Alice Example');
    const saved=await request('/api/tasks',{cookie:alice.cookie,method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Private task',description:'Alice only',work_date:'2026-10-28'})});
    assert.equal(saved.status,201);const task=await saved.json();

    const bob=await signup('bob@example.test','Bob Example');
    assert.deepEqual(await (await request('/api/tasks',{cookie:bob.cookie})).json(),[]);
    assert.equal((await request(`/api/tasks/${task.id}`,{cookie:bob.cookie,method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Attempted edit'})})).status,404);
    assert.equal((await request('/api/tasks')).status,401);

    const login=await request('/api/auth/signin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'alice@example.test',password:'correct horse battery staple'})});
    assert.equal(login.status,200);const aliceAgain=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await request('/api/tasks',{cookie:aliceAgain})).json()).length,1);
    assert.equal((await request('/api/auth/signout',{cookie:aliceAgain,method:'POST'})).status,204);
    assert.equal((await request('/api/auth/me',{cookie:aliceAgain})).status,401);
  }finally{
    if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve))}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

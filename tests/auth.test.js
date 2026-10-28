import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

async function freePort(){
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  await new Promise(resolve=>server.close(resolve));
  return port;
}
test('full API flow: migration, accounts, worklogs, reports, exports, and local AI',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worklog-integration-'));
  const port=await freePort();
  const oldDb=new Database(path.join(dir,'worklog.db'));
  oldDb.exec(`CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
    worklog TEXT NOT NULL, project TEXT DEFAULT '', application TEXT DEFAULT '', environment TEXT DEFAULT '',
    category TEXT DEFAULT 'Other', status TEXT DEFAULT 'Completed', duration_minutes INTEGER NOT NULL DEFAULT 0,
    duration_source TEXT DEFAULT 'estimate', created_at TEXT NOT NULL, work_date TEXT NOT NULL
  )`);
  oldDb.prepare(`INSERT INTO tasks(note,title,description,worklog,project,application,environment,category,status,duration_minutes,duration_source,created_at,work_date)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('Fixed pipeline and tested deployment','Pipeline repair','Updated YAML and tested','Updated YAML and tested deployment','MAIN2','Common API','Production','CI/CD','Completed',60,'estimate','2026-10-27T10:00:00Z','2026-10-27');
  oldDb.close();

  let ollamaStatus=200;
  let ollamaCalls=[];
  let ollamaResponse={title:'Updated API Pipeline',description:'Updated the API pipeline configuration.',worklog:'Updated the API pipeline configuration and verified the deployment.',category:'CI/CD',status:'Completed',duration_minutes:45,duration_source:'estimate',duration_reason:'Rough estimate for the configuration update and verification.'};
  const ollama=createServer((req,res)=>{
    const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{
      res.setHeader('content-type','application/json');
      if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'llama3.2:latest'}]}));
      if(req.url==='/api/generate'){
        ollamaCalls.push(JSON.parse(Buffer.concat(chunks).toString()));
        if(ollamaStatus!==200){res.statusCode=ollamaStatus;return res.end(JSON.stringify({error:'test model failure'}))}
        return res.end(JSON.stringify({response:JSON.stringify(ollamaResponse)}));
      }
      res.statusCode=404;res.end('{}');
    });
  });
  await new Promise(resolve=>ollama.listen(0,'127.0.0.1',resolve));
  const ollamaPort=ollama.address().port;
  const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),stdio:'ignore',env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',WORKLOG_DATA_DIR:dir,OLLAMA_URL:`http://127.0.0.1:${ollamaPort}`,OLLAMA_MODEL:'llama3.2'}});
  const base=`http://127.0.0.1:${port}`;
  const request=async(route,{cookie,...options}={})=>fetch(base+route,{...options,headers:{...(options?.headers||{}),...(cookie?{cookie}:{})}});
  const post=(route,body,cookie)=>request(route,{cookie,method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    let ready=false;
    for(let i=0;i<80&&!ready;i++){
      if(child.exitCode!==null)throw new Error('Test server exited before it became ready');
      try{ready=(await fetch(base+'/api/auth/me')).status===401}catch{}
      if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(ready,true,'server starts with and migrates a legacy database');

    assert.equal((await post('/api/auth/signup',{email:'invalid',display_name:'Alice Example',password:'correct horse battery staple'})).status,400);
    assert.equal((await post('/api/auth/signup',{email:'alice@example.test',display_name:'A',password:'correct horse battery staple'})).status,400);
    assert.equal((await post('/api/auth/signup',{email:'alice@example.test',display_name:'Alice Example',password:'short'})).status,400);
    assert.equal((await request('/api/tasks')).status,401);
    assert.equal((await post('/api/tasks',{title:'Private'})).status,401);

    const signup=await post('/api/auth/signup',{email:'alice@example.test',display_name:'Alice Example',password:'correct horse battery staple'});
    assert.equal(signup.status,201);
    const alice=await signup.json();const aliceCookie=signup.headers.get('set-cookie').split(';')[0];
    assert.match(signup.headers.get('set-cookie'),/HttpOnly/);assert.match(signup.headers.get('set-cookie'),/SameSite=Strict/);
    assert.equal(alice.display_name,'Alice Example');
    assert.equal((await (await request('/api/auth/me',{cookie:aliceCookie})).json()).id,alice.id);
    const signin=await post('/api/auth/signin',{email:'alice@example.test',password:'correct horse battery staple'});
    assert.equal(signin.status,200);
    const aliceLoginCookie=signin.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await request('/api/tasks',{cookie:aliceLoginCookie})).json()).length,1,'sign-in restores the same account history');

    const migrated=await request('/api/tasks',{cookie:aliceCookie});
    assert.equal(migrated.status,200);assert.equal((await migrated.json()).length,1,'first account receives previous unassigned tasks');
    assert.equal((await post('/api/auth/signup',{email:'ALICE@example.test',display_name:'Duplicate Alice',password:'correct horse battery staple'})).status,409);
    assert.equal((await post('/api/auth/signin',{email:'alice@example.test',password:'wrong password'})).status,401);

    const invalidTask=await post('/api/tasks',{note:'',title:'',description:'',worklog:''},aliceCookie);
    assert.equal(invalidTask.status,400);
    const taskResponse=await post('/api/tasks',{note:'',title:'Pod restart investigation',description:'Investigated a restarting pod in staging.',worklog:'Reviewed the pod state.',project:'Orion',application:'API',environment:'Staging',category:'Kubernetes',status:'In Progress',duration_minutes:25,duration_source:'manual',work_date:'2026-10-28'},aliceCookie);
    assert.equal(taskResponse.status,201);const task=await taskResponse.json();
    assert.equal(task.note,'Investigated a restarting pod in staging.','description is used when the quick note is blank');
    assert.equal(task.user_id,alice.id);

    assert.equal((await (await request('/api/tasks?q=Pipeline',{cookie:aliceCookie})).json()).length,1);
    assert.equal((await (await request('/api/tasks?project=Orion&category=Kubernetes&from=2026-10-28&to=2026-10-28',{cookie:aliceCookie})).json()).length,1);
    assert.equal((await (await request('/api/tasks?category=Linux',{cookie:aliceCookie})).json()).length,0);

    assert.equal((await request(`/api/tasks/${task.id}`,{cookie:aliceCookie,method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...task,title:'Pod restart resolved',status:'Completed'})})).status,200);
    assert.equal((await request('/api/reports/summary?from=2026-10-28&to=2026-10-28',{cookie:aliceCookie})).status,200);
    const report=await (await request('/api/reports/summary?from=2026-10-28&to=2026-10-28',{cookie:aliceCookie})).json();
    assert.equal(report.count,1);assert.equal(report.total_minutes,25);assert.equal(report.categories[0].name,'Kubernetes');

    const csv=await request('/api/export.csv',{cookie:aliceCookie});assert.equal(csv.status,200);assert.match(await csv.text(),/Pod restart resolved/);
    const markdown=await request('/api/export.md',{cookie:aliceCookie});assert.match(await markdown.text(),/Pod restart resolved/);
    const xlsx=await request('/api/export.xlsx',{cookie:aliceCookie});assert.equal(xlsx.status,200);assert.match(xlsx.headers.get('content-type'),/spreadsheetml/);assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0,2).toString(),'PK');

    assert.equal((await request('/api/health')).status,200);
    const noNote=await post('/api/generate',{note:''},aliceCookie);assert.equal(noNote.status,400);assert.equal(ollamaCalls.length,0);
    const generated=await post('/api/generate',{note:'Updated API pipeline configuration and verified deployment.',project:'MAIN2',application:'Common API',environment:'Production'},aliceCookie);
    assert.equal(generated.status,200);const generatedBody=await generated.json();
    assert.equal(generatedBody.category,'CI/CD');assert.equal(generatedBody.duration_source,'estimate');assert.equal(generatedBody.duration_minutes,45);
    assert.match(ollamaCalls[0].prompt,/Project: MAIN2/);assert.match(ollamaCalls[0].prompt,/Application: Common API/);assert.match(ollamaCalls[0].prompt,/Do not add tools, causes/);
    assert.equal(ollamaCalls[0].options.num_ctx,2048);assert.equal(ollamaCalls[0].options.temperature,0.15);assert.equal(ollamaCalls[0].format.properties.title.minLength,4);
    ollamaStatus=500;const unavailable=await post('/api/generate',{note:'A valid note.'},aliceCookie);assert.equal(unavailable.status,503);assert.match((await unavailable.json()).error,/not sent anywhere/);

    const bobSignup=await post('/api/auth/signup',{email:'bob@example.test',display_name:'Bob Example',password:'correct horse battery staple'});
    assert.equal(bobSignup.status,201);const bobCookie=bobSignup.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await (await request('/api/tasks',{cookie:bobCookie})).json(),[]);
    assert.equal((await request(`/api/tasks/${task.id}`,{cookie:bobCookie,method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Cross-account edit'})})).status,404);
    assert.equal((await request(`/api/tasks/${task.id}`,{cookie:bobCookie,method:'DELETE'})).status,404);
    assert.equal((await request('/api/tasks',{cookie:bobCookie,method:'DELETE'})).status,204);
    const aliceTasksAfterBobDelete=await (await request('/api/tasks',{cookie:aliceCookie})).json();
    assert.equal(aliceTasksAfterBobDelete.length,2,'Bob deleting his own tasks leaves Alice’s tasks intact');

    assert.equal((await request(`/api/tasks/${task.id}`,{cookie:aliceCookie,method:'DELETE'})).status,204);
    assert.equal((await request('/api/tasks',{cookie:aliceCookie,method:'DELETE'})).status,204);
    assert.deepEqual(await (await request('/api/tasks',{cookie:aliceCookie})).json(),[]);
    assert.equal((await request('/api/auth/signout',{cookie:bobCookie,method:'POST'})).status,204);
    assert.equal((await request('/api/auth/me',{cookie:bobCookie})).status,401);
  }finally{
    if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve))}
    await new Promise(resolve=>ollama.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

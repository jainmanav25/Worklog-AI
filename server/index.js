import express from 'express';
import cors from 'cors';
import ExcelJS from 'exceljs';
import { db, listTasks } from './store.js';
import { authRouter, requireAuth } from './auth.js';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const app=express();
app.use(cors({origin:['http://localhost:5173','http://127.0.0.1:5173'],credentials:true}));
app.use(express.json({limit:'1mb'}));
const port=Number(process.env.PORT||4317);
const ollamaUrl=process.env.OLLAMA_URL||'http://127.0.0.1:11434';
const model=process.env.OLLAMA_MODEL||'llama3.2';
const today=()=>new Date().toLocaleDateString('en-CA');

app.get('/api/health',async(_,res)=>{
 let configured=false;
 try{const r=await fetch(`${ollamaUrl.replace(/\/$/,'')}/api/tags`,{signal:AbortSignal.timeout(1200)});if(r.ok){const {models=[]}=await r.json();const wanted=model.toLowerCase();configured=models.some(item=>{const installed=String(item.name||item.model||'').toLowerCase();return installed===wanted||installed.split(':')[0]===wanted})}}catch{}
 res.json({ok:true,ai:{configured,model,endpoint:ollamaUrl}});
});
app.use('/api/auth',authRouter);
app.use('/api',requireAuth);

app.get('/api/tasks',(req,res)=>{try{res.json(listTasks(req.user.id,req.query))}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/tasks',(req,res)=>{try{
 const t=req.body;const note=String(t.note||t.description||t.worklog||'').trim();
 if(!note||!t.title?.trim())return res.status(400).json({error:'A task title and a note, description, or worklog comment are required.'});
 const stmt=db.prepare(`INSERT INTO tasks(user_id,note,title,description,worklog,project,application,environment,category,status,duration_minutes,duration_source,created_at,work_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 const result=stmt.run(req.user.id,note,t.title.trim(),t.description||'',t.worklog||'',t.project||'',t.application||'',t.environment||'',t.category||'Other',t.status||'Completed',Math.max(0,Number(t.duration_minutes)||0),t.duration_source||'estimate',new Date().toISOString(),t.work_date||today());
 res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(result.lastInsertRowid,req.user.id));
}catch(e){res.status(500).json({error:e.message})}});
app.put('/api/tasks/:id',(req,res)=>{try{
 const t=req.body;const result=db.prepare(`UPDATE tasks SET note=?,title=?,description=?,worklog=?,project=?,application=?,environment=?,category=?,status=?,duration_minutes=?,duration_source=?,work_date=? WHERE id=? AND user_id=?`).run(t.note,t.title,t.description||'',t.worklog||'',t.project||'',t.application||'',t.environment||'',t.category||'Other',t.status||'Completed',Math.max(0,Number(t.duration_minutes)||0),t.duration_source||'manual',t.work_date||today(),req.params.id,req.user.id);
 if(!result.changes)return res.status(404).json({error:'Task not found'});
 res.json(db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(req.params.id,req.user.id));
}catch(e){res.status(500).json({error:e.message})}});
app.delete('/api/tasks/:id',(req,res)=>{const out=db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').run(req.params.id,req.user.id);res.status(out.changes?204:404).end()});
app.delete('/api/tasks',(req,res)=>{db.prepare('DELETE FROM tasks WHERE user_id=?').run(req.user.id);res.status(204).end()});

app.post('/api/generate',async(req,res)=>{
 const note=String(req.body.note||'').trim();if(!note)return res.status(400).json({error:'Enter a work note first.'});
 const context=[['Project',req.body.project],['Application',req.body.application],['Environment',req.body.environment]].filter(([,value])=>String(value||'').trim()).map(([label,value])=>`${label}: ${String(value).trim()}`).join('\n')||'No project, application, or environment was provided.';
 const prompt=`You write concise, accurate worklog entries for an engineering issue tracker. Use only facts in the note and the optional metadata. Do not add tools, causes, fixes, test results, impact, or completion claims that the user did not state. Preserve the meaning of Hinglish notes and write the output in concise professional English.

Rules:
- Title: short, specific, sentence case; do not add a product or system name unless supplied.
- Description: one or two sentences that restate the work and stated outcome only.
- Worklog: a concise first-person-neutral ticket update; never claim successful validation unless the note says it was tested.
- Category must be one of: CI/CD, Kubernetes, Linux, Monitoring, Cloud, Networking, Security, Automation, Other. Choose Other when uncertain.
- Status must be Completed only when the note clearly says the work is finished or verified; otherwise use In Progress. Use Blocked only when explicitly blocked.
- Duration is a suggestion, never a claim about actual time. If the note states a duration, preserve it in minutes and use source provided. Otherwise give a modest rough estimate only if the described work has enough scope; use source estimate and explain that it is approximate. If scope is too vague, use 0 and source unspecified. Never invent elapsed time.
- Return only the requested JSON fields. Keep all wording brief and suitable for a Jira issue comment.

Example note: Fixed pipeline error, updated YAML configuration and tested deployment.
Example result: {"title":"Resolved Pipeline Configuration Issue","description":"Fixed the pipeline error by updating the YAML configuration and tested the deployment.","worklog":"Updated the pipeline YAML configuration and tested the deployment.","category":"CI/CD","status":"Completed","duration_minutes":60,"duration_source":"estimate","duration_reason":"Rough estimate for troubleshooting, configuration updates, and a deployment test."}

User-provided metadata (do not infer missing values):
${context}

Work note:
${note}`;
 const format={type:'object',properties:{title:{type:'string',minLength:4,maxLength:100},description:{type:'string',minLength:8,maxLength:500},worklog:{type:'string',minLength:8,maxLength:500},category:{type:'string',enum:['CI/CD','Kubernetes','Linux','Monitoring','Cloud','Networking','Security','Automation','Other']},status:{type:'string',enum:['Completed','In Progress','Blocked','Pending']},duration_minutes:{type:'integer',minimum:0,maximum:1440},duration_source:{type:'string',enum:['provided','estimate','unspecified']},duration_reason:{type:'string',maxLength:200}},required:['title','description','worklog','category','status','duration_minutes','duration_source','duration_reason'],additionalProperties:false};
 try{const response=await fetch(`${ollamaUrl.replace(/\/$/,'')}/api/generate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt,stream:false,format,keep_alive:'10m',options:{temperature:0.15,top_p:0.9,num_ctx:2048,num_predict:320}})});if(!response.ok)throw new Error(`Ollama returned ${response.status}.`);const payload=await response.json();const raw=JSON.parse(payload.response);const allowedCategories=['CI/CD','Kubernetes','Linux','Monitoring','Cloud','Networking','Security','Automation','Other'];const allowedStatuses=['Completed','In Progress','Blocked','Pending'];const duration=Number.isInteger(raw.duration_minutes)?Math.max(0,Math.min(1440,raw.duration_minutes)):0;const source=['provided','estimate','unspecified'].includes(raw.duration_source)?raw.duration_source:'unspecified';res.json({title:String(raw.title||'').trim(),description:String(raw.description||'').trim(),worklog:String(raw.worklog||'').trim(),category:allowedCategories.includes(raw.category)?raw.category:'Other',status:allowedStatuses.includes(raw.status)?raw.status:'In Progress',duration_minutes:duration,duration_source:duration?source:'unspecified',duration_reason:String(raw.duration_reason||'').trim(),model})}
 catch(e){res.status(503).json({error:`Local AI is unavailable (${e.message}). Start Ollama, download a model (ollama pull llama3.2), or fill the fields manually. Your note was not sent anywhere.`})}
});
app.get('/api/reports/summary',(req,res)=>{const {from,to}=req.query;const tasks=listTasks(req.user.id,{from,to});const total=tasks.reduce((n,t)=>n+t.duration_minutes,0);const group=key=>Object.entries(tasks.reduce((o,t)=>{const k=t[key]||'Unassigned';o[k]=(o[k]||0)+t.duration_minutes;return o},{})).map(([name,minutes])=>({name,minutes}));res.json({count:tasks.length,total_minutes:total,projects:group('project'),categories:group('category'),tasks})});
app.get('/api/export.csv',(req,res)=>{const tasks=listTasks(req.user.id,req.query);const headers=['Task title','Description','Worklog','Date','Project','Application','Environment','Category','Status','Duration (minutes)'];const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;const csv=[headers,...tasks.map(t=>[t.title,t.description,t.worklog,t.work_date,t.project,t.application,t.environment,t.category,t.status,t.duration_minutes])].map(r=>r.map(esc).join(',')).join('\r\n');res.setHeader('content-type','text/csv; charset=utf-8');res.setHeader('content-disposition','attachment; filename="worklog.csv"');res.send('\uFEFF'+csv)});
app.get('/api/export.md',(req,res)=>{const tasks=listTasks(req.user.id,req.query);const content=['# WorkLog report','',...tasks.flatMap(t=>[`## ${t.title}`,`- Date: ${t.work_date}`,`- Project: ${t.project||'—'}`,`- Category: ${t.category}`,`- Status: ${t.status}`,`- Duration: ${t.duration_minutes?`${t.duration_minutes} minutes (${t.duration_source})`:'Unspecified'}`,'',t.description,'',`Worklog: ${t.worklog}`,''])].join('\n');res.setHeader('content-disposition','attachment; filename="worklog.md"');res.type('text/markdown').send(content)});
app.get('/api/export.xlsx',async(req,res)=>{const tasks=listTasks(req.user.id,req.query);const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Worklog');ws.columns=[['Task title','title'],['Description','description'],['Date','work_date'],['Project','project'],['Category','category'],['Status','status'],['Duration (minutes)','duration_minutes']].map(([header,key])=>({header,key,width:24}));ws.addRows(tasks);ws.getRow(1).font={bold:true};res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('content-disposition','attachment; filename="worklog.xlsx"');await wb.xlsx.write(res);res.end()});

const here=path.dirname(fileURLToPath(import.meta.url));const dist=path.resolve(here,'../dist');
if(process.env.NODE_ENV==='production'){app.use(express.static(dist));app.get('*',(_,res)=>res.sendFile(path.join(dist,'index.html')))}
createServer(app).listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`WorkLog AI server listening on http://${process.env.HOST||'127.0.0.1'}:${port}`));

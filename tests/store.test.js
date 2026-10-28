import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('SQLite stores worklogs per account and filters search, date, project, and category', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worklog-ai-'));
  process.env.WORKLOG_DATA_DIR=dir;
  const {db,listTasks,createAccount}=await import('../server/store.js');
  const insert=db.prepare('INSERT INTO tasks(note,title,description,worklog,project,category,status,duration_minutes,created_at,work_date) VALUES(?,?,?,?,?,?,?,?,?,?)');
  insert.run('fixed deploy','Deploy fix','Updated config','Validated release','Atlas','CI/CD','Completed',60,'2026-10-27T10:00:00Z','2026-10-27');
  const alice=createAccount({email:'alice@example.test',displayName:'Alice Jain',passwordHash:'test-hash'});
  const bob=createAccount({email:'bob@example.test',displayName:'Bob Jain',passwordHash:'test-hash'});
  insert.run('checked pod','Pod check','Reviewed health','Checked logs','Beacon','Kubernetes','In Progress',20,'2026-10-26T10:00:00Z','2026-10-26');
  db.prepare('UPDATE tasks SET user_id=? WHERE title=?').run(alice.id,'Pod check');
  assert.equal(listTasks(alice.id,{q:'deploy'}).length,1);
  assert.equal(listTasks(alice.id,{from:'2026-10-27',to:'2026-10-27',project:'Atlas',category:'CI/CD'}).length,1);
  assert.equal(listTasks(alice.id,{category:'Linux'}).length,0);
  assert.equal(listTasks(bob.id).length,0);
  db.close(); fs.rmSync(dir,{recursive:true,force:true}); delete process.env.WORKLOG_DATA_DIR;
});

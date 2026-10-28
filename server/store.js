import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.resolve(process.env.WORKLOG_DATA_DIR||path.join(root,'../data'));
fs.mkdirSync(dataDir,{recursive:true});
export const db=new Database(path.join(dataDir,'worklog.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
 worklog TEXT NOT NULL, project TEXT DEFAULT '', application TEXT DEFAULT '', environment TEXT DEFAULT '',
 category TEXT DEFAULT 'Other', status TEXT DEFAULT 'Completed', duration_minutes INTEGER NOT NULL DEFAULT 0,
 duration_source TEXT DEFAULT 'estimate', created_at TEXT NOT NULL, work_date TEXT NOT NULL
);`);
const taskColumns=db.prepare('PRAGMA table_info(tasks)').all().map(c=>c.name);
if(!taskColumns.includes('user_id'))db.exec('ALTER TABLE tasks ADD COLUMN user_id INTEGER REFERENCES users(id)');
db.exec(`CREATE INDEX IF NOT EXISTS tasks_user_date ON tasks(user_id, work_date);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);

export function createAccount({email,displayName,passwordHash}){
 const insert=db.prepare('INSERT INTO users(email,display_name,password_hash,created_at) VALUES(?,?,?,?)');
 const assignLegacy=db.prepare('UPDATE tasks SET user_id=? WHERE user_id IS NULL');
 return db.transaction(()=>{
  const first=db.prepare('SELECT COUNT(*) AS count FROM users').get().count===0;
  const id=Number(insert.run(email,displayName,passwordHash,new Date().toISOString()).lastInsertRowid);
  if(first)assignLegacy.run(id);
  return db.prepare('SELECT id,email,display_name,created_at FROM users WHERE id=?').get(id);
 })();
}
export function findAccount(email){return db.prepare('SELECT * FROM users WHERE email=?').get(email)}
export function userById(id){return db.prepare('SELECT id,email,display_name,created_at FROM users WHERE id=?').get(id)}
export function createSession(tokenHash,userId,expiresAt){
 const now=new Date().toISOString();db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(tokenHash,userId,expiresAt,now);
}
export function sessionUser(tokenHash){return db.prepare(`SELECT u.id,u.email,u.display_name,u.created_at
 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash,new Date().toISOString())}
export function deleteSession(tokenHash){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash)}

export function listTasks(userId,{from,to,project,category,q}={}){
 let sql='SELECT * FROM tasks WHERE user_id=?';const args=[userId];
 if(from){sql+=' AND work_date >= ?';args.push(from)}if(to){sql+=' AND work_date <= ?';args.push(to)}
 if(project){sql+=' AND project = ?';args.push(project)}if(category){sql+=' AND category = ?';args.push(category)}
 if(q){sql+=' AND (note LIKE ? OR title LIKE ? OR description LIKE ? OR worklog LIKE ?)';args.push(...Array(4).fill(`%${q}%`))}
 return db.prepare(sql+' ORDER BY created_at DESC').all(...args);
}

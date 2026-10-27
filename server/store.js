import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.WORKLOG_DATA_DIR || path.join(root, '../data'));
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'worklog.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS tasks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
 worklog TEXT NOT NULL, project TEXT DEFAULT '', application TEXT DEFAULT '', environment TEXT DEFAULT '',
 category TEXT DEFAULT 'Other', status TEXT DEFAULT 'Completed', duration_minutes INTEGER NOT NULL DEFAULT 0,
 duration_source TEXT DEFAULT 'estimate', created_at TEXT NOT NULL, work_date TEXT NOT NULL
)`);
export const columns = ['id','note','title','description','worklog','project','application','environment','category','status','duration_minutes','duration_source','created_at','work_date'];
export function listTasks({from,to,project,category,q}={}) {
 let sql='SELECT * FROM tasks WHERE 1=1'; const args=[];
 if(from){sql+=' AND work_date >= ?';args.push(from)} if(to){sql+=' AND work_date <= ?';args.push(to)}
 if(project){sql+=' AND project = ?';args.push(project)} if(category){sql+=' AND category = ?';args.push(category)}
 if(q){sql+=' AND (note LIKE ? OR title LIKE ? OR description LIKE ? OR worklog LIKE ?)';args.push(...Array(4).fill(`%${q}%`))}
 return db.prepare(sql+' ORDER BY created_at DESC').all(...args);
}

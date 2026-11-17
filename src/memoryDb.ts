import * as SQLite from 'expo-sqlite';
import { cleanMemoryText, isSensitiveMemoryText, memoryKey,
  type MemoryKind, type MemoryRecord, type MemorySource } from './memoryPolicy';
import type { MemoryNote } from './featureState';

type Row={id:string;kind:string;source:string;text:string;created_at:number;updated_at:number};
let database:Promise<SQLite.SQLiteDatabase>|null=null;
async function connection():Promise<SQLite.SQLiteDatabase>{
  if(!database){
    database=(async()=>{
      const db=await SQLite.openDatabaseAsync('lumavun_memory_v1.db');
      await db.execAsync(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY NOT NULL,
          key TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK(kind IN ('style','fact')),
          source TEXT NOT NULL CHECK(source IN ('explicit','observed')),
          text TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_kind_updated ON memories(kind,updated_at DESC);`);
      return db;
    })().catch(e=>{database=null;throw e});
  }
  return database;
}
function fromRow(row:Row):MemoryRecord{
  return {id:row.id,text:row.text,kind:row.kind==='style'?'style':'fact',
    source:row.source==='observed'?'observed':'explicit',
    createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function listMemories():Promise<MemoryRecord[]>{
  const db=await connection();
  const rows=await db.getAllAsync<Row>('SELECT id,kind,source,text,created_at,updated_at FROM memories ORDER BY updated_at DESC LIMIT 200');
  return rows.map(fromRow);
}
export async function saveMemory(text:string,kind:MemoryKind='fact',source:MemorySource='explicit'):Promise<void>{
  const normalized=cleanMemoryText(text);
  if(normalized.length<3)throw new Error('Catatan terlalu singkat.');
  if(isSensitiveMemoryText(normalized))throw new Error('Catatan berisi informasi sensitif. Memori otomatis tidak menyimpannya.');
  const db=await connection();
  const now=Date.now();
  // A new record is inserted only if the normalized text is not already present.
  await db.runAsync('INSERT OR IGNORE INTO memories (id,key,kind,source,text,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    'mem_'+now+'_'+Math.random().toString(36).slice(2,10),memoryKey(normalized),kind,source,normalized,now,now);
  await db.runAsync('UPDATE memories SET updated_at=? WHERE key=?',now,memoryKey(normalized));
  // Deterministic max retention; prefer keeping recent entries.
  await db.execAsync('DELETE FROM memories WHERE id NOT IN (SELECT id FROM memories ORDER BY updated_at DESC LIMIT 200)');
}
export async function deleteMemory(id:string):Promise<void>{
  const db=await connection();
  await db.runAsync('DELETE FROM memories WHERE id=?',id);
}
export async function clearMemories():Promise<void>{
  const db=await connection();
  await db.runAsync('DELETE FROM memories');
}
export async function migrateLegacyMemories(notes:MemoryNote[]):Promise<MemoryRecord[]>{
  await connection();
  for(const note of notes.slice(0,200)){
    if(typeof note.text!=='string'||isSensitiveMemoryText(note.text))continue;
    await saveMemory(note.text,'fact','explicit');
  }
  return listMemories();
}

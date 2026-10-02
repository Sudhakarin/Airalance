// lib/db.ts
// SQLite database for offline-first messaging (WhatsApp-style)

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'airalance.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(`PRAGMA journal_mode = WAL;`);
    await db.execAsync(`PRAGMA foreign_keys = ON;`);
    await createTables(db);
    await runMigrations(db);
    dbInstance = db;
    return db;
  })();

  return initPromise;
}

async function createTables(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      is_group INTEGER DEFAULT 0,
      name TEXT,
      other_user_id TEXT,
      other_username TEXT,
      other_display_name TEXT,
      other_avatar_color TEXT,
      other_avatar_url TEXT,
      other_verified INTEGER DEFAULT 0,
      last_message TEXT,
      last_at TEXT,
      unread_count INTEGER DEFAULT 0,
      is_muted INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT,
      message_type TEXT DEFAULT 'text',
      media_url TEXT,
      media_duration INTEGER,
      reply_to_id TEXT,
      is_deleted INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      reaction TEXT,
      read_at TEXT,
      delivered_at TEXT,
      created_at TEXT NOT NULL,
      local_status TEXT DEFAULT 'synced',
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_convo
      ON messages(conversation_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_local_status
      ON messages(local_status);

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// ✅ Safe migrations for existing installs
async function runMigrations(db: SQLite.SQLiteDatabase) {
  try {
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(messages)`
    );
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('media_duration')) {
      await db.execAsync(
        `ALTER TABLE messages ADD COLUMN media_duration INTEGER`
      );
    }
  } catch (err) {
    console.warn('[db] migration failed:', err);
  }
}

export type DBConversation = {
  id: string;
  is_group: number;
  name: string | null;
  other_user_id: string | null;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar_color: string | null;
  other_avatar_url: string | null;
  other_verified: number;
  last_message: string | null;
  last_at: string | null;
  unread_count: number;
  is_muted: number;
  is_locked: number;
  updated_at: string | null;
};

export type DBMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  message_type: string;
  media_url: string | null;
  media_duration: number | null;
  reply_to_id: string | null;
  is_deleted: number;
  is_edited: number;
  is_pinned: number;
  reaction: string | null;
  read_at: string | null;
  delivered_at: string | null;
  created_at: string;
  local_status: string;
  synced_at: string | null;
};

// ============================================================
// Conversations
// ============================================================
export async function dbGetConversations(): Promise<DBConversation[]> {
  const db = await getDB();
  return await db.getAllAsync<DBConversation>(
    `SELECT * FROM conversations ORDER BY last_at DESC`
  );
}

export async function dbUpsertConversation(
  c: Partial<DBConversation> & { id: string }
) {
  const db = await getDB();
  const existing = await db.getFirstAsync<DBConversation>(
    `SELECT * FROM conversations WHERE id = ?`,
    [c.id]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE conversations SET
        is_group = COALESCE(?, is_group),
        name = COALESCE(?, name),
        other_user_id = COALESCE(?, other_user_id),
        other_username = COALESCE(?, other_username),
        other_display_name = COALESCE(?, other_display_name),
        other_avatar_color = COALESCE(?, other_avatar_color),
        other_avatar_url = COALESCE(?, other_avatar_url),
        other_verified = COALESCE(?, other_verified),
        last_message = COALESCE(?, last_message),
        last_at = COALESCE(?, last_at),
        unread_count = COALESCE(?, unread_count),
        is_muted = COALESCE(?, is_muted),
        is_locked = COALESCE(?, is_locked),
        updated_at = ?
       WHERE id = ?`,
      [
        c.is_group ?? null,
        c.name ?? null,
        c.other_user_id ?? null,
        c.other_username ?? null,
        c.other_display_name ?? null,
        c.other_avatar_color ?? null,
        c.other_avatar_url ?? null,
        c.other_verified ?? null,
        c.last_message ?? null,
        c.last_at ?? null,
        c.unread_count ?? null,
        c.is_muted ?? null,
        c.is_locked ?? null,
        new Date().toISOString(),
        c.id,
      ]
    );
  } else {
    await db.runAsync(
      `INSERT INTO conversations (
        id, is_group, name, other_user_id, other_username,
        other_display_name, other_avatar_color, other_avatar_url,
        other_verified, last_message, last_at, unread_count,
        is_muted, is_locked, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        c.id,
        c.is_group ?? 0,
        c.name ?? null,
        c.other_user_id ?? null,
        c.other_username ?? null,
        c.other_display_name ?? null,
        c.other_avatar_color ?? null,
        c.other_avatar_url ?? null,
        c.other_verified ?? 0,
        c.last_message ?? null,
        c.last_at ?? null,
        c.unread_count ?? 0,
        c.is_muted ?? 0,
        c.is_locked ?? 0,
        new Date().toISOString(),
      ]
    );
  }
}

export async function dbDeleteConversation(id: string) {
  const db = await getDB();
  await db.runAsync(`DELETE FROM conversations WHERE id = ?`, [id]);
  await db.runAsync(`DELETE FROM messages WHERE conversation_id = ?`, [id]);
}

export async function dbClearAllConversations() {
  const db = await getDB();
  await db.runAsync(`DELETE FROM conversations`);
}

// ============================================================
// Messages
// ============================================================
export async function dbGetMessages(
  conversationId: string,
  limit = 50,
  before?: string
): Promise<DBMessage[]> {
  const db = await getDB();
  if (before) {
    return await db.getAllAsync<DBMessage>(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND created_at < ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [conversationId, before, limit]
    );
  }
  return await db.getAllAsync<DBMessage>(
    `SELECT * FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [conversationId, limit]
  );
}

export async function dbUpsertMessage(
  m: Partial<DBMessage> & {
    id: string;
    conversation_id: string;
    sender_id: string;
    created_at: string;
  }
) {
  const db = await getDB();
  const existing = await db.getFirstAsync<DBMessage>(
    `SELECT * FROM messages WHERE id = ?`,
    [m.id]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE messages SET
        content = COALESCE(?, content),
        message_type = COALESCE(?, message_type),
        media_url = COALESCE(?, media_url),
        media_duration = COALESCE(?, media_duration),
        reply_to_id = COALESCE(?, reply_to_id),
        is_deleted = COALESCE(?, is_deleted),
        is_edited = COALESCE(?, is_edited),
        is_pinned = COALESCE(?, is_pinned),
        reaction = COALESCE(?, reaction),
        read_at = COALESCE(?, read_at),
        delivered_at = COALESCE(?, delivered_at),
        local_status = COALESCE(?, local_status),
        synced_at = ?
       WHERE id = ?`,
      [
        m.content ?? null,
        m.message_type ?? null,
        m.media_url ?? null,
        m.media_duration ?? null,
        m.reply_to_id ?? null,
        m.is_deleted ?? null,
        m.is_edited ?? null,
        m.is_pinned ?? null,
        m.reaction ?? null,
        m.read_at ?? null,
        m.delivered_at ?? null,
        m.local_status ?? null,
        new Date().toISOString(),
        m.id,
      ]
    );
  } else {
    await db.runAsync(
      `INSERT INTO messages (
        id, conversation_id, sender_id, content, message_type,
        media_url, media_duration, reply_to_id, is_deleted, is_edited,
        is_pinned, reaction, read_at, delivered_at, created_at,
        local_status, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.id,
        m.conversation_id,
        m.sender_id,
        m.content ?? null,
        m.message_type ?? 'text',
        m.media_url ?? null,
        m.media_duration ?? null,
        m.reply_to_id ?? null,
        m.is_deleted ?? 0,
        m.is_edited ?? 0,
        m.is_pinned ?? 0,
        m.reaction ?? null,
        m.read_at ?? null,
        m.delivered_at ?? null,
        m.created_at,
        m.local_status ?? 'synced',
        new Date().toISOString(),
      ]
    );
  }
}

export async function dbDeleteMessage(id: string) {
  const db = await getDB();
  await db.runAsync(`DELETE FROM messages WHERE id = ?`, [id]);
}

// ============================================================
// Offline queue
// ============================================================
export async function dbGetPendingMessages(): Promise<DBMessage[]> {
  const db = await getDB();
  return await db.getAllAsync<DBMessage>(
    `SELECT * FROM messages WHERE local_status = 'pending' ORDER BY created_at ASC`
  );
}

export async function dbMarkMessageSent(id: string, serverId?: string) {
  const db = await getDB();
  if (serverId && serverId !== id) {
    await db.runAsync(`DELETE FROM messages WHERE id = ?`, [id]);
  }
  await db.runAsync(
    `UPDATE messages SET local_status = 'synced', synced_at = ? WHERE id = ?`,
    [new Date().toISOString(), serverId ?? id]
  );
}

export async function dbMarkMessageFailed(id: string) {
  const db = await getDB();
  await db.runAsync(
    `UPDATE messages SET local_status = 'failed' WHERE id = ?`,
    [id]
  );
}

// ============================================================
// Sync meta
// ============================================================
export async function dbSetMeta(key: string, value: string) {
  const db = await getDB();
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`,
    [key, value]
  );
}

export async function dbGetMeta(key: string): Promise<string | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_meta WHERE key = ?`,
    [key]
  );
  return row?.value ?? null;
}

export async function dbWipeAll() {
  const db = await getDB();
  await db.execAsync(`
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM sync_meta;
  `);
}

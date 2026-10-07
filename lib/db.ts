// lib/db.ts
// SQLite database for offline-first messaging (WhatsApp-style)
// ✅ FIX 1: getDB() resets initPromise on failure (retry next call)
// ✅ FIX 2: normalizeIso() — timestamps consistent everywhere (Z format)
// ✅ FIX 3: dbMarkMessageSent() — no message loss (safe rename)

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'airalance.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// ============================================================
// ✅ FIX 2: Timestamp normalization
// Supabase: '2026-10-07T19:06:35.831+00:00'
// JS:       '2026-10-07T19:06:35.831Z'
// Mixing breaks string sort → list reorders → "fresh feel"
// ============================================================
function normalizeIso(input: string | null | undefined): string | null {
  if (!input) return null;
  if (typeof input !== 'string') return null;
  // Already canonical ISO-Z
  if (input.endsWith('Z') && input.includes('T')) return input;
  try {
    const d = new Date(input);
    if (isNaN(d.getTime())) return input;
    return d.toISOString();
  } catch {
    return input;
  }
}

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
      `);
      await createTables(db);
      await runMigrations(db);
      dbInstance = db;
      return db;
    } catch (err) {
      // ✅ FIX 1: reset so next call retries (was stuck forever)
      initPromise = null;
      console.warn('[db] init failed, will retry on next call:', err);
      throw err;
    }
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

    CREATE INDEX IF NOT EXISTS idx_conversations_last_at
      ON conversations(last_at DESC);

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

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

export async function dbGetConversation(
  id: string
): Promise<DBConversation | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<DBConversation>(
    `SELECT * FROM conversations WHERE id = ?`,
    [id]
  );
  return row ?? null;
}

const UPSERT_CONVERSATION_SQL = `
  INSERT INTO conversations (
    id, is_group, name, other_user_id, other_username,
    other_display_name, other_avatar_color, other_avatar_url,
    other_verified, last_message, last_at, unread_count,
    is_muted, is_locked, updated_at
  ) VALUES (
    $id, COALESCE($is_group, 0), $name, $other_user_id, $other_username,
    $other_display_name, $other_avatar_color, $other_avatar_url,
    COALESCE($other_verified, 0), $last_message, $last_at,
    COALESCE($unread_count, 0), COALESCE($is_muted, 0),
    COALESCE($is_locked, 0), $now
  )
  ON CONFLICT(id) DO UPDATE SET
    is_group = COALESCE($is_group, is_group),
    name = COALESCE($name, name),
    other_user_id = COALESCE($other_user_id, other_user_id),
    other_username = COALESCE($other_username, other_username),
    other_display_name = COALESCE($other_display_name, other_display_name),
    other_avatar_color = COALESCE($other_avatar_color, other_avatar_color),
    other_avatar_url = COALESCE($other_avatar_url, other_avatar_url),
    other_verified = COALESCE($other_verified, other_verified),
    last_message = COALESCE($last_message, last_message),
    last_at = COALESCE($last_at, last_at),
    unread_count = COALESCE($unread_count, unread_count),
    is_muted = COALESCE($is_muted, is_muted),
    is_locked = COALESCE($is_locked, is_locked),
    updated_at = $now
`;

function conversationParams(
  c: Partial<DBConversation> & { id: string },
  now: string
) {
  return {
    $id: c.id,
    $is_group: c.is_group ?? null,
    $name: c.name ?? null,
    $other_user_id: c.other_user_id ?? null,
    $other_username: c.other_username ?? null,
    $other_display_name: c.other_display_name ?? null,
    $other_avatar_color: c.other_avatar_color ?? null,
    $other_avatar_url: c.other_avatar_url ?? null,
    $other_verified: c.other_verified ?? null,
    $last_message: c.last_message ?? null,
    // ✅ FIX 2: normalize on write
    $last_at: normalizeIso(c.last_at) ?? null,
    $unread_count: c.unread_count ?? null,
    $is_muted: c.is_muted ?? null,
    $is_locked: c.is_locked ?? null,
    $now: now,
  };
}

export async function dbUpsertConversation(
  c: Partial<DBConversation> & { id: string }
) {
  const db = await getDB();
  await db.runAsync(
    UPSERT_CONVERSATION_SQL,
    conversationParams(c, new Date().toISOString())
  );
}

export async function dbUpsertConversations(
  list: (Partial<DBConversation> & { id: string })[]
) {
  if (list.length === 0) return;
  const db = await getDB();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(UPSERT_CONVERSATION_SQL);
    try {
      for (const c of list) {
        await stmt.executeAsync(conversationParams(c, now));
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

export async function dbDeleteConversation(id: string) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM conversations WHERE id = ?`, [id]);
    await db.runAsync(`DELETE FROM messages WHERE conversation_id = ?`, [id]);
  });
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
      [conversationId, normalizeIso(before) ?? before, limit]
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

const UPSERT_MESSAGE_SQL = `
  INSERT INTO messages (
    id, conversation_id, sender_id, content, message_type,
    media_url, media_duration, reply_to_id, is_deleted, is_edited,
    is_pinned, reaction, read_at, delivered_at, created_at,
    local_status, synced_at
  ) VALUES (
    $id, $conversation_id, $sender_id, $content, COALESCE($message_type, 'text'),
    $media_url, $media_duration, $reply_to_id, COALESCE($is_deleted, 0),
    COALESCE($is_edited, 0), COALESCE($is_pinned, 0), $reaction, $read_at,
    $delivered_at, $created_at, COALESCE($local_status, 'synced'), $now
  )
  ON CONFLICT(id) DO UPDATE SET
    content = COALESCE($content, content),
    message_type = COALESCE($message_type, message_type),
    media_url = COALESCE($media_url, media_url),
    media_duration = COALESCE($media_duration, media_duration),
    reply_to_id = COALESCE($reply_to_id, reply_to_id),
    is_deleted = COALESCE($is_deleted, is_deleted),
    is_edited = COALESCE($is_edited, is_edited),
    is_pinned = COALESCE($is_pinned, is_pinned),
    reaction = COALESCE($reaction, reaction),
    read_at = COALESCE($read_at, read_at),
    delivered_at = COALESCE($delivered_at, delivered_at),
    local_status = COALESCE($local_status, local_status),
    synced_at = $ rownow
`;

type MessageUpsertInput = Partial<DBMessage> & {
  id: string;
  conversation_id: string;
  sender_id: string;
  created_at: string;
};

function messageParams(m: MessageUpsertInput, now: string) {
  return {
    $id: m.id,
    $conversation_id: m.conversation_id,
    $sender_id: m.sender_id,
    $content: m.content ?? null,
    $message_type: m.message_type ?? null,
    $media_url: m.media_url ?? null,
    $media_duration: m.media_duration ?? null,
    $reply_to_id: m.reply_to_id ?? null,
    $is_deleted: m.is_deleted ?? null,
    $is_edited: m.is_edited ?? null,
    $is_pinned: m.is_pinned ?? null,
    $reaction: m.reaction ?? null,
    // ✅ FIX 2: normalize on write
    $read_at: normalizeIso(m.read_at),
    $delivered_at: normalizeIso(m.delivered_at),
    $created_at: normalizeIso(m.created_at) ?? m.created_at,
    $local_status: m.local_status ?? null,
    $now: now,
  };
}

export async function dbUpsertMessage(m: MessageUpsertInput) {
  const db = await getDB();
  await db.runAsync(
    UPSERT_MESSAGE_SQL,
    messageParams(m, new Date().toISOString())
  );
}

export async function dbUpsertMessages(list: MessageUpsertInput[]) {
  if (list.length === 0) return;
  const db = await getDB();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(UPSERT_MESSAGE_SQL);
    try {
      for (const m of list) {
        await stmt.executeAsync(messageParams(m, now));
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
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
    `SELECT * FROM messages WHERE local_status IN ('pending', 'failed') ORDER BY created_at ASC`
  );
}

// ✅ FIX 3: Safe rename — was deleting temp before confirming server row existed
// Old flow: delete(temp) → update(server) → if server row missing → MESSAGE LOST
// New flow: check(server exists?) → rename OR delete
export async function dbMarkMessageSent(id: string, serverId?: string) {
  const db = await getDB();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    if (serverId && serverId !== id) {
      const existing = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM messages WHERE id = ?`,
        [serverId]
      );
      if (existing) {
        // Server row already saved (realtime beat us) → just drop the temp
        await db.runAsync(`DELETE FROM messages WHERE id = ?`, [id]);
      } else {
        // Rename temp → server id and mark synced
        await db.runAsync(
          `UPDATE messages SET id = ?, local_status = 'synced', synced_at = ? WHERE id = ?`,
          [serverId, now, id]
        );
      }
    } else {
      await db.runAsync(
        `UPDATE messages SET local_status = 'synced', synced_at = ? WHERE id = ?`,
        [now, id]
      );
    }
  });
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

// lib/chatListCache.ts
// In-memory copy of the chat list so the Chats tab paints INSTANTLY
// (no skeleton / no "loading" flash), like WhatsApp / Instagram.
//
//  - preloadChatList() runs at app start (right after SQLite is ready)
//  - ChatsScreen reads getMemRows() synchronously for its very first frame
//  - ChatsScreen keeps it fresh via setMemRows() on every change

import { dbGetConversations, dbGetMessages } from './db';

let memRows: any[] | null = null;

export function getMemRows(): any[] | null {
  return memRows;
}

export function setMemRows(rows: any[]) {
  memRows = rows;
}

// ---- who am I (so screens don't wait for an async lookup) ----
let memUserId: string | null = null;
export function getMemUserId(): string | null {
  return memUserId;
}
export function setMemUserId(id: string | null) {
  memUserId = id;
}

// ---- messages per chat (opening a chat paints instantly) ----
const MAX_CHATS_IN_MEMORY = 30;
const memMsgs = new Map<string, any[]>(); // converted Message[] (kept fresh by the chat screen)
const memMsgRows = new Map<string, any[]>(); // raw SQLite rows (newest first), preloaded

export function getMemMsgs(convoId: string): any[] | null {
  return memMsgs.get(convoId) ?? null;
}
export function setMemMsgs(convoId: string, msgs: any[]) {
  memMsgs.delete(convoId);
  memMsgs.set(convoId, msgs);
  if (memMsgs.size > MAX_CHATS_IN_MEMORY) {
    const oldest = memMsgs.keys().next().value;
    if (oldest) memMsgs.delete(oldest);
  }
}
export function getMemMsgRows(convoId: string): any[] | null {
  return memMsgRows.get(convoId) ?? null;
}

export async function preloadChatList(): Promise<void> {
  try {
    const rows = await dbGetConversations();
    // never overwrite fresher data written by the screen
    if (!memRows) memRows = rows;

    // Messages of the 8 most recent chats → memory (tapping a chat is instant)
    const recent = [...rows]
      .sort((a: any, b: any) =>
        String(b.last_at ?? '').localeCompare(String(a.last_at ?? ''))
      )
      .slice(0, 8);
    for (const r of recent) {
      try {
        const m = await dbGetMessages((r as any).id, 50);
        if (m.length > 0) memMsgRows.set((r as any).id, m);
      } catch {}
    }
  } catch (err) {
    console.warn('[chatlist] preload failed:', err);
  }
}

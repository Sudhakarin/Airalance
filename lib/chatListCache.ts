// lib/chatListCache.ts
// In-memory copy of the chat list so the Chats tab paints INSTANTLY
// (no skeleton / no "loading" flash), like WhatsApp / Instagram.
//
//  - preloadChatList() runs at app start (right after SQLite is ready)
//  - ChatsScreen reads getMemRows() synchronously for its very first frame
//  - ChatsScreen keeps it fresh via setMemRows() on every change

import { dbGetConversations } from './db';

let memRows: any[] | null = null;

export function getMemRows(): any[] | null {
  return memRows;
}

export function setMemRows(rows: any[]) {
  memRows = rows;
}

export async function preloadChatList(): Promise<void> {
  try {
    const rows = await dbGetConversations();
    // never overwrite fresher data written by the screen
    if (!memRows) memRows = rows;
  } catch (err) {
    console.warn('[chatlist] preload failed:', err);
  }
}

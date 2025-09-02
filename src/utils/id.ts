// src/utils/id.ts
// 唯一 ID 的集中工廠。正式環境走 nanoid；測試可以 setIdGenerator() 注入假實作。
// 請勿在其他檔案直接引用 `nanoid`，一律用這裡的 `newId()` 以利測試與未來替換。

import { nanoid as _nanoid } from 'nanoid';

/** 預設 nanoid 長度（與 nanoid 預設一致） */
export const DEFAULT_ID_SIZE = 21;

/** 產生 ID 的函式型別（方便測試注入） */
export type IdGenerator = () => string;

/** 目前使用中的 ID 產生器（預設使用 nanoid） */
let currentGenerator: IdGenerator = () => _nanoid();

/**
 * 取得一個新的隨機 ID。
 * 在正式環境會使用 nanoid；在測試中可透過 setIdGenerator() 改成固定序列以便斷言。
 */
export function newId(): string {
  return currentGenerator();
}

/**
 * 設定自訂的 ID 產生器（常用於測試）。
 * 會回傳一個「還原函式」，呼叫後可恢復到設定前的 generator。
 *
 * @example
 * const restore = setIdGenerator(() => 'fixed-id');
 * expect(newId()).toBe('fixed-id');
 * restore(); // 還原
 */
export function setIdGenerator(gen: IdGenerator): () => void {
  const prev = currentGenerator;
  currentGenerator = gen;
  return () => {
    currentGenerator = prev;
  };
}

/**
 * 將 ID 產生器重設為預設的 nanoid。
 * 等效於呼叫 setIdGenerator(...) 回傳的還原函式。
 */
export function resetIdGenerator(): void {
  currentGenerator = () => _nanoid();
}

/**
 * 建立一個簡單的「遞增序列」ID 產生器（常用於測試需要可預期的 ID）。
 * 例如：makeSequence('t') 依序回傳 t-1, t-2, t-3, ...
 *
 * @param prefix  ID 前綴字串
 * @param start   起始序號（預設 1）
 */
export function makeSequence(prefix = 'id', start = 1): IdGenerator {
  let i = start;
  return () => `${prefix}-${i++}`;
}

/**
 * 建立一個包上固定前綴、但內容仍為隨機 nanoid 的產生器。
 * 例如：makePrefixed('m') 可能回傳 m-<nanoid()>
 *
 * @param prefix 前綴
 */
export function makePrefixed(prefix: string): IdGenerator {
  return () => `${prefix}-${_nanoid()}`;
}

// src/services/dedup-buffer.ts
//
// 固定容量的去重緩衝（LRU/FIFO 混合：以最舊先淘汰即可滿足「去重防重送」需求）。
// API 與 README 對齊：add / size / clear。預設容量 500。
// 複雜度：add O(1)，size O(1)，clear O(1)。

export interface DedupBuffer {
  /**
   * 嘗試加入一個 actionId。
   * @returns true 表示為新 id（成功加入）；false 表示已存在（應丟棄）。
   */
  add(id: string): boolean;

  /** 當前緩衝中的 id 數量（<= capacity）。 */
  size(): number;

  /** 清空緩衝。 */
  clear(): void;
}

/**
 * 建立固定容量的去重緩衝。
 * - 當緩衝已滿時，加入新 id 會淘汰最舊的 id。
 * - 使用 Set 進行 O(1) 存在性查詢，搭配環形緩衝儲存淘汰順序。
 */
export function createDedupBuffer(capacity: number = 500): DedupBuffer {
  if (!Number.isFinite(capacity) || capacity < 1) {
    throw new Error('DedupBuffer capacity must be a finite number >= 1');
  }

  // 內部狀態
  const cap = Math.floor(capacity);
  // 環形緩衝（可能包含未填滿時的 undefined）
  let ring: Array<string | undefined> = new Array<string | undefined>(cap);
  // 指向「最舊元素」的位置（下一次淘汰將從這裡發生）
  let head = 0;
  // 實際已放入的元素數（<= cap）
  let count = 0;
  // 用於 O(1) 判斷是否已存在
  const seen = new Set<string>();

  function add(id: string): boolean {
    if (seen.has(id)) return false;

    if (count < cap) {
      // 仍未達容量，寫入 head+count 位置
      const idx = (head + count) % cap;
      ring[idx] = id;
      count += 1;
      seen.add(id);
      return true;
    }

    // 已滿：淘汰最舊（head），覆寫並前進 head
    const evict = ring[head];
    if (evict !== undefined) {
      seen.delete(evict);
    }
    ring[head] = id;
    head = (head + 1) % cap;
    seen.add(id);
    return true;
  }

  function size(): number {
    return count;
  }

  function clear(): void {
    ring = new Array<string | undefined>(cap);
    head = 0;
    count = 0;
    seen.clear();
  }

  return { add, size, clear };
}

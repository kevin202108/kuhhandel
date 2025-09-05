import { computed, readonly, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { MoneyCard } from '@/types/game';

/**
 * MoneyPad 本地選取（送出前不動真資產）。
 * - 僅管理「被選取的錢卡 id 陣列」與合計金額。
 * - 自動在底層 moneyCards 變動時，修剪已不再可用的選取 id。
 */

export interface UseMoneySelectionOptions {
  /**
   * 目前可用的錢卡清單（從 store 或 props 傳入）。
   * 傳入 Ref 以便在外部更新時能同步修剪選取內容。
   */
  moneyCards: Ref<readonly MoneyCard[]>;
  /**
   * 初始選取的錢卡 id 陣列（可選）。
   * exactOptionalPropertyTypes: true → 以 `!== undefined` 判斷。
   */
  initialSelectedIds?: readonly string[];
}

export interface UseMoneySelection {
  /** 目前選取中的錢卡 id 陣列（唯讀暴露，避免呼叫端直接變異） */
  selectedIds: Readonly<Ref<readonly string[]>>;
  /** 目前選取合計金額（0 面額計入 0） */
  total: ComputedRef<number>;
  /** 查詢指定 id 是否在選取中 */
  isSelected(id: string): boolean;
  /** 切換指定 id 的選取狀態（若不存在於可用清單，將被忽略） */
  toggle(id: string): void;
  /** 清空選取 */
  clear(): void;
  /** 以一組 id 覆蓋選取（僅保留仍存在於可用清單中的部分） */
  set(ids: readonly string[]): void;
}

export function useMoneySelection(opts: UseMoneySelectionOptions): UseMoneySelection {
  const { moneyCards } = opts;

  const _selected = ref<string[]>([]);
  if (opts.initialSelectedIds !== undefined) {
    // 僅在初始時根據可用清單做一次過濾
    const allowed = new Set(moneyCards.value.map((c) => c.id));
    _selected.value = opts.initialSelectedIds.filter((id) => allowed.has(id)).slice();
  }

  // 依 moneyCards 變動，修剪已不再存在的選取
  watch(
    moneyCards,
    (cards) => {
      const allowed = new Set(cards.map((c) => c.id));
      _selected.value = _selected.value.filter((id) => allowed.has(id));
    },
    { flush: 'sync' }
  );

  // 建立 id → value 對照，供 total 計算
  const valueMap = computed<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const c of moneyCards.value) map.set(c.id, c.value);
    return map;
  });

  const total = computed<number>(() => {
    let sum = 0;
    for (const id of _selected.value) {
      sum += valueMap.value.get(id) ?? 0;
    }
    return sum;
  });

  function isSelected(id: string): boolean {
    return _selected.value.includes(id);
  }

  function toggle(id: string): void {
    // 僅能選取目前可用的錢卡
    if (!valueMap.value.has(id)) return;

    if (isSelected(id)) {
      _selected.value = _selected.value.filter((x) => x !== id);
    } else {
      _selected.value = [..._selected.value, id];
    }
  }

  function clear(): void {
    _selected.value = [];
  }

  function set(ids: readonly string[]): void {
    const allowed = new Set(moneyCards.value.map((c) => c.id));
    _selected.value = ids.filter((id) => allowed.has(id)).slice();
  }

  return {
    selectedIds: readonly(_selected),
    total,
    isSelected,
    toggle,
    clear,
    set
  };
}

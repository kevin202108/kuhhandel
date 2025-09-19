import { useGameStore } from '@/store/game'
import { useCowStore } from '@/store/cow'
import broadcast from '@/services/broadcast'
import { Msg } from '@/networking/protocol'
import { newId } from '@/utils/id'
import type { Animal } from '@/types/game'

export function useCowTrade() {
  const game = useGameStore()
  const cow = useCowStore()

  // 從 URL 獲取當前玩家 ID
  const url = new URL(location.href)
  const myId = url.searchParams.get('player')?.toLowerCase().trim() || ''

  function selectTarget(targetId: string) {
    void broadcast.publish(Msg.Action.SelectCowTarget, {
      playerId: myId,
      targetId
    }, { actionId: newId() })
  }

  function selectAnimal(animal: Animal) {
    void broadcast.publish(Msg.Action.SelectCowAnimal, {
      playerId: myId,
      animal
    }, { actionId: newId() })
  }

  function commitTrade(moneyCardIds: string[]) {
    void broadcast.publish(Msg.Action.CommitCowTrade, {
      playerId: myId,
      moneyCardIds
    }, { actionId: newId() })
  }

  function cancelTrade() {
    void broadcast.publish(Msg.Action.CancelBuyback, {  // 使用現有的取消訊息
      playerId: myId
    })
  }

  return {
    selectTarget,
    selectAnimal,
    commitTrade,
    cancelTrade,
    myId
  }
}

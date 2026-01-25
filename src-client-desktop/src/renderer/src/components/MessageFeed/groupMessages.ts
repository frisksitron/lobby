import type { Message } from "../../../../shared/types"

export interface MessageWithGrouping {
  message: Message
  isFirstInGroup: boolean
  isLastInGroup: boolean
}

const GROUP_TIME_THRESHOLD_MS = 60 * 1000 // 1 minute

/**
 * Computes grouping metadata for messages.
 * Messages are grouped if they:
 * - Have the same author
 * - Are sent within 1 minute of the previous message in the group (chained)
 */
export function computeMessageGrouping(messages: Message[]): MessageWithGrouping[] {
  if (messages.length === 0) return []

  const result: MessageWithGrouping[] = []

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i]
    const prev = messages[i - 1]
    const next = messages[i + 1]

    const sameAuthorAsPrev = prev && prev.authorId === current.authorId

    const withinTimeOfPrev =
      prev &&
      new Date(current.timestamp).getTime() - new Date(prev.timestamp).getTime() <=
        GROUP_TIME_THRESHOLD_MS

    const continuesFromPrev = sameAuthorAsPrev && withinTimeOfPrev

    const sameAuthorAsNext = next && next.authorId === current.authorId

    const withinTimeOfNext =
      next &&
      new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime() <=
        GROUP_TIME_THRESHOLD_MS

    const continuesIntoNext = sameAuthorAsNext && withinTimeOfNext

    result.push({
      message: current,
      isFirstInGroup: !continuesFromPrev,
      isLastInGroup: !continuesIntoNext
    })
  }

  return result
}

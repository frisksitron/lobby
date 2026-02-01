import { createStore, produce, reconcile } from "solid-js/store"
import type { User } from "../../../shared/types"

const [users, setUsers] = createStore<Record<string, User>>({})

export function addUser(user: User): void {
  setUsers(user.id, user)
}

export function addUsers(usersToAdd: User[]): void {
  if (usersToAdd.length === 0) return
  setUsers(
    produce((state) => {
      for (const user of usersToAdd) {
        state[user.id] = user
      }
    })
  )
}

export function updateUser(userId: string, updates: Partial<User>): void {
  if (!users[userId]) return
  setUsers(
    userId,
    produce((user) => {
      Object.assign(user, updates)
    })
  )
}

export function removeUser(userId: string): void {
  setUsers(
    produce((state) => {
      delete state[userId]
    })
  )
}

export function clearUsers(): void {
  setUsers(reconcile({}))
}

export function getUserById(id: string): User | undefined {
  return users[id]
}

export function getAllUsers(): User[] {
  return Object.values(users)
}

export { users }

let getCurrentUserId: () => string | null = () => null

export function initUsers(currentUserIdGetter: () => string | null): void {
  getCurrentUserId = currentUserIdGetter
}

export function getActiveStreamers(): User[] {
  const userId = getCurrentUserId()
  return Object.values(users).filter((u) => u.isStreaming && u.id !== userId)
}

export function useUsers() {
  return {
    users: () => users,
    getUserById,
    getAllUsers,
    getActiveStreamers
  }
}

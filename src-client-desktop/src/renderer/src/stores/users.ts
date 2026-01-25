/**
 * Unified User Cache Store
 *
 * Single source of truth for user data, replacing:
 * - auth.users Map
 * - session.members Map (for user info)
 */

import { createSignal } from "solid-js"
import type { User } from "../../../shared/types"

// Users cache by ID
const [users, setUsers] = createSignal<Map<string, User>>(new Map())

/**
 * Get a user by their ID
 */
export function getUserById(userId: string): User | undefined {
  return users().get(userId)
}

/**
 * Add or update a single user in the cache
 */
export function addUser(user: User): void {
  setUsers((prev) => {
    const next = new Map(prev)
    next.set(user.id, user)
    return next
  })
}

/**
 * Add or update multiple users at once
 */
export function addUsers(usersToAdd: User[]): void {
  if (usersToAdd.length === 0) return

  setUsers((prev) => {
    const next = new Map(prev)
    for (const user of usersToAdd) next.set(user.id, user)
    return next
  })
}

/**
 * Update specific fields of a user
 */
export function updateUser(userId: string, updates: Partial<User>): void {
  setUsers((prev) => {
    const existing = prev.get(userId)
    if (!existing) return prev

    const next = new Map(prev)
    next.set(userId, { ...existing, ...updates })
    return next
  })
}

/**
 * Remove a user from the cache
 */
export function removeUser(userId: string): void {
  setUsers((prev) => {
    if (!prev.has(userId)) return prev
    const next = new Map(prev)
    next.delete(userId)
    return next
  })
}

/**
 * Clear all users from the cache
 */
export function clearUsers(): void {
  setUsers(new Map())
}

/**
 * Get all users as an array
 */
export function getAllUsers(): User[] {
  return Array.from(users().values())
}

/**
 * Get the users signal for reactive access
 */
export function useUsers() {
  return {
    users,
    getUserById,
    addUser,
    addUsers,
    updateUser,
    removeUser,
    clearUsers,
    getAllUsers
  }
}

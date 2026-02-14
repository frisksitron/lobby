import type { User } from "../../../../shared/types"
import { apiRequestMultipartCurrentServer } from "./client"
import type { ChatUploadResponse, ServerInfo } from "./types"

function createUploadForm(file: File): FormData {
  const form = new FormData()
  form.append("file", file)
  return form
}

export async function uploadChatAttachment(file: File): Promise<ChatUploadResponse> {
  return apiRequestMultipartCurrentServer<ChatUploadResponse>(
    "/api/v1/uploads/chat",
    createUploadForm(file),
    "POST"
  )
}

export async function uploadAvatar(file: File): Promise<User> {
  return apiRequestMultipartCurrentServer<User>(
    "/api/v1/users/me/avatar",
    createUploadForm(file),
    "POST"
  )
}

export async function uploadServerImage(file: File): Promise<ServerInfo> {
  return apiRequestMultipartCurrentServer<ServerInfo>(
    "/api/v1/server/image",
    createUploadForm(file),
    "POST"
  )
}

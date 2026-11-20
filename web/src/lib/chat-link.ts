// t.me link for a chat: only a group with a public @username has one that opens for everyone (#116).
export const chatLink = (username: string | null) =>
  username ? `https://t.me/${username}` : null

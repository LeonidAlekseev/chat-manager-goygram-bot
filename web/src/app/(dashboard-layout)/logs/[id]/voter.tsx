type VoterRow = {
  userId: bigint
  name?: string | null // the joined name of rows from before firstName
  firstName?: string | null
  lastName?: string | null
  username?: string | null
}

// A poll answer or chat member: name, copyable Telegram ID, @username linked to t.me.
export function Voter({ v }: { v: VoterRow }) {
  const name =
    [v.firstName, v.lastName].filter(Boolean).join(" ") || v.name || null
  return (
    <>
      {name && <b>{name}</b>}{" "}
      <span className="font-mono text-xs text-muted-foreground select-all">
        ID {String(v.userId)}
      </span>
      {v.username && (
        <>
          {" "}
          <a
            href={`https://t.me/${v.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            @{v.username}
          </a>
        </>
      )}
    </>
  )
}

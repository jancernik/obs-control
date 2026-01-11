import process from "node:process"
import { createObsClient } from "./obs.js"
import { startIpcServer } from "./ipc.js"
import "dotenv/config"

const socketPath = `${process.env.XDG_RUNTIME_DIR}/obs-control.sock`

const obsClient = createObsClient({
  url: process.env.URL,
  password: process.env.PASSWORD
})

async function handleCommand(line) {
  const trimmed = line.trim()
  if (!trimmed) return null

  const [cmd, ...args] = trimmed.split(/\s+/)

  switch (cmd) {
    case "set-filter": {
      const filterName = args.join(" ")
      if (!filterName) throw new Error("missing filterName")
      return await obsClient.setMoveFilter(filterName)
    }

    case "move-relative": {
      const direction = args.join(" ")
      if (!direction) throw new Error("missing direction")
      return await obsClient.moveRelative(direction)
    }

    default:
      throw new Error(`unknown cmd: ${cmd}`)
  }
}

await obsClient.connect()

const ipc = startIpcServer({
  socketPath,
  onLine: handleCommand
})

function shutdown() {
  ipc.close().finally(() => process.exit(0))
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

import net from "node:net"
import fs from "node:fs"

export function startIpcServer({ socketPath, onLine }) {
  try {
    fs.unlinkSync(socketPath)
  } catch {}

  const server = net.createServer((connection) => {
    connection.setEncoding("utf8")

    let buffer = ""

    connection.on("data", async (chunk) => {
      buffer += chunk

      let idx
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)

        try {
          const result = await onLine(line)
          connection.write(JSON.stringify({ ok: true, result }) + "\n")
        } catch (error) {
          connection.write(
            JSON.stringify({ ok: false, error: String(error?.message ?? error) }) + "\n"
          )
        }
      }
    })

    connection.on("error", () => {})
  })

  server.listen(socketPath, () => {
    console.log("IPC listening on", socketPath)
  })

  return {
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

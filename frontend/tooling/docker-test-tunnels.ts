// Test-only TCP tunnels inside the kiosk container. The browser sees the same
// localhost origins as a Windows user, including Host/Origin for Django CSRF.
// These forward HTTP AND HMR WebSockets, and never bind outside the container.
import { connect, createServer } from 'node:net'

const servers = ([['backend', 8000], ['hub', 5174], ['advisor', 5175], ['admin', 5176]] as const).map(([host, port]) => {
  const server = createServer((client) => {
    const upstream = connect(port, host)
    client.pipe(upstream).pipe(client)
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.on('close', () => upstream.destroy())
  })
  server.listen(port, '127.0.0.1')
  return server
})
process.on('SIGTERM', () => { servers.forEach(server => server.close()); process.exit(0) })

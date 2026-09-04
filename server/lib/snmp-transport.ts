import dgram from 'node:dgram'

type SocketFactory = (type: 'udp4' | 'udp6') => dgram.Socket
let socketFactory: SocketFactory = (type) => dgram.createSocket(type)

export function setSnmpSocketFactoryForTests(factory: SocketFactory | null) {
  socketFactory = factory ?? ((type) => dgram.createSocket(type))
}

export function createSnmpSocket(family: number) {
  return socketFactory(family === 6 ? 'udp6' : 'udp4')
}

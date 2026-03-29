declare module 'bitcoinjs-message' {
  export function sign(
    message: string,
    privateKey: Buffer,
    compressed?: boolean,
    messagePrefix?: string
  ): Buffer

  export function verify(
    message: string,
    address: string,
    signature: Buffer | string,
    messagePrefix?: string
  ): boolean

  export function magicHash(
    message: string,
    messagePrefix?: string
  ): Buffer
}

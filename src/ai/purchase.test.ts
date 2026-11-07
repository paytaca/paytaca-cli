import { describe, it, expect } from 'vitest'
import { selectExternalBchPayment } from './purchase.js'

const utxo = (txid: string, vout: number, value: number) => ({ txid, vout, value, address_path: '0/0/0' })

describe('selectExternalBchPayment', () => {
  it('returns the exact tagged amount even when other payments are present', () => {
    const found = selectExternalBchPayment(
      [utxo('aa', 0, 12_000), utxo('bb', 0, 10_042), utxo('cc', 1, 15_000)],
      new Set(),
      10_042
    )
    expect(found).toEqual({ txid: 'bb', vout: 0, value: 10_042 })
  })

  it('accepts a single new utxo above the amount', () => {
    const found = selectExternalBchPayment([utxo('aa', 0, 11_000)], new Set(), 10_042)
    expect(found).toEqual({ txid: 'aa', vout: 0, value: 11_000 })
  })

  it('refuses to attribute someone else\'s txid when several payments are in range', () => {
    const found = selectExternalBchPayment(
      [utxo('aa', 0, 10_500), utxo('bb', 0, 11_000)],
      new Set(),
      10_042
    )
    expect(found).toBeNull()
  })

  it('ignores utxos that predate the request and values below the amount', () => {
    const known = new Set(['aa:0'])
    const found = selectExternalBchPayment(
      [utxo('aa', 0, 10_042), utxo('bb', 0, 9_000), utxo('cc', 0, 10_042)],
      known,
      10_042
    )
    expect(found).toEqual({ txid: 'cc', vout: 0, value: 10_042 })
  })

  it('returns null when nothing in range has arrived yet', () => {
    const found = selectExternalBchPayment([utxo('aa', 0, 500)], new Set(), 10_042)
    expect(found).toBeNull()
  })
})

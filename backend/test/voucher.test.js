import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateVoucherDiscount } from '../src/services/voucherService.js'

test('voucher phần trăm tôn trọng mức giảm tối đa', () => {
  assert.equal(calculateVoucherDiscount({ discountType: 'percentage', value: 20, maxDiscount: 300_000 }, 2_000_000), 300_000)
})

test('voucher số tiền không thể làm tổng thanh toán nhỏ hơn 1.000 đồng', () => {
  assert.equal(calculateVoucherDiscount({ discountType: 'fixed', value: 2_000_000, maxDiscount: 0 }, 1_500_000), 1_499_000)
})

test('voucher phần trăm không giới hạn tính từ giá gốc backend', () => {
  assert.equal(calculateVoucherDiscount({ discountType: 'percentage', value: 10, maxDiscount: 0 }, 3_600_000), 360_000)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCartDiscount, cartTotal, processCart } from '../src/engine/discountEngine.js'
import { removeActiveRule } from '../src/engine/ruleManagement.js'

const items = [{ itemId: 'I-1', product: 'Product', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1000 }]
const rules = [
  { ruleId: 'CSV-BRAND', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 100, stackable: false, minCartValue: null },
  { ruleId: 'AI-1', scope: 'platform', appliesTo: 'Amazon India', type: 'percentage', value: 10, stackable: true, minCartValue: null },
  { ruleId: 'CART-1', scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 800 },
]

test('removes an AI rule while preserving CSV rules and recalculating the item price', () => {
  const remaining = removeActiveRule(rules, 'AI-1')
  assert.deepEqual(remaining.map((rule) => rule.ruleId), ['CSV-BRAND', 'CART-1'])
  assert.equal(processCart(items, remaining)[0].finalPrice, 900)
})

test('removing a cart rule removes its cart saving without changing item calculations', () => {
  const before = processCart(items, rules)
  const remaining = removeActiveRule(rules, 'CART-1')
  assert.equal(cartTotal(before), cartTotal(processCart(items, remaining)))
  assert.equal(applyCartDiscount(cartTotal(before), rules).finalTotal, 729)
  assert.equal(applyCartDiscount(cartTotal(before), remaining).finalTotal, 810)
})

test('removing the final rule leaves a valid no-offer cart result', () => {
  const noRules = removeActiveRule([rules[0]], 'CSV-BRAND')
  const result = processCart(items, noRules)[0]
  assert.deepEqual(noRules, [])
  assert.equal(result.finalPrice, 1000)
  assert.equal(result.reasoning, 'No offers available')
})

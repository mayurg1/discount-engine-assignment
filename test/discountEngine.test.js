import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseCartCSV, parseRulesCSV } from '../src/engine/csvParser.js'
import { applyCartDiscount, applyDiscounts, cartTotal, normalizeDiscountText, processCart, ruleMatchesItem } from '../src/engine/discountEngine.js'

const cartRule = (overrides = {}) => ({
  ruleId: 'CART-10', scope: 'cart', appliesTo: null, type: 'percentage',
  value: 10, stackable: false, minCartValue: 4000, ...overrides,
})

const itemRule = (ruleId, value, stackable = false, type = 'flat') => ({
  ruleId, scope: 'brand', appliesTo: 'Natura Casa', type, value, stackable, minCartValue: null,
})
const smallItem = { itemId: 'SMALL', product: 'Small Product', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 100 }

test('normalizes brand and platform names for exact matching without changing aliases', () => {
  const item = { brand: 'Natura  Casa', platform: ' AMAZON INDIA ' }
  assert.equal(normalizeDiscountText(null), '')
  assert.equal(normalizeDiscountText(undefined), '')
  assert.equal(normalizeDiscountText('  Natura  Casa  '), 'natura casa')
  assert.equal(normalizeDiscountText('Ａmazon India'), 'amazon india')
  assert.equal(ruleMatchesItem(item, { scope: 'brand', appliesTo: 'natura casa' }), true)
  assert.equal(ruleMatchesItem({ brand: 'LivSpace Pro', platform: 'Amazon India' }, { scope: 'brand', appliesTo: 'livspace pro' }), true)
  assert.equal(ruleMatchesItem(item, { scope: 'platform', appliesTo: 'Amazon India' }), true)
  assert.equal(ruleMatchesItem(item, { scope: 'platform', appliesTo: 'Amazon' }), false)
  assert.equal(ruleMatchesItem(item, { scope: 'brand', appliesTo: 'Nordic Basics' }), false)
  assert.equal(ruleMatchesItem({ brand: null, platform: undefined }, { scope: 'brand', appliesTo: null }), false)
})

test('caps oversized flat discounts at the item price', () => {
  for (const value of [150, 200]) {
    const result = applyDiscounts(smallItem, [itemRule(`FLAT-${value}`, value)])
    assert.equal(result.finalPrice, 0)
    assert.equal(result.totalDiscount, 100)
  }
})

test('caps stacked discounts sequentially and keeps a zero balance at zero', () => {
  const result = applyDiscounts(smallItem, [
    itemRule('WINNER', 10),
    itemRule('STACK-ONE', 150, true),
    itemRule('STACK-TWO', 200, true),
  ])
  assert.equal(result.finalPrice, 0)
  assert.equal(result.totalDiscount, 100)
  assert.deepEqual(result.appliedRules, ['WINNER', 'STACK-ONE', 'STACK-TWO'])

  const zeroThenPercentage = applyDiscounts(smallItem, [itemRule('ZERO', 100), itemRule('PERCENTAGE', 50, true, 'percentage')])
  assert.equal(zeroThenPercentage.finalPrice, 0)
  assert.equal(zeroThenPercentage.totalDiscount, 100)
})

test('applies percentage stackable rules to the capped remaining item price', () => {
  const result = applyDiscounts(smallItem, [itemRule('FLAT-80', 80), itemRule('PERCENT-50', 50, true, 'percentage')])
  assert.equal(result.finalPrice, 10)
  assert.equal(result.totalDiscount, 90)
})

test('uses input order for non-stackable flat rules with equal capped savings', () => {
  const result = applyDiscounts(smallItem, [itemRule('FIRST', 150), itemRule('SECOND', 200)])
  assert.deepEqual(result.appliedRules, ['FIRST'])
  assert.deepEqual(result.skippedRules, ['SECOND'])
  assert.equal(result.finalPrice, 0)
})

test('sample data retains item-level results and applies the cart discount afterwards', async () => {
  const [rulesText, cartText] = await Promise.all([
    readFile(new URL('../sample-data/rules.csv', import.meta.url), 'utf8'),
    readFile(new URL('../sample-data/cart.csv', import.meta.url), 'utf8'),
  ])
  const rules = parseRulesCSV(rulesText)
  const cart = parseCartCSV(cartText)
  assert.deepEqual(rules.errors, [])
  assert.deepEqual(cart.errors, [])
  const itemResults = processCart(cart.data, rules.data)
  assert.deepEqual(itemResults.map((item) => item.finalPrice), [1104, 629, 509, 2499, 382, 809])
  assert.equal(cartTotal(itemResults), 5932)
  assert.deepEqual(applyCartDiscount(cartTotal(itemResults), rules.data), {
    applied: true, subtotal: 5932, discountAmount: 593, finalTotal: 5339,
    appliedRules: ['RULE-04'], skippedRules: [], invalidRules: [], reasoning: 'Cart offer: 10% off',
  })
})

test('cart eligibility includes threshold equality, excludes lower subtotals, and handles an empty cart', () => {
  const rule = cartRule()
  assert.equal(applyCartDiscount(4000, [rule]).finalTotal, 3600)
  assert.equal(applyCartDiscount(3999, [rule]).discountAmount, 0)
  assert.equal(applyCartDiscount(4001, [rule]).finalTotal, 3601)
  assert.deepEqual(applyCartDiscount(0, [rule]), {
    applied: false, subtotal: 0, discountAmount: 0, finalTotal: 0,
    appliedRules: [], skippedRules: ['CART-10'], invalidRules: [], reasoning: 'No cart offers available',
  })
})

test('cart rules select the largest non-stackable saving and then apply stackable rules in input order', () => {
  const result = applyCartDiscount(1000, [
    cartRule({ ruleId: 'SMALL', value: 10, minCartValue: 1 }),
    cartRule({ ruleId: 'WINNER', value: 20, minCartValue: 1 }),
    cartRule({ ruleId: 'STACK-ONE', value: 10, stackable: true, minCartValue: 1 }),
    cartRule({ ruleId: 'STACK-TWO', value: 5, stackable: true, minCartValue: 1 }),
  ])
  assert.equal(result.finalTotal, 684) // 1000 -> 800 -> 720 -> 684
  assert.equal(result.discountAmount, 316)
  assert.deepEqual(result.appliedRules, ['WINNER', 'STACK-ONE', 'STACK-TWO'])
  assert.deepEqual(result.skippedRules, ['SMALL'])

  const stackableOnly = applyCartDiscount(1000, [
    cartRule({ ruleId: 'STACK-ONLY', value: 10, stackable: true, minCartValue: 1 }),
  ])
  assert.deepEqual(stackableOnly.appliedRules, ['STACK-ONLY'])
  assert.equal(stackableOnly.finalTotal, 900)
})

test('cart discount handles no matching rule and rejects invalid direct cart rules', () => {
  assert.equal(applyCartDiscount(500, [],).finalTotal, 500)
  const invalidRules = [
    cartRule({ ruleId: 'FLAT', type: 'flat', minCartValue: 1 }),
    cartRule({ ruleId: 'OVER-100', value: 101, minCartValue: 1 }),
    cartRule({ ruleId: 'MISSING-THRESHOLD', minCartValue: undefined }),
    cartRule({ ruleId: 'BAD-THRESHOLD', minCartValue: Number.NaN }),
    cartRule({ ruleId: 'BAD-STACKABLE', stackable: 'true', minCartValue: 1 }),
  ]
  const result = applyCartDiscount(1000, [cartRule({ ruleId: 'VALID', minCartValue: 1 }), ...invalidRules])
  assert.equal(result.finalTotal, 900)
  assert.equal(result.discountAmount, 100)
  assert.deepEqual(result.appliedRules, ['VALID'])
  assert.deepEqual(result.skippedRules, ['FLAT', 'OVER-100', 'MISSING-THRESHOLD', 'BAD-THRESHOLD', 'BAD-STACKABLE'])
  assert.deepEqual(result.invalidRules.map((rule) => rule.ruleId), result.skippedRules)
  assert.match(result.invalidRules[0].errors[0], /type must be percentage/)
})

test('rules CSV accepts valid cart rules with a consistent shape', () => {
  const parsed = parseRulesCSV('rule_id,scope,applies_to,type,value,stackable,min_cart_value\nCART-1,cart,,percentage,10,yes,1000\n')
  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(parsed.data[0], cartRule({ ruleId: 'CART-1', stackable: true, minCartValue: 1000 }))
})

test('rules CSV rejects invalid cart thresholds and rule fields', () => {
  const cases = [
    ['missing threshold', 'C1,cart,,percentage,10,false,', 'min_cart_value is required'],
    ['zero threshold', 'C1,cart,,percentage,10,false,0', 'min_cart_value must be a positive finite number'],
    ['negative threshold', 'C1,cart,,percentage,10,false,-1', 'min_cart_value must be a positive finite number'],
    ['text threshold', 'C1,cart,,percentage,10,false,nope', 'min_cart_value must be a positive finite number'],
    ['unsupported scope', 'C1,store,X,percentage,10,false,', 'scope must be'],
    ['cart flat discount', 'C1,cart,,flat,10,false,100', 'cart rules must use percentage discounts'],
    ['percentage above 100', 'C1,cart,,percentage,101,false,100', 'percentage value cannot exceed 100'],
    ['invalid stackable', 'C1,cart,,percentage,10,maybe,100', 'stackable must be'],
    ['brand missing applies_to', 'C1,brand,,percentage,10,false,', 'applies_to is required'],
  ]
  for (const [name, row, expectedError] of cases) {
    const parsed = parseRulesCSV(`rule_id,scope,applies_to,type,value,stackable,min_cart_value\n${row}\n`)
    assert.equal(parsed.data.length, 0, name)
    assert.match(parsed.errors[0], new RegExp(expectedError), name)
  }
})

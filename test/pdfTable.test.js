import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePdfPrice, reconstructPdfCart } from '../src/engine/pdfTable.js'
import { applyCartDiscount, cartTotal, processCart } from '../src/engine/discountEngine.js'

const columns = { product: 50, brand: 230, platform: 410, baseprice: 610 }
const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 6 })
const header = (y = 700, omitted = []) => Object.entries(columns).filter(([key]) => !omitted.includes(key)).map(([key, x]) => item(key === 'baseprice' ? 'Base Price' : key[0].toUpperCase() + key.slice(1), x, y))
const row = (values, y) => Object.entries(columns).flatMap(([key, x]) => values[key] === undefined ? [] : [item(values[key], x, y)])
const cartRows = [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'], ['Bed Sheet Set', 'Natura Casa', 'Flipkart', '849'],
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', '599'], ['Ceramic Vase', 'LivSpace Pro', 'Noon', '2499'],
  ['Cutting Board', 'Nordic Basics', 'Amazon India', '449'], ['Desk Organiser', 'Nordic Basics', 'Flipkart', '₹899'],
]
const validPage = () => [item('Order #1234', 50, 760), ...header(), ...cartRows.flatMap(([product, brand, platform, baseprice], index) => row({ product, brand, platform, baseprice }, 670 - index * 30)), item('Thank you for shopping', 50, 430)]

test('reconstructs a valid six-row PDF product table with unique IDs and ignores metadata', () => {
  const parsed = reconstructPdfCart([validPage()])
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.data.length, 6)
  assert.deepEqual(parsed.data.map((entry) => entry.itemId), ['PDF-ITEM-001', 'PDF-ITEM-002', 'PDF-ITEM-003', 'PDF-ITEM-004', 'PDF-ITEM-005', 'PDF-ITEM-006'])
  assert.deepEqual(parsed.data[0], { itemId: 'PDF-ITEM-001', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 })
  assert.equal(parsed.data[5].basePrice, 899)
  assert.deepEqual(parsed.metadata, { orderNumber: '1234', date: null })
})

test('normalizes supported currency formats and preserves duplicate product rows', () => {
  for (const [value, expected] of [['Rs.1,299', 1299], ['Rs 1,299', 1299], ['₹1,299', 1299], ['1299', 1299]]) assert.equal(parsePdfPrice(value), expected)
  const page = [...header(), ...row({ product: 'Same Product', brand: 'Brand', platform: 'Platform', baseprice: '100' }, 670), ...row({ product: 'Same Product', brand: 'Brand', platform: 'Platform', baseprice: '100' }, 640)]
  const parsed = reconstructPdfCart([page])
  assert.equal(parsed.data.length, 2)
  assert.notEqual(parsed.data[0].itemId, parsed.data[1].itemId)

  const spacedHeader = [item('  PRODUCT ', 50, 700), item('brand', 230, 700), item(' PLATFORM', 410, 700), item('base price', 610, 700), ...row({ product: 'P', brand: 'B', platform: 'X', baseprice: '100' }, 670)]
  assert.equal(reconstructPdfCart([spacedHeader]).data[0].basePrice, 100)
})

test('rejects empty text, missing required headers, incomplete rows, and invalid prices atomically', () => {
  assert.match(reconstructPdfCart([[]]).errors[0], /No product table/)
  for (const missing of ['product', 'brand', 'platform', 'baseprice']) {
    const parsed = reconstructPdfCart([header(700, [missing])])
    assert.equal(parsed.data.length, 0)
    assert.match(parsed.errors[0], new RegExp(missing === 'baseprice' ? 'Base Price' : missing, 'i'))
  }
  for (const values of [
    { brand: 'Brand', platform: 'Platform', baseprice: '100' },
    { product: 'Product', platform: 'Platform', baseprice: '100' },
    { product: 'Product', brand: 'Brand', baseprice: '100' },
    { product: 'Product', brand: 'Brand', platform: 'Platform', baseprice: 'not-a-price' },
    { product: 'Product', brand: 'Brand', platform: 'Platform', baseprice: '-10' },
    { product: 'Product', brand: 'Brand', platform: 'Platform', baseprice: '0' },
  ]) {
    const parsed = reconstructPdfCart([[...header(), ...row(values, 670)]])
    assert.equal(parsed.data.length, 0)
    assert.ok(parsed.errors.length > 0)
  }
})

test('imports valid PDF rows while skipping invalid rows with source row numbers and product names', () => {
  const partiallyInvalidRows = cartRows.map((values) => [...values])
  partiallyInvalidRows[2][3] = 'not-a-price'
  const page = [item('Order #OP-9921', 50, 760), item('Date: 15 Jan 2025', 230, 760), ...header(), ...partiallyInvalidRows.flatMap(([product, brand, platform, baseprice], index) => row({ product, brand, platform, baseprice }, 670 - index * 30))]
  const parsed = reconstructPdfCart([page])
  assert.equal(parsed.totalRows, 6)
  assert.equal(parsed.acceptedRows, 5)
  assert.equal(parsed.skippedRows, 1)
  assert.deepEqual(parsed.data.map((entry) => entry.product), ['Cushion Cover', 'Bed Sheet Set', 'Ceramic Vase', 'Cutting Board', 'Desk Organiser'])
  assert.match(parsed.errors[0], /^Row 3 \(Wall Shelf\): price "not-a-price"/)
  assert.deepEqual(parsed.metadata, { orderNumber: 'OP-9921', date: '15 Jan 2025' })
})

test('skips multiple invalid rows individually and recalculates using accepted PDF products', () => {
  const page = [...header(),
    ...row({ product: 'Good One', brand: 'Brand', platform: 'Amazon India', baseprice: '1000' }, 670),
    ...row({ product: 'Bad Price', brand: 'Brand', platform: 'Amazon India', baseprice: 'zero' }, 640),
    ...row({ product: 'Good Two', brand: 'Brand', platform: 'Amazon India', baseprice: '4000' }, 610),
    ...row({ product: 'No Platform', brand: 'Brand', baseprice: '50' }, 580),
  ]
  const parsed = reconstructPdfCart([page])
  assert.equal(parsed.acceptedRows, 2)
  assert.equal(parsed.skippedRows, 2)
  assert.match(parsed.errors[0], /Row 2 \(Bad Price\)/)
  assert.match(parsed.errors[1], /Row 4 \(No Platform\): missing Platform/)
  const rules = [{ ruleId: 'CART', scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 4000 }]
  const results = processCart(parsed.data, rules)
  assert.equal(cartTotal(results), 5000)
  assert.equal(applyCartDiscount(cartTotal(results), rules).finalTotal, 4500)
})

test('PDF-derived carts run through the existing item and cart discount calculation', () => {
  const parsed = reconstructPdfCart([validPage()])
  const rules = [
    { ruleId: 'PERCENT', scope: 'platform', appliesTo: 'Amazon India', type: 'percentage', value: 15, stackable: false, minCartValue: null },
    { ruleId: 'FLAT', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 150, stackable: false, minCartValue: null },
    { ruleId: 'STACK', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: true, minCartValue: null },
    { ruleId: 'CART', scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 4000 },
  ]
  const results = processCart(parsed.data, rules)
  assert.deepEqual(results.map((entry) => entry.finalPrice), [1104, 629, 509, 2499, 382, 809])
  assert.equal(cartTotal(results), 5932)
  assert.equal(applyCartDiscount(cartTotal(results), rules).finalTotal, 5339)
})

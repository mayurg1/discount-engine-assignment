import assert from 'node:assert/strict'
import test from 'node:test'
import { createParseRuleHandler } from '../api/parse-rule.js'
import { prepareConfirmedAiRule, validateAiParseResponse, validateDiscountRule } from '../src/engine/ruleValidation.js'
import { applyCartDiscount, cartTotal, processCart } from '../src/engine/discountEngine.js'

const brandRule = { scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, minCartValue: null }
const validResponse = { status: 'valid', message: 'Discount rule parsed successfully.', rule: brandRule }

function request(body = { instruction: '20% off Natura Casa' }) {
  const result = {}
  return [{ method: 'POST', body }, { status(code) { result.status = code; return this }, json(body) { result.body = body; return result } }, result]
}

test('shared validation accepts every supported valid rule shape', () => {
  assert.deepEqual(validateDiscountRule(brandRule), [])
  assert.deepEqual(validateDiscountRule({ ...brandRule, type: 'flat', value: 150, stackable: false }), [])
  assert.deepEqual(validateDiscountRule({ ...brandRule, scope: 'platform', appliesTo: 'Flipkart', stackable: false }), [])
  assert.deepEqual(validateDiscountRule({ scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 5000 }), [])
})

test('shared validation rejects incomplete, invalid, ambiguous, unsupported, and malformed responses', () => {
  const invalidRules = [
    { ...brandRule, appliesTo: '' }, { ...brandRule, value: null },
    { ...brandRule, scope: 'cart', appliesTo: null, minCartValue: null },
    { ...brandRule, scope: 'unknown' }, { ...brandRule, type: 'unknown' },
    { ...brandRule, value: 101 }, { ...brandRule, value: -1 }, { ...brandRule, stackable: 'false' },
  ]
  for (const rule of invalidRules) assert.ok(validateDiscountRule(rule).length > 0)
  assert.equal(validateAiParseResponse({ status: 'needs_clarification', message: 'Need a value.', rule: null }).valid, true)
  assert.equal(validateAiParseResponse({ status: 'unsupported', message: 'BOGO is unsupported.', rule: null }).valid, true)
  assert.equal(validateAiParseResponse({ status: 'valid', message: 'ok', rule: null }).valid, false)
  assert.equal(validateAiParseResponse({ status: 'invalid', message: 'bad', rule: null }).valid, false)
})

test('confirmation workflow accepts valid rules, rejects duplicates, and recalculates through the engine', () => {
  const confirmed = prepareConfirmedAiRule(validResponse, [], 'AI-1')
  assert.deepEqual(confirmed.errors, [])
  assert.equal(confirmed.rule.ruleId, 'AI-1')
  assert.match(prepareConfirmedAiRule(validResponse, [confirmed.rule], 'AI-2').errors[0], /identical/)
  assert.ok(prepareConfirmedAiRule({ status: 'unsupported', message: 'BOGO is unsupported.', rule: null }, [], 'AI-3').errors.length > 0)

  const items = [{ itemId: 'I-1', product: 'P', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1000 }]
  const results = processCart(items, [confirmed.rule])
  assert.equal(results[0].finalPrice, 800)
  assert.equal(applyCartDiscount(cartTotal(results), []).finalTotal, 800)
})

test('parse-rule API rejects missing configuration and invalid requests before Groq', async () => {
  const handler = createParseRuleHandler({ env: {}, fetchImpl: () => assert.fail('fetch should not run') })
  let [req, res, result] = request()
  await handler(req, res)
  assert.equal(result.status, 503)
  ;[req, res, result] = request({ instruction: '' })
  await handler(req, res)
  assert.equal(result.status, 400)
})

test('parse-rule API maps Groq HTTP failures without exposing secrets', async () => {
  for (const status of [400, 401, 429, 500]) {
    const handler = createParseRuleHandler({ env: { GROQ_API_KEY: 'test-key' }, fetchImpl: async () => ({ ok: false, status }) })
    const [req, res, result] = request()
    await handler(req, res)
    assert.equal(result.status, status === 500 ? 502 : status)
    assert.doesNotMatch(JSON.stringify(result.body), /test-key/)
  }
})

test('parse-rule API handles network failures, malformed data, and a valid mocked result', async () => {
  const env = { GROQ_API_KEY: 'test-key', GROQ_MODEL: 'openai/gpt-oss-20b' }
  let handler = createParseRuleHandler({ env, fetchImpl: async () => { throw new TypeError('network') } })
  let [req, res, result] = request()
  await handler(req, res)
  assert.equal(result.status, 502)

  handler = createParseRuleHandler({ env, fetchImpl: async () => {
    const timeout = new Error('timeout')
    timeout.name = 'AbortError'
    throw timeout
  } })
  ;[req, res, result] = request()
  await handler(req, res)
  assert.equal(result.status, 504)

  handler = createParseRuleHandler({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{bad' } }] }) }) })
  ;[req, res, result] = request()
  await handler(req, res)
  assert.equal(result.status, 502)

  handler = createParseRuleHandler({ env, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'openai/gpt-oss-20b')
    assert.equal(options.headers.Authorization, 'Bearer test-key')
    assert.equal(body.response_format.json_schema.strict, true)
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(validResponse) } }] }) }
  } })
  ;[req, res, result] = request()
  await handler(req, res)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, validResponse)
})

test('parse-rule API rejects invalid structured output and model refusals', async () => {
  const env = { GROQ_API_KEY: 'test-key' }
  for (const message of [{ content: JSON.stringify({ ...validResponse, rule: { ...brandRule, value: 101 } }) }, { refusal: 'No' }]) {
    const handler = createParseRuleHandler({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message }] }) }) })
    const [req, res, result] = request()
    await handler(req, res)
    assert.equal(result.status, 422)
  }
})

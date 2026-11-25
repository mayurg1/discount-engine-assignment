const VALID_SCOPES = ['brand', 'platform', 'cart']
const VALID_TYPES = ['percentage', 'flat']
const VALID_STATUSES = ['valid', 'needs_clarification', 'unsupported']

export function validateDiscountRule(rule) {
  const errors = []
  if (!rule || typeof rule !== 'object') return ['A rule object is required.']
  if (!VALID_SCOPES.includes(rule.scope)) errors.push('Scope must be brand, platform, or cart.')
  if (!VALID_TYPES.includes(rule.type)) errors.push('Discount type must be percentage or flat.')
  if (!Number.isFinite(rule.value) || rule.value <= 0) errors.push('Discount value must be a positive finite number.')
  if (rule.type === 'percentage' && rule.value > 100) errors.push('Percentage discounts cannot exceed 100%.')
  if (typeof rule.stackable !== 'boolean') errors.push('Stackable must be true or false.')

  if (rule.scope === 'brand' || rule.scope === 'platform') {
    if (typeof rule.appliesTo !== 'string' || !rule.appliesTo.trim()) errors.push(`${rule.scope} rules require an appliesTo value.`)
    if (rule.minCartValue !== null) errors.push('Non-cart rules cannot have a minimum cart value.')
  }
  if (rule.scope === 'cart') {
    if (rule.appliesTo !== null) errors.push('Cart rules cannot have an appliesTo value.')
    if (rule.type !== 'percentage') errors.push('Cart rules must use percentage discounts.')
    if (!Number.isFinite(rule.minCartValue) || rule.minCartValue <= 0) errors.push('Cart rules require a positive finite minimum cart value.')
  }
  return errors
}

export function validateAiParseResponse(response) {
  if (!response || typeof response !== 'object') return { valid: false, errors: ['The AI returned an invalid response.'] }
  if (!VALID_STATUSES.includes(response.status)) return { valid: false, errors: ['The AI returned an unsupported status.'] }
  if (typeof response.message !== 'string' || !response.message.trim()) return { valid: false, errors: ['The AI response is missing a message.'] }

  if (response.status !== 'valid') {
    if (response.rule !== null) return { valid: false, errors: ['Non-valid AI responses must not include a rule.'] }
    return { valid: true, errors: [] }
  }

  const errors = validateDiscountRule(response.rule)
  return { valid: errors.length === 0, errors }
}

export function ruleBusinessKey(rule) {
  return [rule.scope, rule.appliesTo ?? '', rule.type, rule.value, rule.stackable, rule.minCartValue ?? ''].join('|').toLowerCase()
}

export function prepareConfirmedAiRule(response, existingRules, ruleId) {
  const validation = validateAiParseResponse(response)
  if (!validation.valid || response?.status !== 'valid') {
    return { rule: null, errors: validation.errors.length > 0 ? validation.errors : ['This AI response cannot be confirmed.'] }
  }
  if (existingRules.some((existingRule) => ruleBusinessKey(existingRule) === ruleBusinessKey(response.rule))) {
    return { rule: null, errors: ['An identical discount rule already exists.'] }
  }
  return { rule: { ...response.rule, ruleId }, errors: [] }
}

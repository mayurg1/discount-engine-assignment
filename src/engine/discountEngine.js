/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects.
 * All functions take plain objects and return plain objects.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:    string       — e.g. "RULE-01"
 *   scope:     "brand" | "platform" | "cart"
 *   appliesTo: string       — e.g. "Natura Casa", "Amazon India"
 *   type:      "percentage" | "flat"
 *   value:     number       — percentage as integer (15 = 15%), flat in rupees
 *   stackable: boolean
 * }
 *
 * CartItem {
 *   itemId:    string       — e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number       — in rupees
 * }
 *
 * DiscountResult {
 *   itemId:        string
 *   product:       string
 *   brand:         string
 *   platform:      string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   reasoning:     string   — customer-readable explanation
 * }
 */

/**
 * Normalizes a brand or platform name for exact, presentation-independent
 * matching. Display values are never changed by this helper.
 */
export function normalizeDiscountText(value) {
  if (value === null || value === undefined) return ''
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Returns true if the rule applies to this cart item.
 */
export function ruleMatchesItem(item, rule) {
  const matches = (itemValue, ruleValue) => {
    const normalizedItem = normalizeDiscountText(itemValue)
    const normalizedRule = normalizeDiscountText(ruleValue)
    return normalizedItem !== '' && normalizedRule !== '' && normalizedItem === normalizedRule
  }
  if (rule.scope === 'brand') {
    return matches(item?.brand, rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return matches(item?.platform, rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 */
export function calculateDiscountAmount(price, rule) {
  if (rule.type === 'percentage') {
    return Math.round(price * rule.value / 100)
  }
  if (rule.type === 'flat') {
    return rule.value
  }
  return 0
}

/**
 * Builds the customer-facing reasoning string for an applied rule.
 */
function ruleToReasoning(rule) {
  const scopeLabel = rule.scope === 'brand' ? 'Brand' : 'Platform'
  if (rule.type === 'percentage') {
    return `${scopeLabel} offer: ${rule.value}% off`
  }
  if (rule.type === 'flat') {
    return `${scopeLabel} offer: Rs.${rule.value} off`
  }
  return `${scopeLabel} offer applied`
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 *
 * Logic:
 *   1. Find all rules that match this item.
 *   2. Among non-stackable rules, pick the one giving the largest discount.
 *   3. Apply any stackable rules on top of that price.
 *   4. Build the reasoning string from what was applied.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  // No rules match — return base price with explanation
  if (matchingRules.length === 0) {
    return {
      itemId: item.itemId,
      product: item.product,
      brand: item.brand,
      platform: item.platform,
      basePrice: item.basePrice,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      reasoning: 'No offers available',
    }
  }

  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  // Pick the non-stackable rule that gives the largest actual saving. Flat
  // discounts cannot save more than the item's current base price; equal capped
  // savings retain CSV/input order for deterministic behaviour.
  let winner = null
  let skipped = []

  if (nonStackable.length > 0) {
    for (const rule of nonStackable) {
      const saving = Math.min(item.basePrice, calculateDiscountAmount(item.basePrice, rule))
      const winnerSaving = winner === null
        ? -1
        : Math.min(item.basePrice, calculateDiscountAmount(item.basePrice, winner))
      if (saving > winnerSaving) winner = rule
    }
    skipped = nonStackable.filter((rule) => rule !== winner)
  }

  // Apply winner first, then stack on top
  let price = item.basePrice
  const appliedRules = []
  const reasoningParts = []

  const applyRule = (rule) => {
    const actualDiscount = Math.min(price, calculateDiscountAmount(price, rule))
    price = Math.max(0, price - actualDiscount)
    appliedRules.push(rule.ruleId)
    reasoningParts.push(ruleToReasoning(rule))
  }

  if (winner) {
    applyRule(winner)
  }

  for (const rule of stackable) {
    applyRule(rule)
  }

  const finalPrice = Math.round(Math.max(0, price))

  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules,
    skippedRules: skipped.map((r) => r.ruleId),
    reasoning: reasoningParts.join(' + '),
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Applies cart-level rules after item-level discounts have been totalled.
 *
 * Eligibility is always evaluated against the original item-level subtotal.
 * In input order, the largest eligible non-stackable saving wins (first rule
 * wins ties), then eligible stackable rules are applied sequentially to the
 * remaining total. This makes multiple-rule behaviour deterministic.
 */
export function applyCartDiscount(subtotal, rules) {
  const safeSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? Math.round(subtotal) : 0
  const suppliedRules = Array.isArray(rules) ? rules : []
  const invalidRules = []
  const cartRules = []

  suppliedRules.forEach((rule, index) => {
    if (!rule || typeof rule !== 'object' || rule.scope !== 'cart') return

    const errors = []
    if (rule.type !== 'percentage') errors.push('type must be percentage')
    if (!Number.isFinite(rule.value) || rule.value <= 0 || rule.value > 100) {
      errors.push('value must be a positive finite percentage no greater than 100')
    }
    if (!Number.isFinite(rule.minCartValue) || rule.minCartValue <= 0) {
      errors.push('minCartValue must be a positive finite number')
    }
    if (typeof rule.stackable !== 'boolean') errors.push('stackable must be a boolean')

    if (errors.length > 0) {
      invalidRules.push({ ruleId: rule.ruleId ?? `cart-rule-${index + 1}`, errors })
      return
    }
    cartRules.push(rule)
  })

  const eligibleRules = cartRules.filter((rule) => safeSubtotal >= rule.minCartValue)
  const ineligibleRules = cartRules.filter((rule) => safeSubtotal < rule.minCartValue)
  const nonStackable = eligibleRules.filter((rule) => !rule.stackable)
  const stackable = eligibleRules.filter((rule) => rule.stackable)

  let winner = null
  for (const rule of nonStackable) {
    if (!winner || calculateDiscountAmount(safeSubtotal, rule) > calculateDiscountAmount(safeSubtotal, winner)) {
      winner = rule
    }
  }

  let remaining = safeSubtotal
  const appliedRules = []
  const reasoningParts = []
  const skippedRules = [
    ...invalidRules.map((rule) => rule.ruleId),
    ...ineligibleRules.map((rule) => rule.ruleId),
    ...nonStackable.filter((rule) => rule !== winner).map((rule) => rule.ruleId),
  ]

  const applyRule = (rule) => {
    const discount = Math.min(remaining, calculateDiscountAmount(remaining, rule))
    remaining = Math.max(0, remaining - discount)
    appliedRules.push(rule.ruleId)
    reasoningParts.push(`Cart offer: ${rule.value}% off`)
  }

  if (winner) applyRule(winner)
  for (const rule of stackable) applyRule(rule)

  const finalTotal = Math.round(remaining)
  const discountAmount = safeSubtotal - finalTotal

  return {
    applied: appliedRules.length > 0,
    subtotal: safeSubtotal,
    discountAmount,
    finalTotal,
    appliedRules,
    skippedRules,
    invalidRules,
    reasoning: appliedRules.length > 0
      ? reasoningParts.join(' + ')
      : 'No cart offers available',
  }
}

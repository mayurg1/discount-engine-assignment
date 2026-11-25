/**
 * csvParser.js
 *
 * Converts raw CSV text into the typed objects the discount engine expects.
 * Uses papaparse for reliable CSV parsing, then maps column names to the
 * internal data shapes.
 *
 * Expected rules.csv columns:
 *   rule_id, scope, applies_to, type, value, stackable, min_cart_value
 *
 * Expected cart.csv columns:
 *   item_id, product, brand, platform, base_price
 */

import Papa from 'papaparse'

/**
 * Parses the raw text of rules.csv into an array of DiscountRule objects.
 * Returns { data, errors } where errors is an array of row-level issues.
 */
export function parseRulesCSV(csvText) {
  const { data: rows, errors: parseErrors } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  // A trailing optional min_cart_value is often omitted by CSV exporters.
  // Required-field validation below produces a clearer per-rule error for any
  // other short row, while genuine CSV syntax errors remain fatal.
  const fatalParseErrors = parseErrors.filter((error) => error.code !== 'TooFewFields')
  if (fatalParseErrors.length > 0) {
    return { data: [], errors: fatalParseErrors.map((e) => e.message) }
  }

  const data = []
  const errors = []

  rows.forEach((row, i) => {
    const rowNum = i + 2 // account for header row
    const missing = []

    if (!row.rule_id) missing.push('rule_id')
    if (!row.scope) missing.push('scope')
    if (!row.type) missing.push('type')
    if (row.value === undefined || row.value === '') missing.push('value')
    if (row.stackable === undefined || row.stackable === '') missing.push('stackable')

    if (missing.length > 0) {
      errors.push(`Row ${rowNum}: missing fields — ${missing.join(', ')}`)
      return
    }

    const scope = row.scope.trim().toLowerCase()
    if (!['brand', 'platform', 'cart'].includes(scope)) {
      errors.push(`Row ${rowNum}: scope must be "brand", "platform", or "cart", got "${row.scope}"`)
      return
    }

    if ((scope === 'brand' || scope === 'platform') && !row.applies_to?.trim()) {
      errors.push(`Row ${rowNum}: applies_to is required for ${scope} rules`)
      return
    }

    const type = row.type.trim().toLowerCase()
    if (type !== 'percentage' && type !== 'flat') {
      errors.push(`Row ${rowNum}: type must be "percentage" or "flat", got "${row.type}"`)
      return
    }

    const value = Number(row.value.trim())
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`Row ${rowNum}: value must be a positive finite number, got "${row.value}"`)
      return
    }

    if (type === 'percentage' && value > 100) {
      errors.push(`Row ${rowNum}: percentage value cannot exceed 100, got "${row.value}"`)
      return
    }

    const stackableStr = row.stackable.trim().toLowerCase()
    const stackableValues = {
      true: true,
      yes: true,
      '1': true,
      false: false,
      no: false,
      '0': false,
    }
    if (!Object.hasOwn(stackableValues, stackableStr)) {
      errors.push(`Row ${rowNum}: stackable must be true/false, yes/no, or 1/0, got "${row.stackable}"`)
      return
    }

    let minCartValue = null
    if (scope === 'cart') {
      if (type !== 'percentage') {
        errors.push(`Row ${rowNum}: cart rules must use percentage discounts`)
        return
      }

      if (row.min_cart_value === undefined || row.min_cart_value.trim() === '') {
        errors.push(`Row ${rowNum}: min_cart_value is required for cart rules`)
        return
      }

      minCartValue = Number(row.min_cart_value.trim())
      if (!Number.isFinite(minCartValue) || minCartValue <= 0) {
        errors.push(`Row ${rowNum}: min_cart_value must be a positive finite number, got "${row.min_cart_value}"`)
        return
      }
    }

    data.push({
      ruleId: row.rule_id.trim(),
      scope,
      appliesTo: scope === 'cart' ? null : row.applies_to.trim(),
      type,
      value,
      stackable: stackableValues[stackableStr],
      minCartValue,
    })
  })

  return { data, errors }
}

/**
 * Parses the raw text of cart.csv into an array of CartItem objects.
 * Returns { data, errors } where errors is an array of row-level issues.
 */
export function parseCartCSV(csvText) {
  const { data: rows, errors: parseErrors } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  if (parseErrors.length > 0) {
    return { data: [], errors: parseErrors.map((e) => e.message) }
  }

  const data = []
  const errors = []

  rows.forEach((row, i) => {
    const rowNum = i + 2
    const missing = []

    if (!row.item_id) missing.push('item_id')
    if (!row.product) missing.push('product')
    if (!row.brand) missing.push('brand')
    if (!row.platform) missing.push('platform')
    if (row.base_price === undefined || row.base_price === '') missing.push('base_price')

    if (missing.length > 0) {
      errors.push(`Row ${rowNum}: missing fields — ${missing.join(', ')}`)
      return
    }

    const basePrice = parseFloat(row.base_price)
    if (isNaN(basePrice) || basePrice <= 0) {
      errors.push(`Row ${rowNum}: base_price must be a positive number, got "${row.base_price}"`)
      return
    }

    data.push({
      itemId: row.item_id.trim(),
      product: row.product.trim(),
      brand: row.brand.trim(),
      platform: row.platform.trim(),
      basePrice: Math.round(basePrice),
    })
  })

  return { data, errors }
}

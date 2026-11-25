/** Removes one active session rule without changing its original input file. */
export function removeActiveRule(rules, ruleId) {
  return Array.isArray(rules) ? rules.filter((rule) => rule.ruleId !== ruleId) : []
}

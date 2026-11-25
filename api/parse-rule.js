import { AI_RULE_RESPONSE_SCHEMA, AI_RULE_SYSTEM_PROMPT } from '../src/engine/aiRulePrompt.js'
import { validateAiParseResponse } from '../src/engine/ruleValidation.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = 'openai/gpt-oss-20b'

const send = (res, status, body) => res.status(status).json(body)

export function createParseRuleHandler({ fetchImpl = fetch, env = process.env } = {}) {
  return async function parseRule(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST to parse a discount rule.' })
    const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : ''
    if (!instruction || instruction.length > 2000) return send(res, 400, { error: 'Provide a discount instruction between 1 and 2,000 characters.' })
    if (!env.GROQ_API_KEY) return send(res, 503, { error: 'AI rule creation is not configured. Add GROQ_API_KEY on the server.' })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetchImpl(GROQ_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.GROQ_MODEL || DEFAULT_MODEL,
          messages: [{ role: 'system', content: AI_RULE_SYSTEM_PROMPT }, { role: 'user', content: instruction }],
          response_format: { type: 'json_schema', json_schema: { name: 'discount_rule', strict: true, schema: AI_RULE_RESPONSE_SCHEMA } },
        }),
      })
      if (!response.ok) {
        const messages = { 400: 'The configured model rejected the structured request. Check GROQ_MODEL support.', 401: 'The Groq API key was rejected.', 429: 'Groq rate limit reached. Please try again shortly.' }
        return send(res, response.status >= 500 ? 502 : response.status, { error: messages[response.status] || 'Groq could not process the request.' })
      }
      const payload = await response.json()
      const message = payload?.choices?.[0]?.message
      if (message?.refusal) return send(res, 422, { error: 'The model declined to parse this instruction.' })
      if (typeof message?.content !== 'string' || !message.content.trim()) return send(res, 502, { error: 'Groq returned an empty response.' })
      let parsed
      try { parsed = JSON.parse(message.content) } catch { return send(res, 502, { error: 'Groq returned malformed structured data.' }) }
      const validation = validateAiParseResponse(parsed)
      if (!validation.valid) return send(res, 422, { error: 'Groq returned an invalid discount rule.', details: validation.errors })
      return send(res, 200, parsed)
    } catch (error) {
      return send(res, error?.name === 'AbortError' ? 504 : 502, { error: error?.name === 'AbortError' ? 'The Groq request timed out. Please try again.' : 'Unable to reach Groq. Please try again.' })
    } finally {
      clearTimeout(timeout)
    }
  }
}

export default createParseRuleHandler()

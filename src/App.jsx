/**
 * App.jsx
 *
 * Top-level component. Manages state for rules, cart items, and results.
 * Wires together CSV upload → parse → engine → display.
 */

import { useState } from 'react'
import CsvUploader from './components/CsvUploader.jsx'
import PdfCartUploader from './components/PdfCartUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import { parseRulesCSV, parseCartCSV } from './engine/csvParser.js'
import { parsePdfCart } from './engine/pdfParser.js'
import { beginPdfAttempt, finishPdfAttempt, idlePdfAttempt } from './engine/cartUploadState.js'
import { processCart, cartTotal, applyCartDiscount } from './engine/discountEngine.js'
import { prepareConfirmedAiRule, validateAiParseResponse } from './engine/ruleValidation.js'
import { removeActiveRule } from './engine/ruleManagement.js'

// ── Column definitions ───────────────────────────────────────────

const RULES_COLUMNS = [
  { key: 'ruleId',    label: 'Rule ID' },
  { key: 'scope',     label: 'Scope',      render: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  { key: 'appliesTo', label: 'Applies To' },
  { key: 'type',      label: 'Type',       render: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  {
    key: 'value',
    label: 'Value',
    render: (v, row) => row.type === 'percentage' ? `${v}% off` : `Rs.${v} off`,
  },
  { key: 'stackable', label: 'Stackable',  render: (v) => (v ? 'Yes' : 'No') },
  {
    key: 'minCartValue',
    label: 'Min Cart Value',
    render: (v, row) => row.scope === 'cart' ? `Rs.${v.toLocaleString('en-IN')}` : '—',
  },
]

const CART_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'brand',     label: 'Brand' },
  { key: 'platform',  label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
]

const RESULTS_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'basePrice', label: 'Base Price',  render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
  { key: 'finalPrice',label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>
        Rs.{v.toLocaleString('en-IN')}
      </span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) =>
      v > 0 ? (
        <span style={{ color: '#1e5c2c', fontWeight: 600 }}>Rs.{v.toLocaleString('en-IN')}</span>
      ) : (
        <span style={{ color: '#888' }}>—</span>
      ),
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v) => (
      <span style={{ color: v === 'No offers available' ? '#888' : '#131A48', fontStyle: v === 'No offers available' ? 'italic' : 'normal' }}>
        {v}
      </span>
    ),
  },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page:    { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header:  { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan:{ color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main:    { maxWidth: 960, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem' },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  grid2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  btn:     {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnDisabled: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'not-allowed',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  totalRow: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
    gap: '1rem', marginTop: '0.75rem', paddingTop: '0.75rem',
    borderTop: '2px solid #131A48',
  },
  totalLabel: { fontWeight: 700, fontSize: 14, color: '#131A48' },
  totalValue: { fontWeight: 700, fontSize: 16, color: '#131A48' },
  tag: (color, bg) => ({
    display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 6px',
    borderRadius: 20, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
  }),
  textarea: { width: '100%', minHeight: 88, resize: 'vertical', border: '1px solid #CECECE', borderRadius: 4, padding: 10, font: 'inherit', fontSize: 13 },
  message: (color) => ({ marginTop: 8, fontSize: 12, color }),
  preview: { marginTop: '0.8rem', padding: '0.85rem', border: '1px solid #cdd9ee', borderRadius: 4, background: '#f7faff', fontSize: 12, lineHeight: 1.7 },
  secondaryBtn: { background: '#fff', color: '#131A48', border: '1px solid #131A48', borderRadius: 4, padding: '0.55rem 1rem', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules]           = useState([])
  const [rulesErrors, setRulesErr]  = useState([])
  const [rulesFileName, setRulesFileName] = useState('')

  const [cartItems, setCartItems]   = useState([])
  const [cartErrors, setCartErrors] = useState([])
  const [cartSource, setCartSource] = useState({ type: null, fileName: '' })
  const [pdfAttempt, setPdfAttempt] = useState(idlePdfAttempt)

  const [results, setResults]       = useState(null)
  const [cartDiscount, setCartDiscount] = useState(null)
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiPreview, setAiPreview] = useState(null)
  const [aiError, setAiError] = useState('')
  const [aiSuccess, setAiSuccess] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [ruleSuccess, setRuleSuccess] = useState('')

  // ── Handlers ──

  function handleRulesLoad(csvText, fileName) {
    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErr(errors)
    setRulesFileName(fileName)
    setResults(null) // clear stale results
    setCartDiscount(null)
  }

  function handleCartLoad(csvText, fileName) {
    const { data, errors } = parseCartCSV(csvText)
    setCartErrors(errors)
    if (errors.length > 0 || data.length === 0) return
    setCartItems(data)
    setCartSource({ type: 'csv', fileName })
    setPdfAttempt(idlePdfAttempt)
    setResults(null)
    setCartDiscount(null)
  }

  function handleCalculate() {
    updateCalculation(cartItems, rules)
  }

  function updateCalculation(items, activeRules) {
    const itemResults = processCart(items, activeRules)
    setResults(itemResults)
    setCartDiscount(applyCartDiscount(cartTotal(itemResults), activeRules))
  }

  async function handlePdfCartLoad(file) {
    setPdfAttempt(beginPdfAttempt(file.name))
    const parsed = await parsePdfCart(file)
    const attempt = finishPdfAttempt(file.name, parsed)
    setPdfAttempt(attempt)
    if (attempt.status === 'error') return
    // Replace the cart only after every extracted row has passed validation.
    setCartItems(parsed.data)
    setCartSource({ type: 'pdf', fileName: file.name })
    setCartErr([])
    updateCalculation(parsed.data, rules)
  }

  async function handleAiParse() {
    setAiError('')
    setAiSuccess('')
    setAiPreview(null)
    if (!aiInstruction.trim()) {
      setAiError('Describe the discount rule you want to create.')
      return
    }
    setAiLoading(true)
    try {
      const response = await fetch('/api/parse-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: aiInstruction }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Unable to parse the rule.')
      const validation = validateAiParseResponse(payload)
      if (!validation.valid) throw new Error(validation.errors.join(' '))
      if (payload.status !== 'valid') {
        setAiError(payload.message)
        return
      }
      setAiPreview(payload)
    } catch (error) {
      setAiError(error.message || 'Unable to parse the rule.')
    } finally {
      setAiLoading(false)
    }
  }

  function handleAiConfirm() {
    const confirmation = prepareConfirmedAiRule(aiPreview, rules, `AI-${Date.now()}`)
    if (!confirmation.rule) {
      setAiError(confirmation.errors.join(' '))
      return
    }
    const newRule = confirmation.rule
    const nextRules = [...rules, newRule]
    setRules(nextRules)
    if (cartItems.length > 0) {
      updateCalculation(cartItems, nextRules)
    }
    setAiPreview(null)
    setAiInstruction('')
    setAiSuccess(`Added ${newRule.ruleId} to active discount rules.`)
  }

  function handleRuleDelete(ruleId) {
    const rule = rules.find((candidate) => candidate.ruleId === ruleId)
    if (!rule || !window.confirm(`Remove ${ruleId} from this session's active rules? The uploaded CSV will not be changed.`)) return
    const nextRules = removeActiveRule(rules, ruleId)
    setRules(nextRules)
    setRuleSuccess(`Removed ${ruleId} from the current session's active rules.`)
    if (cartItems.length > 0) updateCalculation(cartItems, nextRules)
  }

  const canCalculate = cartItems.length > 0
  const rulesColumns = [
    ...RULES_COLUMNS,
    {
      key: 'actions',
      label: 'Actions',
      render: (_, row) => (
        <button
          type="button"
          onClick={() => handleRuleDelete(row.ruleId)}
          aria-label={`Delete rule ${row.ruleId}`}
          style={{ background: '#fff', color: '#b42318', border: '1px solid #b42318', borderRadius: 4, padding: '4px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >
          Delete
        </button>
      ),
    },
  ]

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>

        <div style={S.section}>
          <div style={S.sectionTitle}>Create Discount Using AI</div>
          <textarea
            style={S.textarea}
            value={aiInstruction}
            onChange={(event) => setAiInstruction(event.target.value)}
            placeholder="Example: 20% off for Natura Casa brand, stackable with other offers"
            aria-label="Natural-language discount instruction"
          />
          <div style={{ marginTop: '0.65rem' }}>
            <button style={aiLoading ? S.btnDisabled : S.btn} onClick={handleAiParse} disabled={aiLoading}>
              {aiLoading ? 'Parsing Rule…' : 'Parse Rule'}
            </button>
          </div>
          {aiError && <div style={S.message('#b42318')}>{aiError}</div>}
          {aiSuccess && <div style={S.message('#1e5c2c')}>{aiSuccess}</div>}
          {aiPreview?.rule && (
            <div style={S.preview}>
              <strong>AI-Parsed Discount Rule</strong><br />
              Scope: {aiPreview.rule.scope.charAt(0).toUpperCase() + aiPreview.rule.scope.slice(1)}<br />
              Applies To: {aiPreview.rule.appliesTo ?? '—'}<br />
              Type: {aiPreview.rule.type.charAt(0).toUpperCase() + aiPreview.rule.type.slice(1)}<br />
              Value: {aiPreview.rule.type === 'percentage' ? `${aiPreview.rule.value}%` : `Rs.${aiPreview.rule.value}`}<br />
              Stackable: {aiPreview.rule.stackable ? 'Yes' : 'No'}<br />
              Minimum Cart Value: {aiPreview.rule.minCartValue === null ? '—' : `Rs.${aiPreview.rule.minCartValue.toLocaleString('en-IN')}`}<br />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.55rem' }}>
                <button style={S.btn} onClick={handleAiConfirm}>Confirm Rule</button>
                <button style={S.secondaryBtn} onClick={() => setAiPreview(null)}>Discard</button>
              </div>
            </div>
          )}
        </div>

        {/* Upload row */}
        <div style={S.grid2}>
          {/* Rules upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Discount Rules</div>
            <CsvUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              onLoad={handleRulesLoad}
              hasData={rules.length > 0}
              fileName={rulesFileName}
            />
            <ErrorBanner errors={rulesErrors} />
            {ruleSuccess && <div style={S.message('#1e5c2c')}>{ruleSuccess}</div>}
            <div style={{ marginTop: '0.55rem', fontSize: 11, color: '#888' }}>Deleting a rule affects only this session; it does not edit the uploaded CSV file.</div>
            {rules.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {rules.length} rule{rules.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={rulesColumns} rows={rules} />
              </div>
            )}
          </div>

          {/* Cart upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Items</div>
            <CsvUploader
              label="cart.csv"
              description="Upload your cart CSV"
              onLoad={handleCartLoad}
              hasData={cartSource.type === 'csv'}
              fileName={cartSource.type === 'csv' ? cartSource.fileName : ''}
            />
            <div style={{ marginTop: '0.75rem' }}>
              <PdfCartUploader
                onLoad={handlePdfCartLoad}
                isCurrentSource={cartSource.type === 'pdf'}
                currentFileName={cartSource.type === 'pdf' ? cartSource.fileName : ''}
                attempt={pdfAttempt}
              />
            </div>
            <ErrorBanner errors={cartErrors} />
            <ErrorBanner errors={pdfAttempt.errors} />
            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </div>
        </div>

        {/* Calculate button */}
        <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          <button
            style={canCalculate ? S.btn : S.btnDisabled}
            onClick={handleCalculate}
            disabled={!canCalculate}
          >
            Calculate Discounts
          </button>
          {!canCalculate && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              Upload cart items to calculate
            </div>
          )}
        </div>

        {/* Results */}
        {results && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <DataTable columns={RESULTS_COLUMNS} rows={results} />
            <div style={S.totalRow}>
              <span style={S.totalLabel}>Item Subtotal</span>
              <span style={S.totalValue}>Rs.{cartTotal(results).toLocaleString('en-IN')}</span>
            </div>
            {cartDiscount?.applied && (
              <div style={{ ...S.totalRow, borderTop: 'none', marginTop: 0, paddingTop: '0.4rem' }}>
                <span style={S.totalLabel}>Cart Discount ({cartDiscount.reasoning})</span>
                <span style={{ ...S.totalValue, color: '#1e5c2c' }}>-Rs.{cartDiscount.discountAmount.toLocaleString('en-IN')}</span>
              </div>
            )}
            <div style={S.totalRow}>
              <span style={S.totalLabel}>Final Cart Total</span>
              <span style={S.totalValue}>Rs.{(cartDiscount?.finalTotal ?? cartTotal(results)).toLocaleString('en-IN')}</span>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

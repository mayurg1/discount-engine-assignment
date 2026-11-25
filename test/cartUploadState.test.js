import assert from 'node:assert/strict'
import test from 'node:test'
import { beginPdfAttempt, finishPdfAttempt, idlePdfAttempt } from '../src/engine/cartUploadState.js'

test('PDF attempt keeps its selected filename through processing and rejection', () => {
  assert.deepEqual(beginPdfAttempt('sample-cart-invalid.pdf'), {
    fileName: 'sample-cart-invalid.pdf', status: 'processing', errors: [], message: 'Extracting product table…',
  })
  const rejected = finishPdfAttempt('sample-cart-invalid.pdf', { data: [], errors: ['PDF page 1, row 3: Base Price must be a positive number.'] })
  assert.equal(rejected.fileName, 'sample-cart-invalid.pdf')
  assert.equal(rejected.status, 'error')
  assert.match(rejected.errors[0], /row 3/)
})

test('successful PDF attempt has its own success state and a later CSV can reset only the attempt display', () => {
  const accepted = finishPdfAttempt('sample-cart.pdf', { data: [{ itemId: 'PDF-ITEM-001' }, { itemId: 'PDF-ITEM-002' }], errors: [], skippedRows: 0, metadata: { orderNumber: null, date: null } })
  assert.deepEqual(accepted, {
    fileName: 'sample-cart.pdf', status: 'success', errors: [], message: 'Successfully imported — 2 items.',
  })
  assert.deepEqual(idlePdfAttempt, { fileName: '', status: 'idle', errors: [], message: '' })
})

test('partial PDF imports are accepted with warnings, while zero valid rows remain rejected', () => {
  const partial = finishPdfAttempt('sample-cart-invalid.pdf', {
    data: [{ itemId: 'PDF-ITEM-001' }], errors: ['Row 2 (Wall Shelf): price "not-a-price" is not a positive number.'], skippedRows: 1,
    metadata: { orderNumber: 'OP-9921', date: '15 Jan 2025' },
  })
  assert.equal(partial.status, 'warning')
  assert.match(partial.message, /Loaded 1 item from Order #OP-9921 Date: 15 Jan 2025, skipped 1 row/)
  assert.equal(partial.errors.length, 1)
  assert.equal(finishPdfAttempt('all-invalid.pdf', { data: [], errors: ['Row 1: missing Product.'], skippedRows: 1, metadata: { orderNumber: null, date: null } }).status, 'error')
})

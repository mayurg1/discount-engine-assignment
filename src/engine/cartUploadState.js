export const idlePdfAttempt = { fileName: '', status: 'idle', errors: [], message: '' }

export function beginPdfAttempt(fileName) {
  return { fileName, status: 'processing', errors: [], message: 'Extracting product table…' }
}

export function finishPdfAttempt(fileName, parsed) {
  const errors = parsed.errors.length > 0 ? parsed.errors : parsed.data.length === 0 ? ['No product rows were found in the PDF.'] : []
  if (parsed.data.length === 0) return { fileName, status: 'error', errors, message: 'Rejected' }
  const order = parsed.metadata?.orderNumber ? ` from Order #${parsed.metadata.orderNumber}${parsed.metadata.date ? ` Date: ${parsed.metadata.date}` : ''}` : ''
  const skipped = parsed.skippedRows || 0
  const count = `${parsed.data.length} item${parsed.data.length === 1 ? '' : 's'}`
  const message = skipped > 0
    ? `Loaded ${count}${order}, skipped ${skipped} row${skipped === 1 ? '' : 's'} (reasons below).`
    : `Successfully imported — ${count}.`
  return { fileName, status: skipped > 0 ? 'warning' : 'success', errors, message }
}

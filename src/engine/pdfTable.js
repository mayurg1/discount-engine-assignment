const HEADER_NAMES = ['product', 'brand', 'platform', 'baseprice']

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const headerName = (value) => clean(value).toLowerCase().replace(/[^a-z]/g, '')

export function parsePdfPrice(value) {
  const normalized = clean(value).replace(/^rs\.?\s*/i, '').replace(/^₹\s*/, '').replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const price = Number(normalized)
  return Number.isFinite(price) && price > 0 ? Math.round(price) : null
}

export function rowsFromTextItems(items) {
  const positioned = items
    .filter((item) => clean(item.str))
    .map((item) => ({ text: clean(item.str), x: item.x ?? item.transform?.[4] ?? 0, y: item.y ?? item.transform?.[5] ?? 0, width: item.width ?? 0 }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const item of positioned) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3)
    if (line) line.items.push(item)
    else lines.push({ y: item.y, items: [item] })
  }
  return lines.map((line) => ({
    y: line.y,
    items: line.items.sort((a, b) => a.x - b.x),
    text: line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '),
  }))
}

function findHeader(line) {
  const cells = []
  for (const item of line.items) {
    const previous = cells.at(-1)
    const canJoin = previous && item.x - (previous.endX ?? previous.x) < 40
    if (canJoin) {
      previous.text = `${previous.text} ${item.text}`
      previous.endX = item.x + item.width
    } else cells.push({ text: item.text, x: item.x, endX: item.x + item.width })
  }
  const columns = {}
  for (const cell of cells) {
    const key = headerName(cell.text)
    if (HEADER_NAMES.includes(key)) columns[key] = cell.x
  }
  const missing = HEADER_NAMES.filter((name) => !Number.isFinite(columns[name]))
  return { columns: missing.length === 0 ? columns : null, missing, matched: HEADER_NAMES.length - missing.length }
}

function cellsForRow(line, columns) {
  const ordered = HEADER_NAMES.map((name) => ({ name, x: columns[name] })).sort((a, b) => a.x - b.x)
  const boundaries = ordered.slice(1).map((column, index) => (column.x + ordered[index].x) / 2)
  const values = Object.fromEntries(HEADER_NAMES.map((name) => [name, []]))
  for (const item of line.items) {
    let index = boundaries.findIndex((boundary) => item.x < boundary)
    if (index === -1) index = ordered.length - 1
    values[ordered[index].name].push(item.text)
  }
  return Object.fromEntries(Object.entries(values).map(([key, parts]) => [key, clean(parts.join(' '))]))
}

export function reconstructPdfCart(pageItems) {
  const data = []
  const errors = []
  const warnings = []
  const allText = pageItems.flat().map((item) => clean(item.str)).join(' ')
  const orderMatch = allText.match(/\bOrder\s*#?\s*([A-Za-z0-9-]+)/i)
  const dateMatch = allText.match(/\bDate\s*:\s*([A-Za-z0-9, -]+)/i)
  const metadata = { orderNumber: orderMatch ? orderMatch[1] : null, date: dateMatch ? clean(dateMatch[1]).replace(/\s+(Product|Brand|Platform|Base Price).*$/i, '') : null }
  let foundHeader = false
  let missingHeaderColumns = null
  let sourceRowNumber = 0

  pageItems.forEach((items, pageIndex) => {
    let columns = null
    for (const line of rowsFromTextItems(items)) {
      const header = findHeader(line)
      if (header.columns) {
        columns = header.columns
        foundHeader = true
        continue
      }
      if (header.matched >= 2) missingHeaderColumns = header.missing
      if (!columns) continue
      const values = cellsForRow(line, columns)
      const alignedItems = line.items.filter((item) => HEADER_NAMES.some((name) => Math.abs(item.x - columns[name]) <= 45)).length
      if (alignedItems < 2) continue // headings, dates, and one-column footers are not cart rows
      sourceRowNumber += 1
      const fields = [['product', 'Product'], ['brand', 'Brand'], ['platform', 'Platform'], ['baseprice', 'Base Price']]
      const missing = fields.filter(([key]) => !values[key]).map(([, label]) => label)
      const productLabel = values.product ? ` (${values.product})` : ''
      const rowLabel = `Row ${sourceRowNumber}${productLabel}`
      if (missing.length > 0) {
        errors.push(`${rowLabel}: missing ${missing.join(', ')}.`)
        continue
      }
      const basePrice = parsePdfPrice(values.baseprice)
      if (basePrice === null) {
        errors.push(`${rowLabel}: price "${values.baseprice}" is not a positive number.`)
        continue
      }
      data.push({ itemId: `PDF-ITEM-${String(data.length + 1).padStart(3, '0')}`, product: values.product, brand: values.brand, platform: values.platform, basePrice })
    }
  })

  if (!foundHeader) errors.push(missingHeaderColumns ? `PDF table is missing required column(s): ${missingHeaderColumns.map((name) => name === 'baseprice' ? 'Base Price' : `${name[0].toUpperCase()}${name.slice(1)}`).join(', ')}.` : 'No product table was found. Required columns: Product, Brand, Platform, Base Price.')
  if (foundHeader && sourceRowNumber === 0 && errors.length === 0) errors.push('No product rows were found in the PDF table.')
  return { data: foundHeader ? data : [], errors, warnings, metadata, totalRows: sourceRowNumber, acceptedRows: data.length, skippedRows: errors.length }
}

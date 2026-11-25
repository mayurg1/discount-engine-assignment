import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { reconstructPdfCart } from './pdfTable.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PDF_BYTES = 10 * 1024 * 1024
const emptyResult = (errors) => ({ data: [], errors, warnings: [], metadata: { orderNumber: null, date: null }, totalRows: 0, acceptedRows: 0, skippedRows: 0 })

export async function parsePdfCart(file) {
  const name = file?.name || ''
  const isPdf = name.toLowerCase().endsWith('.pdf') && (!file.type || file.type === 'application/pdf')
  if (!isPdf) return emptyResult(['Please upload a PDF file (.pdf).'])
  if (file.size > MAX_PDF_BYTES) return emptyResult(['PDF files must be 10 MB or smaller.'])

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const document = await pdfjsLib.getDocument({ data: bytes }).promise
    const pages = []
    let textItemCount = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.filter((item) => typeof item.str === 'string' && item.str.trim())
      textItemCount += items.length
      pages.push(items)
    }
    if (textItemCount === 0) return emptyResult(['This PDF appears to be scanned or image-only. Please upload a text-based PDF.'])
    return reconstructPdfCart(pages)
  } catch (error) {
    const encrypted = /password|encrypted/i.test(error?.message || '')
    return emptyResult([encrypted ? 'This PDF is password-protected and could not be read.' : 'This PDF could not be read. Please upload a valid text-based PDF.'])
  }
}

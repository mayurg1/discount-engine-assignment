import { useRef } from 'react'

export default function PdfCartUploader({ onLoad, isCurrentSource, currentFileName, attempt }) {
  const inputRef = useRef(null)
  async function handleFile(event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (file) await onLoad(file)
  }
  return (
    <div
      style={{ border: `2px dashed ${attempt.status === 'error' ? '#c0392b' : attempt.status === 'warning' || attempt.status === 'processing' ? '#FF5800' : isCurrentSource ? '#1e5c2c' : '#CECECE'}`, borderRadius: 6, padding: '1rem 1.2rem', background: attempt.status === 'error' ? '#fce8e8' : attempt.status === 'warning' ? '#fff6e8' : isCurrentSource ? '#f0faf2' : '#fafafa', cursor: attempt.status === 'processing' ? 'wait' : 'pointer' }}
      onClick={() => attempt.status !== 'processing' && inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleFile} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: 20 }}>{attempt.status === 'processing' ? '⏳' : attempt.status === 'error' ? '❌' : attempt.status === 'warning' ? '⚠️' : isCurrentSource ? '✅' : '📑'}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48' }}>Cart PDF</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{attempt.fileName || (isCurrentSource ? currentFileName : 'Upload a text-based cart PDF')}</div>
          {attempt.status !== 'idle' && <div style={{ fontSize: 11, color: attempt.status === 'error' ? '#8a1a1a' : attempt.status === 'success' ? '#1e5c2c' : attempt.status === 'warning' ? '#9a6700' : '#888', marginTop: 2 }}>Status: {attempt.message}</div>}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: attempt.status === 'error' ? '#c0392b' : isCurrentSource ? '#1e5c2c' : '#FF5800', textTransform: 'uppercase' }}>{attempt.status === 'processing' ? 'Working' : attempt.status === 'error' ? 'Rejected' : attempt.status === 'warning' ? 'Warnings' : isCurrentSource ? 'Change' : 'Upload'}</span>
      </div>
    </div>
  )
}

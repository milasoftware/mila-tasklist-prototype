import { useRef, useState } from 'react'
import { clearUploadedDataset, isUsingUploadedDataset, saveUploadedDataset, type GeneratedDataset } from '../data'

type RawDebtorFile = {
  debtors: unknown[]
}

type RawPostsFile = {
  administration?: { code?: string }
  invoices: Array<{ Invoicedate?: string }>
}

function isRawDebtorFile(value: unknown): value is RawDebtorFile {
  return !!value && Array.isArray((value as RawDebtorFile).debtors)
}

function isRawPostsFile(value: unknown): value is RawPostsFile {
  return !!value && Array.isArray((value as RawPostsFile).invoices)
}

function isGeneratedDataset(value: unknown): value is GeneratedDataset {
  const maybe = value as Partial<GeneratedDataset> | null
  return !!maybe && !!maybe.meta && Array.isArray(maybe.tasks)
}

function latestInvoiceDate(postsData: RawPostsFile) {
  const dates = postsData.invoices
    .map((invoice) => invoice.Invoicedate)
    .filter((date): date is string => !!date)
    .sort()
  return dates[dates.length - 1] ?? '2026-05-11'
}

async function readJsonFiles(files: FileList) {
  return Promise.all(
    Array.from(files).map(async (file) => ({
      file,
      json: JSON.parse(await file.text()) as unknown,
    })),
  )
}

export function DataUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setIsBusy(true)
    setStatus('Bestanden verwerken...')

    try {
      const parsedFiles = await readJsonFiles(files)
      const generated = parsedFiles.find(({ json }) => isGeneratedDataset(json))?.json

      if (generated && isGeneratedDataset(generated)) {
        saveUploadedDataset(generated)
      } else {
        const debData = parsedFiles.find(({ json }) => isRawDebtorFile(json))?.json
        const postsData = parsedFiles.find(({ json }) => isRawPostsFile(json))?.json

        if (!debData || !postsData || !isRawDebtorFile(debData) || !isRawPostsFile(postsData)) {
          throw new Error('Upload het debiteurenbestand en het posten/facturenbestand als JSON.')
        }

        const { buildGeneratedDataFromRaw } = await import('../preprocess/build-data')
        const snapshot = latestInvoiceDate(postsData)
        const sourceLabel = `Upload ruwe debiteurenbestanden (${new Date().toLocaleDateString('nl-NL')})`
        const dataset = buildGeneratedDataFromRaw({ debData, postsData, snapshot, sourceLabel })
        saveUploadedDataset(dataset as GeneratedDataset)
      }

      window.location.reload()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload mislukt.')
      setIsBusy(false)
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function resetDataset() {
    clearUploadedDataset()
    window.location.reload()
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => handleFiles(event.currentTarget.files)}
      />
      <button
        type="button"
        disabled={isBusy}
        onClick={() => inputRef.current?.click()}
        className="px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {isBusy ? 'Verwerken...' : 'Upload data'}
      </button>
      {isUsingUploadedDataset && (
        <button
          type="button"
          onClick={resetDataset}
          className="px-3 py-1.5 text-sm rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
        >
          Reset
        </button>
      )}
      {status && <span className="max-w-xs truncate text-xs text-slate-500">{status}</span>}
    </div>
  )
}

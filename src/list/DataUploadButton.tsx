import { useRef, useState } from 'react'
import { clearUploadedDataset, isUsingUploadedDataset, saveUploadedDataset, type GeneratedDataset } from '../data'
import { useToast } from '../toast'

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

// Custom error-types zodat we per soort fout een passende toast kunnen
// tonen. Vooral de quota-melding heeft een eigen verhaal (lokale
// preprocess als workaround), dat verdient een eigen tak.
class ParseError extends Error {
  constructor(public readonly fileName: string, cause: unknown) {
    super(`Bestand '${fileName}' kon niet als JSON gelezen worden.`)
    this.name = 'ParseError'
    if (cause instanceof Error) this.stack = cause.stack
  }
}

class StructureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StructureError'
  }
}

class QuotaError extends Error {
  constructor() {
    super('Browser-opslag (localStorage) zit vol — de dataset is te groot.')
    this.name = 'QuotaError'
  }
}

class BuildError extends Error {
  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`Verwerking mislukt tijdens scoring: ${reason}`)
    this.name = 'BuildError'
  }
}

async function readJsonFiles(files: FileList) {
  return Promise.all(
    Array.from(files).map(async (file) => {
      try {
        const text = await file.text()
        const json: unknown = JSON.parse(text)
        return { file, json }
      } catch (cause) {
        throw new ParseError(file.name, cause)
      }
    }),
  )
}

// Drempel waarboven we vooraf een waarschuwing tonen. localStorage-quota
// ligt typisch op 5-10 MB; in JSON-tekst is dat ook ongeveer de grens
// waar de browser-build merkbaar traag wordt voor 20K+ debiteuren.
const LARGE_FILE_BYTES = 25 * 1024 * 1024 // 25 MB

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function isQuotaException(err: unknown) {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: number }
  // Chromium, Firefox en Safari gebruiken verschillende identifiers.
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  )
}

export function DataUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isBusy, setIsBusy] = useState(false)
  const toast = useToast()

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setIsBusy(true)

    // Vooraf-waarschuwing bij grote bestanden — voorkomt dat de gebruiker
    // 5 minuten naar een bevroren tab kijkt zonder uitleg.
    const total = Array.from(files).reduce((sum, f) => sum + f.size, 0)
    if (total > LARGE_FILE_BYTES) {
      toast.warning(
        `Totale upload is ${formatBytes(total)}. De browser-verwerking kan minuten duren en kan de dataset te groot maken voor lokale opslag (~10 MB limiet). Bij voorkeur eerst lokaal pre-processen.`,
        { title: 'Groot bestand gedetecteerd' },
      )
    }

    const progressId = toast.info('Bestanden verwerken...', { sticky: true })

    try {
      const parsedFiles = await readJsonFiles(files)
      const generated = parsedFiles.find(({ json }) => isGeneratedDataset(json))?.json

      let datasetToSave: GeneratedDataset
      let summary: string

      if (generated && isGeneratedDataset(generated)) {
        datasetToSave = generated
        summary = `Voorbewerkte dataset geladen: ${generated.tasks.length} taken.`
      } else {
        const debData = parsedFiles.find(({ json }) => isRawDebtorFile(json))?.json
        const postsData = parsedFiles.find(({ json }) => isRawPostsFile(json))?.json

        if (!debData || !postsData || !isRawDebtorFile(debData) || !isRawPostsFile(postsData)) {
          throw new StructureError(
            'Upload het debiteurenbestand (met "debtors") én het postenbestand (met "invoices"), of één eerder gegenereerd data.generated.json.',
          )
        }

        try {
          const { buildGeneratedDataFromRaw } = await import('../preprocess/build-data')
          const snapshot = latestInvoiceDate(postsData)
          const sourceLabel = `Upload ruwe debiteurenbestanden (${new Date().toLocaleDateString('nl-NL')})`
          datasetToSave = buildGeneratedDataFromRaw({
            debData,
            postsData,
            snapshot,
            sourceLabel,
          }) as GeneratedDataset
          summary = `Ruwe data verwerkt: ${datasetToSave.tasks.length} taken op basis van ${debData.debtors.length} debiteuren.`
        } catch (cause) {
          throw new BuildError(cause)
        }
      }

      try {
        saveUploadedDataset(datasetToSave)
      } catch (cause) {
        if (isQuotaException(cause)) throw new QuotaError()
        throw cause
      }

      toast.dismiss(progressId)
      toast.success(`${summary} Pagina wordt herladen...`)
      // Korte vertraging zodat de gebruiker de toast nog ziet voor de reload.
      window.setTimeout(() => window.location.reload(), 600)
    } catch (error) {
      toast.dismiss(progressId)
      setIsBusy(false)

      if (error instanceof ParseError) {
        toast.error(error.message, {
          title: 'Ongeldige JSON',
          action: {
            label: 'Probeer opnieuw',
            onClick: () => inputRef.current?.click(),
          },
        })
        return
      }

      if (error instanceof StructureError) {
        toast.error(error.message, { title: 'Onverwachte bestandsstructuur' })
        return
      }

      if (error instanceof QuotaError) {
        toast.error(
          'De verwerkte dataset past niet in de browser-opslag (limiet ~5-10 MB). Pre-process de bestanden eerst lokaal met `node scripts/preprocess.mjs` en upload het resulterende `src/data.generated.json` — dat is een stuk compacter.',
          { title: 'Dataset te groot voor browser' },
        )
        return
      }

      if (error instanceof BuildError) {
        toast.error(
          `${error.message}\n\nMogelijke oorzaken: missende velden in de raw bestanden, onverwachte datumformaten, of de dataset is te groot voor de browser.`,
          { title: 'Verwerking mislukt' },
        )
        return
      }

      const fallback = error instanceof Error ? error.message : 'Onbekende fout bij upload.'
      toast.error(fallback, { title: 'Upload mislukt' })
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function resetDataset() {
    clearUploadedDataset()
    toast.info('Dataset gereset — terug naar de standaard dummy-data.')
    window.setTimeout(() => window.location.reload(), 400)
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
    </div>
  )
}

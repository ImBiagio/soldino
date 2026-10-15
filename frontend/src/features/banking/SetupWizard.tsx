import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'

import { useSaveBankingApp } from '../../api/hooks'
import { ErrorBanner, Field, Icon } from '../../components/ui'
import type { BankingStatus } from '../../lib/types'

const CONTROL_PANEL = 'https://enablebanking.com/cp/applications'
const SIGN_IN = 'https://enablebanking.com/sign-in'
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

interface Step {
  title: string
  body: ReactNode
  /** Schermata del pannello Enable Banking, in /public/banca. */
  image?: string
  imageAlt?: string
}

/**
 * Setup della propria applicazione Enable Banking (ADR 0013): ogni utente ne
 * registra una sua, Soldino non ha accesso ai conti di nessuno.
 */
export function SetupWizard({ status, onDone }: { status: BankingStatus; onDone?: () => void }) {
  const [current, setCurrent] = useState(0)
  const steps: Step[] = [
    {
      title: 'Crea il tuo account Enable Banking',
      image: '/banca/01-accesso.png',
      imageAlt: 'La pagina di accesso di Enable Banking',
      body: (
        <>
          <p>
            Enable Banking è il servizio autorizzato (AISP, vigilato in Finlandia) che legge saldo
            e movimenti dalla tua banca. Per uso personale è gratuito: la tua applicazione legge
            solo i conti che colleghi tu.
          </p>
          <p>
            Apri la pagina di accesso, scrivi la tua email e segui il link che ti arriva:
            l&apos;account si crea da solo al primo accesso.
          </p>
          <ExternalLink href={SIGN_IN}>Apri Enable Banking</ExternalLink>
        </>
      ),
    },
    {
      title: "Registra l'applicazione",
      image: '/banca/02-registra.png',
      imageAlt: "Il modulo per aggiungere una nuova applicazione nel pannello di Enable Banking",
      body: (
        <>
          <p>
            Dal menu in alto apri <strong>API applications</strong> e compila &quot;Add a new
            application&quot;:
          </p>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <li>
              <strong>1.</strong> scegli <code>Production</code> (non Sandbox, che ha solo banche
              finte)
            </li>
            <li>
              <strong>2.</strong> lascia &quot;Generate in the browser&quot;: la chiave la crea il
              browser
            </li>
            <li>
              <strong>Application name</strong>: <code>Soldino</code> (lo vedrai quando autorizzi la
              banca)
            </li>
            <li>
              <strong>Allowed redirect URLs</strong>: esattamente questo indirizzo
              <CopyBox value={status.callback_url} />
            </li>
            <li>
              Gli altri campi sono facoltativi: per Privacy e Terms URL va bene l&apos;indirizzo di
              Soldino. Poi premi <strong>Register</strong>.
            </li>
          </ul>
          <p>
            Il browser scarica un file <code>.pem</code> che si chiama come l&apos;application ID
            (es. <code>aaaaaaaa-bbbb-….pem</code>). È la chiave della tua applicazione: tienila
            per te, ti serve tra due passi.
          </p>
          <ExternalLink href={CONTROL_PANEL}>Apri API applications</ExternalLink>
        </>
      ),
    },
    {
      title: "Attiva l'applicazione collegando i conti",
      image: '/banca/03-attiva.png',
      imageAlt:
        "La card dell'applicazione Soldino: attiva, con un conto collegato e i menu per collegarne un altro",
      body: (
        <>
          <p>
            L&apos;applicazione appena creata è <strong>Inactive</strong>: si attiva collegando un
            conto. In fondo alla sua card scegli <strong>Country</strong> (Italy), la banca in{' '}
            <strong>ASPSP</strong> e l&apos;uso in <strong>Usage type</strong> (personale), poi
            premi <strong>Link</strong> (o <strong>Activate by linking accounts</strong>). Accetta i
            termini di Enable Banking e autorizza con l&apos;app della banca.
          </p>
          <p>
            Ripeti per <strong>ogni conto</strong> che vuoi in Soldino: in modalità gratuita
            l&apos;applicazione legge solo i conti sotto <strong>Linked accounts</strong>. Quando
            è pronta vedi <strong>Active</strong> e &quot;Account Information · Restricted&quot;.
            Non si scarica nessun file, la chiave resta una.
          </p>
          <ExternalLink href={CONTROL_PANEL}>Apri API applications</ExternalLink>
        </>
      ),
    },
    {
      title: 'Carica la chiave in Soldino',
      body: <KeyUpload status={status} onDone={onDone} />,
    },
  ]
  const step = steps[current]

  return (
    <section className="grid gap-5 rounded-panel bg-surface-container-low p-5 md:p-6">
      <ol className="flex flex-wrap gap-2" aria-label="Passaggi">
        {steps.map((item, index) => (
          <li key={item.title}>
            <button
              type="button"
              onClick={() => setCurrent(index)}
              aria-current={index === current ? 'step' : undefined}
              className={clsx(
                'state inline-flex h-9 items-center gap-2 rounded-pill pl-1.5 pr-3.5 text-body-medium',
                index === current
                  ? 'bg-secondary-container font-medium text-on-secondary-container'
                  : 'text-on-surface-variant',
              )}
            >
              <span
                className={clsx(
                  'flex h-6 w-6 items-center justify-center rounded-pill text-body-small font-semibold',
                  index <= current ? 'bg-primary text-on-primary' : 'bg-surface-container-high',
                )}
              >
                {index < current ? <Icon name="check" size={16} /> : index + 1}
              </span>
              <span className="hidden sm:inline">{item.title.split(' ')[0]}</span>
            </button>
          </li>
        ))}
      </ol>

      <div
        className={clsx(
          'grid gap-6',
          step.image && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start',
        )}
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 text-body-large [&_code]:rounded [&_code]:bg-surface-container-high [&_code]:px-1.5 [&_code]:text-body-medium [&_li]:ml-5 [&_li]:list-disc">
          <h2 className="text-title-medium">
            {current + 1}. {step.title}
          </h2>
          {step.body}
        </div>
        {step.image && <Screenshot src={step.image} alt={step.imageAlt ?? ''} />}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-text"
          disabled={current === 0}
          onClick={() => setCurrent((value) => value - 1)}
        >
          <Icon name="arrow_back" size={20} />
          Indietro
        </button>
        {current < steps.length - 1 && (
          <button
            type="button"
            className="btn-filled ml-auto"
            onClick={() => setCurrent((value) => value + 1)}
          >
            Fatto, avanti
            <Icon name="arrow_forward" size={20} />
          </button>
        )}
      </div>
    </section>
  )
}

function KeyUpload({ status, onDone }: { status: BankingStatus; onDone?: () => void }) {
  const save = useSaveBankingApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [appId, setAppId] = useState(status.app?.app_id ?? '')

  const pick = (candidate: File | undefined) => {
    if (!candidate) return
    setFile(candidate)
    // Enable Banking chiama il file come l'application ID: lo si legge da li'.
    const fromName = candidate.name.match(UUID_RE)?.[0]
    if (fromName) setAppId(fromName.toLowerCase())
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!file || !appId) return
        await save.mutateAsync({ appId: appId.trim(), key: file })
        onDone?.()
      }}
    >
      <p>
        Scegli il file <code>.pem</code> scaricato al passo 2. Soldino controlla con Enable Banking
        che chiave e application ID funzionino e che l&apos;indirizzo di ritorno sia giusto, poi
        salva la chiave cifrata.
      </p>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="state flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-outline-variant bg-surface px-4 py-5 text-center"
      >
        <Icon name={file ? 'key' : 'upload_file'} size={28} className="text-primary" />
        <span className="text-body-large font-medium">
          {file ? file.name : 'Scegli il file .pem'}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pem,application/x-pem-file,application/x-x509-ca-cert,text/plain"
        className="hidden"
        onChange={(event) => pick(event.target.files?.[0])}
      />
      <Field
        label="Application ID"
        hint="Si compila dal nome del file; lo trovi anche nel pannello, sotto il nome dell'app."
      >
        <input
          className="field-input font-mono"
          value={appId}
          onChange={(event) => setAppId(event.target.value)}
          placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
          spellCheck={false}
        />
      </Field>
      <ErrorBanner error={save.error} />
      {status.configured && status.app && !save.isPending && !save.error && (
        <p className="flex items-center gap-2 text-body-medium text-primary">
          <Icon name="check_circle" size={20} />
          Applicazione &quot;{status.app.name}&quot; verificata.
        </p>
      )}
      <button
        className="btn-filled w-fit"
        disabled={!file || !UUID_RE.test(appId) || save.isPending}
      >
        <Icon name="verified_user" size={20} />
        {save.isPending ? 'Verifico…' : 'Verifica e salva'}
      </button>
    </form>
  )
}

function Screenshot({ src, alt }: { src: string; alt: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return null
  return (
    <figure className="overflow-hidden rounded-card border border-outline-variant bg-surface">
      <img src={src} alt={alt} className="block w-full" onError={() => setMissing(true)} />
    </figure>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="btn-tonal w-fit">
      {children}
      <Icon name="open_in_new" size={18} />
    </a>
  )
}

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="mt-1.5 flex items-center gap-2 rounded-card bg-surface px-3 py-2">
      <code className="min-w-0 flex-1 break-all !bg-transparent !px-0">{value}</code>
      <button
        type="button"
        className="btn-text btn-sm shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        }}
      >
        <Icon name={copied ? 'check' : 'content_copy'} size={16} />
        {copied ? 'Copiato' : 'Copia'}
      </button>
    </span>
  )
}

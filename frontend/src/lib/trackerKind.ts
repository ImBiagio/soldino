import { gettext } from './i18n'
import type { Tracker, TrackerKind } from './types'

/**
 * Il tipo di tracker e' solo un preset di interfaccia (ADR 0010): un tracker
 * "group" (viaggi, cene fra amici) ha ancora conti, ricorrenze e
 * riconciliazione, semplicemente non li mostra. Ogni regola "si vede o no" sta
 * qui, cosi' una schermata nuova decide in un punto solo.
 */

export const KIND_OPTIONS: { value: TrackerKind; label: string; description: string }[] = [
  {
    value: 'household',
    label: gettext('Tracking continuo'),
    description: gettext(
      'Spese di casa o di coppia: entrate, conti, ricorrenze e riconciliazione.',
    ),
  },
  {
    value: 'group',
    label: gettext('Dividere le spese'),
    description: gettext('Viaggi, cene fra amici: solo spese e chi deve cosa, alla Splitwise.'),
  },
]

/** Sezioni (segmento di URL sotto /t/:id) che un tracker "group" non mostra. */
const GROUP_HIDDEN_SECTIONS = new Set(['conti', 'attese', 'abbonamenti', 'scan', 'banca'])

export const isGroup = (tracker: Tracker) => tracker.kind === 'group'

/** Le rotte restano raggiungibili da URL: e' visibilita', non un permesso. */
export const showsSection = (tracker: Tracker, section: string) =>
  !isGroup(tracker) || !GROUP_HIDDEN_SECTIONS.has(section.split('?')[0])

/** Riconciliazione (pill, card, riga in lista, "oggi sui conti" nei grafici). */
export const showsReconciliation = (tracker: Tracker) => !isGroup(tracker)

/** Nel form solo spese: in un gruppo un'entrata non ha senso. */
export const showsIncome = (tracker: Tracker) => !isGroup(tracker)

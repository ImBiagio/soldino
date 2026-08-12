# 0003 — Isolamento per tracker via mixin, non a mano

`apps/core/scoping.TrackerScopedMixin` filtra ogni queryset sui tracker di cui
`request.user` è membro attivo. Le view non filtrano mai a mano.

**Perché:** l'isolamento a mano è corretto finché qualcuno non aggiunge una view
e se ne dimentica. Con un solo punto di applicazione, i test in
`apps/trackers/tests/test_isolation.py` coprono l'intera superficie API.

Un tracker altrui restituisce **404**, non 403, dove il tracker è la risorsa
richiesta: la sua esistenza non è un'informazione da divulgare. Sulle rotte
annidate il permesso scatta prima e restituisce 403.

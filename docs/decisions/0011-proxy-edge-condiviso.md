# 0011 — Un proxy "edge" condiviso sul homeserver

Data: 2026-10-15 · Stato: accettata

## Contesto

Soldino va in produzione sullo stesso homeserver di cinemino, con un dominio
suo (`sold.inoo.it` accanto a `cinem.inoo.it`, stesso IP). Fino a oggi il
Caddy interno di cinemino teneva le porte 80/443 e il suo certificato: due app
non possono pubblicare le stesse porte.

## Decisione

Un Caddy dedicato, **edge** (`deploy/edge/`, sul server in `~/edge`), è l'unico
container con 80/443. Smista per hostname verso i Caddy interni delle app sulla
rete Docker esterna `edge` (alias `cinemino-web`, `soldino-web`) e gestisce
tutti i certificati Let's Encrypt. Le app non pubblicano porte.

I Caddy interni ascoltano in HTTP e si fidano delle `X-Forwarded-*` dell'edge
(`trusted_proxies static private_ranges`). Due conseguenze, entrambe volute:

- Django vede che il client era in HTTPS (`SECURE_PROXY_SSL_HEADER`): niente
  loop col redirect HTTPS di soldino, cookie Secure corretti.
- Il blocco "admin solo dalla LAN" usa `client_ip`, non `remote_ip`: dietro un
  proxy il `remote_ip` è sempre l'edge (rete Docker 172.x) e avrebbe aperto
  l'admin a tutti. Per lo stesso motivo 172.16.0.0/12 non è più fra le reti
  ammesse.

Ogni app tiene il suo routing interno (SPA, `/api`, `/admin`, `/media`, HLS):
l'edge conosce solo i domini. Watchtower resta quello del compose di cinemino,
che aggiorna tutti i container etichettati del server.

## Scartato

- **Aggiungere `sold.inoo.it` al Caddy di cinemino**: lega il deploy di soldino
  alle immagini di cinemino e ai suoi riavvii.
- **Passthrough TLS per SNI (nginx `stream`)**: ogni app terrebbe il suo
  certificato, ma senza PROXY protocol le app vedrebbero comunque l'IP del
  proxy, quindi serviva toccare i Caddyfile lo stesso, con più pezzi in gioco.
- **Edge che conosce i path delle app**: l'edge diventerebbe da aggiornare a
  ogni cambio di routing di una delle app.

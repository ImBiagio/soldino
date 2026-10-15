"""Client minimo dell'API Enable Banking (https://enablebanking.com/docs/api/reference/).

Ogni chiamata e' firmata con la chiave privata dell'applicazione dell'utente:
un JWT RS256 con ``kid`` = application ID, valido un'ora.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from django.conf import settings

TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class BankingError(Exception):
    """Errore da mostrare all'utente. ``session_lost``: va rifatta l'autorizzazione."""

    def __init__(self, message: str, *, status: int | None = None, session_lost: bool = False):
        super().__init__(message)
        self.status = status
        self.session_lost = session_lost


def _explain(response: httpx.Response) -> BankingError:
    try:
        body = response.json()
    except ValueError:
        body = {}
    detail = body.get("message") or body.get("error") or body.get("detail") or ""
    code = response.status_code
    if code == 401:
        return BankingError(
            "Enable Banking ha rifiutato la firma: controlla che application ID e file .pem "
            "siano della stessa applicazione.",
            status=code,
        )
    if "application does not exist" in str(detail).lower():
        return BankingError(
            "Enable Banking non conosce questo application ID: controlla che sia quello "
            "dell'applicazione (e' il nome del file .pem).",
            status=code,
        )
    if code in (403, 404) and "session" in str(detail).lower():
        return BankingError(
            "Il consenso della banca non e' piu' valido: rinnova il collegamento.",
            status=code,
            session_lost=True,
        )
    if code == 429:
        return BankingError(
            "La banca ha raggiunto il limite di accessi giornalieri: riprova domani.",
            status=code,
        )
    return BankingError(f"Enable Banking ha risposto con un errore ({code}): {detail}", status=code)


class EnableBankingClient:
    def __init__(self, app_id: str, private_key: bytes, base_url: str | None = None):
        self.app_id = str(app_id)
        self.private_key = private_key
        self.base_url = (base_url or settings.ENABLE_BANKING_API_URL).rstrip("/")

    def _token(self) -> str:
        now = int(time.time())
        return jwt.encode(
            {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now,
             "exp": now + 3600},
            self.private_key,
            algorithm="RS256",
            headers={"kid": self.app_id},
        )

    def _request(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        try:
            response = httpx.request(
                method,
                f"{self.base_url}{path}",
                headers={"Authorization": f"Bearer {self._token()}"},
                timeout=TIMEOUT,
                **kwargs,
            )
        except httpx.HTTPError as exc:
            raise BankingError(f"Enable Banking non risponde: {exc}") from exc
        if response.status_code >= 400:
            raise _explain(response)
        return response.json() if response.content else {}

    def application(self) -> dict:
        return self._request("GET", "/application")

    def aspsps(self, country: str) -> list[dict]:
        data = self._request("GET", "/aspsps", params={"country": country, "psu_type": "personal"})
        return data.get("aspsps", [])

    def start_auth(
        self, *, aspsp_name: str, country: str, valid_until: str, state: str, redirect_url: str
    ) -> dict:
        return self._request(
            "POST",
            "/auth",
            json={
                "access": {"valid_until": valid_until},
                "aspsp": {"name": aspsp_name, "country": country},
                "state": state,
                "redirect_url": redirect_url,
                "psu_type": "personal",
                "language": "it",
            },
        )

    def create_session(self, code: str) -> dict:
        return self._request("POST", "/sessions", json={"code": code})

    def delete_session(self, session_id: str) -> None:
        self._request("DELETE", f"/sessions/{session_id}")

    def balances(self, uid: str) -> list[dict]:
        return self._request("GET", f"/accounts/{uid}/balances").get("balances", [])

    def transactions(self, uid: str, *, date_from: str) -> list[dict]:
        """Tutte le pagine dei movimenti dal ``date_from`` in poi."""
        params: dict[str, str] = {"date_from": date_from}
        items: list[dict] = []
        for _ in range(50):  # paracadute: nessuna banca pagina cosi' tanto
            data = self._request("GET", f"/accounts/{uid}/transactions", params=params)
            items.extend(data.get("transactions") or [])
            key = data.get("continuation_key")
            if not key:
                break
            params = {"date_from": date_from, "continuation_key": key}
        return items

"""La segnalazione errori (Sentry/GlitchTip) vive solo in config.settings.prod."""

from __future__ import annotations

import sentry_sdk


def test_i_test_non_inizializzano_sentry():
    assert not sentry_sdk.is_initialized()

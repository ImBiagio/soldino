import json
from io import StringIO

import pytest
from django.core.management import call_command


@pytest.mark.django_db
def test_export_for_cornhub(user):
    user.display_name = "Anna Maria Bianchi"
    user.save()
    out = StringIO()
    call_command("export_cornhub_users", stdout=out)
    [row] = json.loads(out.getvalue())
    assert row["email"] == user.email
    assert row["first_name"] == "Anna" and row["last_name"] == "Maria Bianchi"
    assert row["password"].startswith("md5$")  # l'hash, mai la password
    assert row["is_active"] is True

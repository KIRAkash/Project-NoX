from types import SimpleNamespace

from nox_api.db.models import Role
from nox_api.missions.drafting import build_prompt
from nox_api.missions.templates import SECTIONS


def _mission(creator: Role):
    return SimpleNamespace(key="NOX-1", title="t", prompt="Move the session store to Redis", created_as_role=creator)


def test_every_file_gets_its_reader_brief_and_sections():
    for role in Role:
        p = build_prompt(_mission(Role.business), role, {}, "(kb)")
        assert "Reader brief" in p and "Your reader:" in p
        assert all(f"- {h}:" in p for h, _ in SECTIONS[role])


def test_business_file_keeps_technical_words_out():
    p = build_prompt(_mission(Role.business), Role.business, {}, "(kb)")
    assert "Never in this file:" in p and "endpoint" in p and "No knowledge-base citations" in p


def test_technical_missions_let_business_and_product_go_light():
    for creator in (Role.engineering, Role.developer):
        for role in (Role.business, Role.product):
            assert "light touch" in build_prompt(_mission(creator), role, {}, "(kb)")
    assert "often a technical change" not in build_prompt(_mission(Role.business), Role.business, {}, "(kb)")
    assert "often a technical change" not in build_prompt(_mission(Role.developer), Role.engineering, {}, "(kb)")


def test_engineering_lens_covers_tests_architecture_and_standards():
    headings = [h for h, _ in SECTIONS[Role.engineering]]
    assert "Test strategy" in headings and "Architecture, guardrails and standards" in headings

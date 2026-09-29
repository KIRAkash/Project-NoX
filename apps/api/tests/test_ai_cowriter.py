"""Co-writer agent: section edits that can't break the author's file, streamed live, saved as one version."""

import pytest

from nox_api.ai.tools import spec
from nox_api.ai.tools.spec import EditError

FILE = "# Build spec: Lockout\n\nIntro line.\n\n## Tasks\n1. Add counter\n\n### Detail\nsub\n\n## Rollout\n- flag\n\n## Verification checklist\n- [ ] works\n"


def test_split_and_join_round_trip():
    pre, secs = spec.split(FILE)
    assert pre == "# Build spec: Lockout\n\nIntro line.\n"
    assert [s.heading for s in secs] == ["Tasks", "Rollout", "Verification checklist"]
    assert "### Detail" in secs[0].body  # deeper headings stay inside their section
    assert spec.join(pre, secs) == FILE


def test_replace_keeps_the_heading_and_everything_else():
    out = spec.replace_body(FILE, "tasks", "## Tasks\n1. Add counter\n2. Lock after 5\n\n### Detail\nsub")
    assert "## Tasks\n\n1. Add counter\n2. Lock after 5\n\n### Detail\nsub\n\n## Rollout\n- flag\n" in out  # untouched section keeps its exact form
    with pytest.raises(EditError):
        spec.replace_body(FILE, "Tasks", "x\n\n## Sneaky new section\ny")
    with pytest.raises(EditError, match="No section"):
        spec.replace_body(FILE, "Nope", "x")


def test_a_rewrite_must_keep_the_sections_subheadings():
    with pytest.raises(EditError, match="Keep these subheadings.*Detail"):
        spec.replace_body(FILE, "Tasks", "1. Add counter\n\n### Details renamed\nsub")
    out = spec.replace_body(FILE, "Tasks", "1. Add counter\n2. Lock\n\n### detail\nnew sub")  # same heading, any case
    assert "### detail\nnew sub" in out


def test_insert_lands_before_the_checklist_and_refuses_duplicates():
    out = spec.insert(FILE, "Risks", "- lockout abuse")
    _, secs = spec.split(out)
    assert [s.heading for s in secs] == ["Tasks", "Rollout", "Risks", "Verification checklist"]
    out2 = spec.insert(FILE, "Risks", "- r", after="Verification checklist")
    assert [s.heading for s in spec.split(out2)[1]][-1] == "Verification checklist"  # checklist stays last
    with pytest.raises(EditError, match="already exists"):
        spec.insert(FILE, "rollout", "x")


def test_append_adds_without_touching_the_rest():
    out = spec.append(FILE, "Rollout", "- migrate counters")
    assert "- flag\n- migrate counters" in out and out.count("## ") == FILE.count("## ")


def test_answering_every_open_question_removes_the_section():
    md = FILE.replace("## Verification checklist", "## Open questions\n- lock for how long?\n\n## Verification checklist")
    out = spec.replace_body(md, "Open questions", "")
    assert "Open questions" not in out and out == FILE
    assert "## Rollout\n\n\n" in spec.replace_body(FILE, "Rollout", "")  # other sections just go empty


def test_editor_system_drops_the_whole_file_output_rule():
    from nox_api.ai.agents.cowriter import _OUTPUT_RULE, _UNKNOWN_RULE, EDITOR_SYSTEM
    from nox_api.missions.drafting import SYSTEM

    assert _OUTPUT_RULE in SYSTEM and _OUTPUT_RULE not in EDITOR_SYSTEM
    assert _UNKNOWN_RULE in SYSTEM and _UNKNOWN_RULE not in EDITOR_SYSTEM  # questions go to the chat, not the file


async def test_questions_for_the_author_go_to_the_chat_not_the_file(db_clean, fake_nox, monkeypatch):
    from .ai_fakes import FakeLlm, call, text, use_fake
    from .test_cowrite import _events, _until
    from .test_missions import _client, _setup_app, _wait_drafts

    use_fake(monkeypatch, FakeLlm(script=[
        call("insert_section", heading="Rollout", markdown="- behind the lockout flag"),
        call("ask_author", question="How long does an account stay locked?", suggestion="15 minutes, the auth default"),
        text("Put the rollout behind a flag."),
    ]))
    kb = await _setup_app()
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
        await _wait_drafts(dev, key)
        await dev.post(f"/api/v1/missions/{key}/files/developer/chat", json={"message": "Tighten the rollout"})

        async def replied():
            return any(e["payload"].get("author") == "nox" for e in await _events(dev, key, "chat.message"))

        await _until(replied)
        msg = next(e["payload"] for e in await _events(dev, key, "chat.message") if e["payload"].get("author") == "nox")
        assert msg["questions"] == 1 and msg["body"].startswith("Put the rollout behind a flag.")
        assert "1. How long does an account stay locked? (Suggestion: 15 minutes, the auth default)" in msg["body"]
        md = next(f for f in (await dev.get(f"/api/v1/missions/{key}")).json()["files"] if f["role"] == "developer")["markdown"]
        assert "behind the lockout flag" in md and "How long" not in md and "Open questions" not in md


async def test_a_turn_with_two_edits_streams_both_and_saves_one_version(db_clean, fake_nox, monkeypatch):
    from nox_api.missions import events as events_module

    from .ai_fakes import FakeLlm, call, text, use_fake
    from .test_cowrite import _events, _until
    from .test_missions import _client, _setup_app, _wait_drafts

    live = []

    async def capture(mission_id, type_, payload):
        live.append((type_, payload))

    monkeypatch.setattr(events_module, "broadcast_transient", capture)
    use_fake(monkeypatch, FakeLlm(script=[
        call("search_kb", query="lockout"),
        call("insert_section", heading="Risks", markdown="- lockout abuse"),
        call("append_to_section", heading="Risks", markdown="- counter reset on deploy"),
        call("replace_section", heading="Verification checklist", markdown="## Oops\n- nope"),  # rejected by the tool
        text("Added two risks."),
    ]))
    kb = await _setup_app()
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
        m = await _wait_drafts(dev, key)
        v0 = next(f for f in m["files"] if f["role"] == "developer")["version"]
        await dev.post(f"/api/v1/missions/{key}/files/developer/chat", json={"message": "What could go wrong?"})

        async def replied():
            return any(e["payload"].get("author") == "nox" for e in await _events(dev, key, "chat.message"))

        await _until(replied)
        edits = await _events(dev, key, "nox.edit")
        assert len(edits) == 1 and edits[0]["payload"]["fromVersion"] == v0 and edits[0]["payload"]["toVersion"] == v0 + 1
        assert edits[0]["payload"]["edits"] == ["added “Risks”", "extended “Risks”"]
        md = next(f for f in (await dev.get(f"/api/v1/missions/{key}")).json()["files"] if f["role"] == "developer")["markdown"]
        assert "- lockout abuse\n- counter reset on deploy" in md and "## Oops" not in md
        assert md.rstrip().endswith("- [ ] it works")  # checklist untouched and still last

    partials = [p for t, p in live if t == "nox.edit.partial"]
    assert [p["step"] for p in partials] == [1, 2] and all(p["fromVersion"] == v0 for p in partials)
    assert partials[-1]["markdown"] == md
    steps = [p["label"] for t, p in live if t == "nox.step"]
    assert steps[0].startswith("Searching refunds-service") and "Adding “Risks”" in steps
    assert "".join(p["text"] for t, p in live if t == "chat.delta") == "Added two risks."

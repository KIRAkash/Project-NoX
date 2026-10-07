.PHONY: help install infra infra-down free-ports dev api web worker beat migrate embed-backfill eval seed-demo push-demo demo-reset test test-live lint typecheck build

API := apps/api
DEV_PORTS := 8000 3000
UV  := cd $(API) && uv run

help:
	@echo "make install     Install web (npm) and api (uv) dependencies"
	@echo "make infra       Start postgres + redis in Docker"
	@echo "make dev         infra + api + worker + web, all in the foreground (Ctrl-C stops all)"
	@echo "make free-ports  Kill whatever listens on the api/web ports and stray nox workers (make dev runs this first)"
	@echo "make api|web|worker|beat   Run one service"
	@echo "make migrate     Apply database migrations"
	@echo "make embed-backfill  Index every compiled knowledge base for search (embeds only what changed)"
	@echo "make eval        AI evals: golden questions and Show NoX captures on the demo KBs (live model, a few cents)"
	@echo "make seed-demo   Check the Tidewell estate, seed Jira/Confluence/Notion/Slack, then the org tree + apps (launches pipelines)"
	@echo "make push-demo   Create the Tidewell demo repos on GitHub and push the reference code and branches"
	@echo "make demo-reset  Delete the demo orgs' missions before a rehearsal (asks first; KBs stay)"
	@echo "make test        API tests (no live services)   make test-live  tests that hit real services"
	@echo "make lint        ruff + web typecheck"

install:
	npm install
	cd $(API) && uv sync

infra:
	@if nc -z localhost 5432 2>/dev/null && nc -z localhost 6379 2>/dev/null; then \
	  echo "postgres + redis already running locally"; \
	else docker compose up -d postgres redis; fi

infra-down:
	docker compose down

free-ports:
	@killed=; for port in $(DEV_PORTS); do \
	  pids=$$(lsof -ti tcp:$$port -sTCP:LISTEN 2>/dev/null); \
	  if [ -n "$$pids" ]; then echo "port $$port in use, stopping pid" $$pids; kill $$pids 2>/dev/null; killed=1; fi; \
	done; \
	if pkill -f '[c]elery -A nox_api.workers.tasks worker' 2>/dev/null; then echo "stopped stray celery worker"; killed=1; fi; \
	if [ -n "$$killed" ]; then sleep 1; \
	  for port in $(DEV_PORTS); do pids=$$(lsof -ti tcp:$$port -sTCP:LISTEN 2>/dev/null); [ -z "$$pids" ] || kill -9 $$pids 2>/dev/null; done; \
	fi; true

dev: infra free-ports
	@trap 'kill 0' INT TERM; \
	  ( $(UV) uvicorn nox_api.main:app --reload --port 8000 ) & \
	  ( $(UV) celery -A nox_api.workers.tasks worker -l info -P threads -c 4 2>/dev/null || true ) & \
	  ( npm run dev:web ) & \
	  wait

api:
	$(UV) uvicorn nox_api.main:app --reload --port 8000

web:
	npm run dev:web

worker:
	$(UV) celery -A nox_api.workers.tasks worker -l info -P threads -c 4

beat:
	$(UV) celery -A nox_api.workers.tasks beat -l info

migrate:
	$(UV) alembic upgrade head

embed-backfill:
	$(UV) python -m nox_api.services.search backfill

eval:
	$(UV) python ../../scripts/eval_ask.py
	$(UV) python ../../scripts/eval_media.py

seed-demo:
	$(UV) python ../../scripts/check_estate.py
	$(UV) python -m nox_api.demo.seed_sources
	$(UV) python -m nox_api.demo.seed_org

push-demo:
	$(UV) python ../../scripts/check_estate.py
	$(UV) python -m nox_api.demo.push_repos

demo-reset:
	$(UV) python -m nox_api.demo.reset_missions
	@read -p "Delete them? [y/N] " ok && [ "$$ok" = y ] && $(UV) python -m nox_api.demo.reset_missions --yes || echo "Kept."

test:
	$(UV) pytest
	node --test packages/nox-cli/test/*.test.mjs

test-live:
	$(UV) pytest -m live

lint:
	$(UV) ruff check .
	npm run typecheck:web

typecheck:
	npm run typecheck:web

build:
	npm run build:web

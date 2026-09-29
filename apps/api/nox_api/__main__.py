"""`python -m nox_api` — dev server that honours $PORT (used by preview tooling)."""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run("nox_api.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), reload=True)

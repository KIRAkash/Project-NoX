from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from .auth import authenticate_user, create_access_token, verify_token
from .config import settings

app = FastAPI(title="Mini AuthService", version="1.0.0")

@app.post("/api/v1/auth/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    token = create_access_token(data={"sub": user["username"]})
    return {"access_token": token, "token_type": "bearer"}

@app.get("/api/v1/auth/me")
async def get_current_user(token_data: dict = Depends(verify_token)):
    return {"username": token_data["sub"], "status": "active"}

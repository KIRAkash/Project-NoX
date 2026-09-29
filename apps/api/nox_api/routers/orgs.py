import re
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..core.auth import Actor, Cap, assert_org_visible, require, visible_org_ids
from ..db.database import get_db
from ..db.models import KnowledgeBase, Membership, Org, OrgInterfaceContract, OrgInvite, User
from ..db.schemas import KBCreate, KBResponse, OrgCreate, OrgResponse, OrgTreeNode
from ..workers.dispatcher import dispatch_generation_pipeline

router = APIRouter(prefix="/api/v1/orgs", tags=["Organizations"])

async def _get_org_by_id_or_slug(db: AsyncSession, identifier: str) -> Org | None:
    try:
        val = uuid.UUID(identifier)
        stmt = select(Org).options(selectinload(Org.knowledge_bases)).where((Org.id == val) | (Org.slug == identifier))
    except ValueError:
        stmt = select(Org).options(selectinload(Org.knowledge_bases)).where(Org.slug == identifier)
    result = await db.execute(stmt)
    return result.scalars().first()

async def _visible_org(db: AsyncSession, actor: Actor, identifier: str) -> Org:
    org = await _get_org_by_id_or_slug(db, identifier)
    await assert_org_visible(db, actor.user, org.id if org else None)
    return org


@router.get("", response_model=list[OrgResponse])
async def list_orgs(db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    visible = await visible_org_ids(db, actor.user)
    if not visible:
        return []
    result = await db.execute(select(Org).where(Org.id.in_(visible)).order_by(Org.created_at))
    return result.scalars().all()

@router.post("", response_model=OrgResponse)
async def create_org(org: OrgCreate, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.MANAGE_ORGS))):
    if org.parent_org_id:
        await assert_org_visible(db, actor.user, org.parent_org_id)
    existing = await db.execute(select(Org).where(Org.slug == org.slug))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Organization slug already exists")
    new_org = Org(**org.model_dump())
    db.add(new_org)
    await db.flush()
    if not org.parent_org_id:  # sub-orgs inherit visibility from their parent
        db.add(Membership(user_id=actor.user.id, org_id=new_org.id))
    await db.commit()
    await db.refresh(new_org)
    return new_org

@router.get("/{org_id}", response_model=OrgResponse)
async def get_org(org_id: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    return await _visible_org(db, actor, org_id)

@router.get("/{org_id}/tree", response_model=OrgTreeNode)
async def get_org_tree(org_id: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    root_org = await _visible_org(db, actor, org_id)

    async def fetch_tree(current_org_id: UUID):
        result = await db.execute(
            select(Org).options(selectinload(Org.knowledge_bases)).where(Org.id == current_org_id)
        )
        current = result.scalars().first()
        if not current:
            return None
        kbs = []
        if current.knowledge_bases:
            kbs = [KBResponse.model_validate(k) for k in current.knowledge_bases]
            
        result_children = await db.execute(select(Org).where(Org.parent_org_id == current_org_id))
        children = result_children.scalars().all()
        child_nodes = []
        for child in children:
            c = await fetch_tree(child.id)
            if c:
                child_nodes.append(c)
                
        node = OrgTreeNode(
            id=current.id,
            name=current.name,
            slug=current.slug,
            github_org=current.github_org,
            parent_org_id=current.parent_org_id,
            created_at=current.created_at,
            children=child_nodes,
            knowledge_bases=kbs,
            apps=kbs,
        )
        return node
        
    tree = await fetch_tree(root_org.id)
    return tree

@router.post("/{org_id}/apps", response_model=KBResponse)
async def create_app_kb(org_id: str, kb: KBCreate, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.ONBOARD_APP))):
    org = await _visible_org(db, actor, org_id)
        
    new_kb = KnowledgeBase(
        org_id=org.id,
        app_name=kb.app_name,
        source_urls=[s.model_dump() for s in kb.source_urls]
    )
    db.add(new_kb)
    await db.commit()
    await db.refresh(new_kb)
    
    dispatch_generation_pipeline(str(new_kb.id))
    
    return new_kb


# ── Members ──────────────────────────────────────────────────────────────────


class InviteRequest(BaseModel):
    email: EmailStr


@router.get("/{org_id}/members")
async def list_members(org_id: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    org = await _visible_org(db, actor, org_id)
    rows = (
        await db.execute(select(User).join(Membership, Membership.user_id == User.id).where(Membership.org_id == org.id).order_by(User.name))
    ).scalars().all()
    invites = (await db.execute(select(OrgInvite).where(OrgInvite.org_id == org.id).order_by(OrgInvite.created_at))).scalars().all()
    return {
        "members": [{"id": str(u.id), "name": u.name, "email": u.email, "photoUrl": u.photo_url} for u in rows],
        "invites": [{"id": str(i.id), "email": i.email, "createdAt": i.created_at.isoformat()} for i in invites],
    }


@router.post("/{org_id}/members")
async def invite_member(org_id: str, body: InviteRequest, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.INVITE_MEMBERS))):
    """Add someone by email: a member right away if they've signed in before, otherwise a pending invite."""
    org = await _visible_org(db, actor, org_id)
    email = body.email.lower()
    user = (await db.execute(select(User).where(User.email == email))).scalars().first()
    if user:
        exists = (await db.execute(select(Membership).where(Membership.user_id == user.id, Membership.org_id == org.id))).scalars().first()
        if not exists:
            db.add(Membership(user_id=user.id, org_id=org.id, invited_by=actor.user.id))
        await db.commit()
        return {"status": "member", "email": email}
    exists = (await db.execute(select(OrgInvite).where(OrgInvite.org_id == org.id, OrgInvite.email == email))).scalars().first()
    if not exists:
        db.add(OrgInvite(org_id=org.id, email=email, invited_by=actor.user.id))
        await db.commit()
    return {"status": "invited", "email": email}


@router.delete("/{org_id}/members/{user_id}")
async def remove_member(org_id: str, user_id: UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.INVITE_MEMBERS))):
    org = await _visible_org(db, actor, org_id)
    m = (await db.execute(select(Membership).where(Membership.user_id == user_id, Membership.org_id == org.id))).scalars().first()
    if m:
        await db.delete(m)
        await db.commit()
    return {"status": "removed"}


# ── Contract map ─────────────────────────────────────────────────────────────

_CROSS_KB_LINK = re.compile(r"\[\[kb:([a-z0-9][a-z0-9-]*)/")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


@router.get("/{org_id}/map")
async def org_map(org_id: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    """Apps in this org and everything beneath it, their exported contracts, and the cross-app links
    their compiled KB pages make to one another."""
    from ..services.local_storage import load_checkpoint_json

    root = await _visible_org(db, actor, org_id)
    orgs = (await db.execute(select(Org))).scalars().all()
    children: dict[UUID | None, list[Org]] = {}
    for o in orgs:
        children.setdefault(o.parent_org_id, []).append(o)
    subtree, stack = [], [root]
    while stack:
        o = stack.pop()
        subtree.append(o)
        stack.extend(children.get(o.id, []))
    org_ids = [o.id for o in subtree]

    kbs = (await db.execute(select(KnowledgeBase).where(KnowledgeBase.org_id.in_(org_ids)))).scalars().all()
    contracts = (
        await db.execute(select(OrgInterfaceContract).where(OrgInterfaceContract.kb_id.in_([k.id for k in kbs])))
    ).scalars().all() if kbs else []

    by_slug = {_slug(k.app_name): k for k in kbs}
    links: dict[tuple[str, str], int] = {}
    for kb in kbs:
        files = load_checkpoint_json(str(kb.id), "compiled_files.json") or {}
        for content in files.values():
            for target in _CROSS_KB_LINK.findall(content or ""):
                other = by_slug.get(target) or next((k for s, k in by_slug.items() if target.endswith(s)), None)
                if other and other.id != kb.id:
                    key = (str(kb.id), str(other.id))
                    links[key] = links.get(key, 0) + 1

    return {
        "orgs": [{"id": str(o.id), "name": o.name, "parentOrgId": str(o.parent_org_id) if o.parent_org_id else None} for o in subtree],
        "apps": [{"id": str(k.id), "name": k.app_name, "orgId": str(k.org_id), "status": k.status.value} for k in kbs],
        "contracts": [
            {"appId": str(c.kb_id), "type": c.interface_type.value, "identifier": c.identifier, "page": c.page_path, "description": c.description}
            for c in contracts
        ],
        "links": [{"from": a, "to": b, "count": n} for (a, b), n in sorted(links.items(), key=lambda x: -x[1])],
    }

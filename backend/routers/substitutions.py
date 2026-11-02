"""
Shift Substitutions Router — Factory Staff Shift Coverage & Handover Management.
Allows supervisors to assign substitute colleagues to cover a person's scheduled shift & workstation.
"""

from datetime import datetime, timezone
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import get_user_scope, require_any_permission
from backend.database import get_db
from backend.models import CameraZone, Person, ShiftSubstitution, User
from backend.schemas import (
    ShiftSubstitutionConflictInfo,
    ShiftSubstitutionCreate,
    ShiftSubstitutionResponse,
)
from backend.stream_processor import stream_processor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/substitutions", tags=["substitutions"])


def _dates_overlap(start1: str, end1: str, start2: str, end2: str) -> bool:
    """Check if two date ranges [start1, end1] and [start2, end2] (YYYY-MM-DD) overlap."""
    s1 = (start1 or "").strip()
    e1 = (end1 or s1).strip()
    s2 = (start2 or "").strip()
    e2 = (end2 or s2).strip()
    if not s1 or not s2:
        return False
    return max(s1, s2) <= min(e1, e2)


async def check_substitution_conflict(
    db: AsyncSession,
    original_person_id: int,
    substitute_person_id: int,
    start_date: str,
    end_date: str,
    exclude_substitution_id: Optional[int] = None,
) -> tuple[bool, Optional[str], Optional[str], dict]:
    """
    Check if a substitution creates a schedule conflict for the substitute person:
    - Same person
    - Substitute on leave during dates
    - Substitute already assigned as substitute for someone else
    - Substitute has their own assigned workstation/shift
    Returns (has_conflict, detail_message, conflict_type, conflict_meta).
    """
    if original_person_id == substitute_person_id:
        return True, "فرد نمی‌تواند جانشین خودش باشد.", "self_substitution", {}

    substitute = await db.get(Person, substitute_person_id)
    if not substitute:
        return False, None, None, {}

    sub_name = substitute.name

    # 1. Check if substitute has active leaves
    leaves = getattr(substitute, "leaves", None) or []
    for l in leaves:
        if isinstance(l, dict):
            l_start = str(l.get("start_date", "")).strip()
            l_end = str(l.get("end_date", "")).strip() or l_start
            if _dates_overlap(start_date, end_date, l_start, l_end):
                raw_type = str(l.get("leave_type", "مرخصی")).strip()
                l_type = "مرخصی روزانه" if raw_type == "daily_leave" else ("آف شیفت" if raw_type == "off_duty" else ("استعلاجی" if raw_type == "sick" else raw_type))
                return (
                    True,
                    f"فرد جانشین ({sub_name}) در بازه {l_start} تا {l_end} در وضعیت '{l_type}' ثبت شده است.",
                    "leave",
                    {
                        "substitute_name": sub_name,
                        "start_date": l_start,
                        "end_date": l_end,
                        "leave_type": l_type,
                    },
                )

    # 2. Check if substitute is already substituting for another colleague
    subst_q = select(ShiftSubstitution).where(
        ShiftSubstitution.substitute_person_id == substitute_person_id
    )
    if exclude_substitution_id:
        subst_q = subst_q.where(ShiftSubstitution.id != exclude_substitution_id)
    existing_substs = (await db.execute(subst_q)).scalars().all()

    for es in existing_substs:
        if _dates_overlap(start_date, end_date, es.start_date, es.end_date):
            orig_p = await db.get(Person, es.original_person_id)
            orig_name = orig_p.name if orig_p else f"#{es.original_person_id}"
            return (
                True,
                f"فرد جانشین ({sub_name}) قبلاً در بازه {es.start_date} تا {es.end_date} برای '{orig_name}' به عنوان جانشین ثبت شده است.",
                "already_substituting",
                {
                    "substitute_name": sub_name,
                    "original_name": orig_name,
                    "start_date": es.start_date,
                    "end_date": es.end_date,
                },
            )

    # 3. Check if substitute has their own scheduled workstation/shift
    zones_res = await db.execute(
        select(CameraZone).where(CameraZone.is_active == True)  # noqa: E712
    )
    active_zones = zones_res.scalars().all()
    sub_own_zones = []
    for z in active_zones:
        assigned = [int(px) for px in (z.assigned_person_ids or []) if str(px).isdigit()]
        if substitute_person_id in assigned:
            sub_own_zones.append(z.name)
        # Check sub-shifts
        for s in (z.shifts or []):
            s_pids = [int(px) for px in (s.get("assigned_person_ids") or []) if str(px).isdigit()]
            if substitute_person_id in s_pids and z.name not in sub_own_zones:
                sub_own_zones.append(f"{z.name} ({s.get('name', 'شیفت')})")

    if sub_own_zones:
        z_names = "، ".join(sub_own_zones)
        return (
            True,
            f"فرد جانشین ({sub_name}) در این بازه، خود دارای شیفت کاری در ایستگاه '{z_names}' است.",
            "own_shift",
            {
                "substitute_name": sub_name,
                "station_names": z_names,
            },
        )

    return False, None, None, {}


async def _enrich_substitution(sub: ShiftSubstitution, db: AsyncSession) -> ShiftSubstitutionResponse:
    """Populate person names, sections, zone name, and conflict details."""
    orig_person = await db.get(Person, sub.original_person_id)
    sub_person = await db.get(Person, sub.substitute_person_id)
    zone_obj = await db.get(CameraZone, sub.zone_id) if sub.zone_id else None

    has_conflict, conflict_detail, _, _ = await check_substitution_conflict(
        db,
        sub.original_person_id,
        sub.substitute_person_id,
        sub.start_date,
        sub.end_date,
        exclude_substitution_id=sub.id,
    )

    return ShiftSubstitutionResponse(
        id=sub.id,
        original_person_id=sub.original_person_id,
        original_person_name=orig_person.name if orig_person else f"#{sub.original_person_id}",
        original_person_section=orig_person.section if orig_person else None,
        substitute_person_id=sub.substitute_person_id,
        substitute_person_name=sub_person.name if sub_person else f"#{sub.substitute_person_id}",
        substitute_person_section=sub_person.section if sub_person else None,
        start_date=sub.start_date,
        end_date=sub.end_date,
        zone_id=sub.zone_id,
        zone_name=zone_obj.name if zone_obj else None,
        leave_id=sub.leave_id,
        note=sub.note or "",
        created_by=sub.created_by or "system",
        created_at=sub.created_at,
        updated_at=sub.updated_at,
        has_conflict=has_conflict,
        conflict_detail=conflict_detail,
    )


@router.get("", response_model=list[ShiftSubstitutionResponse])
async def list_substitutions(
    person_id: Optional[int] = Query(None, description="Filter by original or substitute person ID"),
    active_only: bool = Query(False, description="Filter only active substitutions for today"),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_any_permission("duty:view", "persons:view")),
):
    """List shift substitutions with supervisor privacy scoping."""
    scope = await get_user_scope(_user, db)

    query = select(ShiftSubstitution).order_by(ShiftSubstitution.start_date.desc(), ShiftSubstitution.id.desc())

    if person_id:
        query = query.where(
            or_(
                ShiftSubstitution.original_person_id == person_id,
                ShiftSubstitution.substitute_person_id == person_id,
            )
        )

    if active_only:
        today_str = datetime.now().strftime("%Y-%m-%d")
        query = query.where(
            ShiftSubstitution.start_date <= today_str,
            ShiftSubstitution.end_date >= today_str,
        )

    res = await db.execute(query)
    subs = res.scalars().all()

    # Apply supervisor scoping: must have access to either original or substitute person
    if scope.is_scoped and scope.person_ids is not None:
        subs = [
            s for s in subs
            if s.original_person_id in scope.person_ids or s.substitute_person_id in scope.person_ids
        ]

    enriched = [await _enrich_substitution(s, db) for s in subs]
    return enriched


@router.post("/check-conflict", response_model=ShiftSubstitutionConflictInfo)
async def check_conflict_endpoint(
    data: ShiftSubstitutionCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_any_permission("duty:view", "persons:view")),
):
    """Check whether a planned substitution causes a schedule conflict for the substitute."""
    has_conflict, detail, conflict_type, meta = await check_substitution_conflict(
        db,
        data.original_person_id,
        data.substitute_person_id,
        data.start_date.strip(),
        data.end_date.strip(),
    )
    return ShiftSubstitutionConflictInfo(
        has_conflict=has_conflict,
        conflict_type=conflict_type,
        detail=detail,
        substitute_name=meta.get("substitute_name"),
        original_name=meta.get("original_name"),
        start_date=meta.get("start_date"),
        end_date=meta.get("end_date"),
        station_names=meta.get("station_names"),
        leave_type=meta.get("leave_type"),
    )


@router.post("", response_model=ShiftSubstitutionResponse, status_code=status.HTTP_201_CREATED)
async def create_substitution(
    data: ShiftSubstitutionCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_any_permission("duty:manage", "persons:edit")),
):
    """
    Create a shift substitution.
    Scoped supervisors can only assign substitutions between personnel within their scope.
    """
    scope = await get_user_scope(_user, db)

    if data.original_person_id == data.substitute_person_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="فرد نمی‌تواند به عنوان جانشین خودش تعیین گردد.",
        )

    s_date = data.start_date.strip()
    e_date = data.end_date.strip() or s_date
    if s_date > e_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.",
        )

    # Scoping check
    if not scope.can_access_person(data.original_person_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="دسترسی به فرد اصلی برای شما مجاز نیست.",
        )
    if not scope.can_access_person(data.substitute_person_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="دسترسی به فرد جانشین برای شما مجاز نیست.",
        )

    orig_p = await db.get(Person, data.original_person_id)
    if not orig_p:
        raise HTTPException(status_code=404, detail="Original person not found")

    sub_p = await db.get(Person, data.substitute_person_id)
    if not sub_p:
        raise HTTPException(status_code=404, detail="Substitute person not found")

    # If zone_id not specified, auto-resolve original person's assigned zone
    zone_id = data.zone_id
    if not zone_id:
        zones_res = await db.execute(select(CameraZone).where(CameraZone.is_active == True))  # noqa: E712
        for z in zones_res.scalars().all():
            assigned = [int(px) for px in (z.assigned_person_ids or []) if str(px).isdigit()]
            if data.original_person_id in assigned:
                zone_id = z.id
                break

    creator_name = getattr(_user, "full_name", None) or getattr(_user, "username", "supervisor")

    new_sub = ShiftSubstitution(
        original_person_id=data.original_person_id,
        substitute_person_id=data.substitute_person_id,
        start_date=s_date,
        end_date=e_date,
        zone_id=zone_id,
        note=(data.note or "").strip(),
        created_by=creator_name,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(new_sub)
    await db.commit()
    await db.refresh(new_sub)

    await stream_processor.refresh_zones()

    return await _enrich_substitution(new_sub, db)


@router.delete("/{substitution_id}", response_model=dict)
async def delete_substitution(
    substitution_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_any_permission("duty:manage", "persons:edit")),
):
    """Cancel / remove a shift substitution."""
    scope = await get_user_scope(_user, db)

    sub = await db.get(ShiftSubstitution, substitution_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Shift substitution not found")

    if not scope.can_access_person(sub.original_person_id) and not scope.can_access_person(sub.substitute_person_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="شما دسترسی لازم برای لغو این جانشینی را ندارید.",
        )

    # If this substitution was linked to a leave record, clear the link or keep leave intact
    # We delete the substitution record
    await db.delete(sub)
    await db.commit()

    await stream_processor.refresh_zones()

    return {"detail": "Shift substitution cancelled successfully", "id": substitution_id}

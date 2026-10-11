"""Account status state machine shared by drivers and riders.

    onboarding --submit--> pending --approve--> approved --suspend--> suspended
                              |                    |  ^                   |
                              +--reject--> rejected |  +----reinstate-----+
                                             |      +--ban--> banned
                                             +--submit--> pending

Banned accounts can only be reinstated by a super-admin.
"""

from __future__ import annotations

from enum import Enum

from .enums import AccountStatus as S
from .enums import Role


class StatusAction(str, Enum):
    SUBMIT = "submit"  # performed by the account owner
    APPROVE = "approve"
    REJECT = "reject"
    SUSPEND = "suspend"
    BAN = "ban"
    REINSTATE = "reinstate"


TRANSITIONS: dict[tuple[S, StatusAction], S] = {
    (S.ONBOARDING, StatusAction.SUBMIT): S.PENDING,
    (S.REJECTED, StatusAction.SUBMIT): S.PENDING,
    (S.PENDING, StatusAction.APPROVE): S.APPROVED,
    (S.PENDING, StatusAction.REJECT): S.REJECTED,
    (S.REJECTED, StatusAction.APPROVE): S.APPROVED,
    (S.APPROVED, StatusAction.SUSPEND): S.SUSPENDED,
    (S.PENDING, StatusAction.SUSPEND): S.SUSPENDED,
    (S.SUSPENDED, StatusAction.REINSTATE): S.APPROVED,
    (S.PENDING, StatusAction.BAN): S.BANNED,
    (S.REJECTED, StatusAction.BAN): S.BANNED,
    (S.APPROVED, StatusAction.BAN): S.BANNED,
    (S.SUSPENDED, StatusAction.BAN): S.BANNED,
    (S.BANNED, StatusAction.REINSTATE): S.APPROVED,
}

# Actions that require a written reason (shown to the user and kept in the audit log).
REASON_REQUIRED = {StatusAction.REJECT, StatusAction.SUSPEND, StatusAction.BAN}

SUPER_ADMIN_ONLY: set[tuple[S, StatusAction]] = {(S.BANNED, StatusAction.REINSTATE)}


class TransitionError(ValueError):
    pass


def next_status(
    current: S | str,
    action: StatusAction | str,
    actor_role: Role | str,
    reason: str | None = None,
) -> S:
    current, action, actor_role = S(current), StatusAction(action), Role(actor_role)

    if action is StatusAction.SUBMIT:
        if actor_role.is_staff:
            raise TransitionError("only the account owner can submit an application")
    elif not actor_role.is_staff:
        raise TransitionError("only staff can review accounts")

    target = TRANSITIONS.get((current, action))
    if target is None:
        raise TransitionError(f"cannot {action.value} an account that is {current.value}")
    if (current, action) in SUPER_ADMIN_ONLY and actor_role is not Role.SUPER_ADMIN:
        raise TransitionError("only a super-admin can reinstate a banned account")
    if action in REASON_REQUIRED and not (reason and reason.strip()):
        raise TransitionError(f"a reason is required to {action.value} an account")
    return target


def allowed_actions(current: S | str, actor_role: Role | str) -> list[StatusAction]:
    current, actor_role = S(current), Role(actor_role)
    out = []
    for (frm, action), _ in TRANSITIONS.items():
        if frm is not current or action is StatusAction.SUBMIT:
            continue
        if (frm, action) in SUPER_ADMIN_ONLY and actor_role is not Role.SUPER_ADMIN:
            continue
        out.append(action)
    return out


def can_operate(status: S | str) -> bool:
    """Approved accounts are the only ones that may go online / request rides."""
    return S(status) is S.APPROVED

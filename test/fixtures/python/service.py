"""User account service — business logic for signup and billing."""

import hashlib
from dataclasses import dataclass


@dataclass
class Account:
    """A user account record."""

    id: int
    email: str
    plan: str = "free"


class AccountService:
    """Coordinates account creation, plan changes, and password hashing."""

    def __init__(self, db):
        self.db = db
        self._cache = {}

    def create_account(self, email, password):
        """Create a new account, hashing the password before storage."""
        hashed = self._hash_password(password)
        account = Account(id=self.db.next_id(), email=email)
        self.db.insert(account, hashed)
        return account

    def _hash_password(self, password):
        salt = "static-salt-for-example-only"
        return hashlib.sha256((password + salt).encode()).hexdigest()

    @staticmethod
    def validate_email(email):
        """Return True if the email looks well-formed."""
        return "@" in email and "." in email.split("@")[-1]

    @property
    def account_count(self):
        return len(self._cache)


def upgrade_plan(account, plan):
    """Upgrade an account to a new billing plan."""
    if plan not in ("free", "pro", "enterprise"):
        raise ValueError(f"unknown plan: {plan}")
    account.plan = plan
    return account

from django.contrib.auth.base_user import AbstractBaseUser
from django.db import models
from django.db.models.functions import Lower
from apps.accounts.managers import UserManager
from django.contrib.auth.hashers import check_password
from django.conf import settings
from django.utils.crypto import salted_hmac

class User(AbstractBaseUser):
    class AccountType(models.TextChoices):
        CUSTOMER = "CUSTOMER", "Customer"
        DOCTOR = "DOCTOR", "Doctor"
        OWNER = "OWNER", "Owner"

    # Credentials belong to the matching customer/doctor/owner profile.
    password = None
    last_login = None

    id = models.CharField(
        primary_key=True,
        max_length=23,
        editable=False,
    )

    account_type = models.CharField(
        max_length=8,
        choices=AccountType.choices,
    )

    first_name = models.CharField(max_length=32)
    last_name = models.CharField(max_length=32)

    phone_number = models.CharField(max_length=16)
    email = models.EmailField(max_length=128)

    phone_country_code = models.CharField(
        max_length=2,
        default="EG",
    )

    phone_verified_at = models.DateTimeField(null=True, blank=True)

    is_disabled = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "id"

    class Meta:
        db_table = "users"

        constraints = [
            models.UniqueConstraint(
                fields=["account_type", "phone_number"],
                name="users_account_type_phone_unique",
            ),
            models.UniqueConstraint(
                "account_type",
                Lower("email"),
                name="users_account_type_email_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    account_type__in=["CUSTOMER", "DOCTOR", "OWNER"],
                ),
                name="users_account_type_valid",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(is_staff=False)
                    | models.Q(account_type="OWNER")
                ),
                name="users_staff_requires_owner",
            ),
        ]

    @property
    def credential_profile(self):
        profile_name = {
            self.AccountType.CUSTOMER: "customer",
            self.AccountType.DOCTOR: "doctor",
            self.AccountType.OWNER: "owner",
        }[self.account_type]

        return getattr(self, profile_name)

    @property
    def credential_hash(self):
        profile = self.credential_profile

        if self.account_type == self.AccountType.CUSTOMER:
            return profile.pin_hash

        return profile.password_hash

    def check_password(self, raw_password):
        return check_password(raw_password, self.credential_hash) # This calls the Django function, not the model's method (Not recursive).

    def set_password(self, raw_password):
        raise NotImplementedError(
            "Change credentials through the account service "
            "so hashing and session invalidation happen together."
        )

    def _get_session_auth_hash(self, secret=None):
        credential_state = (
            f"{self.credential_hash}:"
            f"{self.credential_profile.credential_changed_at.isoformat()}"
        )

        return salted_hmac(
            key_salt="have.accounts.User.session",
            value=credential_state,
            secret=secret,
            algorithm="sha256",
        ).hexdigest()

    def get_session_auth_fallback_hash(self):
        for secret in settings.SECRET_KEY_FALLBACKS:
            yield self._get_session_auth_hash(secret=secret)

    @property
    def is_active(self):
        return not self.is_disabled

    def has_perm(self, perm, obj=None):
        if obj is not None:
            return False

        return (
            self.is_active
            and self.is_staff
            and self.account_type == self.AccountType.OWNER
            and perm in {
                "accounts.view_doctor",
                "accounts.change_doctor",
            }
        )

    def has_module_perms(self, app_label):
        return (
            app_label == "accounts"
            and self.has_perm("accounts.view_doctor")
        )

    def get_full_name(self):
        return f"{self.first_name} {self.last_name}"

    def get_short_name(self):
        return self.first_name

    def __str__(self):
        return self.id
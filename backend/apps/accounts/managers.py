from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):
    def create_user(self, *args, **kwargs):
        raise NotImplementedError(
            "Create accounts through the account service, "
            "which creates the user and its matching credential profile."
        )

    def create_superuser(self, *args, **kwargs):
        raise NotImplementedError(
            "Owner accounts must be provisioned through "
            "the dedicated owner provisioning command."
        )
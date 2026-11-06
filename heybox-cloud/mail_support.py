import os


import re


import smtplib


import ssl


from dataclasses import dataclass


from datetime import datetime, timedelta, timezone


from email.headerregistry import Address


from email.message import EmailMessage


from email.utils import format_datetime, make_msgid


BEIJING = timezone(timedelta(hours=8))


class TestConfigurationError(Exception):
    pass


@dataclass(frozen=True, repr=False)
class MailConfig:
    user: str
    password: str
    recipient: str


def required(environ, name):
    value = str(environ.get(name, "")).strip()
    if not value:
        raise TestConfigurationError("SECRET_MISSING_" + name)
    return value


def read_config(environ):
    user = required(environ, "SMTP_USER")
    password = required(environ, "SMTP_PASS")
    recipient = required(environ, "MAIL_TO")
    address = r"[A-Za-z0-9][A-Za-z0-9._+\-]{0,127}@qq\.com"
    if not re.fullmatch(address, user, flags=re.IGNORECASE):
        raise TestConfigurationError("SMTP_USER_FORMAT_INVALID")
    if not re.fullmatch(address, recipient, flags=re.IGNORECASE):
        raise TestConfigurationError("MAIL_TO_FORMAT_INVALID")
    if user.casefold() != recipient.casefold():
        raise TestConfigurationError("SELF_MAIL_ADDRESSES_DIFFER")
    if not re.fullmatch(r"[!-~]{8,256}", password):
        raise TestConfigurationError("SMTP_PASS_FORMAT_INVALID")
    return MailConfig(user, password, recipient)


def send_notice(config, message, smtp_factory=None):
    factory = smtp_factory or smtplib.SMTP_SSL
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    with factory("smtp.qq.com", 465, timeout=20, context=context) as smtp:
        smtp.set_debuglevel(0)
        smtp.login(config.user, config.password)
        refused = smtp.send_message(message, from_addr=config.user, to_addrs=[config.recipient])
        if refused:
            raise TestConfigurationError("MAIL_RECIPIENT_REJECTED")


def safe_error(error):
    if isinstance(error, TestConfigurationError):
        known = {"SECRET_MISSING_SMTP_USER", "SECRET_MISSING_SMTP_PASS", "SECRET_MISSING_MAIL_TO",
                 "SMTP_USER_FORMAT_INVALID", "MAIL_TO_FORMAT_INVALID", "SELF_MAIL_ADDRESSES_DIFFER",
                 "SMTP_PASS_FORMAT_INVALID", "MANUAL_EVENT_REQUIRED", "REPOSITORY_MISMATCH",
                 "MAIN_BRANCH_REQUIRED", "SCENARIO_INVALID", "RUN_CONTEXT_INVALID", "MAIL_RECIPIENT_REJECTED"}
        return str(error) if str(error) in known else "MAIL_TEST_CONFIG_INVALID"
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return "MAIL_AUTH_REJECTED"
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "MAIL_RECIPIENT_REJECTED"
    if isinstance(error, ssl.SSLCertVerificationError):
        return "MAIL_TLS_VERIFY_FAILED"
    if isinstance(error, (TimeoutError, smtplib.SMTPServerDisconnected)):
        return "MAIL_DELIVERY_NOT_CONFIRMED"
    if isinstance(error, smtplib.SMTPResponseException):
        code = error.smtp_code
        return f"MAIL_SMTP_REJECTED_{code}" if isinstance(code, int) and 100 <= code <= 599 else "MAIL_SMTP_REJECTED"
    if isinstance(error, OSError):
        return "MAIL_CONNECTION_FAILED"
    return "MAIL_TEST_UNEXPECTED_ERROR"


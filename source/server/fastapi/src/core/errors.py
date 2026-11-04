"""The failure table and the one application error type.

Every error a client sees comes from ``FAILURES``, whoever raised it. A failure
answers with an HTTP status and a fixed message; the internal code stays on
:class:`ApiError` for logs and tests and is never serialised. No two entries
share a message, so the message alone tells two failures with one status apart.
"""

import re

#: Internal code to (HTTP status, message template). ``{name}`` is filled with a sanitised name.
FAILURES: dict[str, tuple[int, str]] = {
    "invalid_request": (400, "invalid request"),
    "invalid_field": (400, "invalid value for '{name}'"),
    "unauthorized": (401, "authentication required"),
    "forbidden": (403, "not allowed"),
    "not_found": (404, "not found"),
    "method_not_allowed": (405, "method not allowed"),
    "conflict": (409, "the request conflicts with the current state"),
    "busy": (409, "the resource is busy"),
    "payload_too_large": (413, "the request body is too large"),
    "unsupported_media_type": (415, "unsupported media type"),
    "unprocessable": (422, "the request cannot be processed"),
    "too_many_requests": (429, "too many requests"),
    "unavailable": (503, "service unavailable"),
    "internal": (500, "internal error"),
}

#: The entry that answers a framework-raised error of a given status.
_STATUS_CODES: dict[int, str] = {
    400: "invalid_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "unprocessable",
    429: "too_many_requests",
    500: "internal",
    503: "unavailable",
}

#: A name that may be echoed in a message; anything else is shown as ``?``.
_NAME_RE = re.compile(r"[A-Za-z0-9_.-]{1,40}")


def safe_name(name: str) -> str:
    """Restrict a caller-supplied name to a safe token.

    Args:
        name: A parameter or field name from a closed set the server defines.

    Returns:
        The name when it is 1 to 40 characters of ``A-Za-z0-9_.-``, else ``?``.
    """
    return name if _NAME_RE.fullmatch(name) else "?"


def message_for(code: str, name: str | None = None) -> str:
    """Build the fixed message of a failure code.

    Args:
        code: A key of ``FAILURES``.
        name: The parameter or field the template names, if it has a ``{name}``.

    Returns:
        The message text.
    """
    template = FAILURES[code][1]
    return template.replace("{name}", safe_name(name)) if name is not None else template


def failure_for_status(status: int) -> tuple[int, str]:
    """Find the table entry that answers a status raised outside the services.

    Used for errors a framework or a guard raised: the client sees the table's
    message, never the framework's own text. A status with no entry answers the
    entry for 400 (4xx) or ``internal`` (anything else).

    Args:
        status: The HTTP status of the raised error.

    Returns:
        The status to answer with and the fixed message.
    """
    code = _STATUS_CODES.get(status) or ("invalid_request" if 400 <= status < 500 else "internal")
    return FAILURES[code]


class ApiError(Exception):
    """An error the client may see; its code never leaves the process.

    Services raise it with a table code and never with free text.

    Attributes:
        code: The internal code (never serialised).
        status: The HTTP status of the code.
        message: The fixed text the answer carries.
    """

    def __init__(self, code: str, name: str | None = None) -> None:
        """Build the error.

        Args:
            code: A key of ``FAILURES``.
            name: Fills ``{name}`` in a templated message.
        """
        self.code = code
        self.status = FAILURES[code][0]
        self.message = message_for(code, name)
        super().__init__(self.message)

"""Deliberate test boundary for the future device-agent printer integration."""


def print_receipt_stub(order):
    """Record the selection, never pretend that hardware produced a receipt.

    Called only while creating the order's one immutable receipt. There is no
    print job, filesystem document, external call, or real printer in this increment.
    """
    return "SIMULATED_REQUESTED" if order.print_requested else "GO_GREEN"

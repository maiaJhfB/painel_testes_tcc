"""Tarifa fictícia da demo; não é uma política de preços definida pelo TCC."""
from decimal import Decimal, ROUND_HALF_UP
import math

PRICING_VERSION = "demo-distance-time-v1"
BASE_CENTS = 450
PER_KM_CENTS = 200
PER_MINUTE_CENTS = 30
MINIMUM_CENTS = 800


def cents(value):
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def estimate_fare(route):
    distance = route["distanceMeters"]
    duration = route["durationSeconds"]
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool)
               and math.isfinite(value) and value > 0 for value in (distance, duration)):
        raise ValueError("invalid route metrics")
    distance_cents = cents(Decimal(str(distance)) * PER_KM_CENTS / 1000)
    time_cents = cents(Decimal(str(duration)) * PER_MINUTE_CENTS / 60)
    subtotal = BASE_CENTS + distance_cents + time_cents
    return {
        "pricingVersion": PRICING_VERSION,
        "currency": "BRL",
        "simulated": True,
        "origin": "Ponto de embarque",
        "destination": "Destino da corrida",
        "distanceMeters": distance,
        "durationSeconds": duration,
        "routeSource": route["source"],
        "baseCents": BASE_CENTS,
        "perKmCents": PER_KM_CENTS,
        "perMinuteCents": PER_MINUTE_CENTS,
        "distanceCents": distance_cents,
        "timeCents": time_cents,
        "minimumCents": MINIMUM_CENTS,
        "minimumAdjustmentCents": max(0, MINIMUM_CENTS - subtotal),
        "totalCents": max(MINIMUM_CENTS, subtotal),
    }

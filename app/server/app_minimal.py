# Minimal BLE test - just advertise and hold connection
# Upload this as app.py to test if BLE works without any app logic

import sys
sys.path.append("")

import asyncio
import aioble
import bluetooth

SERVICE_UUID = bluetooth.UUID("D191D191-F070-51DE-C0DE-B1EA550C1A7E")
_ADV_INTERVAL_US = 250_000

service = aioble.Service(SERVICE_UUID)
aioble.register_services(service)

async def connection_task():
    while True:
        async with await aioble.advertise(
            _ADV_INTERVAL_US,
            name="digimini_test",
            services=[SERVICE_UUID],
        ) as connection:
            await connection.disconnected(timeout_ms=None)

asyncio.run(connection_task())

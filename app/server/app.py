import sys

# ruff: noqa: E402
sys.path.append("")

from micropython import const

import asyncio
import aioble
import bluetooth

import random
import struct

from primitives.broker import broker

# Custom UUIDs for our service
SERVICE_UUID = bluetooth.UUID("D191D191-F070-51DE-C0DE-B1EA550C1A7E")
CLIENT2US_UUID = bluetooth.UUID("D191D191-F070-FEED-DA7A-B1EA550C1A7E")
US2CLIENT_UUID = bluetooth.UUID("D191D191-F070-ACCE-55E5-B1EA550C1A7E")

# org.bluetooth.service.environmental_sensing
_ENV_SENSE_UUID = bluetooth.UUID(0x181A)
# org.bluetooth.characteristic.temperature
_ENV_SENSE_TEMP_UUID = bluetooth.UUID(0x2A6E)
# org.bluetooth.characteristic.gap.appearance.xml
_ADV_APPEARANCE_GENERIC_THERMOMETER = const(768)

# How frequently to send advertising beacons.
_ADV_INTERVAL_US = 250_000


# Register GATT server.
service = aioble.Service(SERVICE_UUID)
client2us_characteristic = aioble.Characteristic(
    service, CLIENT2US_UUID, write=True, capture=True
)
us2client_characteristic = aioble.Characteristic(
    service, US2CLIENT_UUID, read=True, notify=True
)
aioble.register_services(service)


# listen for transmissions of data from them to us
async def client2us_task():
    print(client2us_characteristic, dir(client2us_characteristic))
    while True:
        try:
            res = await client2us_characteristic.written()
            if res:
                print(f"Received {res}")
        except asyncio.CancelledError:
            # Catch the CancelledError
            print("Wait4Write task cancelled")
        except Exception as e:
            print("Error in Wait4write_task:", e)
        finally:
            # Ensure the loop continues to the next iteration
            await asyncio.sleep_ms(500)
            print("loop")

async def us2client_handle_connection_message(channel, value):
    print("u2c_c_m", value)

# send data back to client
async def us2client_task():
    broker.subscribe("connection", us2client_handle_connection_message)
    while True:
        us2client_characteristic.write("hello", send_update=True)
        await asyncio.sleep_ms(1000)


# Serially wait for connections. Don't advertise while a central is
# connected.
async def connection_task():
    while True:
        async with await aioble.advertise(
            _ADV_INTERVAL_US,
            name="digimini",
            services=[SERVICE_UUID],
        ) as connection:
            print("Connection from", connection.device)
            broker.publish("connection", "connected")
            await connection.disconnected(timeout_ms=None)
            print("Disconnected from", connection.device)
            broker.publish("connection", "disconnected")



# Run all tasks
async def main():
    t_c2u = asyncio.create_task(client2us_task())
    t_u2c = asyncio.create_task(us2client_task())
    t_srv = asyncio.create_task(connection_task())
    await asyncio.gather(t_c2u, t_u2c, t_srv)

print("App startup")
asyncio.run(main())

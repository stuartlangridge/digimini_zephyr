import sys

# ruff: noqa: E402
sys.path.append("")

from micropython import const

import asyncio
import aioble
import bluetooth

import random
import struct
import time

from primitives.broker import broker

# Custom UUIDs for our service
SERVICE_UUID = bluetooth.UUID("D191D191-F070-51DE-C0DE-B1EA550C1A7E")
CLIENT2US_CMD_UUID = bluetooth.UUID("D191D191-F070-FEED-1DEA-B1EA550C1A7E")
CLIENT2US_DATA_UUID = bluetooth.UUID("D191D191-F070-FEED-DA7A-B1EA550C1A7E")
US2CLIENT_UUID = bluetooth.UUID("D191D191-F070-ACCE-55E5-B1EA550C1A7E")

# How frequently to send advertising beacons.
_ADV_INTERVAL_US = 250_000


# Register GATT server.
service = aioble.Service(SERVICE_UUID)
client2us_cmd_characteristic = aioble.Characteristic(
    service, CLIENT2US_CMD_UUID, write=True, capture=True)
client2us_data_characteristic = aioble.Characteristic(
    service, CLIENT2US_DATA_UUID, write=True, capture=True)
us2client_characteristic = aioble.Characteristic(
    service, US2CLIENT_UUID, read=True, notify=True
)
aioble.register_services(service)
aioble.core.ble.gatts_set_buffer(client2us_data_characteristic._value_handle, 512)

class ChecksumAlreadyStartedError(Exception): pass
class Checksum:
    """calculate checksum by adding length (number of bytes sent)
       and sum of byte values sent, both mod 256, and return as 2 bytes
       this is a sort of half-arsed Adler checksum"""

    def __init__(self):
        # note: when first created we set this to None
        # so we can tell the difference between "just created" when
        # no data has been sent, and "0-0" which could be a valid checksum
        # so the process is:
        # when there's no transmission going on, global.checksum is unstarted
        # when a transmission is requested with send_data, start() the checksum
        # if you try to start() an already started checksum, complain
        # when a transmission ends/aborts, reset global.checksum
        self.reset()

    def start(self):
        self.len = 0
        self.sum = 0
        self.block_count = 0

    def started(self): return self.sum is not None

    def reset(self):
        self.len = None
        self.sum = None

    def add(self, data):
        if self.sum is None:
            raise ChecksumAlreadyStartedError("Checksum not started")
        for a in data:
            self.sum += a
        self.len += len(data)
        self.sum = self.sum % 256
        self.len = self.len % 256
        self.block_count += 1

    def get(self):
        return f"{self.sum},{self.len},{self.block_count}"

last_sent_cs = None

async def periodic_checksum_sender():
    global last_sent_cs
    while True:
        await asyncio.sleep_ms(5000)
        if checksum.started():
            current = checksum.get()
            if current != last_sent_cs:
                cs_str = f"dmcs:{current}"
                broker.publish("request_send_us2client", cs_str)
                print("Periodic CS (changed):", cs_str)
                last_sent_cs = current
            # else: skip sending duplicate

# listen for transmissions of data from them to us
# put those data on the incoming_data queue
# to be processed by the incoming_data_handler
async def client2us_data_listener():
    while True:
        try:
            res = await client2us_data_characteristic.written()
            if res:
                connection, data = res
                #print("Received data:", data, time.ticks_ms())
                broker.publish("incoming_data_handler", data)
        except asyncio.CancelledError:
            # Catch the CancelledError
            print("client2us_data_listener cancelled")
        except Exception as e:
            print("Error in client2us_data_listener:", e)
        finally:
            # Ensure the loop continues to the next iteration
            await asyncio.sleep_ms(500)

# listen for transmissions of commands from them to us
# put those commands on the incoming_cmd queue
# to be processed by the incoming_cmd_handler
async def client2us_cmd_listener():
    while True:
        try:
            res = await client2us_cmd_characteristic.written()
            if res:
                connection, cmd = res
                print("Received cmd:", cmd)
                broker.publish("incoming_cmd_handler", cmd)
        except asyncio.CancelledError:
            # Catch the CancelledError
            print("client2us_cmd_listener cancelled")
        except Exception as e:
            print("Error in client2us_cmd_listener:", e)
        finally:
            # Ensure the loop continues to the next iteration
            await asyncio.sleep_ms(500)

checksum = Checksum()

async def incoming_cmd_handler(channel, data):
    global checksum
    try:
        cmd = data.decode("utf-8")
    except Exception as e:
        print("badly formatted incoming command", repr(data))
        raise e

    if not cmd.startswith("dmcmd:"):
        print("invalid incoming command", cmd)
        return

    parts = cmd.split(":")

    if parts[1] == "send_data":
        try:
            blocks = int(parts[2])
        except:
            print("invalid incoming send_data command", parts)
            return
        # reset checksums
        try:
            checksum.start()
        except ChecksumAlreadyStartedError:
            print("Tried to initiate a send_data when there's already one")
            return
        # respond with dmres:goahead
        broker.publish("request_send_us2client", "dmres:goahead")
    elif parts[1] == "abort_data":
        if not checksum.started():
            print("Error: tried to abort_data when there is no transmission")
            return
        # recreate the checksum as just started
        checksum.reset()
        print("data aborted")
    elif parts[1] == "end_data":
        if not checksum.started():
            print("Error: tried to end_data when there is no transmission")
            return
        print("data ends (do whatever with file now)")
        # reset the checksum to unstarted
        checksum.reset()
    elif parts[1] == "request_cs":
        if checksum.started():
            cs_str = f"dmcs:{checksum.get()}"
            broker.publish("request_send_us2client", cs_str)
            print("On-demand CS sent")

# Add global counters for debugging
received_blocks = 0

async def incoming_data_handler(channel, data):
    global checksum, received_blocks
    if not checksum.started():
        return
    checksum.add(data)
    received_blocks += 1
    # print(f"Recv block {data}")
    # Still notify on modulo or periodic task
    if received_blocks % 50 == 0:
        cs_str = f"dmcs:{checksum.get()}"
        broker.publish("request_send_us2client", cs_str)

# listens to request_send_us2client queue and sends things on it
async def outgoing_message_sender(channel, data):
    #print("send to client", data, time.ticks_ms())
    us2client_characteristic.write(data, send_update=True)
    #print("send to client after send", data, time.ticks_ms())

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


async def main():
    t_srv = asyncio.create_task(connection_task())
    t_c2u_cmd = asyncio.create_task(client2us_cmd_listener())
    t_c2u_data = asyncio.create_task(client2us_data_listener())
    t_cssend = asyncio.create_task(periodic_checksum_sender())

    broker.subscribe("incoming_data_handler", incoming_data_handler)
    broker.subscribe("incoming_cmd_handler", incoming_cmd_handler)
    broker.subscribe("request_send_us2client", outgoing_message_sender)
    await asyncio.gather(t_c2u_cmd, t_c2u_data, t_srv, t_cssend)

print("App startup")
asyncio.run(main())

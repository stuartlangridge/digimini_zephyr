# BLE Debugging Notes

## Enabling Zephyr BT debug logging

Add the following to `micropython/ports/zephyr/boards/nrf52840dongle.conf`:

```
CONFIG_LOG=y
CONFIG_LOG_BACKEND_UART=y
CONFIG_BT_LOG_LEVEL_DBG=y
```

After rebuilding and flashing, log output appears in the same serial
stream as MicroPython, so it shows up in `mpremote` or `picocom
/dev/ttyACM0`.

**WARNING**: BT debug logging is extremely verbose and outputs via USB
CDC serial. If the USB serial buffer fills up, the BT host thread blocks
waiting for it to drain, which stalls BLE radio processing and causes
connection failures (0x3e "Connection Failed to be Established"). This
makes the logging self-defeating for connection issues: the act of
logging causes the problem you are trying to debug.

For the same reason, avoid `print()` calls in BLE connection handlers.
USB CDC serial print blocks when the buffer is full, which stalls the
BLE host and causes supervision timeouts.

## Using btmon on the Linux side

`btmon` captures all HCI traffic on the host (Linux) side without
affecting the peripheral. This is much more useful than on-device
logging for connection-level debugging:

```bash
sudo btmon
```

Run it in a separate terminal alongside your connection tool
(`bluetoothctl`, Chrome, etc.). It shows every HCI command, event, and
ACL data packet with full decoding.

## Using bluetoothctl for testing

`bluetoothctl` talks directly to BlueZ and bypasses Chrome's Web
Bluetooth layer. Useful for isolating whether a problem is
Chrome-specific or fundamental:

```bash
bluetoothctl
scan on
# wait for the device to appear
scan off
connect E4:2E:82:CD:C9:B0
```

## Known issues

### Intermittent 0x3e (Connection Failed to Establish)

The peripheral sometimes fails to respond at the first connection event.
This appears as 0x3e after ~235ms (6 missed connection events at 45ms
interval). It is intermittent and usually succeeds on retry. The cause
is not fully understood but may be related to timing of the MicroPython
event loop at connection establishment.

### 2M PHY breaks the Zephyr LL SW controller

The Zephyr BLE controller on nRF52840 (v4.2.1) has a bug where
switching to 2M PHY causes the controller to lose radio synchronisation.
The peripheral goes completely radio-silent after the PHY update. This
is worked around with `CONFIG_BT_CTLR_PHY_2M=n` in the board config.
This only manifests with BT5 centrals that request a PHY update.

### BlueZ 420ms supervision timeout

BlueZ hardcodes a 420ms supervision timeout for new LE connections. The
peripheral requests a 6s timeout via L2CAP Connection Parameter Update
at 100ms after connection. The LL-level parameter update path does not
work (blocked by the HCI command pipeline), so we force the L2CAP path
with `CONFIG_BT_CTLR_CONN_PARAM_REQ=n`.

### USB CDC serial blocking

Any output to the serial console (print, Zephyr LOG) can block the
calling thread when the USB CDC buffer is full. Since BLE host
processing runs in threads, blocking on serial output stalls radio
processing. Keep serial output minimal during BLE operation.

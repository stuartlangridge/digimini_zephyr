This is example code which successfully writes to the screen.

```python
from machine import SPI, Pin
import ST7735

spi = SPI("spi@40004000", baudrate=8_000_000)

display = ST7735.TFT(
    spi,
    ("gpio0", 15),   # aDC
    ("gpio0", 20),   # aReset
    ("gpio0", 13)    # aCS
)

backlight = Pin(("gpio0", 17), Pin.OUT, value=1)

display.initr()

# Fix dimensions for 160x80 mini display
display._size = (160, 80)

# Switch to BGR color order to match ESP32 config
display.rgb(False)

display.fill(ST7735.TFT.BLACK)
display.fillrect((20, 20), (88, 40), ST7735.TFT.RED)
```

Pin connections for this working setup with the nRF52840 dongle are:

ST7735 screen   | nRF52840 dongle
----------------+----------------
SCL             | 0.31
SDA             | 1.15
RES             | 0.20
DC              | 0.15
CS              | 0.13
BLK             | 3.3v

We can also tie BLK (backlight) to pin 29 which is defined as pwm0 in nrf52840dongle.overlay in micropython.

The pin headers need to be soldered to the dongle otherwise it doesn't work.
Turns out Reddit was right, cursedly.

Pins for rotary encoder are in rotary.py:

a = Pin(("gpio0", 2),  Pin.IN, Pin.PULL_UP)
b = Pin(("gpio0", 22), Pin.IN, Pin.PULL_UP)
sw = Pin(("gpio0", 24), Pin.IN, Pin.PULL_UP)

sw is a button
a and b go to the leftmost and rightmost pins on the rotary encoder.
middle pin on the rotary encoder goes to ground.



PWM for backlight on screens

# freq 10000 means it turns on and off 1000Hz, or 1,000,000ns
# so if you want it to be max brightness, set duty_ns=1,000,000
# so the backlight is on all the time
# if you want it to be min brightness set duty_ns to be 0
# 50% brightness is duty_ns 500,000
# power usage scales with brightness:
# at 0 brightness the power consumption of just the screen is ~4mA
# at 100% brightness the power consumption of both screens together is ~40mA
# at 50% brightness the power consumption of both screens together is ~20mA
pwm = PWM(("pwm0", 0), freq=1000, duty_ns=1_000_000, invert=True)

NOTE:

add pads to our board to let us do bootloader flashing

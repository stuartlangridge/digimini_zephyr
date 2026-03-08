from machine import SPI, Pin, PWM
import ST7735
import time
import deflate

spi = SPI("spi@40004000", baudrate=8_000_000)

display = ST7735.TFT(
    spi,
    ("gpio0", 15),   # aDC
    ("gpio0", 20),   # aReset
    ("gpio0", 13)    # aCS
)

backlight = Pin(("gpio0", 17), Pin.OUT, value=1)

ST7735.ScreenSize = (80, 160)

display.initr()

# Fix dimensions for 160x80 mini display
display._size = (80, 160)
display._offset = bytearray([24, 0])
# Switch to BGR color order to match ESP32 config
display.rgb(False)

display.fill(ST7735.TFT.BLACK)
display.fillrect((20, 20), (88, 40), ST7735.TFT.RED)

# note that this data is gzip compressed! needs to be decompressed
with open("/flash/images/cded6c00-e759-5931-bb11-93e2123974ba", mode="rb") as fp:
    with deflate.DeflateIO(fp, deflate.ZLIB, 12) as d:
        display._setwindowloc((0, 0), (79, 79))
        display._writedata(d.read(12800))
        display._setwindowloc((0, 80), (79, 159))
        display._writedata(d.read(12800))


# freq 10000 means it turns on and off 1000Hz, or 1,000,000ns
# so if you want it to be max brightness, set duty_ns=1,000,000
# so the backlight is on all the time
# if you want it to be min brightness set duty_ns to be 0
# 50% brightness is duty_ns 500,000
# power usage scales with brightness:
# at 0 brightness the power consumption of just the screen is ~4mA
# at 100% brightness the power consumption of both screens together is ~40mA
# at 50% brightness the power consumption of both screens together is ~20mA
pwm = PWM(("pwm0", 0), freq=1000, duty_ns=1_000_000)

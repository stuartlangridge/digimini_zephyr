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

ST7735.ScreenSize = (80, 160)

display.initr()

# Fix dimensions for 160x80 mini display
display._size = (80, 160)
display._offset = bytearray([24, 0])
# Switch to BGR color order to match ESP32 config
display.rgb(False)

display.fill(ST7735.TFT.BLACK)
display.fillrect((20, 20), (88, 40), ST7735.TFT.RED)
#
with open("/flash/images/af53b11b-0ce2-90b3-1a5b-5dfa5e6fcf6c", mode="rb") as fp:
    rgb565 = fp.read(12800)
    display._setwindowloc((0,0), (79,79))
    display._writedata(rgb565)

    rgb565 = fp.read(12800)

    display._setwindowloc((0,80), (79,159))
    display._writedata(rgb565)

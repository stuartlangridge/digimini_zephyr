import machine
import time

# SAADC register addresses
SAADC_BASE      = 0x40007000
SAADC_TASKS_START   = SAADC_BASE + 0x000
SAADC_TASKS_SAMPLE  = SAADC_BASE + 0x004
SAADC_TASKS_STOP    = SAADC_BASE + 0x008
SAADC_EVENTS_STARTED = SAADC_BASE + 0x100
SAADC_EVENTS_END    = SAADC_BASE + 0x104
SAADC_RESOLUTION = SAADC_BASE + 0x5F0
machine.mem32[SAADC_RESOLUTION] = 1   # 1 = 10-bit explicitly
SAADC_ENABLE        = SAADC_BASE + 0x500
SAADC_CH0_PSELP     = SAADC_BASE + 0x510  # positive input select
SAADC_CH0_CONFIG    = SAADC_BASE + 0x518
SAADC_RESULT_PTR    = SAADC_BASE + 0x62C
SAADC_RESULT_MAXCNT = SAADC_BASE + 0x630

# VDD input = 0x0D on nRF52840
VDD_INPUT = 0x0D

# We need a memory location to store the result
# Use a bytearray and get its address via uctypes
import uctypes
buf = bytearray(2)
buf_addr = uctypes.addressof(buf)

# Configure SAADC
machine.mem32[SAADC_ENABLE] = 1
machine.mem32[SAADC_CH0_PSELP] = VDD_INPUT       # measure VDD
machine.mem32[SAADC_CH0_CONFIG] = (0 << 0)        # gain 1/6, ref internal
machine.mem32[SAADC_RESULT_PTR] = buf_addr
machine.mem32[SAADC_RESULT_MAXCNT] = 1

# Start and sample
machine.mem32[SAADC_EVENTS_STARTED] = 0
machine.mem32[SAADC_TASKS_START] = 1
while machine.mem32[SAADC_EVENTS_STARTED] == 0:
    pass

machine.mem32[SAADC_EVENTS_END] = 0
machine.mem32[SAADC_TASKS_SAMPLE] = 1
while machine.mem32[SAADC_EVENTS_END] == 0:
    pass

machine.mem32[SAADC_TASKS_STOP] = 1
machine.mem32[SAADC_ENABLE] = 0

# Read result - it's a signed 16-bit value
raw = buf[0] | (buf[1] << 8)
if raw > 32767:
    raw -= 65536

import uctypes

# After sampling, before converting:
print("uctypes.addressof(buf):", uctypes.addressof(buf))
print(f"buf bytes: {buf[0]}, {buf[1]}")
print(f"buf_addr: {hex(buf_addr)}")
print(f"raw: {raw}")

# Convert: VDD with gain=1/6, ref=0.6V, 10-bit resolution
# VDD = raw * (0.6 * 6) / 1024
# Correct conversion:
# ADC measures VDD/4
# With gain=1/6, ref=0.6V, 10-bit unsigned:
# V_at_adc = raw * 3.6 / 1024
# VDD = V_at_adc * 4

vdd = raw * 3.6 / 1024 * 4
print(f"VDD: {vdd:.2f}V")
